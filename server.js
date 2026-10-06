import 'dotenv/config';
import express from 'express';
import path from 'path';
import cors from 'cors';
import crypto from 'crypto';
import mysql from 'mysql2/promise';
import session from 'express-session';
import MySQLStoreFactory from 'express-mysql-session';
import rateLimit from 'express-rate-limit'; 
import { fileURLToPath } from 'url';

// Fix for ES Module directory resolution (__dirname)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


const app = express();
const PORT = process.env.PORT || 5000;
const isProd = process.env.NODE_ENV === 'production';

if (!process.env.SESSION_SECRET) {
  console.error('SESSION_SECRET is missing. Set it in your environment.');
  process.exit(1);
}

// ===
// MIDDLEWARE
// ===

app.set('trust proxy', 1);

const allowedOrigins = [
  process.env.CLIENT_URL || 'https://dental-appointment-dt.netlify.app',
  'http://localhost:5173',
  'http://localhost:5000'
];


// Body parser for JSON payloads from fetch()
// CORS Configuration
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    console.error(`CORS blocked for origin: ${origin}`);
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  optionsSuccessStatus: 204
}));
 
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- Middleware ---
app.use((req, res, next) => {
    console.log(`Request URL: ${req.url}`);
    console.log(`Request Method: ${req.method}`);
    console.log(`Request Headers: ${JSON.stringify(req.headers)}`);
    next();
});

// --- MySQL Connection ---
const db = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || process.env.MYSQLPORT || 4000),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: process.env.DB_SSL === 'true' ? { minVersion: 'TLSv1.2', rejectUnauthorized: true } : undefined,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// --- Session Store ---
/*const MySQLStore = MySQLStoreFactory(session);
const sessionStore = new MySQLStore({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: process.env.DB_SSL === 'true' ? { minVersion: 'TLSv1.2', rejectUnauthorized: true } : undefined, 
    port: Number(process.env.MYSQLPORT || process.env.MYSQLPORT || 4000),
    clearExpired: true,
    checkExpirationInterval: 900000,
    expiration: 86400000,
});*/

const MySQLStore = MySQLStoreFactory(session);
// Create pool with SSL config explicitly
const sessionStore = new MySQLStore({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || process.env.MYSQLPORT || 4000),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: process.env.DB_SSL === 'true' ? { minVersion: 'TLSv1.2', rejectUnauthorized: true } : undefined,
    clearExpired: true,
    checkExpirationInterval: 900000,
    expiration: 86400000,
});

/*const sessionStore = new MySQLStore({
    // Pass the pre-configured pool
    connection: sessionPool,
    clearExpired: true,
    checkExpirationInterval: 900000,
    expiration: 86400000,
});*/

// Add this line BEFORE app.use(session(...))
app.set('trust proxy', 1);

app.use(session({
    name: 'user_sid',
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: sessionStore,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        sameSite: isProd ? 'none' : 'lax', 
        maxAge: 1000 * 60 * 60 * 24
    }
}));

/*const makeLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 50,
    message: { error: 'Too many requests, please try again later.'},
    standardHeaders: true,
    legacyHeaders: false,
});*/

const makeLimiter = () => (req, res, next) => next();

const otpLimiter = makeLimiter(5);     // each request costs you an SMS
const bookLimiter = makeLimiter(20);
const loginLimiter = makeLimiter(10);
const registerLimiter = makeLimiter(5);

async function initDb() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS appointments (
      id          VARCHAR(40)  PRIMARY KEY,
      fullname    VARCHAR(120) NOT NULL,
      service     VARCHAR(120) NOT NULL,
      \`date\`     DATE         NOT NULL,
      \`time\`     VARCHAR(20)  NOT NULL,
      phone       VARCHAR(20)  NOT NULL,
      otp         VARCHAR(20),
      status      ENUM('pending','confirmed','completed','cancelled') NOT NULL DEFAULT 'pending',
      created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS admin_invite_codes (
      code        VARCHAR(64)  PRIMARY KEY,
      created_by  VARCHAR(120) NOT NULL,
      created_at  TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
      used_by     VARCHAR(120) NULL,
      used_at     TIMESTAMP    NULL,
      expires_at  TIMESTAMP    NOT NULL
    )
  `);

  console.log('Database ready.');
}






// ====
// MEMORY DATABASE (RAM Array)
// ====

// In-memory OTP storage: { "09934415338": "123456" }
const otpStore = new Map();

// httpSMS Credentials (Reads from Environment Variables)
const HTTPSMS_API_KEY = process.env.HTTPSMS_API_KEY;
const HTTPSMS_PHONE_NUMBER = process.env.HTTPSMS_PHONE_NUMBER;

const SERVICES = ['cleaning', 'checkup', 'extraction', 'whitening', 'braces'];
const TIME_SLOTS = ['09:00', '10:30', '13:30', '15:00'];

// Helper: Format phone number to international E.164 (+63)
function formatPhoneNumber(phone) {
  if (!phone) return '';
  
  // Quick check: If the user typed a full international number with '+', preserve it
  if (phone.trim().startsWith('+')) {
    return '+' + phone.replace(/\D/g, '');
  }

  let cleaned = phone.replace(/\D/g, ''); // Strip non-digits

  // ===
  // COUNTRY PHONE FORMATTER PRESETS
  // ===

  // --- 1. PHILIPPINES (+63) --- [DEFAULT ACTIVE]
  // Local input: 09171234567, 9171234567, or 639171234567 -> Output: +639171234567
  if (cleaned.startsWith('0')) {
    cleaned = '63' + cleaned.slice(1);
  } else if (cleaned.length === 10 && cleaned.startsWith('9')) {
    cleaned = '63' + cleaned;
  } else if (!cleaned.startsWith('63')) {
    cleaned = '63' + cleaned;
  }

  // --- 2. USA / CANADA / US TERRITORIES (+1) ---
  // Local input: 5551234567 or 15551234567 -> Output: +15551234567
  /*
  if (cleaned.length === 10) {
    cleaned = '1' + cleaned;
  } else if (cleaned.startsWith('0')) {
    cleaned = '1' + cleaned.slice(1);
  }
  */

  // --- 3. UNITED KINGDOM (+44) ---
  // Local input: 07123456789 -> Output: +447123456789
  /*
  if (cleaned.startsWith('0')) {
    cleaned = '44' + cleaned.slice(1);
  } else if (!cleaned.startsWith('44')) {
    cleaned = '44' + cleaned;
  }
  */

  // --- 4. AUSTRALIA (+61) ---
  // Local input: 0412345678 -> Output: +61412345678
  /*
  if (cleaned.startsWith('0')) {
    cleaned = '61' + cleaned.slice(1);
  } else if (!cleaned.startsWith('61')) {
    cleaned = '61' + cleaned;
  }
  */

  // --- 5. JAPAN (+81) ---
  // Local input: 09012345678 -> Output: +819012345678
  /*
  if (cleaned.startsWith('0')) {
    cleaned = '81' + cleaned.slice(1);
  } else if (!cleaned.startsWith('81')) {
    cleaned = '81' + cleaned;
  }
  */

  // --- 6. PASSTHROUGH / INTERNATIONAL ---
  /*
  // Leaves 'cleaned' as-is
  */

  return '+' + cleaned;
}

// ====
// SEND OTP ENDPOINT
// ====
app.post('/api/send-otp', otpLimiter, async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) {
      return res.status(400).json({ success: false, error: 'Phone number is required.' });
    }

    const recipient = formatPhoneNumber(phone);
    const generatedOtp = Math.floor(100000 + Math.random() * 900000).toString();

    // Store OTP in RAM temporarily
    otpStore.set(recipient, { code: generatedOtp, expires: Date.now() + 5 * 60 * 1000 });

    // Call httpSMS API
    const response = await fetch('https://api.httpsms.com/v1/messages/send', {
      method: 'POST',
      headers: {
        'x-api-key': HTTPSMS_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        content: `Your Grace Dental Clinic OTP code is: ${generatedOtp}. Do not share this with anyone.`,
        from: HTTPSMS_PHONE_NUMBER,
        to: recipient
      })
    });

    const data = await response.json();

    if (response.ok) {
      return res.status(200).json({ success: true, message: 'OTP sent successfully via SMS.' });
    } else {
      return res.status(500).json({ success: false, error: data.message || 'Failed to send SMS.' });
    }
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});


app.post('/api/book-appointment', bookLimiter, async (req, res) => {
  try {
    const {
          fullname,
          service,
          date,
          time,
          phone,
          otp
        
        } = req.body;

    if (!fullname || !service || !date || !time || !phone || !otp) {
      return res.status(400).json({
        success: false,
        error: 'All fields are required.'
      });
    }


    const recipient = formatPhoneNumber(phone);
    const record = otpStore.get(recipient);
    if (!record || record.code !== String(otp) || Date.now() > record.expires) {
      return res.status(400).json({ success: false, error: 'Invalid or expired OTP.' });
    }
    otpStore.delete(recipient);

    const id = 'BOOK-' + Date.now();

    await db.query(
      'INSERT INTO appointments (id, fullname, service, date, time, phone, otp) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [id, fullname, service, date, time, phone, otp]
    );

    return res.status(201).json({
      success: true,
      message: 'Record permanently created in MySQL database.',
      data: { 
      id, 
      fullname, 
      service, 
      date, 
      time, 
      phone: recipient, status: 'pending' }
    });
  } catch (error) {
    console.error('Database Error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to insert record into database.'
    });
  }
});


// ====
// ADMIN LOGIN (credentials come from environment variables)
// ====
function safeEqual(a, b) {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
}
 
function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  return res.status(401).json({ success: false, error: 'Unauthorized.' });
}


// GET /api/admin/invite-codes — list all codes
app.get('/api/admin/invite-codes', requireAdmin, async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT code, created_by, created_at, used_by, used_at, expires_at,
             CASE 
               WHEN used_by IS NOT NULL THEN 'used'
               WHEN expires_at < NOW() THEN 'expired'
               ELSE 'unused'
             END AS status
      FROM admin_invite_codes
      ORDER BY created_at DESC
    `);
    return res.status(200).json(rows);
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Failed to fetch invite codes.' });
  }
});



// POST /api/admin/invite-codes — generate new code
app.post('/api/admin/invite-codes', requireAdmin, async (req, res) => {
  try {
    const code = crypto.randomBytes(16).toString('hex'); // 32-char hex
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
    
    await db.query(`
      INSERT INTO admin_invite_codes (code, created_by, expires_at)
      VALUES (?, ?, ?)
    `, [code, req.session.username || 'admin', expiresAt]);
    
    return res.status(201).json({ success: true, code, expiresAt });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Failed to generate code.' });
  }
});



// DELETE /api/admin/invite-codes/:code — revoke unused code
app.delete('/api/admin/invite-codes/:code', requireAdmin, async (req, res) => {
  try {
    const [result] = await db.query(`
      DELETE FROM admin_invite_codes WHERE code = ? AND used_by IS NULL
    `, [req.params.code]);
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, error: 'Code not found or already used.' });
    }
    return res.status(200).json({ success: true, message: 'Code revoked.' });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Failed to revoke code.' });
  }
});



app.post('/api/admin/register', registerLimiter, async (req, res) => {
  const { username, password, inviteCode } = req.body;

  const [codes] = await db.query(`
    SELECT * FROM admin_invite_codes 
    WHERE code = ? AND used_by IS NULL AND expires_at > NOW()
  `, [inviteCode]);
  
  if (codes.length === 0) {
    return res.status(403).json({ success: false, error: 'Invalid or expired invite code.' });
  }
  
  //const validInvite = process.env.ADMIN_INVITE_CODE && inviteCode === process.env.ADMIN_INVITE_CODE;
  //if (!validInvite) return res.status(403).json({ success: false, error: 'Invalid invite code.' });
  
  const okUser = process.env.ADMIN_USERNAME && safeEqual(username || '', process.env.ADMIN_USERNAME);
  const okPass = process.env.ADMIN_PASSWORD && safeEqual(password || '', process.env.ADMIN_PASSWORD);

  if (!okUser || !okPass) {
    return res.status(401).json({ success: false, error: 'Invalid credentials.' });
  }
  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ success: false, error: 'Registration failed.' });
    req.session.isAdmin = true;
    req.session.username = username;
    return res.status(200).json({ success: true, message: 'Admin registered.' });
  });
});




app.get('/api/admin/login', (req, res) =>
  res.json({ success: true, isAdmin: !!req.session?.isAdmin }));



 
app.post('/api/admin/login', loginLimiter, async (req, res) => {
  const { username, password } = req.body;
  const okUser = process.env.ADMIN_USERNAME && safeEqual(username || '', process.env.ADMIN_USERNAME);
  const okPass = process.env.ADMIN_PASSWORD && safeEqual(password || '', process.env.ADMIN_PASSWORD);
 
  if (!okUser || !okPass) {
    return res.status(401).json({ success: false, error: 'Invalid username or password.' });
  }
  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ success: false, error: 'Login failed.' });
    req.session.isAdmin = true;
    req.session.username = username;
    return res.status(200).json({ success: true, message: 'Logged in.' });
  });
});



 
app.post('/api/admin/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('user_sid');
    res.status(200).json({ success: true, message: 'Logged out.' });
  });
});



 
// ====
// ADMIN DASHBOARD ENDPOINTS
// ====
app.get('/api/appointments', requireAdmin, async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT id, fullname, service,
              DATE_FORMAT(date, '%Y-%m-%d') AS date,
              time AS time, phone, status, created_at AS createdAt
       FROM appointments
       ORDER BY created_at DESC`
    );
    return res.status(200).json(rows);
  } catch (error) {
    console.error('Fetch error:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch appointments.' });
  }
});




 
app.patch('/api/appointments/:id/status', requireAdmin, async (req, res) => {
  try {
    const { status } = req.body;
    const allowed = ['pending', 'confirmed', 'completed', 'cancelled'];
    if (!allowed.includes(status)) {
      return res.status(400).json({ success: false, error: 'Invalid status.' });
    }
    const [result] = await db.query('UPDATE appointments SET status = ? WHERE id = ?', [status, req.params.id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, error: 'Appointment not found.' });
    }
    return res.status(200).json({ success: true, message: 'Status updated.' });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Failed to update status.' });
  }
});




 
app.delete('/api/appointments/:id', requireAdmin, async (req, res) => {
  try {
    const [result] = await db.query('DELETE FROM appointments WHERE id = ?', [req.params.id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, error: 'Appointment not found.' });
    }
    return res.status(200).json({ success: true, message: 'Appointment deleted.' });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Failed to delete appointment.' });
  }
});



app.use((err, req, res, next) => {
  console.error('Error:', err);
  if (req.path.startsWith('/api/')) {
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
  next(err); // Let non-API errors fall through
});
 
app.get(/(.*)/, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});




 
initDb()
  .then(() => {
    app.listen(PORT, () => console.log(`Server is running on http://localhost:${PORT}`));
  })
  .catch((err) => {
    console.error('Could not connect to the database:', err.message);
    process.exit(1);
  });

    //Can change anytime if you want to use a database like MongoDB, or PostgrelSQL, For now we will just use an array to store the data in RAM for demo purposes.
    //database.push(newBooking);








































// ———————————————————————————————————————————————————————————————————————————————————————————————————————————————————————


/*app.delete('/api/demo/items/:id', (req, res) => {
  try {
    const { id } = req.params;
    const index = database.findIndex((item) => item.id === id);

    if (index === -1) {
      return res.status(404).json({
        success: false,
        error: 'Demo record not found.'
      });
    }

    database.splice(index, 1);

    return res.status(200).json({
      success: true,
      message: `Demo record ${id} deleted successfully.`
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: 'Failed to delete demo record.'
    });
  }
});*/

app.get(/^\/(?!api\/).*/, (req, res) => {
  // Only matches non-API routes
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});

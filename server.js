import express from 'express';
import path from 'path';
import cors from 'cors';
import { fileURLToPath } from 'url';

// Fix for ES Module directory resolution (__dirname)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 5000;

// ===
// MIDDLEWARE
// ===
// Body parser for JSON payloads from fetch()
app.use(express.json());
app.use(cors());

// Serve static frontend files (HTML, CSS, client-side JS) from 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// ====
// MEMORY DATABASE (RAM Array)
// ====
const database = [];

// In-memory OTP storage: { "09934415338": "123456" }
const otpStore = new Map();

// httpSMS Credentials (Reads from Environment Variables)
const HTTPSMS_API_KEY = process.env.HTTPSMS_API_KEY;
const HTTPSMS_SENDER_NUMBER = process.env.HTTPSMS_PHONE_NUMBER || '+639934415338';

// Helper: Format phone number to international E.164 (+63)
function formatPhoneNumber(phone) {
  let cleaned = phone.replace(/\D/g, '');
  if (cleaned.startsWith('0')) {
    cleaned = '63' + cleaned.slice(1);
  }
  return '+' + cleaned;
}

// ====
// SEND OTP ENDPOINT
// ====
app.post('/api/send-otp', async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) {
      return res.status(400).json({ success: false, error: 'Phone number is required.' });
    }

    const recipient = formatPhoneNumber(phone);
    const generatedOtp = Math.floor(100000 + Math.random() * 900000).toString();

    // Store OTP in RAM temporarily
    otpStore.set(recipient, generatedOtp);

    // Call httpSMS API
    const response = await fetch('https://api.httpsms.com/v1/messages/send', {
      method: 'POST',
      headers: {
        'x-api-key': HTTPSMS_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        content: `Your Grace Dental Clinic OTP code is: ${generatedOtp}. Do not share this with anyone.`,
        from: HTTPSMS_SENDER_NUMBER,
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


app.post('/api/book-appointment', (req, res) => {
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

    const newBooking = {
      id: 'BOOK-' + Date.now(),
      fullname,
      service,
      date,
      time,
      phone,
      otp,
      createdAt: new Date().toISOString()
    };

    database.push(newBooking);

    //Since no database is used, the data will be stored in RAM and will be last until the server is restarted. This is for demo purposes only. In a real application you would use a database like MongoDB, PostgreSQL, etc. to persist data.
    
    console.log('New booking added:', newBooking);
    console.log('Current database state:', database);
    console.log('Total bookings:', database.length);


    return res.status(201).json({
      success: true,
      message: 'Appointment booked successfully!',
      data: newBooking
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: 'Failed to create demo record.'
    });
  }
});


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

app.get('/{*splat}', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});

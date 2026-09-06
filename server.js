import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

// Fix for ES Module directory resolution (__dirname)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 5000;

// =============================================================================
// 1. MIDDLEWARE
// =============================================================================
// Body parser for JSON payloads from fetch()
app.use(express.json());

// Serve static frontend files (HTML, CSS, client-side JS) from 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// =============================================================================
// 2. IN-MEMORY DATABASE (RAM Array)
// =============================================================================
const database = [];


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

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});

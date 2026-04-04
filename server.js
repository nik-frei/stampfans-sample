const express = require('express');
const path = require('path');
const multer = require('multer');
const app = express();

// ── Config from environment variables ──
const {
  AIRTABLE_API_KEY,
  AIRTABLE_BASE_ID = 'appUFMUrxeNoltVId',
  AIRTABLE_TABLE_NAME = 'Samples',
  AIRTABLE_PDF_FIELD = 'Document',
  STRIPE_PAYMENT_LINK = 'https://buy.stripe.com/eVqcN5gFI5bjggq1n46wR3S',
} = process.env;

// Multer stores file in memory as a Buffer
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') cb(null, true);
    else cb(new Error('Only PDF files are allowed'));
  },
});

// Serve static frontend
app.use(express.static(path.join(__dirname, 'public')));

// ── GET /config — returns only the Stripe link (safe for frontend) ──
app.get('/config', (req, res) => {
  res.json({ stripePaymentLink: STRIPE_PAYMENT_LINK });
});

// ── POST /submit — creates Airtable record, returns record ID ──
app.post('/submit', express.json({ limit: '1mb' }), async (req, res) => {
  try {
    const { fields } = req.body;
    if (!fields) return res.status(400).json({ error: 'Missing fields' });

    console.log('Creating Airtable record...');

    const createRes = await fetch(
      `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(AIRTABLE_TABLE_NAME)}`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${AIRTABLE_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ fields }),
      }
    );

    if (!createRes.ok) {
      const err = await createRes.json().catch(() => ({}));
      console.error('Airtable create error:', err);
      return res.status(createRes.status).json({ error: err.error?.message || 'Airtable error' });
    }

    const record = await createRes.json();
    console.log('Airtable record created:', record.id);
    res.json({ recordId: record.id });
  } catch (err) {
    console.error('Submit error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /upload-pdf/:recordId — uploads PDF to Airtable Content API ──
app.post('/upload-pdf/:recordId', upload.single('pdf'), async (req, res) => {
  try {
    const { recordId } = req.params;

    if (!req.file) {
      console.error('No PDF file received');
      return res.status(400).json({ error: 'No PDF file received' });
    }

    const fileName = req.file.originalname || 'sample.pdf';
    console.log(`Uploading PDF for record ${recordId}: ${fileName} (${req.file.size} bytes)`);

    // Convert Buffer to Uint8Array for fetch compatibility
    const body = new Uint8Array(req.file.buffer);

    const url = `https://content.airtable.com/v0/${AIRTABLE_BASE_ID}/${recordId}/${encodeURIComponent(AIRTABLE_PDF_FIELD)}/uploadAttachment`;
    console.log('Upload URL:', url);

    const uploadRes = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${AIRTABLE_API_KEY}`,
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${fileName}"`,
      },
      body: body,
    });

    if (!uploadRes.ok) {
      const errBody = await uploadRes.text();
      console.error('Airtable upload error:', uploadRes.status, errBody);
      return res.status(uploadRes.status).json({ error: errBody || 'Upload failed' });
    }

    console.log('PDF uploaded successfully for record', recordId);
    res.json({ success: true });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`StampFans Sample Mailer running on port ${PORT}`);
});

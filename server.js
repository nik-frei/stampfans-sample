const express = require('express');
const path = require('path');
const multer = require('multer');
const crypto = require('crypto');
const app = express();

// ── Config from environment variables ──
const {
  AIRTABLE_API_KEY,
  AIRTABLE_BASE_ID = 'appUFMUrxeNoltVId',
  AIRTABLE_TABLE_NAME = 'Samples',
  AIRTABLE_PDF_FIELD = 'Document',
  STRIPE_PAYMENT_LINK,
  PUBLIC_BASE_URL, // e.g. https://stampfans-sample.onrender.com
} = process.env;

// ── Temp file store (in-memory, same pattern as creator portal) ──
const TEMP_FILES = new Map();
const TEMP_TTL_MS = 5 * 60 * 1000; // 5 minutes

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of TEMP_FILES.entries()) {
    if (now > v.expiresAt) TEMP_FILES.delete(k);
  }
}, 60 * 1000);

// ── Multer for file uploads ──
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') cb(null, true);
    else cb(new Error('Only PDF files are allowed'));
  },
});

// ── Serve static frontend ──
app.use(express.static(path.join(__dirname, 'public')));

// ── Serve temp files for Airtable to fetch ──
app.get('/tmp/:token', (req, res) => {
  const item = TEMP_FILES.get(req.params.token);
  if (!item) return res.status(404).send('Not found');
  if (Date.now() > item.expiresAt) {
    TEMP_FILES.delete(req.params.token);
    return res.status(410).send('Expired');
  }
  res.setHeader('Content-Type', item.mime || 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${(item.filename || 'upload.pdf').replaceAll('"', '')}"`);
  res.send(item.buffer);
});

// ── GET /config ──
app.get('/config', (req, res) => {
  res.json({ stripePaymentLink: STRIPE_PAYMENT_LINK });
});

// ── POST /submit — creates Airtable record ──
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

// ── POST /upload-pdf/:recordId — store temp file, then PATCH Airtable with URL ──
app.post('/upload-pdf/:recordId', upload.single('pdf'), async (req, res) => {
  try {
    const { recordId } = req.params;

    if (!req.file) {
      console.error('No PDF file received');
      return res.status(400).json({ error: 'No PDF file received' });
    }

    const filename = req.file.originalname || 'sample.pdf';
    console.log(`Uploading PDF for record ${recordId}: ${filename} (${req.file.size} bytes)`);

    // 1) Store PDF in memory with a temp token
    const token = crypto.randomBytes(24).toString('hex');
    TEMP_FILES.set(token, {
      buffer: req.file.buffer,
      mime: req.file.mimetype,
      filename,
      expiresAt: Date.now() + TEMP_TTL_MS,
    });

    const baseUrl = PUBLIC_BASE_URL || `https://${req.get('host')}`;
    const fileUrl = `${baseUrl}/tmp/${token}`;
    console.log('Temp file URL for Airtable:', fileUrl);

    // 2) PATCH Airtable record with the temp URL
    const patchUrl = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(AIRTABLE_TABLE_NAME)}/${recordId}`;
    const patchRes = await fetch(patchUrl, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${AIRTABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        fields: {
          [AIRTABLE_PDF_FIELD]: [
            { url: fileUrl, filename: filename }
          ],
        },
      }),
    });

    if (!patchRes.ok) {
      const errBody = await patchRes.text();
      console.error('Airtable PATCH error:', patchRes.status, errBody);
      return res.status(patchRes.status).json({ error: errBody || 'Upload failed' });
    }

    console.log('PDF attached successfully for record', recordId);

    // 3) Clean up temp file after 2 minutes
    setTimeout(() => TEMP_FILES.delete(token), 2 * 60 * 1000);

    res.json({ success: true });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Error handler for multer ──
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'PDF too large. Please keep it under 25MB.' });
  }
  if (err.message === 'Only PDF files are allowed') {
    return res.status(400).json({ error: 'Only PDF files are accepted.' });
  }
  next(err);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`StampFans Sample Mailer running on port ${PORT}`);
});

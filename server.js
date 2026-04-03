const express = require('express');
const path = require('path');
const app = express();

// ── Config from environment variables ──
const {
  AIRTABLE_API_KEY,
  AIRTABLE_BASE_ID = 'appUFMUrxeNoltVId',
  AIRTABLE_TABLE_NAME = 'Samples',
  AIRTABLE_PDF_FIELD = 'Document',
  STRIPE_PAYMENT_LINK = 'https://buy.stripe.com/eVqcN5gFI5bjggq1n46wR3S',
} = process.env;

// Parse JSON bodies (for the record fields)
app.use(express.json({ limit: '1mb' }));

// Serve static frontend
app.use(express.static(path.join(__dirname, 'public')));

// ── GET /config — returns only the Stripe link (safe for frontend) ──
app.get('/config', (req, res) => {
  res.json({ stripePaymentLink: STRIPE_PAYMENT_LINK });
});

// ── POST /submit — creates Airtable record, returns record ID ──
app.post('/submit', async (req, res) => {
  try {
    const { fields } = req.body;
    if (!fields) return res.status(400).json({ error: 'Missing fields' });

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
      return res.status(createRes.status).json({ error: err.error?.message || 'Airtable error' });
    }

    const record = await createRes.json();
    res.json({ recordId: record.id });
  } catch (err) {
    console.error('Submit error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /upload-pdf/:recordId — uploads PDF to Airtable Content API ──
app.post('/upload-pdf/:recordId', express.raw({ type: 'application/pdf', limit: '25mb' }), async (req, res) => {
  try {
    const { recordId } = req.params;
    const fileName = req.headers['x-filename'] || 'sample.pdf';

    const uploadRes = await fetch(
      `https://content.airtable.com/v0/${AIRTABLE_BASE_ID}/${recordId}/${encodeURIComponent(AIRTABLE_PDF_FIELD)}/uploadAttachment`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${AIRTABLE_API_KEY}`,
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="${fileName}"`,
        },
        body: req.body,
      }
    );

    if (!uploadRes.ok) {
      const err = await uploadRes.json().catch(() => ({}));
      return res.status(uploadRes.status).json({ error: err.error?.message || 'Upload failed' });
    }

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

const express = require('express');
const twilio = require('twilio');
const { WhatsAppBookingService } = require('../services/WhatsAppBookingService');

const router = express.Router();
const bookingService = new WhatsAppBookingService();

function validateTwilioSignature(req) {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken || process.env.CURA_WHATSAPP_SKIP_SIGNATURE === 'true') {
    return true;
  }
  const signature = req.headers['x-twilio-signature'];
  if (!signature) return false;
  const url =
    process.env.TWILIO_WEBHOOK_URL ||
    `${req.protocol}://${req.get('host')}${req.originalUrl}`;
  return twilio.validateRequest(authToken, signature, url, req.body || {});
}

/**
 * Twilio WhatsApp inbound webhook.
 * Configure in Twilio Console → WhatsApp sender → "When a message comes in".
 */
router.post('/whatsapp', async (req, res) => {
  try {
    if (!validateTwilioSignature(req)) {
      console.warn('[whatsapp-webhook] invalid Twilio signature');
      return res.status(403).type('text/plain').send('Forbidden');
    }

    const from = req.body?.From || req.body?.from || '';
    const body = req.body?.Body || req.body?.body || '';
    const clinicIdHint = req.query?.clinicId || req.body?.clinicId;

    const result = await bookingService.handleInbound({ from, body, clinicIdHint });
    const reply = result?.reply || 'Thank you. Reply *book* to schedule a visit.';

    res.type('text/xml');
    res.send(
      `<?xml version="1.0" encoding="UTF-8"?>` +
        `<Response><Message>${escapeXml(reply)}</Message></Response>`
    );
  } catch (err) {
    console.error('[whatsapp-webhook]', err);
    res.type('text/xml');
    res.send(
      `<?xml version="1.0" encoding="UTF-8"?>` +
        `<Response><Message>Sorry, we could not process your message. Please try again or call the clinic.</Message></Response>`
    );
  }
});

function escapeXml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

module.exports = router;

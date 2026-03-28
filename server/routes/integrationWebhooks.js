/**
 * Zoom + Microsoft Graph webhook receivers (validation + event logging).
 * Actual bot media (joining meetings, capturing audio) runs in a separate worker
 * that uses Zoom Meeting SDK / Teams Graph Communications — see docs/MEETING_BOTS_ZOOM_TEAMS.md
 */

const crypto = require('crypto');

function verifyZoomSignature(req, bodyBuffer, secret) {
  const sig = req.headers['x-zm-signature'];
  const ts = req.headers['x-zm-request-timestamp'];
  if (!sig || !ts || !secret || !bodyBuffer) return false;
  const bodyStr = bodyBuffer.toString('utf8');
  const message = `v0:${ts}:${bodyStr}`;
  const hash = crypto.createHmac('sha256', secret).update(message).digest('hex');
  const expected = `v0=${hash}`;
  try {
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch (_) {
    return false;
  }
}

async function zoomWebhook(req, res) {
  const secret = process.env.ZOOM_WEBHOOK_SECRET_TOKEN;
  const buf = Buffer.isBuffer(req.body)
    ? req.body
    : Buffer.from(typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {}));

  if (!secret) {
    console.warn('[integrations/zoom] ZOOM_WEBHOOK_SECRET_TOKEN not set — ignoring');
    return res.status(503).json({ error: 'Zoom webhooks not configured' });
  }

  let payload;
  try {
    payload = JSON.parse(buf.toString('utf8'));
  } catch (e) {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  if (payload.event === 'endpoint.url_validation') {
    const plainToken = payload.payload?.plainToken;
    if (!plainToken) return res.status(400).json({ error: 'Missing plainToken' });
    const enc = crypto.createHmac('sha256', secret).update(plainToken).digest('hex');
    return res.status(200).json({
      plainToken,
      encryptedToken: enc,
    });
  }

  if (!verifyZoomSignature(req, buf, secret)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const { handleZoomWebhookEvent } = require('../utils/zoomWebhookHandlers');
  try {
    const result = await handleZoomWebhookEvent(payload);
    if (process.env.NODE_ENV !== 'production') {
      console.log('[integrations/zoom] event:', payload.event, result);
    }
  } catch (e) {
    console.error('[integrations/zoom] handler error:', e.message);
  }

  return res.status(200).json({ received: true });
}

/**
 * Microsoft Graph change notifications — validation uses ?validationToken=
 */
function teamsGraphWebhook(req, res) {
  const token = req.query.validationToken;
  if (token) {
    res.set('Content-Type', 'text/plain');
    return res.status(200).send(decodeURIComponent(token));
  }

  if (process.env.NODE_ENV !== 'production' && req.body) {
    console.log(
      '[integrations/teams] notification batch:',
      Array.isArray(req.body?.value) ? req.body.value.length : 0
    );
  }

  // TODO: verify clientState, enqueue bot/recording pipeline
  return res.status(202).json({ received: true });
}

module.exports = {
  zoomWebhook,
  teamsGraphWebhook,
};

/**
 * Dispatch “join meeting” jobs to an external bot worker (Zoom Meeting SDK Linux, etc.).
 *
 * Configure either:
 *   CONFERENCE_BOT_WEBHOOK_URL or ZOOM_BOT_WORKER_URL — POST JSON job
 *   CONFERENCE_BOT_WEBHOOK_SECRET — optional HMAC SHA-256 of raw body, header X-PortIQ-Signature: hex
 *
 * Without a URL, jobs are logged in dev and skipped in production (see return reason).
 */

const crypto = require('crypto');

const fetch = global.fetch;

/**
 * @param {object} job
 * @param {string} job.meetingId
 * @param {string} [job.adminId]
 * @param {'zoom'|'teams'} job.provider
 * @param {string} job.joinUrl
 * @param {string|null} [job.externalMeetingId]
 * @param {string|null} [job.scheduledTime] ISO
 */
async function enqueueJoinMeeting(job) {
  const url =
    process.env.CONFERENCE_BOT_WEBHOOK_URL ||
    process.env.ZOOM_BOT_WORKER_URL ||
    '';
  const secret = process.env.CONFERENCE_BOT_WEBHOOK_SECRET || '';

  if (!url) {
    if (process.env.NODE_ENV !== 'production') {
      console.log(
        '[conferenceBotQueue] enqueueJoinMeeting (no worker URL) meetingId=%s provider=%s',
        job?.meetingId,
        job?.provider
      );
    }
    return { queued: false, reason: 'worker_url_not_configured' };
  }

  const body = JSON.stringify({
    v: 1,
    type: 'conference.join',
    ...job,
    enqueuedAt: new Date().toISOString(),
  });

  const headers = {
    'Content-Type': 'application/json',
    'User-Agent': 'PortIQ-API/1.0',
  };
  if (secret) {
    const sig = crypto.createHmac('sha256', secret).update(body).digest('hex');
    headers['X-PortIQ-Signature'] = sig;
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body,
    });
    const text = await res.text().catch(() => '');
    if (!res.ok) {
      console.warn('[conferenceBotQueue] worker HTTP', res.status, text.slice(0, 200));
      return { queued: false, reason: 'worker_http_error', status: res.status };
    }
    return { queued: true, status: res.status };
  } catch (e) {
    console.error('[conferenceBotQueue]', e.message);
    return { queued: false, reason: e.message || 'fetch_failed' };
  }
}

module.exports = {
  enqueueJoinMeeting,
};

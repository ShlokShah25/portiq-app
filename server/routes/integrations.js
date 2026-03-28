const express = require('express');
const router = express.Router();

/**
 * Public capability flags (no secrets). Used by client to show “Connect Zoom” when ready.
 */
router.get('/status', (req, res) => {
  res.json({
    zoomWebhook: !!process.env.ZOOM_WEBHOOK_SECRET_TOKEN,
    zoomOAuthClient: !!process.env.ZOOM_CLIENT_ID,
    zoomOAuthRedirect: !!process.env.ZOOM_OAUTH_REDIRECT_URI,
    conferenceBotWorkerUrl: !!(
      process.env.CONFERENCE_BOT_WEBHOOK_URL || process.env.ZOOM_BOT_WORKER_URL
    ),
    conferenceBotWorkerSecret: !!process.env.CONFERENCE_BOT_WEBHOOK_SECRET,
    workerCallbackSecret: !!process.env.PORTIQ_WORKER_SECRET,
    teamsGraphApp: !!(
      process.env.TEAMS_GRAPH_CLIENT_ID || process.env.MICROSOFT_CLIENT_ID
    ),
    teamsOAuthRedirect: !!process.env.TEAMS_OAUTH_REDIRECT_URI,
    teamsTenantHint: !!(
      process.env.TEAMS_APP_TENANT_ID || process.env.MICROSOFT_TENANT_ID
    ),
    conferenceBotsNote:
      'Joining meetings and capturing audio runs in a separate bot worker; webhooks land here first.',
    allowManualMeetingPlatforms: process.env.ALLOW_MANUAL_MEETING_PLATFORMS === 'true',
  });
});

module.exports = router;

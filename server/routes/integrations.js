const express = require('express');
const router = express.Router();

/**
 * Public capability flags (no secrets). Used by client to show “Connect Zoom” when ready.
 */
router.get('/status', (req, res) => {
  res.json({
    zoomWebhook: !!process.env.ZOOM_WEBHOOK_SECRET_TOKEN,
    zoomOAuthClient: !!process.env.ZOOM_CLIENT_ID,
    teamsGraphApp: !!process.env.TEAMS_GRAPH_CLIENT_ID,
    teamsTenantHint: !!process.env.TEAMS_APP_TENANT_ID,
    conferenceBotsNote:
      'Joining meetings and capturing audio runs in a separate bot worker; webhooks land here first.',
  });
});

module.exports = router;

/**
 * Authenticated callbacks from the conference bot worker (Zoom Meeting SDK Linux, etc.).
 * Set PORTIQ_WORKER_SECRET on API + worker; worker sends header X-PortIQ-Worker-Secret.
 */

const express = require('express');
const fetch = global.fetch;
const Meeting = require('../models/Meeting');
const { getZoomAccessTokenForAdmin } = require('../utils/zoomOAuthTokens');

const router = express.Router();

function assertWorkerAuth(req, res) {
  const secret = process.env.PORTIQ_WORKER_SECRET;
  if (!secret) {
    res.status(503).json({ error: 'Worker callbacks not configured (PORTIQ_WORKER_SECRET)' });
    return false;
  }
  const sent = String(req.get('x-portiq-worker-secret') || '');
  if (sent !== secret) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  return true;
}

const ALLOWED_BOT = ['', 'queued', 'joining', 'in_meeting', 'ended', 'failed'];

/**
 * Worker-only: OAuth-backed Zoom join context (ZAK + URLs). Authenticate with X-PortIQ-Worker-Secret.
 * Requires the Zoom app to grant a ZAK scope (e.g. user_zak:read) and matching ZOOM_OAUTH_SCOPES.
 */
router.post('/worker/zoom/join-context', express.json({ limit: '64kb' }), async (req, res) => {
  try {
    if (!assertWorkerAuth(req, res)) return;

    const meetingId = req.body?.meetingId;
    if (!meetingId) {
      return res.status(400).json({ error: 'meetingId is required' });
    }

    const meeting = await Meeting.findById(meetingId);
    if (!meeting) {
      return res.status(404).json({ error: 'Meeting not found' });
    }

    if (String(meeting.conferenceProvider || '').toLowerCase() !== 'zoom') {
      return res.status(400).json({ error: 'Meeting is not a Zoom conference' });
    }

    const joinUrl = meeting.conferenceJoinUrl ? String(meeting.conferenceJoinUrl).trim() : '';
    if (!joinUrl) {
      return res.status(400).json({ error: 'Meeting has no conferenceJoinUrl' });
    }

    const adminId = meeting.adminId ? meeting.adminId.toString() : null;
    let zak = null;
    let zakError = null;

    if (adminId) {
      const accessToken = await getZoomAccessTokenForAdmin(adminId);
      if (!accessToken) {
        zakError = 'no_zoom_access_token';
      } else {
        const zr = await fetch('https://api.zoom.us/v2/users/me/token?type=zak', {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const zj = await zr.json().catch(() => ({}));
        if (!zr.ok) {
          zakError =
            zj.message || zj.reason || zj.error || `zoom_http_${zr.status}`;
        } else if (zj.token) {
          zak = String(zj.token);
        } else {
          zakError = 'zoom_zak_missing_in_response';
        }
      }
    } else {
      zakError = 'no_admin_on_meeting';
    }

    return res.json({
      meetingId: meeting._id.toString(),
      joinUrl,
      externalMeetingId: meeting.externalMeetingId
        ? String(meeting.externalMeetingId)
        : null,
      zak,
      zakError: zak ? undefined : zakError || undefined,
    });
  } catch (e) {
    console.error('[worker/zoom/join-context]', e);
    return res.status(500).json({ error: 'Failed to load join context' });
  }
});

router.post('/bot/report', express.json({ limit: '4mb' }), async (req, res) => {
  try {
    if (!assertWorkerAuth(req, res)) return;

    const {
      meetingId,
      conferenceBotStatus,
      status: meetingStatus,
      transcriptionStatus,
      audioFile,
      error: workerError,
    } = req.body || {};

    if (!meetingId) {
      return res.status(400).json({ error: 'meetingId is required' });
    }

    const meeting = await Meeting.findById(meetingId);
    if (!meeting) {
      return res.status(404).json({ error: 'Meeting not found' });
    }

    if (conferenceBotStatus !== undefined) {
      const v = String(conferenceBotStatus).trim().toLowerCase();
      if (!ALLOWED_BOT.includes(v)) {
        return res.status(400).json({ error: 'Invalid conferenceBotStatus' });
      }
      meeting.conferenceBotStatus = v;
    }

    if (meetingStatus !== undefined) {
      const allowed = ['Scheduled', 'In Progress', 'Completed', 'Cancelled'];
      if (allowed.includes(meetingStatus)) {
        meeting.status = meetingStatus;
      }
    }

    if (transcriptionStatus !== undefined) {
      const allowedT = ['Not Started', 'Recording', 'Processing', 'Completed', 'Failed'];
      if (allowedT.includes(transcriptionStatus)) {
        meeting.transcriptionStatus = transcriptionStatus;
      }
    }

    if (audioFile !== undefined && audioFile !== null) {
      meeting.audioFile = String(audioFile).trim().slice(0, 2048) || null;
    }

    if (workerError) {
      console.warn('[bot/report] worker note:', meetingId, String(workerError).slice(0, 500));
    }

    await meeting.save();
    return res.json({ success: true, meeting });
  } catch (e) {
    console.error('[bot/report]', e);
    return res.status(500).json({ error: 'Failed to update meeting' });
  }
});

module.exports = router;

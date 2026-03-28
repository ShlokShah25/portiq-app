/**
 * Authenticated callbacks from the conference bot worker (Zoom Meeting SDK Linux, etc.).
 * Set PORTIQ_WORKER_SECRET on API + worker; worker sends header X-PortIQ-Worker-Secret.
 */

const express = require('express');
const Meeting = require('../models/Meeting');

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

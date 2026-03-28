/**
 * Zoom account-level webhook events → update PortIQ Meeting + optional bot queue.
 * Subscribe in Zoom Marketplace to meeting.* events for your account.
 */

const Meeting = require('../models/Meeting');
const { enqueueJoinMeeting } = require('./conferenceBotQueue');

function zoomObjectId(obj) {
  if (!obj || obj.id == null) return '';
  return String(obj.id);
}

/**
 * Find a PortIQ meeting that corresponds to a Zoom webhook payload object.
 */
async function findMeetingForZoomPayload(zoomObject) {
  const mid = zoomObjectId(zoomObject);
  if (!mid) return null;

  let m = await Meeting.findOne({
    conferenceProvider: 'zoom',
    externalMeetingId: mid,
  });
  if (m) return m;

  const joinUrl = zoomObject.join_url && String(zoomObject.join_url);
  if (joinUrl) {
    m = await Meeting.findOne({
      conferenceProvider: 'zoom',
      conferenceJoinUrl: joinUrl,
    });
    if (m) return m;
  }

  const re = new RegExp(`/${mid}(?:\\?|$|/)`);
  m = await Meeting.findOne({
    conferenceProvider: 'zoom',
    conferenceJoinUrl: re,
  });
  return m;
}

/**
 * @param {object} payload full Zoom webhook JSON (after URL validation)
 */
async function handleZoomWebhookEvent(payload) {
  const event = payload?.event;
  const obj = payload?.payload?.object;

  if (!event || !obj) {
    return { handled: false, reason: 'missing_event_or_object' };
  }

  const meeting = await findMeetingForZoomPayload(obj);
  if (!meeting) {
    if (process.env.NODE_ENV !== 'production') {
      console.log('[zoomWebhook] no local meeting for event', event, zoomObjectId(obj));
    }
    return { handled: true, matched: false, event };
  }

  const mid = zoomObjectId(obj);
  if (mid && !meeting.externalMeetingId) {
    meeting.externalMeetingId = mid;
    await meeting.save();
  }

  switch (event) {
    case 'meeting.started': {
      if (meeting.status === 'Scheduled') {
        meeting.status = 'In Progress';
      }
      if (!meeting.startTime) {
        meeting.startTime = new Date();
      }
      await meeting.save();

      if (
        meeting.conferenceJoinUrl &&
        ['', 'queued', 'failed'].includes(String(meeting.conferenceBotStatus || '').toLowerCase())
      ) {
        await enqueueJoinMeeting({
          meetingId: meeting._id.toString(),
          adminId: meeting.adminId ? meeting.adminId.toString() : null,
          provider: 'zoom',
          joinUrl: meeting.conferenceJoinUrl,
          externalMeetingId: meeting.externalMeetingId || mid,
          scheduledTime: meeting.scheduledTime
            ? meeting.scheduledTime.toISOString()
            : null,
          trigger: 'webhook.meeting.started',
        });
      }
      return { handled: true, matched: true, event, meetingId: meeting._id.toString() };
    }

    case 'meeting.ended': {
      meeting.conferenceBotStatus = 'ended';
      if (meeting.status === 'In Progress') {
        meeting.status = 'Completed';
      }
      if (!meeting.endTime) {
        meeting.endTime = new Date();
      }
      await meeting.save();
      return { handled: true, matched: true, event, meetingId: meeting._id.toString() };
    }

    case 'recording.completed': {
      // Future: map recording download URLs to transcription pipeline
      return { handled: true, matched: true, event, meetingId: meeting._id.toString() };
    }

    default:
      return { handled: true, matched: true, event, meetingId: meeting._id.toString(), noop: true };
  }
}

module.exports = {
  handleZoomWebhookEvent,
  findMeetingForZoomPayload,
};

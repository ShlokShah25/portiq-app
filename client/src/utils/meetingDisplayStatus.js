/**
 * Unified status labels for meeting lists and detail (badges).
 * @returns {{ key: string, label: string, variant: string }}
 */
export function getMeetingDisplayStatus(meeting) {
  if (!meeting) {
    return { key: 'scheduled', label: 'Scheduled', variant: 'muted' };
  }

  const online =
    !!(meeting.conferenceJoinUrl && String(meeting.conferenceJoinUrl).trim()) ||
    ['zoom', 'teams'].includes(String(meeting.conferenceProvider || '').toLowerCase());

  const bot = String(meeting.conferenceBotStatus || '').toLowerCase();
  const tStatus = meeting.transcriptionStatus || '';
  const mStatus = meeting.status || '';
  const hasSummary =
    !!(meeting.summary || meeting.pendingSummary) &&
    (tStatus === 'Completed' || meeting.transcriptionStatus === 'Completed');

  if (mStatus === 'Completed' && hasSummary) {
    return { key: 'summary_ready', label: 'Summary Ready', variant: 'success' };
  }
  if (tStatus === 'Processing' || tStatus === 'Recording') {
    return { key: 'processing', label: 'Processing', variant: 'processing' };
  }

  if (online) {
    if (bot === 'joining' || bot === 'queued') {
      return { key: 'joining', label: 'Joining', variant: 'joining' };
    }
    if (bot === 'in_meeting' || mStatus === 'In Progress') {
      return { key: 'joined', label: 'Joined', variant: 'joined' };
    }
    if (bot === 'failed') {
      return { key: 'failed', label: 'Assistant issue', variant: 'warn' };
    }
    if (mStatus === 'Scheduled') {
      return { key: 'scheduled', label: 'Scheduled', variant: 'muted' };
    }
  }

  if (mStatus === 'In Progress') {
    return { key: 'joined', label: 'Live', variant: 'live' };
  }
  if (mStatus === 'Completed') {
    return { key: 'processing', label: 'Processing', variant: 'processing' };
  }

  return { key: 'scheduled', label: 'Scheduled', variant: 'muted' };
}

export function isOnlineMeeting(meeting) {
  if (!meeting) return false;
  const url = meeting.conferenceJoinUrl && String(meeting.conferenceJoinUrl).trim();
  const p = String(meeting.conferenceProvider || '').toLowerCase();
  return !!(url || p === 'zoom' || p === 'teams');
}

export function isLiveRecordingMeeting(meeting) {
  return !isOnlineMeeting(meeting);
}

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

  const hasSummaryContent = !!(meeting.summary || meeting.pendingSummary);
  const summaryReady =
    mStatus === 'Completed' && tStatus === 'Completed' && hasSummaryContent;

  if (summaryReady) {
    return { key: 'summary_ready', label: 'Summary Ready', variant: 'success' };
  }

  if (tStatus === 'Processing') {
    return { key: 'processing', label: 'Generating summary', variant: 'processing' };
  }
  if (tStatus === 'Recording') {
    return { key: 'recording', label: 'Recording audio', variant: 'processing' };
  }
  if (mStatus === 'Completed' && tStatus === 'Failed') {
    return { key: 'failed', label: 'Summary failed', variant: 'warn' };
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
    return { key: 'completed', label: 'Completed', variant: 'muted' };
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

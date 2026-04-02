/**
 * Single source of truth for "why is there no AI summary content on the meeting summary page?"
 * Mirrors client MeetingSummary.js hasContent logic so GET /meetings/:id can return labeled reasons.
 */

function meetingHasSummaryContent(m) {
  if (!m) return false;
  const summaryText = String(m.pendingSummary || m.summary || '').trim();
  const keyPoints = (m.pendingKeyPoints && m.pendingKeyPoints.length
    ? m.pendingKeyPoints
    : m.keyPoints) || [];
  const actionItems = (m.pendingActionItems && m.pendingActionItems.length
    ? m.pendingActionItems
    : m.actionItems) || [];
  const decisions = (m.pendingDecisions && m.pendingDecisions.length
    ? m.pendingDecisions
    : m.decisions) || [];
  const decisionsDisplay = (decisions || []).filter(
    (d) => String(d || '').trim().toLowerCase() !== 'not specified'
  );
  const nextSteps = (m.pendingNextSteps && m.pendingNextSteps.length
    ? m.pendingNextSteps
    : m.nextSteps) || [];
  const importantNotes = (m.pendingImportantNotes && m.pendingImportantNotes.length
    ? m.pendingImportantNotes
    : m.importantNotes) || [];

  return (
    !!summaryText ||
    keyPoints.length > 0 ||
    actionItems.length > 0 ||
    decisionsDisplay.length > 0 ||
    nextSteps.length > 0 ||
    importantNotes.length > 0
  );
}

/**
 * @typedef {(
 *   'PROCESSING' |
 *   'TRANSCRIPTION_FAILED' |
 *   'MEETING_CANCELLED' |
 *   'MEETING_SCHEDULED' |
 *   'MEETING_IN_PROGRESS' |
 *   'TRANSCRIPTION_RECORDING' |
 *   'NO_RECORDING_PROCESSED' |
 *   'TRANSCRIPTION_DISABLED' |
 *   'TRANSCRIPT_SAVED_STRUCTURED_SUMMARY_MISSING' |
 *   'TRANSCRIPT_SAVED_OTHER' |
 *   'COMPLETED_NO_TRANSCRIPT_ROW' |
 *   'TRANSCRIPTION_COMPLETED_ANOMALY' |
 *   'TRANSCRIPTION_NOT_STARTED' |
 *   'UNKNOWN_SUMMARY_STATE'
 * )} SummaryEmptyReasonCode
 */

/**
 * @param {object} m — meeting doc or plain object
 * @returns {SummaryEmptyReasonCode | null} null when structured summary content exists
 */
function computeSummaryEmptyReason(m) {
  if (!m) return 'UNKNOWN_SUMMARY_STATE';
  if (meetingHasSummaryContent(m)) return null;

  const transcript = String(m.transcription || '').trim();
  const hasTranscript = transcript.length > 0;
  const ts = m.transcriptionStatus || 'Not Started';
  const ms = m.status || 'Scheduled';
  const transcriptionEnabled = m.transcriptionEnabled !== false;

  if (ts === 'Processing') return 'PROCESSING';

  if (ts === 'Failed') return 'TRANSCRIPTION_FAILED';

  if (ms === 'Cancelled') return 'MEETING_CANCELLED';

  if (ms === 'Scheduled') return 'MEETING_SCHEDULED';

  if (ms === 'In Progress') return 'MEETING_IN_PROGRESS';

  if (ts === 'Recording') return 'TRANSCRIPTION_RECORDING';

  if (!transcriptionEnabled) return 'TRANSCRIPTION_DISABLED';

  if (ms === 'Completed' && ts === 'Not Started') {
    return hasTranscript ? 'TRANSCRIPT_SAVED_STRUCTURED_SUMMARY_MISSING' : 'NO_RECORDING_PROCESSED';
  }

  if (hasTranscript) {
    if (ts === 'Completed' && ms === 'Completed') {
      return 'TRANSCRIPT_SAVED_STRUCTURED_SUMMARY_MISSING';
    }
    return 'TRANSCRIPT_SAVED_OTHER';
  }

  if (ms === 'Completed' && ts === 'Completed') {
    return 'COMPLETED_NO_TRANSCRIPT_ROW';
  }

  if (ts === 'Completed') {
    return 'TRANSCRIPTION_COMPLETED_ANOMALY';
  }

  if (ts === 'Not Started') {
    return 'TRANSCRIPTION_NOT_STARTED';
  }

  return 'UNKNOWN_SUMMARY_STATE';
}

/**
 * Attach summary UI fields for API consumers (no DB write).
 * @param {object} payload — plain meeting object (e.g. toObject())
 */
function attachSummaryUiState(payload) {
  if (!payload || typeof payload !== 'object') return;
  const present = meetingHasSummaryContent(payload);
  payload.summaryContentPresent = present;
  payload.summaryEmptyReason = present ? null : computeSummaryEmptyReason(payload);
}

module.exports = {
  meetingHasSummaryContent,
  computeSummaryEmptyReason,
  attachSummaryUiState,
};

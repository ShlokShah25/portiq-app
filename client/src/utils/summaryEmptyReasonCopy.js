/**
 * Maps server `summaryEmptyReason` (and legacy fallbacks) to user-facing copy on the summary page.
 */
import { transcriptionFailureCopy } from './transcriptionFailureCopy';

const M = {
  MEETING_CANCELLED:
    'This meeting was cancelled, so no AI summary was generated.',
  MEETING_SCHEDULED:
    'This meeting has not happened yet. A summary will appear here after the session is completed and the recording is processed.',
  MEETING_IN_PROGRESS:
    'This meeting is still in progress. When it ends and audio is processed, the summary will appear here.',
  TRANSCRIPTION_RECORDING:
    'Recording is still in progress or being finalized. Check back shortly after the meeting ends.',
  NO_RECORDING_PROCESSED:
    'No recording was processed for this session, so no AI summary was generated. If you ended the meeting without uploading or saving audio, that is expected.',
  TRANSCRIPTION_DISABLED:
    'Transcription was off for this meeting, so no AI summary was generated.',
  TRANSCRIPT_SAVED_STRUCTURED_SUMMARY_MISSING:
    'No structured AI summary is on file yet, but the meeting transcript was saved. Open it below or use Regenerate summary.',
  TRANSCRIPT_SAVED_OTHER:
    'No structured AI summary yet. Your saved transcript is below.',
  TRANSCRIPT_SAVED_IN_PROGRESS:
    'A transcript is saved below. The full structured summary will appear after the meeting ends and processing completes.',
  COMPLETED_NO_TRANSCRIPT_ROW:
    'Processing finished, but no transcript text was stored. Try Regenerate summary, or re-upload the recording if you have it.',
  TRANSCRIPTION_COMPLETED_ANOMALY:
    'Transcription was marked complete, but no transcript text was found. Try Regenerate summary, or upload the recording again if you can.',
  TRANSCRIPTION_NOT_STARTED:
    'Transcription has not started for this meeting yet. When the session ends and audio is available, processing will begin.',
  UNKNOWN_SUMMARY_STATE:
    'No summary is available yet. If you expected one, try Regenerate summary in a few minutes or after checking your recording.',
};

/**
 * Body text for the empty-summary panel (not shown while Processing — parent handles that).
 * @param {object} meeting
 * @returns {string}
 */
export function getSummaryEmptyBodyMessage(meeting) {
  const hasTranscript = !!String(meeting.transcription || '').trim();
  const reason = meeting.summaryEmptyReason;

  if (meeting.transcriptionStatus === 'Failed') {
    return transcriptionFailureCopy(meeting.transcriptionFailureCode, { hasTranscript });
  }

  switch (reason) {
    case 'MEETING_CANCELLED':
      return M.MEETING_CANCELLED;
    case 'MEETING_SCHEDULED':
      return M.MEETING_SCHEDULED;
    case 'MEETING_IN_PROGRESS':
      return M.MEETING_IN_PROGRESS;
    case 'TRANSCRIPTION_RECORDING':
      return M.TRANSCRIPTION_RECORDING;
    case 'NO_RECORDING_PROCESSED':
      return M.NO_RECORDING_PROCESSED;
    case 'TRANSCRIPTION_DISABLED':
      return M.TRANSCRIPTION_DISABLED;
    case 'TRANSCRIPT_SAVED_STRUCTURED_SUMMARY_MISSING':
      return M.TRANSCRIPT_SAVED_STRUCTURED_SUMMARY_MISSING;
    case 'TRANSCRIPT_SAVED_OTHER':
      if (meeting.status === 'In Progress') {
        return M.TRANSCRIPT_SAVED_IN_PROGRESS;
      }
      return M.TRANSCRIPT_SAVED_OTHER;
    case 'COMPLETED_NO_TRANSCRIPT_ROW':
      return M.COMPLETED_NO_TRANSCRIPT_ROW;
    case 'TRANSCRIPTION_COMPLETED_ANOMALY':
      return M.TRANSCRIPTION_COMPLETED_ANOMALY;
    case 'TRANSCRIPTION_NOT_STARTED':
      return M.TRANSCRIPTION_NOT_STARTED;
    case 'PROCESSING':
      return '';
    case 'UNKNOWN_SUMMARY_STATE':
      return M.UNKNOWN_SUMMARY_STATE;
    case undefined:
    case null:
      return legacyEmptyMessage(meeting);
    default:
      return legacyEmptyMessage(meeting);
  }
}

/** Pre-label API responses / edge cases */
function legacyEmptyMessage(meeting) {
  const hasTranscript = !!String(meeting.transcription || '').trim();
  const notProcessing = meeting.transcriptionStatus !== 'Processing';

  if (hasTranscript && notProcessing) {
    if (meeting.transcriptionStatus === 'Failed') {
      return transcriptionFailureCopy(meeting.transcriptionFailureCode, { hasTranscript });
    }
    if (meeting.transcriptionStatus === 'Completed' && meeting.status === 'Completed') {
      return M.TRANSCRIPT_SAVED_STRUCTURED_SUMMARY_MISSING;
    }
    return M.TRANSCRIPT_SAVED_OTHER;
  }
  if (meeting.transcriptionStatus === 'Failed') {
    return transcriptionFailureCopy(meeting.transcriptionFailureCode, { hasTranscript });
  }
  if (meeting.status === 'Completed' && meeting.transcriptionStatus === 'Not Started') {
    return M.NO_RECORDING_PROCESSED;
  }
  return M.UNKNOWN_SUMMARY_STATE;
}

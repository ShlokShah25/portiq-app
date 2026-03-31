/**
 * User-facing copy for failed transcription/summary runs.
 * Server stores `transcriptionFailureCode` on the meeting; we map it here so
 * provider outages read as temporary service issues, not user mistakes.
 */

/**
 * @param {string | null | undefined} code
 * @param {{ hasTranscript?: boolean }} [ctx]
 * @returns {string}
 */
export function transcriptionFailureCopy(code, ctx = {}) {
  const hasTranscript = !!ctx.hasTranscript;
  const c = String(code || '').trim();

  const serviceRetry =
    "We couldn't finish the AI summary because of a temporary issue on our side (for example the AI provider was busy or unavailable). Try again in a few minutes.";
  const serviceRetryWithTranscript =
    "We couldn't finish the AI summary because of a temporary issue on our side. A transcript may still be available below—try Regenerate summary in a few minutes.";

  const inputNoSpeech =
    'We could not detect usable speech in the recording. Check that the microphone was on and try again with a new recording if needed.';
  const inputAudio =
    'We could not process this audio file. Try a common format (such as mp3, wav, or m4a) or a shorter recording.';
  const inputMissing =
    'No recording or usable transcript was available for this step.';

  switch (c) {
    case 'AI_UNAVAILABLE':
    case 'AI_RATE_LIMIT':
    case 'AI_TIMEOUT':
    case 'AI_CONFIG':
    case 'UNKNOWN':
      return hasTranscript ? serviceRetryWithTranscript : serviceRetry;
    case 'INPUT_NO_SPEECH':
      return inputNoSpeech;
    case 'INPUT_AUDIO_INVALID':
      return inputAudio;
    case 'INPUT_FILE_MISSING':
    case 'INPUT_TRANSCRIPT_EMPTY':
      return inputMissing;
    default:
      return hasTranscript ? serviceRetryWithTranscript : serviceRetry;
  }
}

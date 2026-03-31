/**
 * Classifies transcription/summary pipeline errors so the UI can show
 * provider-side issues (GPT down, rate limits) as temporary service problems,
 * not something the user did wrong.
 */

const TRANSCRIPTION_FAILURE_CODES = {
  AI_UNAVAILABLE: 'AI_UNAVAILABLE',
  AI_RATE_LIMIT: 'AI_RATE_LIMIT',
  AI_TIMEOUT: 'AI_TIMEOUT',
  AI_CONFIG: 'AI_CONFIG',
  INPUT_NO_SPEECH: 'INPUT_NO_SPEECH',
  INPUT_AUDIO_INVALID: 'INPUT_AUDIO_INVALID',
  INPUT_FILE_MISSING: 'INPUT_FILE_MISSING',
  INPUT_TRANSCRIPT_EMPTY: 'INPUT_TRANSCRIPT_EMPTY',
  UNKNOWN: 'UNKNOWN',
};

/**
 * @param {unknown} err
 * @returns {string} TRANSCRIPTION_FAILURE_CODES value
 */
function classifyTranscriptionError(err) {
  if (!err) return TRANSCRIPTION_FAILURE_CODES.UNKNOWN;

  const status =
    typeof err === 'object' && err !== null && 'status' in err && err.status != null
      ? Number(err.status)
      : undefined;
  const netCode =
    typeof err === 'object' && err !== null && 'code' in err && err.code != null
      ? String(err.code)
      : '';
  const msg = String((typeof err === 'object' && err !== null && err.message) || err || '');

  if (status === 401) return TRANSCRIPTION_FAILURE_CODES.AI_CONFIG;
  if (status === 429) return TRANSCRIPTION_FAILURE_CODES.AI_RATE_LIMIT;
  if (status === 408) return TRANSCRIPTION_FAILURE_CODES.AI_TIMEOUT;
  if (status === 500 || status === 502 || status === 503) {
    return TRANSCRIPTION_FAILURE_CODES.AI_UNAVAILABLE;
  }

  if (['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN'].includes(netCode)) {
    return TRANSCRIPTION_FAILURE_CODES.AI_UNAVAILABLE;
  }

  if (/openai api key not configured|OPENAI_API_KEY|authentication failed/i.test(msg)) {
    return TRANSCRIPTION_FAILURE_CODES.AI_CONFIG;
  }
  if (/rate limit/i.test(msg)) return TRANSCRIPTION_FAILURE_CODES.AI_RATE_LIMIT;
  if (/server error\s*\(\s*\d+\s*\)/i.test(msg) || /API server error/i.test(msg)) {
    return TRANSCRIPTION_FAILURE_CODES.AI_UNAVAILABLE;
  }
  if (/timeout|timed out|took too long/i.test(msg)) {
    return TRANSCRIPTION_FAILURE_CODES.AI_TIMEOUT;
  }

  if (/empty text|silent or corrupted|no speech/i.test(msg)) {
    return TRANSCRIPTION_FAILURE_CODES.INPUT_NO_SPEECH;
  }
  if (/stored transcript is empty/i.test(msg)) {
    return TRANSCRIPTION_FAILURE_CODES.INPUT_TRANSCRIPT_EMPTY;
  }
  if (/audio file not found|file not found/i.test(msg)) {
    return TRANSCRIPTION_FAILURE_CODES.INPUT_FILE_MISSING;
  }
  if (/empty \(0 bytes\)|audio file is empty/i.test(msg)) {
    return TRANSCRIPTION_FAILURE_CODES.INPUT_FILE_MISSING;
  }
  if (/audio file error|valid audio format|compress|too large/i.test(msg)) {
    return TRANSCRIPTION_FAILURE_CODES.INPUT_AUDIO_INVALID;
  }

  return TRANSCRIPTION_FAILURE_CODES.UNKNOWN;
}

function buildTranscriptionFailureSet(error) {
  const code = classifyTranscriptionError(error);
  return {
    transcriptionStatus: 'Failed',
    transcriptionFailureCode: code,
    transcriptionFailureAt: new Date(),
  };
}

function clearTranscriptionFailureFields() {
  return {
    transcriptionFailureCode: null,
    transcriptionFailureAt: null,
  };
}

module.exports = {
  TRANSCRIPTION_FAILURE_CODES,
  classifyTranscriptionError,
  buildTranscriptionFailureSet,
  clearTranscriptionFailureFields,
};

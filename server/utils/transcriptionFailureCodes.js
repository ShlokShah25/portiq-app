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
 * HTTP status from OpenAI SDK errors, fetch, or nested axios-style shapes.
 * @param {unknown} err
 * @returns {number | undefined}
 */
function getErrorHttpStatus(err) {
  if (!err || typeof err !== 'object') return undefined;
  const o = /** @type {Record<string, unknown>} */ (err);
  if (o.status != null && Number.isFinite(Number(o.status))) return Number(o.status);
  const res = o.response;
  if (res && typeof res === 'object' && res !== null && 'status' in res && res.status != null) {
    const n = Number(res.status);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

/**
 * Best-effort message string for classification (OpenAI often nests detail).
 * @param {unknown} err
 * @returns {string}
 */
function getErrorMessageForClassification(err) {
  if (!err) return '';
  if (typeof err === 'string') return err;
  if (typeof err !== 'object') return String(err);
  const o = /** @type {Record<string, unknown>} */ (err);
  const parts = [];
  if (typeof o.message === 'string' && o.message) parts.push(o.message);
  const inner = o.error;
  if (inner && typeof inner === 'object' && inner !== null && 'message' in inner) {
    const m = /** @type {{ message?: string }} */ (inner).message;
    if (typeof m === 'string' && m) parts.push(m);
  }
  const res = o.response;
  if (res && typeof res === 'object' && res !== null && 'data' in res) {
    const data = /** @type {{ error?: { message?: string } }} */ (res).data;
    const dm = data && data.error && typeof data.error.message === 'string' ? data.error.message : '';
    if (dm) parts.push(dm);
  }
  return parts.filter(Boolean).join(' — ') || '';
}

/**
 * @param {unknown} err
 * @returns {string} TRANSCRIPTION_FAILURE_CODES value
 */
function classifyTranscriptionError(err) {
  if (!err) return TRANSCRIPTION_FAILURE_CODES.UNKNOWN;

  const status = getErrorHttpStatus(err);
  const netCode =
    typeof err === 'object' && err !== null && 'code' in err && err.code != null
      ? String(err.code)
      : '';
  const msg = getErrorMessageForClassification(err);

  if (status === 401) return TRANSCRIPTION_FAILURE_CODES.AI_CONFIG;
  if (status === 429) return TRANSCRIPTION_FAILURE_CODES.AI_RATE_LIMIT;
  if (status === 413) return TRANSCRIPTION_FAILURE_CODES.INPUT_AUDIO_INVALID;
  if (status === 408) return TRANSCRIPTION_FAILURE_CODES.AI_TIMEOUT;
  /** Whisper / audio API often returns 400 for corrupt, empty, or unsupported uploads — was mislabeled UNKNOWN. */
  if (status === 400 || status === 422) return TRANSCRIPTION_FAILURE_CODES.INPUT_AUDIO_INVALID;
  if (status === 404) return TRANSCRIPTION_FAILURE_CODES.INPUT_FILE_MISSING;
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
  if (/install ffmpeg|compress automatically|whisper accepts up to 25 mb/i.test(msg)) {
    return TRANSCRIPTION_FAILURE_CODES.INPUT_AUDIO_INVALID;
  }
  if (/too long to fit under the 25 mb|could not compress audio below 25 mb/i.test(msg)) {
    return TRANSCRIPTION_FAILURE_CODES.INPUT_AUDIO_INVALID;
  }

  return TRANSCRIPTION_FAILURE_CODES.UNKNOWN;
}

/**
 * Short, non-secret string for DB + API (support / teacher debugging).
 * @param {unknown} err
 * @returns {string | null}
 */
function sanitizeTranscriptionFailureDetail(err) {
  const raw = getErrorMessageForClassification(err).trim();
  if (!raw) return null;
  let s = raw.replace(/\bsk-[a-zA-Z0-9]{10,}\b/g, '[redacted]').replace(/\bBearer\s+[a-zA-Z0-9._-]+\b/g, 'Bearer [redacted]');
  if (s.length > 1500) s = `${s.slice(0, 1497)}…`;
  return s || null;
}

function buildTranscriptionFailureSet(error) {
  const code = classifyTranscriptionError(error);
  const detail = sanitizeTranscriptionFailureDetail(error);
  return {
    transcriptionStatus: 'Failed',
    transcriptionFailureCode: code,
    transcriptionFailureAt: new Date(),
    transcriptionFailureDetail: detail,
  };
}

function clearTranscriptionFailureFields() {
  return {
    transcriptionFailureCode: null,
    transcriptionFailureAt: null,
    transcriptionFailureDetail: null,
  };
}

module.exports = {
  TRANSCRIPTION_FAILURE_CODES,
  classifyTranscriptionError,
  buildTranscriptionFailureSet,
  clearTranscriptionFailureFields,
};

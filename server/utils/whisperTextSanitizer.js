/**
 * Filter common Whisper hallucinations — especially on short live audio chunks and silence.
 */

const HALLUCINATION_PATTERNS = [
  /^thank(s| you) for watching\.?$/i,
  /^thanks for listening\.?$/i,
  /^please subscribe\.?$/i,
  /^subscribe to (the )?channel\.?$/i,
  /^like and subscribe\.?$/i,
  /^subtitles by .+$/i,
  /^subtitle(s)? by .+$/i,
  /^translated by .+$/i,
  /^amara\.org$/i,
  /^for more information,.+$/i,
  /^visit www\..+$/i,
  /^copyright .+$/i,
  /^all rights reserved\.?$/i,
  /^music$/i,
  /^\[music\]$/i,
  /^\(music\)$/i,
  /^applause$/i,
  /^\[applause\]$/i,
  /^silence$/i,
  /^\.+$/,
  /^you\.?$/i,
  /^i\.?$/i,
  /^the\.?$/i,
  /^a\.?$/i,
  /^um+\.?$/i,
  /^uh+\.?$/i,
  /^hmm+\.?$/i,
  /^okay\.?$/i,
  /^ok\.?$/i,
  /^bye\.?$/i,
  /^goodbye\.?$/i,
  /^see you\.?$/i,
  /^thank you\.?$/i,
  /^thanks\.?$/i,
  /^mbc news$/i,
  /^bbc news$/i,
  /^breaking news$/i,
];

function normalizeForCheck(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * @param {string} text
 * @param {{ liveChunk?: boolean }} [opts]
 */
function isLikelyWhisperHallucination(text, opts = {}) {
  const t = normalizeForCheck(text);
  if (!t) return true;
  if (opts.liveChunk && t.length < 4) return true;
  if (opts.liveChunk && t.length < 12 && /^[^a-zA-Z0-9]*$/.test(t)) return true;
  for (const re of HALLUCINATION_PATTERNS) {
    if (re.test(t)) return true;
  }
  // Repeated single token on noise (e.g. "the the the")
  if (opts.liveChunk) {
    const words = t.toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length >= 2 && words.every((w) => w === words[0]) && words[0].length <= 4) {
      return true;
    }
  }
  return false;
}

/**
 * Strip junk lines from a full meeting transcript before summarization.
 * @param {string} text
 */
function sanitizeWhisperTranscript(text) {
  const raw = String(text || '').trim();
  if (!raw) return '';

  const lines = raw.split(/\n+/);
  const kept = [];
  for (const line of lines) {
    const t = normalizeForCheck(line);
    if (!t) continue;
    if (isLikelyWhisperHallucination(t, { liveChunk: false })) continue;
    kept.push(t);
  }

  if (kept.length === 0) return raw;

  // Collapse duplicate consecutive lines (Whisper sometimes repeats on noise)
  const deduped = [];
  for (const line of kept) {
    if (deduped.length === 0 || deduped[deduped.length - 1] !== line) {
      deduped.push(line);
    }
  }
  return deduped.join('\n').trim();
}

module.exports = {
  isLikelyWhisperHallucination,
  sanitizeWhisperTranscript,
};

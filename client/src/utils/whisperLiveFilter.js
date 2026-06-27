/**
 * Client-side filter for live Whisper preview chunks (mirrors server sanitizer patterns).
 */

const HALLUCINATION_PATTERNS = [
  /^thank(s| you) for watching\.?$/i,
  /^thanks for listening\.?$/i,
  /^please subscribe\.?$/i,
  /^subtitles by .+$/i,
  /^amara\.org$/i,
  /^music$/i,
  /^\[music\]$/i,
  /^you\.?$/i,
  /^i\.?$/i,
  /^the\.?$/i,
  /^um+\.?$/i,
  /^uh+\.?$/i,
  /^thank you\.?$/i,
  /^thanks\.?$/i,
];

export function isLikelyLiveWhisperHallucination(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t || t.length < 4) return true;
  for (const re of HALLUCINATION_PATTERNS) {
    if (re.test(t)) return true;
  }
  const words = t.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length >= 2 && words.every((w) => w === words[0]) && words[0].length <= 4) {
    return true;
  }
  return false;
}

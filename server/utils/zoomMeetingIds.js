/**
 * Extract Zoom numeric meeting id from common join URLs (best-effort).
 * Examples: https://zoom.us/j/12345678901?pwd=…, https://us02web.zoom.us/j/12345678901
 * @param {string} url
 * @returns {string|null}
 */
function parseZoomMeetingIdFromJoinUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const u = url.trim();
  if (!u) return null;
  try {
    const path = new URL(u).pathname;
    const m = path.match(/\/j\/(\d{9,11})\b/i);
    if (m) return m[1];
  } catch (_) {
    const m2 = u.match(/zoom\.[a-z.]+\/j\/(\d{9,11})\b/i);
    if (m2) return m2[1];
  }
  return null;
}

module.exports = {
  parseZoomMeetingIdFromJoinUrl,
};

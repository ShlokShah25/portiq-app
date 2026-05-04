/**
 * Optional second copy of meeting audio to a persistent directory (e.g. Railway volume mount).
 * Set MEETING_AUDIO_MIRROR_DIR (or alias PORTIQ_PERSISTENT_AUDIO_DIR) to an absolute path on durable
 * storage so redeploys do not lose files that only lived under the default ./uploads folder.
 *
 * `resolveUploadPath` checks this directory by **basename** when the primary uploads path is missing,
 * so "Regenerate summary" can still find audio after a deploy if the mirror survived.
 */
const fs = require('fs');
const path = require('path');

/** @returns {string|null} absolute root for mirrored audio, or null if not configured */
function getMeetingAudioMirrorRoot() {
  const a = String(process.env.MEETING_AUDIO_MIRROR_DIR || '').trim();
  const b = String(process.env.PORTIQ_PERSISTENT_AUDIO_DIR || '').trim();
  return a || b || null;
}

function mirrorMeetingAudioToPersistentDir(sourceAbsolutePath) {
  const mirrorRoot = getMeetingAudioMirrorRoot();
  if (!mirrorRoot || !sourceAbsolutePath) return;
  try {
    if (!fs.existsSync(sourceAbsolutePath)) return;
    const destDir = path.resolve(mirrorRoot);
    fs.mkdirSync(destDir, { recursive: true });
    const base = path.basename(sourceAbsolutePath);
    const dest = path.join(destDir, base);
    fs.copyFileSync(sourceAbsolutePath, dest);
    console.log(`📦 Meeting audio mirrored to persistent dir: ${dest}`);
  } catch (err) {
    console.warn('⚠️ MEETING_AUDIO_MIRROR_DIR copy failed:', err.message);
  }
}

module.exports = {
  mirrorMeetingAudioToPersistentDir,
  getMeetingAudioMirrorRoot,
};

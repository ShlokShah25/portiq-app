/**
 * Optional second copy of meeting audio to a persistent directory (e.g. Railway volume mount).
 * Set MEETING_AUDIO_MIRROR_DIR to an absolute path on durable storage so redeploys do not lose files
 * that only lived under the default ./uploads folder.
 */
const fs = require('fs');
const path = require('path');

function mirrorMeetingAudioToPersistentDir(sourceAbsolutePath) {
  const mirrorRoot = process.env.MEETING_AUDIO_MIRROR_DIR;
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

module.exports = { mirrorMeetingAudioToPersistentDir };

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

/**
 * Every caller uses this fire-and-forget (never awaited) — it used to copy with the
 * *Sync fs functions, which run on Node's single thread and block the entire event
 * loop for as long as the copy takes. For a lecture-length recording (tens of MB)
 * that's a multi-second stall shared by EVERY request the server is handling at that
 * moment — uploads, summary polling, unrelated API calls, all of it — which is exactly
 * what "uploading audio is taking too long" looks like from the outside. Using the
 * async fs.promises variants offloads the actual disk I/O to libuv's thread pool
 * instead, so the request that triggered this can respond immediately and the rest of
 * the server keeps serving other requests while the copy happens in the background.
 */
function mirrorMeetingAudioToPersistentDir(sourceAbsolutePath) {
  const mirrorRoot = getMeetingAudioMirrorRoot();
  if (!mirrorRoot || !sourceAbsolutePath) return;
  (async () => {
    try {
      const exists = await fs.promises
        .access(sourceAbsolutePath)
        .then(() => true)
        .catch(() => false);
      if (!exists) return;
      const destDir = path.resolve(mirrorRoot);
      await fs.promises.mkdir(destDir, { recursive: true });
      const base = path.basename(sourceAbsolutePath);
      const dest = path.join(destDir, base);
      await fs.promises.copyFile(sourceAbsolutePath, dest);
      console.log(`📦 Meeting audio mirrored to persistent dir: ${dest}`);
    } catch (err) {
      console.warn('⚠️ MEETING_AUDIO_MIRROR_DIR copy failed:', err.message);
    }
  })();
}

module.exports = {
  mirrorMeetingAudioToPersistentDir,
  getMeetingAudioMirrorRoot,
};

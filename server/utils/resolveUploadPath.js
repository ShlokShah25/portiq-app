const fs = require('fs');
const path = require('path');

/**
 * Resolve a path stored on Meeting.audioFile (e.g. `/uploads/meetings/x.webm` or `uploads/meetings/x.webm`)
 * to an absolute path under the project root. Leading slashes in the DB value would otherwise make
 * path.join() drop the project prefix and point at the OS root.
 *
 * If the default upload dir was wiped on redeploy but `MEETING_AUDIO_MIRROR_DIR` still has a copy
 * (see `meetingAudioMirror.js`), fall back to the same basename under the mirror root.
 */
function resolveUploadPath(storedPath) {
  if (!storedPath) return null;
  const rel = String(storedPath).replace(/^[/\\]+/, '').replace(/\\/g, '/');
  const primary = path.join(__dirname, '..', '..', rel);
  try {
    if (fs.existsSync(primary)) return primary;
  } catch (_) {
    /* ignore */
  }
  const mirrorRoot = process.env.MEETING_AUDIO_MIRROR_DIR;
  if (mirrorRoot) {
    try {
      const alt = path.join(path.resolve(mirrorRoot), path.basename(rel));
      if (fs.existsSync(alt)) return alt;
    } catch (_) {
      /* ignore */
    }
  }
  return primary;
}

module.exports = { resolveUploadPath };

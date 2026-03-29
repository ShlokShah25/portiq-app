const path = require('path');

/**
 * Resolve a path stored on Meeting.audioFile (e.g. `/uploads/meetings/x.webm` or `uploads/meetings/x.webm`)
 * to an absolute path under the project root. Leading slashes in the DB value would otherwise make
 * path.join() drop the project prefix and point at the OS root.
 */
function resolveUploadPath(storedPath) {
  if (!storedPath) return null;
  const rel = String(storedPath).replace(/^[/\\]+/, '').replace(/\\/g, '/');
  return path.join(__dirname, '..', '..', rel);
}

module.exports = { resolveUploadPath };

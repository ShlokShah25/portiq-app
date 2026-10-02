/**
 * Who may touch a meeting. Shared by the meetings and smartboard (teacher) routers.
 *
 * Previously a request with no token was treated as allowed ("keep routes usable from
 * unauthenticated contexts"), so anyone with a meeting ID — or none, via the list route — could
 * read transcripts and summaries, end meetings, email participants and overwrite voiceprints.
 * Every client page that calls these routes is already behind login, so they now require it.
 * Public lecture recaps keep working through their own unguessable recap token (publicRouter).
 */
const jwt = require('jsonwebtoken');
const Admin = require('../models/Admin');
const { getJwtSecret } = require('./jwtSecret');

async function getAdminFromRequest(req) {
  if (req.admin) return req.admin;
  try {
    const header = req.header('Authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : null;
    if (!token) return null;
    const decoded = jwt.verify(token, getJwtSecret());
    if (!decoded || !decoded.id) return null;
    return await Admin.findById(String(decoded.id)).select('-password');
  } catch {
    return null;
  }
}

function isSuperAdmin(admin) {
  return !!admin && String(admin.username || '').toLowerCase() === 'admin';
}

/** Owner of the meeting, or the platform super-admin. Meetings without an owner: super-admin only. */
function canAccessMeeting(meeting, admin) {
  if (!meeting || !admin) return false;
  if (isSuperAdmin(admin)) return true;
  if (!meeting.adminId) return false;
  return String(meeting.adminId) === String(admin._id);
}

/** Router middleware: 401 unless the request carries a valid login token; sets req.admin. */
async function requireAdmin(req, res, next) {
  const admin = await getAdminFromRequest(req);
  if (!admin) {
    return res.status(401).json({ error: 'Please sign in to continue.', code: 'AUTH_REQUIRED' });
  }
  req.admin = admin;
  return next();
}

module.exports = { getAdminFromRequest, canAccessMeeting, isSuperAdmin, requireAdmin };

const AuditLog = require('../models/AuditLog');
const crypto = require('crypto');

/**
 * Derive a stable version hash for the current AI-generated clinical note snapshot.
 * @param {object} meeting
 * @returns {string}
 */
function aiSummaryVersionFromMeeting(meeting) {
  const payload = {
    pendingClinicalNote: meeting?.pendingClinicalNote,
    clinicalNote: meeting?.clinicalNote,
    pendingSummary: meeting?.pendingSummary,
    transcriptionStatus: meeting?.transcriptionStatus,
    updatedAt: meeting?.updatedAt,
  };
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 16);
}

/**
 * Record a Cura audit event (AI approval, finalize, etc.).
 * @param {object} params
 * @param {import('mongoose').Types.ObjectId} params.clinicId
 * @param {import('mongoose').Types.ObjectId} params.doctorId
 * @param {string} params.action
 * @param {import('mongoose').Types.ObjectId} params.resourceId
 * @param {string} [params.resourceType]
 * @param {import('mongoose').Types.ObjectId|null} [params.patientId]
 * @param {object} [params.meeting] — used to compute aiSummaryVersion
 * @param {object} [params.metadata]
 */
async function logCuraAudit({
  clinicId,
  doctorId,
  action,
  resourceId,
  resourceType = 'meeting',
  patientId = null,
  meeting = null,
  metadata = {},
}) {
  if (!clinicId || !doctorId || !action || !resourceId) return null;
  try {
    return await AuditLog.create({
      clinicId,
      doctorId,
      action,
      resourceType,
      resourceId,
      patientId: patientId || meeting?.patientId || null,
      aiSummaryVersion: meeting ? aiSummaryVersionFromMeeting(meeting) : '',
      metadata,
    });
  } catch (err) {
    console.error('[cura-audit] failed to write audit log:', err.message || err);
    return null;
  }
}

module.exports = {
  logCuraAudit,
  aiSummaryVersionFromMeeting,
};

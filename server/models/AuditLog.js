const mongoose = require('mongoose');

/**
 * Audit trail for Cura clinical actions (AI approval, finalize, etc.).
 * MongoDB equivalent of audit_trail — scoped per clinic + doctor.
 */
const auditLogSchema = new mongoose.Schema({
  clinicId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Clinic',
    required: true,
    index: true,
  },
  doctorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin',
    required: true,
    index: true,
  },
  action: {
    type: String,
    required: true,
    trim: true,
    index: true,
  },
  resourceType: { type: String, default: 'meeting', trim: true },
  resourceId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    index: true,
  },
  patientId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Patient',
    default: null,
    index: true,
  },
  aiSummaryVersion: { type: String, default: '', trim: true },
  metadata: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
  createdAt: { type: Date, default: Date.now, index: true },
});

auditLogSchema.index({ clinicId: 1, createdAt: -1 });

module.exports = mongoose.model('AuditLog', auditLogSchema);

const mongoose = require('mongoose');

/** High-priority alerts when patients report emergencies via WhatsApp. */
const clinicAlertSchema = new mongoose.Schema({
  clinicId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Clinic',
    required: true,
    index: true,
  },
  patientId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Patient',
    default: null,
  },
  phone: { type: String, default: '', trim: true },
  severity: { type: String, enum: ['urgent', 'emergency'], default: 'emergency' },
  triageLevel: {
    type: String,
    enum: ['NORMAL', 'URGENT', 'EMERGENCY'],
    default: 'EMERGENCY',
  },
  message: { type: String, default: '', trim: true },
  status: { type: String, enum: ['open', 'acknowledged', 'resolved'], default: 'open', index: true },
  sessionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'WhatsAppSession',
    default: null,
  },
  createdAt: { type: Date, default: Date.now },
  acknowledgedAt: { type: Date, default: null },
});

module.exports = mongoose.model('ClinicAlert', clinicAlertSchema);

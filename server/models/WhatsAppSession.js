const mongoose = require('mongoose');

const BOOKING_FLOW_STATES = [
  'START',
  'AUTH_PENDING',
  'SELECTING_BOOKING_TYPE',
  'SELECTING_SLOT',
  'CAPTURING_SYMPTOMS',
  'CONFIRMED',
  'EMERGENCY_ALERTED',
];

const whatsAppSessionSchema = new mongoose.Schema({
  phone: { type: String, required: true, trim: true, index: true },
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
    index: true,
  },
  bookingFlowState: {
    type: String,
    enum: BOOKING_FLOW_STATES,
    default: 'START',
    index: true,
  },
  trustedSession: { type: Boolean, default: false },
  verifiedAt: { type: Date, default: null },
  otpHash: { type: String, default: '' },
  otpExpiresAt: { type: Date, default: null },
  context: {
    type: mongoose.Schema.Types.Mixed,
    default: () => ({}),
  },
  consultationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Meeting',
    default: null,
  },
  lastIntent: { type: String, default: '', trim: true },
  patientTimezone: { type: String, default: '', trim: true },
  lastInboundAt: { type: Date, default: Date.now },
  lastOutboundAt: { type: Date, default: null },
  expiresAt: { type: Date, default: null, index: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

whatsAppSessionSchema.index({ phone: 1, clinicId: 1 }, { unique: true });

whatsAppSessionSchema.pre('save', function onSave(next) {
  this.updatedAt = Date.now();
  if (!this.expiresAt) {
    const d = new Date();
    d.setHours(d.getHours() + 24);
    this.expiresAt = d;
  }
  next();
});

module.exports = mongoose.model('WhatsAppSession', whatsAppSessionSchema);
module.exports.BOOKING_FLOW_STATES = BOOKING_FLOW_STATES;

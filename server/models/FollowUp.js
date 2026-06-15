const mongoose = require('mongoose');

const followUpSchema = new mongoose.Schema({
  clinicId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Clinic',
    required: true,
    index: true,
  },
  patientId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Patient',
    required: true,
    index: true,
  },
  consultationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Meeting',
    default: null,
    index: true,
  },
  channel: {
    type: String,
    enum: ['whatsapp', 'email', 'sms'],
    default: 'whatsapp',
  },
  messageType: {
    type: String,
    enum: ['summary', 'check_in', 'prescription', 'reminder'],
    default: 'check_in',
  },
  status: {
    type: String,
    enum: ['scheduled', 'sent', 'delivered', 'replied', 'failed', 'cancelled'],
    default: 'scheduled',
  },
  scheduledAt: { type: Date, default: null },
  sentAt: { type: Date, default: null },
  messageBody: { type: String, default: '', trim: true },
  patientResponse: { type: String, default: '', trim: true },
  respondedAt: { type: Date, default: null },
  aiStatusSummary: { type: String, default: '', trim: true },
  twilioMessageSid: { type: String, default: '', trim: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

followUpSchema.index({ clinicId: 1, status: 1, scheduledAt: 1 });

followUpSchema.pre('save', function onSave(next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model('FollowUp', followUpSchema);

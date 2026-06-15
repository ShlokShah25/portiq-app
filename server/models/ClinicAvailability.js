const mongoose = require('mongoose');

/** Weekly recurring availability windows per clinic (used for WhatsApp slot discovery). */
const clinicAvailabilitySchema = new mongoose.Schema({
  clinicId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Clinic',
    required: true,
    index: true,
  },
  /** 0 = Sunday … 6 = Saturday */
  dayOfWeek: { type: Number, required: true, min: 0, max: 6 },
  startTime: { type: String, required: true, trim: true }, // HH:mm
  endTime: { type: String, required: true, trim: true },
  slotMinutes: { type: Number, default: 30, min: 10, max: 120 },
  enabled: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

clinicAvailabilitySchema.index({ clinicId: 1, dayOfWeek: 1 });
clinicAvailabilitySchema.pre('save', function onSave(next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model('ClinicAvailability', clinicAvailabilitySchema);

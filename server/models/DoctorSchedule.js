const mongoose = require('mongoose');

const hourBlockSchema = new mongoose.Schema(
  {
    dayOfWeek: { type: Number, required: true, min: 0, max: 6 },
    startTime: { type: String, required: true, trim: true },
    endTime: { type: String, required: true, trim: true },
    enabled: { type: Boolean, default: true },
  },
  { _id: false }
);

/** Per-doctor schedule at a specific clinic (multi-clinic support). */
const doctorScheduleSchema = new mongoose.Schema({
  adminId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin',
    required: true,
    index: true,
  },
  clinicId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Clinic',
    required: true,
    index: true,
  },
  timezone: { type: String, default: '', trim: true },
  operatingHours: { type: [hourBlockSchema], default: [] },
  slotMinutes: { type: Number, default: 30, min: 10, max: 120 },
  enabled: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

doctorScheduleSchema.index({ adminId: 1, clinicId: 1 }, { unique: true });

doctorScheduleSchema.pre('save', function onSave(next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model('DoctorSchedule', doctorScheduleSchema);

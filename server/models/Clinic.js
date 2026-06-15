const mongoose = require('mongoose');

const clinicSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  city: { type: String, default: '', trim: true },
  phone: { type: String, default: '', trim: true },
  specialty: { type: String, default: '', trim: true },
  ownerAdminId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin',
    required: true,
    index: true,
  },
  settings: {
    timezone: { type: String, default: 'Asia/Kolkata' },
    whatsappEnabled: { type: Boolean, default: false },
    doctorDisplayName: { type: String, default: '', trim: true },
    bookingLeadMinutes: { type: Number, default: 60 },
    emergencyPhone: { type: String, default: '112', trim: true },
  },
  /** IANA timezone for clinic wall-clock hours */
  timezone: { type: String, default: 'Asia/Kolkata', trim: true },
  operatingHours: [
    {
      dayOfWeek: { type: Number, min: 0, max: 6 },
      startTime: { type: String, trim: true },
      endTime: { type: String, trim: true },
      enabled: { type: Boolean, default: true },
      slotMinutes: { type: Number, default: 30 },
    },
  ],
  emergencyPhone: { type: String, default: '112', trim: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

clinicSchema.pre('save', function onSave(next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model('Clinic', clinicSchema);

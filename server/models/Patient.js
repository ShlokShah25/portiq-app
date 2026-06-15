const mongoose = require('mongoose');

const patientSchema = new mongoose.Schema({
  clinicId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Clinic',
    required: true,
    index: true,
  },
  adminId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin',
    required: true,
    index: true,
  },
  name: { type: String, required: true, trim: true },
  phone: { type: String, default: '', trim: true },
  email: { type: String, default: '', trim: true, lowercase: true },
  dateOfBirth: { type: Date, default: null },
  medicalRecordNumber: { type: String, default: '', trim: true },
  allergies: [{ type: String, trim: true }],
  conditions: [{ type: String, trim: true }],
  whatsappOptIn: { type: Boolean, default: false },
  timezone: { type: String, default: '', trim: true },
  preferredClinicId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Clinic',
    default: null,
  },
  notes: { type: String, default: '', trim: true },
  lastDoctorName: { type: String, default: '', trim: true },
  patientHistory: [
    {
      at: { type: Date, default: Date.now },
      summary: { type: String, default: '', trim: true },
      consultationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Meeting', default: null },
    },
  ],
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

patientSchema.index({ clinicId: 1, name: 1 });
patientSchema.index({ clinicId: 1, phone: 1 });

patientSchema.pre('save', function onSave(next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model('Patient', patientSchema);

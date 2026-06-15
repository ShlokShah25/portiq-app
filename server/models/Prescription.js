const mongoose = require('mongoose');

const prescriptionItemSchema = new mongoose.Schema(
  {
    drugName: { type: String, required: true, trim: true },
    dosage: { type: String, default: '', trim: true },
    frequency: { type: String, default: '', trim: true },
    duration: { type: String, default: '', trim: true },
    instructions: { type: String, default: '', trim: true },
  },
  { _id: false }
);

const prescriptionSchema = new mongoose.Schema({
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
    required: true,
    index: true,
  },
  items: [prescriptionItemSchema],
  status: {
    type: String,
    enum: ['draft', 'approved', 'sent'],
    default: 'draft',
  },
  approvedAt: { type: Date, default: null },
  approvedByAdminId: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', default: null },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

prescriptionSchema.pre('save', function onSave(next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model('Prescription', prescriptionSchema);

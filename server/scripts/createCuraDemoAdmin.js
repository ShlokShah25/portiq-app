/**
 * Create (or update) a Cura demo clinic admin with sample patients.
 *
 * Usage (from repo root, with MONGODB_URI in .env):
 *   node server/scripts/createCuraDemoAdmin.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const Admin = require('../models/Admin');
const Clinic = require('../models/Clinic');
const Patient = require('../models/Patient');
const ClinicAvailability = require('../models/ClinicAvailability');
const DoctorSchedule = require('../models/DoctorSchedule');
const { DEFAULT_WINDOWS } = require('../services/AvailabilityService');

const mongoUri =
  process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/workplace_visitor_management';

const DEMO = {
  username: 'cura-demo',
  email: 'cura-demo@example.com',
  password: 'cura-demo-123',
  clinicName: 'City Health Clinic',
  clinicCity: 'Mumbai',
  specialty: 'General medicine',
};

const SAMPLE_PATIENTS = [
  {
    name: 'Ananya Mehta',
    phone: '+919876543210',
    email: 'ananya.mehta@example.com',
    medicalRecordNumber: 'CURA-001',
    conditions: ['Hypertension'],
    allergies: ['Penicillin'],
    whatsappOptIn: true,
    timezone: 'Asia/Kolkata',
  },
  {
    name: 'Rahul Verma',
    phone: '+919812345678',
    email: 'rahul.verma@example.com',
    medicalRecordNumber: 'CURA-002',
    conditions: ['Type 2 diabetes'],
    allergies: [],
    whatsappOptIn: true,
  },
  {
    name: 'Priya Nair',
    phone: '+919900112233',
    email: 'priya.nair@example.com',
    medicalRecordNumber: 'CURA-003',
    conditions: [],
    allergies: ['Sulfa drugs'],
    whatsappOptIn: false,
  },
];

async function main() {
  await mongoose.connect(mongoUri);

  let admin = await Admin.findOne({ username: DEMO.username });
  if (!admin) {
    admin = new Admin({
      username: DEMO.username,
      email: DEMO.email,
      password: DEMO.password,
      role: 'admin',
      productType: 'cura',
      complimentaryAccess: true,
      plan: 'professional',
    });
    await admin.save();
    console.log('Created Cura demo admin.');
  } else {
    admin.email = DEMO.email;
    admin.password = DEMO.password;
    admin.productType = 'cura';
    admin.complimentaryAccess = true;
    admin.plan = 'professional';
    await admin.save();
    console.log('Updated existing Cura demo admin.');
  }

  let clinic = await Clinic.findOne({ ownerAdminId: admin._id });
  if (!clinic) {
    clinic = await Clinic.create({
      name: DEMO.clinicName,
      city: DEMO.clinicCity,
      specialty: DEMO.specialty,
      ownerAdminId: admin._id,
      timezone: 'Asia/Kolkata',
      operatingHours: DEFAULT_WINDOWS,
      emergencyPhone: '112',
      settings: {
        whatsappEnabled: true,
        doctorDisplayName: 'Dr. Demo Clinician',
        bookingLeadMinutes: 30,
        emergencyPhone: '112',
      },
    });
    console.log('Created demo clinic:', clinic.name);
  } else {
    clinic.name = DEMO.clinicName;
    clinic.city = DEMO.clinicCity;
    clinic.specialty = DEMO.specialty;
    await clinic.save();
    console.log('Updated demo clinic:', clinic.name);
  }

  admin.clinicId = clinic._id;
  await admin.save();

  const availCount = await ClinicAvailability.countDocuments({ clinicId: clinic._id });
  if (!availCount) {
    await ClinicAvailability.insertMany(
      DEFAULT_WINDOWS.map((w) => ({ ...w, clinicId: clinic._id }))
    );
    console.log('Seeded default clinic availability windows.');
  }

  const sched = await DoctorSchedule.findOne({ adminId: admin._id, clinicId: clinic._id });
  if (!sched) {
    await DoctorSchedule.create({
      adminId: admin._id,
      clinicId: clinic._id,
      timezone: 'Asia/Kolkata',
      operatingHours: DEFAULT_WINDOWS,
      slotMinutes: 30,
    });
    console.log('Seeded doctor schedule for demo clinic.');
  }

  for (const sample of SAMPLE_PATIENTS) {
    const existing = await Patient.findOne({
      clinicId: clinic._id,
      medicalRecordNumber: sample.medicalRecordNumber,
    });
    if (existing) {
      Object.assign(existing, sample);
      await existing.save();
      continue;
    }
    await Patient.create({
      ...sample,
      clinicId: clinic._id,
      adminId: admin._id,
    });
  }

  console.log('\n✅ Cura demo ready\n');
  console.log('  Sign in:  /cura/login');
  console.log('  Username:', DEMO.username);
  console.log('  Password:', DEMO.password);
  console.log('  Clinic:  ', DEMO.clinicName);
  console.log('  Patients:', SAMPLE_PATIENTS.length, 'sample records');
  console.log('  WhatsApp: enabled (set TWILIO_* env + webhook /api/webhooks/whatsapp)\n');

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('Failed to create Cura demo:', err);
  process.exit(1);
});

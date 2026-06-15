const Clinic = require('../models/Clinic');

function isCuraProduct(admin) {
  return String(admin?.productType || '').toLowerCase() === 'cura';
}

function requireCuraAdmin(req, res, next) {
  if (!req.admin) {
    return res.status(401).json({ error: 'Sign in required.' });
  }
  if (!isCuraProduct(req.admin)) {
    return res.status(403).json({
      error: 'Cura account required.',
      details: 'This workspace is only available for Cura clinical accounts.',
    });
  }
  return next();
}

async function loadClinicForAdmin(admin) {
  if (!admin?.clinicId) return null;
  return Clinic.findById(admin.clinicId);
}

function requireClinic(req, res, next) {
  if (!req.curaClinic) {
    return res.status(400).json({
      error: 'Clinic not set up.',
      details: 'Complete onboarding to create your clinic profile.',
    });
  }
  return next();
}

async function attachClinic(req, res, next) {
  try {
    req.curaClinic = await loadClinicForAdmin(req.admin);
    return next();
  } catch (err) {
    console.error('[cura] attachClinic failed:', err.message);
    return res.status(500).json({ error: 'Failed to load clinic.' });
  }
}

function patientFilter(req) {
  return { clinicId: req.curaClinic._id };
}

function consultationFilter(req) {
  return {
    clinicId: req.curaClinic._id,
    patientId: { $ne: null },
  };
}

module.exports = {
  isCuraProduct,
  requireCuraAdmin,
  loadClinicForAdmin,
  requireClinic,
  attachClinic,
  patientFilter,
  consultationFilter,
};

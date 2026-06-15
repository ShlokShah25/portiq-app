const express = require('express');
const router = express.Router();
const Admin = require('../models/Admin');
const Clinic = require('../models/Clinic');
const Patient = require('../models/Patient');
const Meeting = require('../models/Meeting');
const Prescription = require('../models/Prescription');
const FollowUp = require('../models/FollowUp');
const WhatsAppSession = require('../models/WhatsAppSession');
const { authenticateAdmin } = require('../middleware/auth');
const {
  requireCuraAdmin,
  attachClinic,
  requireClinic,
  patientFilter,
  consultationFilter,
} = require('../utils/curaAccess');
const { subscriptionDeniedResponse } = require('../utils/subscriptionGate');

router.use(authenticateAdmin, requireCuraAdmin, attachClinic);

/** Clinic profile + onboarding */
router.get('/clinic', async (req, res) => {
  try {
    const clinic = req.curaClinic;
    if (!clinic) {
      return res.json({ clinic: null, needsOnboarding: true });
    }
    return res.json({
      clinic: clinic.toObject ? clinic.toObject() : clinic,
      needsOnboarding: false,
    });
  } catch (err) {
    console.error('[cura] GET /clinic', err);
    return res.status(500).json({ error: 'Failed to load clinic.' });
  }
});

router.post('/onboarding', async (req, res) => {
  try {
    const { role, clinicName, clinicCity, doctorName, specialty } = req.body || {};
    const name = String(clinicName || '').trim();
    if (!name) {
      return res.status(400).json({ error: 'Clinic name is required.' });
    }

    let clinic = req.curaClinic;
    if (!clinic) {
      clinic = new Clinic({
        name,
        city: String(clinicCity || '').trim(),
        specialty: String(specialty || '').trim(),
        ownerAdminId: req.admin._id,
      });
      await clinic.save();
      await Admin.findByIdAndUpdate(req.admin._id, {
        $set: { clinicId: clinic._id },
      });
    } else {
      clinic.name = name;
      clinic.city = String(clinicCity || '').trim();
      clinic.specialty = String(specialty || '').trim();
      await clinic.save();
    }

    const profile = {
      role: String(role || '').trim(),
      doctorName: String(doctorName || '').trim(),
      specialty: String(specialty || '').trim(),
    };

    return res.json({
      clinic: clinic.toObject(),
      profile,
      message: 'Clinic profile saved.',
    });
  } catch (err) {
    console.error('[cura] POST /onboarding', err);
    return res.status(500).json({ error: 'Failed to save clinic profile.' });
  }
});

/** Dashboard stats */
router.get('/dashboard', requireClinic, async (req, res) => {
  try {
    const clinicId = req.curaClinic._id;
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    const baseConsult = { clinicId, patientId: { $ne: null } };

    const [todayConsultations, pendingApprovals, followUpsDue, recentPatients, emergencyTriage] =
      await Promise.all([
      Meeting.countDocuments({
        ...baseConsult,
        $or: [
          { scheduledTime: { $gte: startOfDay, $lte: endOfDay } },
          { startTime: { $gte: startOfDay, $lte: endOfDay } },
        ],
      }),
      Meeting.countDocuments({
        ...baseConsult,
        transcriptionStatus: 'Completed',
        clinicalSummaryReviewedAt: null,
        summaryStatus: { $ne: 'Sent' },
      }),
      FollowUp.countDocuments({
        clinicId,
        status: 'scheduled',
        scheduledAt: { $lte: endOfDay },
      }),
      Patient.find(patientFilter(req)).sort({ updatedAt: -1 }).limit(5).lean(),
      Meeting.countDocuments({
        clinicId,
        triageLevel: 'EMERGENCY',
        urgentTriage: true,
        status: { $ne: 'Cancelled' },
        createdAt: { $gte: new Date(Date.now() - 48 * 60 * 60 * 1000) },
      }),
    ]);

    const consultationsToday = await Meeting.find({
      ...baseConsult,
      $or: [
        { scheduledTime: { $gte: startOfDay, $lte: endOfDay } },
        { startTime: { $gte: startOfDay, $lte: endOfDay } },
      ],
    })
      .sort({ startTime: -1, scheduledTime: -1 })
      .limit(12)
      .select(
        'title status scheduledTime startTime chiefComplaint preVisitNotes clinicalPrepStatus bookingSource visitType patientId triageLevel urgentTriage'
      )
      .populate('patientId', 'name phone')
      .lean();

    const pendingList = await Meeting.find({
      ...baseConsult,
      transcriptionStatus: 'Completed',
      clinicalSummaryReviewedAt: null,
      summaryStatus: { $ne: 'Sent' },
    })
      .sort({ updatedAt: -1 })
      .limit(8)
      .populate('patientId', 'name')
      .lean();

    return res.json({
      stats: {
        todayConsultations,
        pendingApprovals,
        followUpsDue,
        patientCount: await Patient.countDocuments({ clinicId }),
        emergencyTriage,
      },
      consultationsToday,
      pendingApprovals: pendingList,
      recentPatients,
    });
  } catch (err) {
    console.error('[cura] GET /dashboard', err);
    return res.status(500).json({ error: 'Failed to load dashboard.' });
  }
});

/** Patients */
router.get('/patients', requireClinic, async (req, res) => {
  try {
    const q = String(req.query.q || '').trim().toLowerCase();
    const filter = patientFilter(req);
    let patients = await Patient.find(filter).sort({ name: 1 }).limit(200).lean();

    if (q) {
      patients = patients.filter(
        (p) =>
          String(p.name || '').toLowerCase().includes(q) ||
          String(p.phone || '').includes(q) ||
          String(p.email || '').toLowerCase().includes(q) ||
          String(p.medicalRecordNumber || '').toLowerCase().includes(q)
      );
    }

    const counts = await Meeting.aggregate([
      { $match: { clinicId: req.curaClinic._id, patientId: { $ne: null } } },
      { $group: { _id: '$patientId', sessions: { $sum: 1 } } },
    ]);
    const sessionMap = new Map(counts.map((c) => [String(c._id), c.sessions]));

    const enriched = patients.map((p) => ({
      ...p,
      sessionCount: sessionMap.get(String(p._id)) || 0,
    }));

    return res.json({ patients: enriched });
  } catch (err) {
    console.error('[cura] GET /patients', err);
    return res.status(500).json({ error: 'Failed to list patients.' });
  }
});

router.post('/patients', requireClinic, async (req, res) => {
  try {
    const { name, phone, email, dateOfBirth, medicalRecordNumber, allergies, conditions, whatsappOptIn, notes } =
      req.body || {};
    const nm = String(name || '').trim();
    if (!nm) {
      return res.status(400).json({ error: 'Patient name is required.' });
    }

    const patient = await Patient.create({
      clinicId: req.curaClinic._id,
      adminId: req.admin._id,
      name: nm,
      phone: String(phone || '').trim(),
      email: String(email || '').trim().toLowerCase(),
      dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null,
      medicalRecordNumber: String(medicalRecordNumber || '').trim(),
      allergies: Array.isArray(allergies) ? allergies.map((a) => String(a).trim()).filter(Boolean) : [],
      conditions: Array.isArray(conditions) ? conditions.map((c) => String(c).trim()).filter(Boolean) : [],
      whatsappOptIn: !!whatsappOptIn,
      notes: String(notes || '').trim(),
    });

    return res.status(201).json({ patient });
  } catch (err) {
    console.error('[cura] POST /patients', err);
    return res.status(500).json({ error: 'Failed to create patient.' });
  }
});

router.get('/patients/:id', requireClinic, async (req, res) => {
  try {
    const patient = await Patient.findOne({
      _id: req.params.id,
      clinicId: req.curaClinic._id,
    }).lean();
    if (!patient) {
      return res.status(404).json({ error: 'Patient not found.' });
    }

    const [consultations, prescriptions, followUps, whatsappSessions] = await Promise.all([
      Meeting.find({ clinicId: req.curaClinic._id, patientId: patient._id })
        .sort({ startTime: -1, scheduledTime: -1, createdAt: -1 })
        .limit(50)
        .lean(),
      Prescription.find({ clinicId: req.curaClinic._id, patientId: patient._id })
        .sort({ createdAt: -1 })
        .limit(30)
        .lean(),
      FollowUp.find({ clinicId: req.curaClinic._id, patientId: patient._id })
        .sort({ scheduledAt: -1, createdAt: -1 })
        .limit(30)
        .lean(),
      WhatsAppSession.find({ clinicId: req.curaClinic._id, patientId: patient._id })
        .sort({ lastInboundAt: -1, updatedAt: -1 })
        .limit(30)
        .lean(),
    ]);

    const timeline = [];
    consultations.forEach((c) => {
      timeline.push({
        id: String(c._id),
        type: 'consultation',
        at: c.endTime || c.startTime || c.scheduledTime || c.createdAt,
        title: c.title || 'Consultation',
        status: c.status,
        summaryStatus: c.summaryStatus,
        chiefComplaint: c.chiefComplaint,
      });
    });
    prescriptions.forEach((p) => {
      timeline.push({
        id: String(p._id),
        type: 'prescription',
        at: p.approvedAt || p.createdAt,
        title: `Prescription (${p.status})`,
        status: p.status,
        itemCount: Array.isArray(p.items) ? p.items.length : 0,
      });
    });
    followUps.forEach((f) => {
      timeline.push({
        id: String(f._id),
        type: 'follow_up',
        at: f.sentAt || f.scheduledAt || f.createdAt,
        title: f.messageType === 'check_in' ? 'Follow-up check-in' : 'Follow-up',
        status: f.status,
      });
    });
    whatsappSessions.forEach((w) => {
      const state = String(w.bookingFlowState || 'START');
      const summary =
        state === 'CONFIRMED'
          ? 'Booking confirmed via WhatsApp'
          : state === 'CAPTURING_SYMPTOMS'
            ? 'Symptom intake in progress'
            : state === 'EMERGENCY_ALERTED'
              ? 'Emergency triage alert'
              : w.lastIntent
                ? `WhatsApp: ${w.lastIntent}`
                : 'WhatsApp interaction';
      timeline.push({
        id: String(w._id),
        type: 'whatsapp',
        at: w.lastInboundAt || w.updatedAt || w.createdAt,
        title: summary,
        status: state,
        bookingFlowState: state,
      });
    });
    timeline.sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0));

    return res.json({ patient, consultations, prescriptions, followUps, timeline });
  } catch (err) {
    console.error('[cura] GET /patients/:id', err);
    return res.status(500).json({ error: 'Failed to load patient.' });
  }
});

/** Start consultation (creates Meeting linked to patient) */
router.post('/consultations', requireClinic, async (req, res) => {
  try {
    const denied = subscriptionDeniedResponse(req.admin);
    if (denied) {
      return res.status(denied.status).json(denied.json);
    }

    const { patientId, chiefComplaint, visitType, scheduledTime } = req.body || {};
    const patient = await Patient.findOne({
      _id: patientId,
      clinicId: req.curaClinic._id,
    });
    if (!patient) {
      return res.status(404).json({ error: 'Patient not found.' });
    }

    const now = new Date();
    const sched = scheduledTime ? new Date(scheduledTime) : now;
    const title = `Consultation · ${patient.name}`;
    const organizer = req.admin.username || 'Clinician';
    const participants = [];
    if (patient.email) {
      participants.push({ name: patient.name, email: patient.email, role: 'Patient' });
    }
    if (req.admin.email) {
      participants.push({
        name: organizer,
        email: req.admin.email,
        role: 'Clinician',
      });
    }

    const meeting = await Meeting.create({
      adminId: req.admin._id,
      clinicId: req.curaClinic._id,
      patientId: patient._id,
      meetingRoom: 'Cura Clinic',
      title,
      organizer,
      participants,
      scheduledTime: sched,
      startTime: null,
      status: 'Scheduled',
      chiefComplaint: String(chiefComplaint || '').trim(),
      visitType: String(visitType || 'general').trim(),
      summaryMode: 'clinical',
      transcriptionEnabled: true,
    });

    return res.status(201).json({ consultation: meeting });
  } catch (err) {
    console.error('[cura] POST /consultations', err);
    return res.status(500).json({ error: 'Failed to create consultation.' });
  }
});

router.get('/consultations', requireClinic, async (req, res) => {
  try {
    const list = await Meeting.find(consultationFilter(req))
      .sort({ updatedAt: -1 })
      .limit(100)
      .populate('patientId', 'name phone')
      .lean();
    return res.json({ consultations: list });
  } catch (err) {
    console.error('[cura] GET /consultations', err);
    return res.status(500).json({ error: 'Failed to list consultations.' });
  }
});

/** Month calendar — consultations + follow-ups for scheduling view */
router.get('/calendar', requireClinic, async (req, res) => {
  try {
    const now = new Date();
    const year = Math.min(2100, Math.max(2020, parseInt(req.query.year, 10) || now.getFullYear()));
    const month = Math.min(12, Math.max(1, parseInt(req.query.month, 10) || now.getMonth() + 1));
    const rangeStart = new Date(year, month - 1, 1, 0, 0, 0, 0);
    const rangeEnd = new Date(year, month, 0, 23, 59, 59, 999);
    const clinicId = req.curaClinic._id;

    const [consultations, followUps] = await Promise.all([
      Meeting.find({
        clinicId,
        patientId: { $ne: null },
        $or: [
          { scheduledTime: { $gte: rangeStart, $lte: rangeEnd } },
          { startTime: { $gte: rangeStart, $lte: rangeEnd } },
          {
            scheduledTime: null,
            startTime: null,
            createdAt: { $gte: rangeStart, $lte: rangeEnd },
          },
        ],
      })
        .sort({ scheduledTime: 1, startTime: 1, createdAt: 1 })
        .select(
          'title status scheduledTime startTime endTime chiefComplaint preVisitNotes patientId summaryStatus transcriptionStatus clinicalSummaryReviewedAt'
        )
        .populate('patientId', 'name phone')
        .lean(),
      FollowUp.find({
        clinicId,
        $or: [
          { scheduledAt: { $gte: rangeStart, $lte: rangeEnd } },
          { sentAt: { $gte: rangeStart, $lte: rangeEnd } },
        ],
      })
        .sort({ scheduledAt: 1, createdAt: 1 })
        .populate('patientId', 'name phone')
        .lean(),
    ]);

    return res.json({ year, month, consultations, followUps });
  } catch (err) {
    console.error('[cura] GET /calendar', err);
    return res.status(500).json({ error: 'Failed to load calendar.' });
  }
});

router.get('/follow-ups', requireClinic, async (req, res) => {
  try {
    const list = await FollowUp.find({ clinicId: req.curaClinic._id })
      .sort({ scheduledAt: -1, createdAt: -1 })
      .limit(100)
      .populate('patientId', 'name phone')
      .lean();
    return res.json({ followUps: list });
  } catch (err) {
    console.error('[cura] GET /follow-ups', err);
    return res.status(500).json({ error: 'Failed to list follow-ups.' });
  }
});

router.get('/prescriptions', requireClinic, async (req, res) => {
  try {
    const list = await Prescription.find({ clinicId: req.curaClinic._id })
      .sort({ createdAt: -1 })
      .limit(100)
      .populate('patientId', 'name')
      .lean();
    return res.json({ prescriptions: list });
  } catch (err) {
    console.error('[cura] GET /prescriptions', err);
    return res.status(500).json({ error: 'Failed to list prescriptions.' });
  }
});

/** Search consultations by pre-visit notes / chief complaint (clinical prelude). */
router.get('/search', requireClinic, async (req, res) => {
  try {
    const q = String(req.query.q || '').trim().toLowerCase();
    if (!q || q.length < 2) {
      return res.status(400).json({
        error: 'Search query too short.',
        details: 'Provide at least 2 characters (e.g. headache, follow-up).',
      });
    }

    const consultations = await Meeting.find({
      clinicId: req.curaClinic._id,
      patientId: { $ne: null },
      $or: [
        { preVisitNotes: { $regex: q, $options: 'i' } },
        { chiefComplaint: { $regex: q, $options: 'i' } },
      ],
    })
      .sort({ scheduledTime: -1, createdAt: -1 })
      .limit(40)
      .populate('patientId', 'name phone medicalRecordNumber')
      .lean();

    return res.json({ query: q, results: consultations });
  } catch (err) {
    console.error('[cura] GET /search', err);
    return res.status(500).json({ error: 'Search failed.' });
  }
});

/** Open clinic alerts (WhatsApp emergencies). */
router.get('/alerts', requireClinic, async (req, res) => {
  try {
    const ClinicAlert = require('../models/ClinicAlert');
    const alerts = await ClinicAlert.find({
      clinicId: req.curaClinic._id,
      status: 'open',
    })
      .sort({ createdAt: -1 })
      .limit(20)
      .populate('patientId', 'name phone')
      .lean();
    const emergencyCount = alerts.filter((a) => a.triageLevel === 'EMERGENCY').length;
    return res.json({ alerts, emergencyCount, hasEmergencyPulse: emergencyCount > 0 });
  } catch (err) {
    console.error('[cura] GET /alerts', err);
    return res.status(500).json({ error: 'Failed to load alerts.' });
  }
});

module.exports = router;

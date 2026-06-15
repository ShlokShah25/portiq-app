const ClinicAlert = require('../models/ClinicAlert');
const Meeting = require('../models/Meeting');
const Admin = require('../models/Admin');
const { sendEmail, isEmailConfigured } = require('../utils/emailService');

const TRIAGE_LEVELS = {
  NORMAL: 'NORMAL',
  URGENT: 'URGENT',
  EMERGENCY: 'EMERGENCY',
};

/** High-risk patterns — safety-critical, prefer over-booking. */
const EMERGENCY_SIGNALS = [
  /\bchest\s+pain\b/i,
  /\bheart\s+attack\b/i,
  /\bcan'?t\s+breathe\b/i,
  /\bcannot\s+breathe\b/i,
  /\bdifficulty\s+breathing\b/i,
  /\bshort(ness)?\s+of\s+breath\b/i,
  /\buncontrolled\s+bleeding\b/i,
  /\bsevere\s+bleeding\b/i,
  /\bloss\s+of\s+consciousness\b/i,
  /\bpassed\s+out\b/i,
  /\bunconscious\b/i,
  /\bstroke\b/i,
  /\bface\s+drooping\b/i,
  /\bslurred\s+speech\b/i,
  /\bsuicid(e|al)\b/i,
  /\bwant\s+to\s+die\b/i,
  /\bkill\s+myself\b/i,
  /\boverdose\b/i,
  /\bseizure\b/i,
  /\banaphylaxis\b/i,
  /\bnot\s+breathing\b/i,
];

const URGENT_SIGNALS = [
  /\bemergency\b/i,
  /\burgent\b/i,
  /\bhigh\s+fever\b/i,
  /\bsevere\s+pain\b/i,
  /\bworsening\b/i,
  /\bblood\s+in\b/i,
  /\bcan'?t\s+walk\b/i,
  /\bcannot\s+walk\b/i,
];

function defaultEmergencyNumber(clinic) {
  return (
    String(clinic?.emergencyPhone || '').trim() ||
    String(clinic?.settings?.emergencyPhone || '').trim() ||
    process.env.CURA_EMERGENCY_NUMBER ||
    '112'
  );
}

/**
 * Assess chief complaint / free text for triage level.
 */
function assessTriage(text, clinic = null) {
  const raw = String(text || '').trim();
  const emergencyNumber = defaultEmergencyNumber(clinic);
  const matchedEmergency = EMERGENCY_SIGNALS.filter((re) => re.test(raw)).map((re) =>
    String(re)
  );
  const matchedUrgent = URGENT_SIGNALS.filter((re) => re.test(raw)).map((re) => String(re));

  if (matchedEmergency.length) {
    return {
      level: TRIAGE_LEVELS.EMERGENCY,
      signals: matchedEmergency,
      emergencyNumber,
      overrideBooking: true,
      dashboardAlert: true,
    };
  }
  if (matchedUrgent.length) {
    return {
      level: TRIAGE_LEVELS.URGENT,
      signals: matchedUrgent,
      emergencyNumber,
      overrideBooking: false,
      dashboardAlert: true,
    };
  }
  return {
    level: TRIAGE_LEVELS.NORMAL,
    signals: [],
    emergencyNumber,
    overrideBooking: false,
    dashboardAlert: false,
  };
}

function redRouteMessage(assessment, clinic) {
  const num = assessment.emergencyNumber || '112';
  return (
    `⚠️ *This sounds like an emergency.*\n\n` +
    `Please call local emergency services *${num}* or visit the nearest ER immediately.\n\n` +
    `Do not wait for an appointment. We've alerted ${clinic?.name || 'the clinic'} staff.`
  );
}

async function notifyClinicAdmin(clinic, { patient, phone, text, triageLevel, sessionId }) {
  await ClinicAlert.create({
    clinicId: clinic._id,
    patientId: patient?._id || null,
    phone: phone || '',
    severity: triageLevel === TRIAGE_LEVELS.EMERGENCY ? 'emergency' : 'urgent',
    message: String(text || '').trim(),
    triageLevel,
    status: 'open',
    sessionId: sessionId || null,
  });

  const admin = await Admin.findById(clinic.ownerAdminId).select('email username');
  if (admin?.email && isEmailConfigured()) {
    try {
      await sendEmail({
        to: admin.email,
        subject:
          triageLevel === TRIAGE_LEVELS.EMERGENCY
            ? `🚨 HIGH-RISK PATIENT ALERT — ${patient?.name || phone}`
            : `⚠️ Urgent triage — ${patient?.name || phone}`,
        text:
          `Cura triage alert (${triageLevel})\n\n` +
          `Clinic: ${clinic.name}\n` +
          `Patient: ${patient?.name || 'Unknown'} (${phone})\n` +
          `Message: ${text}\n\n` +
          `Review immediately in the Cura dashboard.`,
      });
    } catch (err) {
      console.warn('[SafetyGuardrail] admin notify failed:', err.message);
    }
  }
}

async function flagConsultationTriage(consultationId, triageLevel, text) {
  if (!consultationId) return null;
  const urgent = triageLevel === TRIAGE_LEVELS.EMERGENCY;
  return Meeting.findByIdAndUpdate(
    consultationId,
    {
      $set: {
        triageLevel,
        urgentTriage: urgent,
        chiefComplaint: String(text || '').slice(0, 500),
        preVisitNotes: String(text || '').slice(0, 2000),
        clinicalPrepStatus: 'pre_notes_provided',
      },
    },
    { new: true }
  );
}

class SafetyGuardrailService {
  /**
   * Run triage on inbound text. Returns action for booking flow.
   */
  async evaluate({ text, clinic, patient, phone, session, consultationId }) {
    const assessment = assessTriage(text, clinic);

    if (assessment.level === TRIAGE_LEVELS.EMERGENCY) {
      await notifyClinicAdmin(clinic, { patient, phone, text, triageLevel: assessment.level, sessionId: session?._id });
      if (consultationId || session?.consultationId) {
        await flagConsultationTriage(
          consultationId || session.consultationId,
          assessment.level,
          text
        );
      }
      if (session) {
        session.bookingFlowState = 'EMERGENCY_ALERTED';
        session.lastIntent = 'emergency_triage';
        session.context = {
          ...(session.context || {}),
          lastTriage: assessment,
        };
        await session.save();
      }
      return {
        blocked: true,
        triageLevel: assessment.level,
        reply: redRouteMessage(assessment, clinic),
        assessment,
      };
    }

    if (assessment.level === TRIAGE_LEVELS.URGENT) {
      await notifyClinicAdmin(clinic, { patient, phone, text, triageLevel: assessment.level, sessionId: session?._id });
      if (consultationId || session?.consultationId) {
        await flagConsultationTriage(
          consultationId || session.consultationId,
          assessment.level,
          text
        );
      }
      return {
        blocked: false,
        triageLevel: assessment.level,
        urgentWarning:
          `We noted urgent symptoms. If you feel worse, call ${assessment.emergencyNumber} immediately.\n\n`,
        assessment,
      };
    }

    return {
      blocked: false,
      triageLevel: TRIAGE_LEVELS.NORMAL,
      assessment,
    };
  }
}

module.exports = {
  SafetyGuardrailService,
  assessTriage,
  TRIAGE_LEVELS,
  redRouteMessage,
  defaultEmergencyNumber,
};

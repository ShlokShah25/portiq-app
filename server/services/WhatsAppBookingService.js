const crypto = require('crypto');
const Patient = require('../models/Patient');
const Clinic = require('../models/Clinic');
const Admin = require('../models/Admin');
const Meeting = require('../models/Meeting');
const FollowUp = require('../models/FollowUp');
const WhatsAppSession = require('../models/WhatsAppSession');
const DoctorSchedule = require('../models/DoctorSchedule');
const {
  calculateAvailableSlotsForPatient,
  formatSlotLabel,
  resolvePreferredClinic,
} = require('./AvailabilityService');
const { SafetyGuardrailService, assessTriage, TRIAGE_LEVELS } = require('./SafetyGuardrailService');
const { inferTimezoneFromPhone, resolveTimezone } = require('../utils/timezoneUtils');
const { normalizeWhatsAppPhone } = require('../utils/whatsapp');

const safetyGuardrail = new SafetyGuardrailService();
const BOOK_PATTERN = /\b(book|appointment|schedule|visit|consult|slot|doctor)\b/i;
const FOLLOW_UP_PATTERN = /\b(follow[\s-]?up|review visit|check[\s-]?up)\b/i;
const GREETING_PATTERN = /^(hi|hello|hey|start|menu|help)\b/i;

function doctorName(clinic) {
  return (
    String(clinic?.settings?.doctorDisplayName || '').trim() ||
    String(clinic?.name || 'your doctor').trim()
  );
}

function classifyIntent(text) {
  const t = String(text || '').trim();
  if (!t) return 'greeting';
  const triage = assessTriage(t);
  if (triage.level === TRIAGE_LEVELS.EMERGENCY) return 'emergency';
  if (triage.level === TRIAGE_LEVELS.URGENT && /\b(emergency|urgent)\b/i.test(t)) return 'emergency';
  if (FOLLOW_UP_PATTERN.test(t)) return 'follow_up';
  if (BOOK_PATTERN.test(t)) return 'book';
  if (GREETING_PATTERN.test(t)) return 'greeting';
  if (/^[12]$/.test(t)) return 'menu_choice';
  if (/^[123]$/.test(t)) return 'slot_choice';
  return 'free_text';
}

function hashOtp(code) {
  return crypto.createHash('sha256').update(String(code)).digest('hex');
}

function generateOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function resolveClinic(clinicIdHint) {
  if (clinicIdHint) {
    const c = await Clinic.findById(clinicIdHint);
    if (c) return c;
  }
  const envId = process.env.CURA_DEFAULT_CLINIC_ID;
  if (envId) {
    const c = await Clinic.findById(envId);
    if (c) return c;
  }
  return Clinic.findOne({ 'settings.whatsappEnabled': true }).sort({ updatedAt: -1 });
}

async function findPatientByPhone(clinicId, phone) {
  const normalized = normalizeWhatsAppPhone(phone);
  const tail = normalized.replace(/\D/g, '').slice(-10);
  return Patient.findOne({
    clinicId,
    $or: [{ phone: normalized }, { phone: new RegExp(`${tail}$`) }],
  });
}

async function getOrCreateSession(phone, clinic) {
  const normalized = normalizeWhatsAppPhone(phone);
  let session = await WhatsAppSession.findOne({ phone: normalized, clinicId: clinic._id });
  if (!session) {
    session = new WhatsAppSession({
      phone: normalized,
      clinicId: clinic._id,
      bookingFlowState: 'START',
      context: {},
    });
  }
  session.lastInboundAt = new Date();
  const exp = new Date();
  exp.setHours(exp.getHours() + 24);
  session.expiresAt = exp;
  return session;
}

async function loadPatientContext(clinicId, phone) {
  const patient = await findPatientByPhone(clinicId, phone);
  if (!patient) return { patient: null, lastDoctor: null, lastVisit: null };

  const lastMeeting = await Meeting.findOne({
    clinicId,
    patientId: patient._id,
    status: { $ne: 'Cancelled' },
  })
    .sort({ scheduledTime: -1, startTime: -1, createdAt: -1 })
    .lean();

  const lastDoctor =
    patient.lastDoctorName ||
    (lastMeeting?.organizer ? String(lastMeeting.organizer) : null);

  return { patient, lastDoctor, lastVisit: lastMeeting };
}

function menuMessage({ patientName, lastDoctor, clinic }) {
  const dr = doctorName(clinic);
  const greet = patientName ? `Hi ${patientName}!` : 'Hello!';
  const recall = lastDoctor
    ? `Last visit was with ${lastDoctor}.`
    : `Welcome to ${clinic.name}.`;
  return (
    `${greet} ${recall}\n\n` +
    `Book with ${dr} — reply with a number:\n` +
    `1 · Follow-up visit\n` +
    `2 · New health concern\n` +
    `3 · Emergency (urgent care info)\n\n` +
    `Or type *book* anytime to see open slots.`
  );
}

async function resolveClinicsForDoctor(adminId, fallbackClinic) {
  if (!adminId) return fallbackClinic ? [fallbackClinic] : [];
  const schedules = await DoctorSchedule.find({ adminId, enabled: true }).select('clinicId').lean();
  if (!schedules.length) return fallbackClinic ? [fallbackClinic] : [];
  const clinics = await Clinic.find({
    _id: { $in: schedules.map((s) => s.clinicId) },
    'settings.whatsappEnabled': true,
  }).lean();
  if (clinics.length) return clinics;
  return fallbackClinic ? [fallbackClinic] : [];
}

async function pickClinicForPatient(patient, admin, primaryClinic) {
  const clinics = await resolveClinicsForDoctor(admin?._id, primaryClinic);
  if (!clinics.length) return primaryClinic;
  if (clinics.length === 1) return clinics[0];
  const preferredId = patient
    ? await resolvePreferredClinic(patient._id, admin?._id)
    : null;
  if (preferredId) {
    const match = clinics.find((c) => String(c._id) === String(preferredId));
    if (match) return match;
  }
  return clinics[0];
}

function slotsMessage(slots, clinic, patientTz) {
  if (!slots.length) {
    return `Sorry, no open slots in the next two weeks at ${clinic.name}. Please call the clinic directly.`;
  }
  const tzNote = patientTz ? `\n(Times shown in your local timezone)\n` : '';
  const lines = slots.map((s, i) => `${i + 1} · ${s.label || s.labelPatient}`);
  return (
    `Open appointments at ${clinic.name}:${tzNote}\n` +
    `${lines.join('\n')}\n\n` +
    `Reply *1*, *2*, or *3* to book.`
  );
}

async function createConsultationBooking({ clinic, patient, admin, slot, visitType, session }) {
  const title = `Consultation · ${patient.name}`;
  const organizer = doctorName(clinic);
  const participants = [];
  if (patient.email) {
    participants.push({ name: patient.name, email: patient.email, role: 'Patient' });
  }
  if (admin?.email) {
    participants.push({ name: organizer, email: admin.email, role: 'Clinician' });
  }

  const meeting = await Meeting.create({
    adminId: admin._id,
    clinicId: clinic._id,
    patientId: patient._id,
    meetingRoom: clinic.name,
    title,
    organizer,
    participants,
    scheduledTime: slot.start,
    status: 'Scheduled',
    visitType: visitType || 'general',
    summaryMode: 'clinical',
    transcriptionEnabled: true,
    bookingSource: 'whatsapp',
    clinicalPrepStatus: 'pending',
    whatsappSessionId: session?._id || null,
  });

  session.consultationId = meeting._id;
  session.bookingFlowState = 'CAPTURING_SYMPTOMS';
  session.context = {
    ...session.context,
    consultationId: String(meeting._id),
    slotLabel: formatSlotLabel(slot.start, session.patientTimezone || ''),
  };
  await session.save();

  await FollowUp.create({
    clinicId: clinic._id,
    patientId: patient._id,
    consultationId: meeting._id,
    channel: 'whatsapp',
    messageType: 'reminder',
    status: 'scheduled',
    scheduledAt: new Date(slot.start.getTime() - 24 * 60 * 60 * 1000),
    messageBody: `Reminder: your consultation at ${clinic.name} is tomorrow.`,
  });

  return meeting;
}

async function finalizeSymptoms(session, clinic, text, patient, phone) {
  const guard = await safetyGuardrail.evaluate({
    text,
    clinic,
    patient,
    phone,
    session,
    consultationId: session.consultationId,
  });
  if (guard.blocked) {
    return { reply: guard.reply, triageLevel: guard.triageLevel };
  }

  const notes = String(text || '').trim();
  const meeting = await Meeting.findById(session.consultationId);
  if (!meeting) {
    return { error: 'Booking not found.' };
  }
  meeting.preVisitNotes = notes;
  meeting.chiefComplaint = notes.slice(0, 500);
  meeting.clinicalPrepStatus = notes.length ? 'pre_notes_provided' : 'pending';
  meeting.visitType = session.context?.visitType || meeting.visitType;
  meeting.triageLevel = guard.triageLevel || 'NORMAL';
  meeting.urgentTriage = guard.triageLevel === TRIAGE_LEVELS.EMERGENCY;
  await meeting.save();

  if (session.patientId) {
    await Patient.findByIdAndUpdate(session.patientId, {
      $push: {
        patientHistory: {
          at: new Date(),
          summary: notes.slice(0, 300),
          consultationId: meeting._id,
        },
      },
    });
  }

  session.bookingFlowState = 'CONFIRMED';
  session.context = { ...session.context, preVisitNotes: notes };
  await session.save();

  const dr = doctorName(clinic);
  const when = session.context?.slotLabel || formatSlotLabel(meeting.scheduledTime, session.patientTimezone);
  const prefix = guard.urgentWarning || '';
  return {
    reply:
      prefix +
      `✅ Appointment confirmed\n` +
      `📅 ${when}\n` +
      `👨‍⚕️ ${dr}\n\n` +
      `Your visit reason has been shared with the clinic. You'll get a reminder 24h before.\n\n` +
      `Reply *book* anytime to schedule another visit.`,
    triageLevel: guard.triageLevel,
  };
}

async function handleEmergency(session, clinic, text, patient) {
  const guard = await safetyGuardrail.evaluate({
    text,
    clinic,
    patient,
    phone: session.phone,
    session,
    consultationId: session.consultationId,
  });
  return {
    reply: guard.reply,
    triageLevel: guard.triageLevel,
    blocked: guard.blocked,
  };
}

class WhatsAppBookingService {
  /**
   * Process inbound WhatsApp message; returns Twilio reply body (plain text).
   */
  async handleInbound({ from, body, clinicIdHint }) {
    const phone = normalizeWhatsAppPhone(from);
    const text = String(body || '').trim();
    const clinic = await resolveClinic(clinicIdHint);

    if (!clinic) {
      return { reply: 'Clinic booking is not configured yet. Please contact your clinic directly.' };
    }
    if (!clinic.settings?.whatsappEnabled && process.env.CURA_WHATSAPP_FORCE !== 'true') {
      return {
        reply: `${clinic.name} has not enabled WhatsApp booking yet. Please call the clinic.`,
      };
    }

    const session = await getOrCreateSession(phone, clinic);
    const { patient, lastDoctor } = await loadPatientContext(clinic._id, phone);
    if (patient) {
      session.patientId = patient._id;
      if (patient.whatsappOptIn) session.trustedSession = true;
    }

    const intent = classifyIntent(text);
    session.lastIntent = intent;
    const patientTz = resolveTimezone(
      patient?.timezone ||
        session.patientTimezone ||
        inferTimezoneFromPhone(phone)
    );
    session.patientTimezone = patientTz;
    const admin = await Admin.findById(clinic.ownerAdminId);
    const activeClinic = await pickClinicForPatient(patient, admin, clinic);

    const preCheck = await safetyGuardrail.evaluate({
      text,
      clinic: activeClinic,
      patient,
      phone,
      session,
      consultationId: session.consultationId,
    });
    if (preCheck.blocked) {
      await session.save();
      return { reply: preCheck.reply, triageLevel: preCheck.triageLevel };
    }

    if (intent === 'emergency' || (session.bookingFlowState === 'START' && text === '3')) {
      const res = await handleEmergency(session, activeClinic, text, patient);
      return res;
    }

    if (session.bookingFlowState === 'AUTH_PENDING') {
      const code = text.replace(/\D/g, '');
      if (
        session.otpHash &&
        session.otpExpiresAt > new Date() &&
        hashOtp(code) === session.otpHash
      ) {
        session.trustedSession = true;
        session.verifiedAt = new Date();
        session.otpHash = '';
        session.bookingFlowState = 'SELECTING_BOOKING_TYPE';
        await session.save();
        return {
          reply: menuMessage({
            patientName: patient?.name,
            lastDoctor,
            clinic,
          }),
        };
      }
      return { reply: 'Invalid or expired code. Reply *book* to receive a new code.' };
    }

    if (session.bookingFlowState === 'CAPTURING_SYMPTOMS') {
      const res = await finalizeSymptoms(session, activeClinic, text, patient, phone);
      if (res.error) return res;
      return res;
    }

    if (session.bookingFlowState === 'SELECTING_SLOT' || intent === 'slot_choice') {
      const idx = parseInt(text, 10) - 1;
      const offered = session.context?.offeredSlots || [];
      const slot = offered[idx];
      if (!slot) {
        return { reply: 'Please reply *1*, *2*, or *3* for an available slot.' };
      }

      let pat = patient;
      if (!pat) {
        pat = await Patient.create({
          clinicId: clinic._id,
          adminId: admin._id,
          name: session.context?.patientName || `Patient ${phone.slice(-4)}`,
          phone,
          whatsappOptIn: true,
        });
        session.patientId = pat._id;
      }

      const visitType = session.context?.visitType || 'general';
      await createConsultationBooking({
        clinic: activeClinic,
        patient: pat,
        admin,
        slot: { start: new Date(slot.start), end: new Date(slot.end) },
        visitType,
        session,
      });

      const dr = doctorName(activeClinic);
      return {
        reply:
          `Booked: ${slot.label}\n\n` +
          `To help ${dr} prepare, briefly describe what you'd like to discuss (one message):`,
      };
    }

    if (
      session.bookingFlowState === 'SELECTING_BOOKING_TYPE' ||
      intent === 'menu_choice' ||
      intent === 'book' ||
      intent === 'follow_up' ||
      intent === 'greeting'
    ) {
      if (session.bookingFlowState === 'SELECTING_BOOKING_TYPE' || intent === 'menu_choice') {
        const choice = text.trim();
        if (choice === '1') session.context = { ...session.context, visitType: 'follow_up' };
        else if (choice === '2') session.context = { ...session.context, visitType: 'general' };
        else if (choice !== '1' && choice !== '2' && intent !== 'follow_up' && intent !== 'book') {
          return {
            reply: menuMessage({ patientName: patient?.name, lastDoctor, clinic }),
          };
        } else if (intent === 'follow_up') {
          session.context = { ...session.context, visitType: 'follow_up' };
        } else {
          session.context = { ...session.context, visitType: 'general' };
        }
      }

      if (!session.trustedSession && !patient?.whatsappOptIn) {
        const otp = generateOtp();
        session.otpHash = hashOtp(otp);
        session.otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000);
        session.bookingFlowState = 'AUTH_PENDING';
        await session.save();
        return {
          reply:
            `For your security, enter this code: *${otp}*\n\n` +
            `(Valid 10 minutes. First-time WhatsApp booking.)`,
        };
      }

      const leadMin = activeClinic.settings?.bookingLeadMinutes || 60;
      const doctorClinics = await resolveClinicsForDoctor(admin?._id, activeClinic);
      const slotResult = await calculateAvailableSlotsForPatient({
        patientId: patient?._id,
        doctorAdminId: admin?._id,
        clinicIds: doctorClinics.map((c) => c._id),
        patientTimezone: patientTz,
        patientPhone: phone,
        limit: 3,
        leadMinutes: leadMin,
      });
      const slots = slotResult.slots;
      const slotClinic = slotResult.clinic || activeClinic;
      session.bookingFlowState = 'SELECTING_SLOT';
      session.context = {
        ...session.context,
        offeredSlots: slots.map((s) => ({
          start: s.start.toISOString(),
          end: s.end.toISOString(),
          label: s.label,
          clinicId: String(slotClinic._id),
        })),
        activeClinicId: String(slotClinic._id),
      };
      await session.save();

      return { reply: slotsMessage(slots, slotClinic, patientTz) };
    }

    session.bookingFlowState = 'SELECTING_BOOKING_TYPE';
    await session.save();
    return {
      reply: menuMessage({ patientName: patient?.name, lastDoctor, clinic }),
    };
  }
}

module.exports = {
  WhatsAppBookingService,
  classifyIntent,
  doctorName,
};

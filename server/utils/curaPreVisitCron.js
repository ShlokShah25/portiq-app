const cron = require('node-cron');
const Meeting = require('../models/Meeting');
const Patient = require('../models/Patient');
const Clinic = require('../models/Clinic');
const FollowUp = require('../models/FollowUp');
const { sendWhatsAppText } = require('./whatsapp');
const { doctorName } = require('../services/WhatsAppBookingService');

function hoursUntil(d) {
  return (new Date(d).getTime() - Date.now()) / (60 * 60 * 1000);
}

/**
 * 24h pre-consultation prep messages + appointment reminders.
 */
async function runPreVisitPrepJob() {
  const now = new Date();
  const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const windowStart = new Date(in24h.getTime() - 30 * 60 * 1000);
  const windowEnd = new Date(in24h.getTime() + 30 * 60 * 1000);

  const upcoming = await Meeting.find({
    patientId: { $ne: null },
    bookingSource: 'whatsapp',
    status: 'Scheduled',
    preVisitPrepSentAt: null,
    scheduledTime: { $gte: windowStart, $lte: windowEnd },
  })
    .limit(50)
    .lean();

  for (const m of upcoming) {
    try {
      const [patient, clinic] = await Promise.all([
        Patient.findById(m.patientId).lean(),
        Clinic.findById(m.clinicId).lean(),
      ]);
      if (!patient?.phone || !patient.whatsappOptIn) continue;
      if (!clinic?.settings?.whatsappEnabled && process.env.CURA_WHATSAPP_FORCE !== 'true') continue;

      const dr = doctorName(clinic);
      const when = new Date(m.scheduledTime).toLocaleString('en-IN', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      });

      const hasPreNotes = String(m.preVisitNotes || m.chiefComplaint || '').trim().length > 0;
      const body = hasPreNotes
        ? `Reminder: your consultation with ${dr} is tomorrow (${when}).\n\n` +
          `We have your visit notes on file. Reply with any updates or documents you'd like the doctor to know.`
        : `Reminder: your consultation with ${dr} is tomorrow (${when}).\n\n` +
          `To help ${dr} prepare, briefly describe what you'd like to discuss (reply in one message).`;

      const sent = await sendWhatsAppText(patient.phone, body);
      if (sent.success) {
        await Meeting.findByIdAndUpdate(m._id, {
          $set: {
            preVisitPrepSentAt: new Date(),
            clinicalPrepStatus: hasPreNotes ? 'prep_sent' : 'pending',
          },
        });
      }
    } catch (err) {
      console.warn('[cura-previsit] failed for meeting', m._id, err.message);
    }
  }

  const dueReminders = await FollowUp.find({
    channel: 'whatsapp',
    messageType: 'reminder',
    status: 'scheduled',
    scheduledAt: { $lte: now },
  })
    .limit(30)
    .lean();

  for (const fu of dueReminders) {
    try {
      const patient = await Patient.findById(fu.patientId).lean();
      if (!patient?.phone) continue;
      const sent = await sendWhatsAppText(patient.phone, fu.messageBody || 'Appointment reminder from your clinic.');
      await FollowUp.findByIdAndUpdate(fu._id, {
        $set: {
          status: sent.success ? 'sent' : 'failed',
          sentAt: sent.success ? new Date() : null,
          twilioMessageSid: sent.messageSid || '',
        },
      });
    } catch (err) {
      console.warn('[cura-previsit] follow-up send failed', fu._id, err.message);
    }
  }
}

function startCuraPreVisitCron() {
  cron.schedule('*/15 * * * *', () => {
    runPreVisitPrepJob().catch((err) => {
      console.error('[cura-previsit] cron error:', err.message);
    });
  });
  console.log('✅ Cura pre-visit WhatsApp cron scheduled (every 15 min)');
}

module.exports = {
  startCuraPreVisitCron,
  runPreVisitPrepJob,
};

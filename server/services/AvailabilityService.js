const moment = require('moment-timezone');
const Clinic = require('../models/Clinic');
const ClinicAvailability = require('../models/ClinicAvailability');
const DoctorSchedule = require('../models/DoctorSchedule');
const Meeting = require('../models/Meeting');
const Patient = require('../models/Patient');
const {
  resolveTimezone,
  formatSlotDualLabel,
  inferTimezoneFromPhone,
  DEFAULT_TZ,
} = require('../utils/timezoneUtils');

const DEFAULT_WINDOWS = [
  { dayOfWeek: 1, startTime: '09:00', endTime: '13:00', slotMinutes: 30, enabled: true },
  { dayOfWeek: 1, startTime: '16:00', endTime: '19:00', slotMinutes: 30, enabled: true },
  { dayOfWeek: 2, startTime: '09:00', endTime: '13:00', slotMinutes: 30, enabled: true },
  { dayOfWeek: 2, startTime: '16:00', endTime: '19:00', slotMinutes: 30, enabled: true },
  { dayOfWeek: 3, startTime: '09:00', endTime: '13:00', slotMinutes: 30, enabled: true },
  { dayOfWeek: 3, startTime: '16:00', endTime: '19:00', slotMinutes: 30, enabled: true },
  { dayOfWeek: 4, startTime: '09:00', endTime: '13:00', slotMinutes: 30, enabled: true },
  { dayOfWeek: 4, startTime: '16:00', endTime: '19:00', slotMinutes: 30, enabled: true },
  { dayOfWeek: 5, startTime: '09:00', endTime: '13:00', slotMinutes: 30, enabled: true },
  { dayOfWeek: 5, startTime: '16:00', endTime: '19:00', slotMinutes: 30, enabled: true },
  { dayOfWeek: 6, startTime: '10:00', endTime: '14:00', slotMinutes: 30, enabled: true },
];

function parseHHMM(hhmm) {
  const m = String(hhmm || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return { h: parseInt(m[1], 10), min: parseInt(m[2], 10) };
}

function normalizeHourBlocks(blocks) {
  if (!Array.isArray(blocks) || !blocks.length) return null;
  return blocks
    .filter((b) => b && b.enabled !== false)
    .map((b) => ({
      dayOfWeek: b.dayOfWeek,
      startTime: b.startTime,
      endTime: b.endTime,
      slotMinutes: b.slotMinutes || 30,
      enabled: true,
    }));
}

async function getClinicOperatingHours(clinic) {
  const fromSchema = normalizeHourBlocks(clinic.operatingHours);
  if (fromSchema?.length) return fromSchema;

  const rows = await ClinicAvailability.find({ clinicId: clinic._id, enabled: true }).lean();
  if (rows.length) {
    return rows.map((r) => ({
      dayOfWeek: r.dayOfWeek,
      startTime: r.startTime,
      endTime: r.endTime,
      slotMinutes: r.slotMinutes || 30,
      enabled: true,
    }));
  }
  return DEFAULT_WINDOWS;
}

async function getDoctorHours(adminId, clinicId) {
  if (!adminId) return null;
  const sched = await DoctorSchedule.findOne({ adminId, clinicId, enabled: true }).lean();
  if (!sched) return null;
  return {
    timezone: sched.timezone || null,
    blocks: normalizeHourBlocks(sched.operatingHours),
    slotMinutes: sched.slotMinutes || 30,
  };
}

/**
 * Intersect clinic hours with doctor hours (by dayOfWeek + overlapping time range).
 */
function intersectHourBlocks(clinicBlocks, doctorBlocks) {
  if (!doctorBlocks?.length) return clinicBlocks;
  const result = [];
  for (const cb of clinicBlocks) {
    const db = doctorBlocks.find((d) => d.dayOfWeek === cb.dayOfWeek);
    if (!db) continue;
    const cs = parseHHMM(cb.startTime);
    const ce = parseHHMM(cb.endTime);
    const ds = parseHHMM(db.startTime);
    const de = parseHHMM(db.endTime);
    if (!cs || !ce || !ds || !de) continue;
    const startMin = Math.max(cs.h * 60 + cs.min, ds.h * 60 + ds.min);
    const endMin = Math.min(ce.h * 60 + ce.min, de.h * 60 + de.min);
    if (endMin <= startMin) continue;
    result.push({
      dayOfWeek: cb.dayOfWeek,
      startTime: `${String(Math.floor(startMin / 60)).padStart(2, '0')}:${String(startMin % 60).padStart(2, '0')}`,
      endTime: `${String(Math.floor(endMin / 60)).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}`,
      slotMinutes: Math.min(cb.slotMinutes || 30, db.slotMinutes || 30),
      enabled: true,
    });
  }
  return result.length ? result : clinicBlocks;
}

async function getBookedSlotStarts(clinicId, doctorId, rangeStart, rangeEnd) {
  const filter = {
    clinicId,
    patientId: { $ne: null },
    status: { $ne: 'Cancelled' },
    scheduledTime: { $gte: rangeStart, $lte: rangeEnd },
  };
  if (doctorId) filter.adminId = doctorId;
  const meetings = await Meeting.find(filter).select('scheduledTime').lean();
  return new Set(
    meetings
      .map((m) => (m.scheduledTime ? new Date(m.scheduledTime).getTime() : null))
      .filter(Boolean)
  );
}

/**
 * Generate slot instants (UTC) from hour blocks in clinic timezone.
 */
function generateSlotsFromBlocks(blocks, clinicTz, { earliestUtc, rangeEndUtc, booked, limit }) {
  const slots = [];
  const tz = resolveTimezone(clinicTz);
  let cursor = moment.tz(tz);
  const endMoment = moment.utc(rangeEndUtc).tz(tz);

  for (let dayOffset = 0; dayOffset < 21 && slots.length < limit; dayOffset += 1) {
    const day = moment.tz(tz).startOf('day').add(dayOffset, 'days');
    const dow = day.day();
    const dayWindows = blocks.filter((w) => w.dayOfWeek === dow);
    for (const win of dayWindows) {
      const startP = parseHHMM(win.startTime);
      const endP = parseHHMM(win.endTime);
      if (!startP || !endP) continue;
      const slotMin = win.slotMinutes || 30;
      let slotStart = day.clone().hour(startP.h).minute(startP.min).second(0);
      const windowEnd = day.clone().hour(endP.h).minute(endP.min).second(0);
      while (slotStart.isBefore(windowEnd) && slots.length < limit) {
        const utc = slotStart.clone().utc().toDate();
        if (utc >= earliestUtc && utc <= rangeEndUtc) {
          const key = utc.getTime();
          if (!booked.has(key)) {
            slots.push({
              start: utc,
              end: new Date(utc.getTime() + slotMin * 60 * 1000),
              slotMinutes: slotMin,
            });
          }
        }
        slotStart = slotStart.add(slotMin, 'minutes');
      }
    }
  }
  return slots.slice(0, limit);
}

/**
 * Preferred clinic from patient visit history (most visits wins; tie → most recent).
 */
async function resolvePreferredClinic(patientId, doctorAdminId) {
  if (!patientId) return null;
  const patient = await Patient.findById(patientId).select('preferredClinicId clinicId').lean();
  if (!patient) return null;
  if (patient.preferredClinicId) return patient.preferredClinicId;

  const agg = await Meeting.aggregate([
    {
      $match: {
        patientId: patient._id,
        clinicId: { $ne: null },
        status: { $ne: 'Cancelled' },
        ...(doctorAdminId ? { adminId: doctorAdminId } : {}),
      },
    },
    { $group: { _id: '$clinicId', count: { $sum: 1 }, lastAt: { $max: '$scheduledTime' } } },
    { $sort: { count: -1, lastAt: -1 } },
    { $limit: 1 },
  ]);
  if (agg.length) return agg[0]._id;
  return patient.clinicId || null;
}

/**
 * Three-way join: clinic hours ∩ doctor schedule ∩ booked slots.
 * Labels returned in patient local timezone.
 */
async function calculateAvailableSlots({
  clinicId,
  doctorAdminId = null,
  patientTimezone = null,
  patientPhone = null,
  limit = 3,
  leadMinutes = 60,
  horizonDays = 14,
}) {
  const clinic = await Clinic.findById(clinicId).lean();
  if (!clinic) return { slots: [], clinic: null, clinicTimezone: DEFAULT_TZ, patientTimezone: DEFAULT_TZ };

  const clinicTz = resolveTimezone(clinic.timezone || clinic.settings?.timezone);
  const patientTz = resolveTimezone(
    patientTimezone || inferTimezoneFromPhone(patientPhone)
  );

  const clinicBlocks = await getClinicOperatingHours(clinic);
  const doctorData = await getDoctorHours(doctorAdminId, clinicId);
  const effectiveBlocks = intersectHourBlocks(
    clinicBlocks,
    doctorData?.blocks || null
  );
  const effectiveTz = doctorData?.timezone ? resolveTimezone(doctorData.timezone) : clinicTz;

  const now = new Date();
  const earliestUtc = new Date(now.getTime() + leadMinutes * 60 * 1000);
  const rangeEndUtc = new Date(now.getTime() + horizonDays * 24 * 60 * 60 * 1000);
  const booked = await getBookedSlotStarts(clinicId, doctorAdminId, earliestUtc, rangeEndUtc);

  const rawSlots = generateSlotsFromBlocks(effectiveBlocks, effectiveTz, {
    earliestUtc,
    rangeEndUtc,
    booked,
    limit,
  });

  const slots = rawSlots.map((s) => ({
    ...s,
    label: formatSlotDualLabel(s.start, patientTz, clinicTz),
    labelPatient: formatSlotDualLabel(s.start, patientTz, patientTz),
    labelClinic: formatSlotDualLabel(s.start, clinicTz, clinicTz),
    clinicTimezone: clinicTz,
    patientTimezone: patientTz,
    clinicId: clinic._id,
    clinicName: clinic.name,
  }));

  return {
    slots,
    clinic,
    clinicTimezone: clinicTz,
    patientTimezone: patientTz,
    doctorAdminId,
  };
}

/**
 * Multi-clinic: pick preferred clinic then discover slots.
 */
async function calculateAvailableSlotsForPatient({
  patientId,
  doctorAdminId,
  clinicIds,
  patientTimezone,
  patientPhone,
  limit = 3,
  leadMinutes = 60,
}) {
  const ids = Array.isArray(clinicIds) ? clinicIds : [];
  let ordered = ids;
  if (patientId && ids.length > 1) {
    const preferred = await resolvePreferredClinic(patientId, doctorAdminId);
    if (preferred) {
      ordered = [preferred, ...ids.filter((id) => String(id) !== String(preferred))];
    }
  }

  for (const clinicId of ordered) {
    const result = await calculateAvailableSlots({
      clinicId,
      doctorAdminId,
      patientTimezone,
      patientPhone,
      limit,
      leadMinutes,
    });
    if (result.slots.length) {
      return { ...result, preferredClinicId: clinicId };
    }
  }

  if (ordered.length) {
    return calculateAvailableSlots({
      clinicId: ordered[0],
      doctorAdminId,
      patientTimezone,
      patientPhone,
      limit,
      leadMinutes,
    });
  }

  return { slots: [], clinic: null, clinicTimezone: DEFAULT_TZ, patientTimezone: DEFAULT_TZ };
}

/** Back-compat wrapper used by WhatsAppBookingService */
async function discoverOpenSlots(clinicId, options = {}) {
  const result = await calculateAvailableSlots({
    clinicId,
    doctorAdminId: options.doctorAdminId,
    patientTimezone: options.patientTimezone,
    patientPhone: options.patientPhone,
    limit: options.limit || 3,
    leadMinutes: options.leadMinutes || 60,
  });
  return result.slots;
}

function formatSlotLabel(utcDate, timezone) {
  return formatSlotDualLabel(utcDate, timezone, timezone);
}

module.exports = {
  calculateAvailableSlots,
  calculateAvailableSlotsForPatient,
  resolvePreferredClinic,
  discoverOpenSlots,
  formatSlotLabel,
  getClinicOperatingHours,
  DEFAULT_WINDOWS,
};

const moment = require('moment-timezone');

const DEFAULT_TZ = 'Asia/Kolkata';

/**
 * Resolve IANA timezone string; fallback if invalid.
 */
function resolveTimezone(tz) {
  const candidate = String(tz || '').trim();
  if (candidate && moment.tz.zone(candidate)) return candidate;
  return DEFAULT_TZ;
}

/**
 * Format a UTC instant for display in a target timezone.
 */
function formatInTimezone(utcDate, timezone, options = {}) {
  const tz = resolveTimezone(timezone);
  const m = moment.utc(utcDate).tz(tz);
  return m.format(
    options.format ||
      (options.timeOnly ? 'h:mm A' : 'ddd, MMM D · h:mm A')
  );
}

/**
 * Build a UTC Date from clinic-local wall clock (day offset from today in clinic TZ).
 */
function wallClockToUtc({ timezone, dayOffset = 0, hhmm }) {
  const tz = resolveTimezone(timezone);
  const match = String(hhmm || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const h = parseInt(match[1], 10);
  const min = parseInt(match[2], 10);
  const base = moment.tz(tz).startOf('day').add(dayOffset, 'days');
  return base.hour(h).minute(min).second(0).millisecond(0).utc().toDate();
}

/**
 * Current moment as ISO date string (YYYY-MM-DD) in a timezone.
 */
function todayYmdInTimezone(timezone) {
  return moment.tz(resolveTimezone(timezone)).format('YYYY-MM-DD');
}

/**
 * Day-of-week (0=Sun) for a calendar day in a timezone.
 */
function dayOfWeekInTimezone(utcDate, timezone) {
  return moment.utc(utcDate).tz(resolveTimezone(timezone)).day();
}

/**
 * Infer patient timezone from phone country code (best-effort).
 */
function inferTimezoneFromPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.startsWith('91') || digits.length === 10) return 'Asia/Kolkata';
  if (digits.startsWith('1')) return 'America/New_York';
  if (digits.startsWith('44')) return 'Europe/London';
  if (digits.startsWith('971')) return 'Asia/Dubai';
  return DEFAULT_TZ;
}

/**
 * Dual-label slot string: patient local + clinic local.
 */
function formatSlotDualLabel(utcStart, patientTz, clinicTz) {
  const pt = formatInTimezone(utcStart, patientTz);
  const ct = formatInTimezone(utcStart, clinicTz);
  if (pt === ct) return pt;
  return `${pt} (clinic: ${ct})`;
}

module.exports = {
  DEFAULT_TZ,
  resolveTimezone,
  formatInTimezone,
  wallClockToUtc,
  todayYmdInTimezone,
  dayOfWeekInTimezone,
  inferTimezoneFromPhone,
  formatSlotDualLabel,
};

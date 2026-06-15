/**
 * Shared slot/time formatting for Cura UI (mirrors server timezoneUtils labels).
 */
export function formatSlotInTimezone(utcIso, timezone, options = {}) {
  if (!utcIso) return '';
  const tz = timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata';
  try {
    return new Date(utcIso).toLocaleString(undefined, {
      timeZone: tz,
      weekday: options.weekday === false ? undefined : 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      ...options,
    });
  } catch (_) {
    return new Date(utcIso).toLocaleString();
  }
}

export function formatSlotDual(utcIso, patientTz, clinicTz) {
  const pt = formatSlotInTimezone(utcIso, patientTz);
  const ct = formatSlotInTimezone(utcIso, clinicTz);
  if (pt === ct) return pt;
  return `${pt} (clinic: ${ct})`;
}

export function triageLevelLabel(level) {
  const l = String(level || 'NORMAL').toUpperCase();
  if (l === 'EMERGENCY') return 'Emergency triage';
  if (l === 'URGENT') return 'Urgent';
  return 'Routine';
}

export function triageLevelTone(level) {
  const l = String(level || 'NORMAL').toUpperCase();
  if (l === 'EMERGENCY') return 'critical';
  if (l === 'URGENT') return 'warning';
  return 'default';
}

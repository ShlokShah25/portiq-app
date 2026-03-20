/**
 * Client-side due date inference (mirrors server/utils/actionItemDueDate.js) for display + calendar links.
 */

const MONTH_ALIASES = {
  january: 0,
  jan: 0,
  february: 1,
  feb: 1,
  march: 2,
  mar: 2,
  april: 3,
  apr: 3,
  may: 4,
  june: 5,
  jun: 5,
  july: 6,
  jul: 6,
  august: 7,
  aug: 7,
  september: 8,
  sep: 8,
  sept: 8,
  october: 9,
  oct: 9,
  november: 10,
  nov: 10,
  december: 11,
  dec: 11,
};

const MONTH_PATTERN =
  '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';

function normalizeYear(y) {
  if (y == null || y === '') return null;
  let year = parseInt(String(y), 10);
  if (Number.isNaN(year)) return null;
  if (year < 100) year += 2000;
  return year;
}

function resolveYearMonthDay(year, month, day, ref) {
  if (month < 0 || month > 11 || day < 1 || day > 31) return null;
  let y = year;
  if (y == null) {
    y = ref.getFullYear();
    const candidate = new Date(y, month, day);
    if (candidate.getTime() < ref.getTime() - 86400000) {
      y += 1;
    }
  }
  const d = new Date(y, month, day);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

export function parseDueDateFromText(text, referenceDate) {
  if (!text || typeof text !== 'string') return null;
  const ref =
    referenceDate instanceof Date && !Number.isNaN(referenceDate.getTime())
      ? referenceDate
      : new Date();
  const s = text.trim();
  if (!s) return null;

  let re = new RegExp(
    `\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${MONTH_PATTERN}(?:\\s*,?\\s*(\\d{2,4}))?\\b`,
    'i'
  );
  let m = s.match(re);
  if (m) {
    const day = parseInt(m[1], 10);
    const mk = m[2].toLowerCase();
    const month = MONTH_ALIASES[mk];
    if (month === undefined) return null;
    const y = normalizeYear(m[3]);
    return resolveYearMonthDay(y, month, day, ref);
  }

  re = new RegExp(
    `\\b${MONTH_PATTERN}\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:\\s*,?\\s*(\\d{2,4}))?\\b`,
    'i'
  );
  m = s.match(re);
  if (m) {
    const mk = m[1].toLowerCase();
    const month = MONTH_ALIASES[mk];
    const day = parseInt(m[2], 10);
    const y = normalizeYear(m[3]);
    if (month === undefined) return null;
    return resolveYearMonthDay(y, month, day, ref);
  }

  m = s.match(/\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?\b/);
  if (m) {
    const a = parseInt(m[1], 10);
    const b = parseInt(m[2], 10);
    const yRaw = m[3];
    let year = yRaw != null ? parseInt(yRaw, 10) : null;
    if (year != null && !Number.isNaN(year) && year < 100) year += 2000;

    if (year != null && !Number.isNaN(year)) {
      if (a > 12) {
        return resolveYearMonthDay(year, b - 1, a, ref);
      }
      if (b > 12) {
        return resolveYearMonthDay(year, a - 1, b, ref);
      }
      return resolveYearMonthDay(year, b - 1, a, ref);
    }
    const y = ref.getFullYear();
    if (a > 12) {
      return resolveYearMonthDay(y, b - 1, a, ref);
    }
    return resolveYearMonthDay(y, b - 1, a, ref);
  }

  return null;
}

/**
 * Prefer stored dueDate; otherwise parse from task/notes using meeting time as reference.
 */
export function getEffectiveDueDate(item, meeting) {
  if (!item) return null;
  if (item.dueDate) {
    const d = new Date(item.dueDate);
    if (!Number.isNaN(d.getTime())) return d;
  }
  const refRaw = meeting?.endTime || meeting?.scheduledTime || meeting?.startTime;
  const refDate = refRaw ? new Date(refRaw) : new Date();
  const blob = [item.task, item.notes].filter(Boolean).join(' ');
  return parseDueDateFromText(blob, refDate);
}

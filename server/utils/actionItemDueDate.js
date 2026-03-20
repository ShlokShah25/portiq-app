/**
 * Infer calendar due dates from natural language in action item text when the model omits dueDate.
 * Handles e.g. "24th March", "March 24", "by 24 March 2026", DD/MM/YYYY.
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

function normalizeYear(y, ref) {
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
    // If parsed date is more than ~1 day before reference, assume next year
    if (candidate.getTime() < ref.getTime() - 86400000) {
      y += 1;
    }
  }
  const d = new Date(y, month, day);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

/**
 * @param {string} text
 * @param {Date} referenceDate  meeting end / scheduled time for year context
 * @returns {Date|null}
 */
function parseDueDateFromText(text, referenceDate) {
  if (!text || typeof text !== 'string') return null;
  const ref =
    referenceDate instanceof Date && !Number.isNaN(referenceDate.getTime())
      ? referenceDate
      : new Date();
  const s = text.trim();
  if (!s) return null;

  // 24th March 2026 / 24 March / 24 march 26
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
    const y = normalizeYear(m[3], ref);
    return resolveYearMonthDay(y, month, day, ref);
  }

  // March 24th, 2026 / March 24
  re = new RegExp(
    `\\b${MONTH_PATTERN}\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:\\s*,?\\s*(\\d{2,4}))?\\b`,
    'i'
  );
  m = s.match(re);
  if (m) {
    const mk = m[1].toLowerCase();
    const month = MONTH_ALIASES[mk];
    const day = parseInt(m[2], 10);
    const y = normalizeYear(m[3], ref);
    if (month === undefined) return null;
    return resolveYearMonthDay(y, month, day, ref);
  }

  // DD/MM/YYYY or DD-MM-YYYY (day-first when first token > 12, else still DMY for intl)
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
 * @param {Array<{task?:string,assignee?:string,dueDate?:any,notes?:string}>} actionItems
 * @param {Date|string|null} referenceDate
 * @returns {Array}
 */
function enrichActionItemsWithDueDates(actionItems, referenceDate) {
  if (!Array.isArray(actionItems)) return actionItems;
  const ref =
    referenceDate instanceof Date && !Number.isNaN(referenceDate.getTime())
      ? referenceDate
      : referenceDate
        ? new Date(referenceDate)
        : new Date();
  if (Number.isNaN(ref.getTime())) return actionItems;

  return actionItems.map((item) => {
    if (!item || typeof item !== 'object') return item;
    const copy = { ...item };
    let existing = copy.dueDate;
    if (existing != null && existing !== '') {
      const d = new Date(existing);
      if (!Number.isNaN(d.getTime())) {
        copy.dueDate = d;
        return copy;
      }
    }
    const blob = [copy.task, copy.notes, copy.assignee].filter(Boolean).join(' ');
    const inferred = parseDueDateFromText(blob, ref);
    if (inferred) {
      copy.dueDate = inferred;
    }
    return copy;
  });
}

module.exports = {
  parseDueDateFromText,
  enrichActionItemsWithDueDates,
};

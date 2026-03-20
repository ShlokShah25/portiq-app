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

function dateCalendarKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function tokenizeWords(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1);
}

function wordOverlapCount(taskTokens, text) {
  if (!taskTokens.length) return 0;
  const set = new Set(taskTokens);
  const words = tokenizeWords(text);
  let n = 0;
  for (const w of words) {
    if (set.has(w)) n += 1;
  }
  return n;
}

/**
 * Collect unique calendar dates mentioned anywhere in key points / summary (one line at a time).
 */
function extractAllMentionedDates(keyPoints, summary, nextSteps, ref) {
  const byKey = new Map();
  const lines = [
    ...(Array.isArray(keyPoints) ? keyPoints : []),
    ...(Array.isArray(nextSteps) ? nextSteps : []),
    ...String(summary || '')
      .split(/\n+/)
      .map((l) => l.trim())
      .filter(Boolean),
  ];
  for (const line of lines) {
    const d = parseDueDateFromText(line, ref);
    if (d && !Number.isNaN(d.getTime())) {
      byKey.set(dateCalendarKey(d), d);
    }
  }
  return [...byKey.values()];
}

/**
 * When the task line omits a date but a key point / summary line mentions it (same assignee or topic overlap).
 */
function splitSummaryLines(summary) {
  const t = String(summary || '').trim();
  if (!t) return [];
  const out = [];
  for (const para of t.split(/\n+/)) {
    const sentences = para.split(/(?<=[.!?])\s+/);
    for (const s of sentences) {
      const x = s.trim();
      if (x.length >= 4) out.push(x);
    }
  }
  return out;
}

function inferDueDateFromContext(item, ref, keyPoints, summary, nextSteps) {
  const assignee = (item.assignee || '').trim().toLowerCase();
  const task = (item.task || '').trim();
  const taskTokens = tokenizeWords(task);

  const lines = [
    ...(Array.isArray(keyPoints) ? keyPoints : []).map((l) => String(l)),
    ...splitSummaryLines(summary),
    ...(Array.isArray(nextSteps) ? nextSteps : []).map((l) => String(l)),
  ];

  for (const line of lines) {
    if (!line || line.length < 4) continue;
    const d = parseDueDateFromText(line, ref);
    if (!d || Number.isNaN(d.getTime())) continue;
    const low = line.toLowerCase();
    if (assignee && assignee.length >= 2 && low.includes(assignee)) {
      return d;
    }
    if (taskTokens.length && wordOverlapCount(taskTokens, line) >= 2) {
      return d;
    }
  }

  return null;
}

function hasValidDueDate(item) {
  if (!item || item.dueDate == null || item.dueDate === '') return false;
  const d = new Date(item.dueDate);
  return !Number.isNaN(d.getTime());
}

/**
 * @param {Array<{task?:string,assignee?:string,dueDate?:any,notes?:string}>} actionItems
 * @param {Date|string|null} referenceDate
 * @param {{ keyPoints?: string[], summary?: string, nextSteps?: string[] }} [context]
 * @returns {Array}
 */
function enrichActionItemsWithDueDates(actionItems, referenceDate, context = {}) {
  if (!Array.isArray(actionItems)) return actionItems;
  const ref =
    referenceDate instanceof Date && !Number.isNaN(referenceDate.getTime())
      ? referenceDate
      : referenceDate
        ? new Date(referenceDate)
        : new Date();
  if (Number.isNaN(ref.getTime())) return actionItems;

  const keyPoints = context.keyPoints || [];
  const summary = context.summary || '';
  const nextSteps = context.nextSteps || [];
  const allDatesInContext = extractAllMentionedDates(keyPoints, summary, nextSteps, ref);

  const afterTaskAndContext = actionItems.map((item) => {
    if (!item || typeof item !== 'object') return item;
    const copy = { ...item };
    if (copy.dueDate != null && copy.dueDate !== '') {
      const d = new Date(copy.dueDate);
      if (!Number.isNaN(d.getTime())) {
        copy.dueDate = d;
        return copy;
      }
    }
    const blob = [copy.task, copy.notes, copy.assignee].filter(Boolean).join(' ');
    let inferred = parseDueDateFromText(blob, ref);
    if (inferred) {
      copy.dueDate = inferred;
      return copy;
    }
    inferred = inferDueDateFromContext(copy, ref, keyPoints, summary, nextSteps);
    if (inferred) {
      copy.dueDate = inferred;
    }
    return copy;
  });

  const stillMissing = afterTaskAndContext.filter((i) => !hasValidDueDate(i));
  if (stillMissing.length === 1 && allDatesInContext.length === 1) {
    const onlyDate = allDatesInContext[0];
    return afterTaskAndContext.map((item) =>
      hasValidDueDate(item) ? item : { ...item, dueDate: onlyDate }
    );
  }

  return afterTaskAndContext;
}

module.exports = {
  parseDueDateFromText,
  enrichActionItemsWithDueDates,
  inferDueDateFromContext,
  extractAllMentionedDates,
};

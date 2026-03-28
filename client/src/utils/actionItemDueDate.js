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

function dateOnlyFromReferenceLocal(ref) {
  const r =
    ref instanceof Date && !Number.isNaN(ref.getTime()) ? ref : new Date();
  return new Date(r.getFullYear(), r.getMonth(), r.getDate(), 12, 0, 0, 0);
}

function addLocalCalendarDays(ref, days) {
  const d = dateOnlyFromReferenceLocal(ref);
  d.setDate(d.getDate() + days);
  return d;
}

function tryParseRelativeDuePhrases(text, ref) {
  if (!text || typeof text !== 'string') return null;
  const r =
    ref instanceof Date && !Number.isNaN(ref.getTime()) ? ref : new Date();
  const low = text.toLowerCase().replace(/\s+/g, ' ');

  if (
    /\b(tonight|this evening|today|eod|end of (?:the )?day|by end of day|before midnight)\b/.test(
      low
    )
  ) {
    return dateOnlyFromReferenceLocal(r);
  }
  if (/\b(tomorrow|tmrw|tmr)\b/.test(low)) {
    return addLocalCalendarDays(r, 1);
  }
  if (
    /\b(aaj raat|aaj sham|aaj shaam|aaj hi|is sham|is shaam|aaj ke din|aaj ke liye)\b/.test(low)
  ) {
    return dateOnlyFromReferenceLocal(r);
  }
  if (/\baaj\b/.test(low) && /\b(raat|sham|shaam|evening|night)\b/.test(low)) {
    return dateOnlyFromReferenceLocal(r);
  }
  if (/\bkal\b/.test(low) && /\b(subah|morning|sham|shaam|evening)\b/.test(low)) {
    return addLocalCalendarDays(r, 1);
  }

  return null;
}

function dateCalendarKeyLocal(d) {
  if (!d || Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

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

  const relative = tryParseRelativeDuePhrases(s, ref);
  if (relative) return relative;

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

function splitSummaryLines(summary) {
  const t = String(summary || '').trim();
  if (!t) return [];
  const out = [];
  try {
    for (const para of t.split(/\n+/)) {
      const sentences = para.split(/(?<=[.!?])\s+/);
      for (const s of sentences) {
        const x = s.trim();
        if (x.length >= 4) out.push(x);
      }
    }
  } catch (_) {
    // Fallback if lookbehind unsupported
    return t.split(/\n+/).map((l) => l.trim()).filter(Boolean);
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

function inferRelativeDueFromContextOverride(item, ref, keyPoints, summary, nextSteps) {
  if (!item || typeof item !== 'object') return null;
  const assignee = (item.assignee || '').trim().toLowerCase();
  const taskTokens = tokenizeWords(item.task || '');
  if (!taskTokens.length) return null;

  const lines = [
    ...(Array.isArray(keyPoints) ? keyPoints : []).map((l) => String(l)),
    ...splitSummaryLines(summary),
    ...(Array.isArray(nextSteps) ? nextSteps : []).map((l) => String(l)),
  ];

  for (const line of lines) {
    if (!line || line.length < 4) continue;
    const rel = tryParseRelativeDuePhrases(line, ref);
    if (!rel || Number.isNaN(rel.getTime())) continue;
    const low = line.toLowerCase();
    if (assignee && assignee.length >= 2 && low.includes(assignee)) {
      return rel;
    }
    if (wordOverlapCount(taskTokens, line) >= 2) {
      return rel;
    }
  }
  return null;
}

function meetingReferenceDate(meeting) {
  const raw =
    meeting?.endTime ||
    meeting?.scheduledTime ||
    meeting?.startTime ||
    meeting?.createdAt;
  if (raw) {
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return new Date();
}

function alignDueYearToReference(due, ref) {
  if (!due || Number.isNaN(due.getTime()) || !ref || Number.isNaN(ref.getTime())) return due;
  const refY = ref.getUTCFullYear();
  if (due.getUTCFullYear() >= refY) return due;
  const m = due.getUTCMonth();
  const day = due.getUTCDate();
  let next = new Date(Date.UTC(refY, m, day, 0, 0, 0, 0));
  if (next.getUTCMonth() !== m) {
    next = new Date(Date.UTC(refY, m + 1, 0, 0, 0, 0, 0));
  }
  return next;
}

/**
 * If due year is before the meeting reference year, keep month/day in that year (fixes stale/LLM years).
 */
export function alignDueYearToMeetingReference(due, meeting) {
  const ref = meeting ? meetingReferenceDate(meeting) : new Date();
  return alignDueYearToReference(due, ref);
}

/**
 * Prefer stored dueDate; otherwise parse from task/notes; then key points + summary + next steps (same as server).
 */
export function getEffectiveDueDate(item, meeting) {
  if (!item) return null;
  const align = (d) => {
    if (!d || Number.isNaN(d.getTime())) return null;
    return alignDueYearToMeetingReference(d, meeting);
  };

  const refRaw = meeting?.endTime || meeting?.scheduledTime || meeting?.startTime;
  const refDate = refRaw ? new Date(refRaw) : new Date();

  const keyPoints =
    meeting?.pendingKeyPoints?.length ? meeting.pendingKeyPoints : meeting?.keyPoints;
  const summary = meeting?.pendingSummary || meeting?.summary;
  const nextSteps =
    meeting?.pendingNextSteps?.length ? meeting.pendingNextSteps : meeting?.nextSteps;

  const blob = [item.task, item.notes, item.assignee].filter(Boolean).join(' ');
  const relativeInTask = tryParseRelativeDuePhrases(blob, refDate);
  if (relativeInTask) return align(relativeInTask);

  if (item.dueDate) {
    const d = new Date(item.dueDate);
    if (!Number.isNaN(d.getTime())) {
      const stored = align(d);
      const relOverride = inferRelativeDueFromContextOverride(
        item,
        refDate,
        keyPoints || [],
        summary || '',
        nextSteps || []
      );
      if (
        relOverride &&
        stored &&
        dateCalendarKeyLocal(stored) !== dateCalendarKeyLocal(align(relOverride))
      ) {
        return align(relOverride);
      }
      return stored;
    }
  }

  let inferred = parseDueDateFromText(blob, refDate);
  if (inferred) return align(inferred);

  inferred = inferDueDateFromContext(item, refDate, keyPoints || [], summary || '', nextSteps || []);
  if (inferred) return align(inferred);

  // Single-date fallback is applied only on the server when exactly one action item lacks a due date (avoids wrong dates for multiple open items).

  return null;
}

/**
 * Detects the first pooled two-speaker bracket produced when the model can't separate two voices.
 * Example: [Jamie Lee / Alex Kim]
 */
export function findFirstTwoPersonSpeakerBracket(fullText) {
  const t = String(fullText || '');
  const re = /\[([^\]\n]{1,160}?)\s\/\s([^\]\n]{1,160}?)\]/;
  const m = t.match(re);
  if (!m) return null;
  const left = String(m[1] || '').trim();
  const right = String(m[2] || '').trim();
  const full = m[0];
  if (!left || !right) return null;
  if (/unidentified/i.test(left) || /unidentified/i.test(right)) return null;
  return { bracket: full, left, right };
}

/**
 * Concatenate all user-visible summary strings for pool detection.
 */
export function joinSummaryTextForSpeakerDetection({
  summaryText = '',
  keyPoints = [],
  decisions = [],
  nextSteps = [],
  importantNotes = [],
  actionItems = [],
}) {
  const lines = [
    summaryText,
    ...(Array.isArray(keyPoints) ? keyPoints : []),
    ...(Array.isArray(decisions) ? decisions : []),
    ...(Array.isArray(nextSteps) ? nextSteps : []),
    ...(Array.isArray(importantNotes) ? importantNotes : []),
  ];
  for (const item of Array.isArray(actionItems) ? actionItems : []) {
    if (item && item.task) lines.push(String(item.task));
    if (item && item.notes) lines.push(String(item.notes));
  }
  return lines.filter(Boolean).join('\n');
}

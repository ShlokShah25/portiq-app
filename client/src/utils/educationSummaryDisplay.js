/** Matches "[Anyone]: " style speaker prefixes from the summary model (education cleanup). */
const EDUCATION_SPEAKER_BRACKET_PREFIX = /\[[^\]\r\n]{1,120}\]\s*:\s*/g;

function stripSpeakerPrefixesFromLine(s) {
  let t = String(s || '');
  let prev;
  do {
    prev = t;
    t = t.replace(EDUCATION_SPEAKER_BRACKET_PREFIX, '');
  } while (t !== prev);
  return t.replace(/\s{2,}/g, ' ').trim();
}

function stripStringArray(arr) {
  return (Array.isArray(arr) ? arr : [])
    .map((x) => stripSpeakerPrefixesFromLine(x))
    .filter((x) => x.length > 0);
}

/**
 * Returns a shallow copy of summary fields with bracket speaker labels removed.
 * Use in education mode so lecture notes read as neutral notes (no "[Unidentified speaker]:").
 */
export function stripEducationSummaryForDisplay({
  summary = '',
  keyPoints = [],
  decisions = [],
  nextSteps = [],
  importantNotes = [],
  actionItems = [],
}) {
  return {
    summary: stripSpeakerPrefixesFromLine(summary),
    keyPoints: stripStringArray(keyPoints),
    decisions: stripStringArray(decisions),
    nextSteps: stripStringArray(nextSteps),
    importantNotes: stripStringArray(importantNotes),
    actionItems: Array.isArray(actionItems)
      ? actionItems.map((item) => ({
          ...item,
          task: stripSpeakerPrefixesFromLine(item?.task != null ? item.task : ''),
          notes:
            item?.notes != null && String(item.notes).trim()
              ? stripSpeakerPrefixesFromLine(item.notes)
              : item?.notes,
        }))
      : [],
  };
}

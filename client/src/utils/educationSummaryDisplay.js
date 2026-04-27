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

/** Display-only: simpler words for common corporate terms (does not change stored AI output). */
const EDU_DISPLAY_VOCAB_REPLACEMENTS = [
  [/\bstakeholders\b/gi, 'people involved'],
  [/\bstakeholder\b/gi, 'someone involved'],
  [/\butilize\b/gi, 'use'],
  [/\butilizes\b/gi, 'uses'],
  [/\butilized\b/gi, 'used'],
  [/\bleverage\b/gi, 'use'],
  [/\bleverages\b/gi, 'uses'],
  [/\bleveraged\b/gi, 'used'],
  [/\bfacilitate\b/gi, 'help'],
  [/\bfacilitates\b/gi, 'helps'],
  [/\bfacilitated\b/gi, 'helped'],
];

function softenStudentFacingVocab(s) {
  let t = String(s || '');
  for (const [re, rep] of EDU_DISPLAY_VOCAB_REPLACEMENTS) {
    t = t.replace(re, rep);
  }
  return t;
}

/**
 * Pull "Revision questions:" out of the summary body so the UI can render it as its own section.
 * Model text may embed this block at the end of the narrative paragraph.
 */
function splitRevisionQuestionsFromSummary(text) {
  const s = String(text || '');
  const re = /\s*Revision questions\s*:\s*/i;
  const m = re.exec(s);
  if (!m) return { summaryBody: s.trim(), revisionBlock: null };
  const head = s.slice(0, m.index).trimEnd();
  const tail = s.slice(m.index + m[0].length).trim();
  return { summaryBody: head, revisionBlock: tail || null };
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
  const summaryStripped = stripSpeakerPrefixesFromLine(summary);
  const { summaryBody, revisionBlock } = splitRevisionQuestionsFromSummary(summaryStripped);

  return {
    summary: softenStudentFacingVocab(summaryBody),
    revisionQuestions: revisionBlock ? softenStudentFacingVocab(revisionBlock) : null,
    keyPoints: stripStringArray(keyPoints).map((x) => softenStudentFacingVocab(x)),
    decisions: stripStringArray(decisions).map((x) => softenStudentFacingVocab(x)),
    nextSteps: stripStringArray(nextSteps).map((x) => softenStudentFacingVocab(x)),
    importantNotes: stripStringArray(importantNotes).map((x) => softenStudentFacingVocab(x)),
    actionItems: Array.isArray(actionItems)
      ? actionItems.map((item) => ({
          ...item,
          task: softenStudentFacingVocab(
            stripSpeakerPrefixesFromLine(item?.task != null ? item.task : '')
          ),
          notes:
            item?.notes != null && String(item.notes).trim()
              ? softenStudentFacingVocab(stripSpeakerPrefixesFromLine(item.notes))
              : item?.notes,
        }))
      : [],
  };
}

/**
 * Display helpers for AI lecture notes, shared by the teacher's review page and the student recap.
 *
 * The notes are Markdown with a fixed shape: "## STRUCTURED NOTES" (subsections Definitions: /
 * Objectives: / Functions: / Key Concepts:) then "## DETAILED EXPLANATION". Until Oct 2026 a
 * clean-up step on the server and another in the browser collapsed every run of 2+ whitespace
 * characters into one space, which also destroyed blank lines. Lectures stored in that period
 * have their headings glued onto the previous sentence and paragraphs merged. These helpers put
 * the structure back for display, and are harmless on correctly formatted notes.
 *
 * No regex lookbehind here on purpose: older Safari (iPad) throws on it at parse time.
 */

const SUBSECTIONS = ['Definitions', 'Objectives', 'Functions', 'Key Concepts'];
const LONG_PARAGRAPH = 650;

/** Break a very long run-on paragraph into paragraphs of about three sentences. */
function splitLongParagraph(line) {
  const sentences = line.match(/[^.!?]+(?:[.!?]+["')\]]*|$)\s*/g);
  if (!sentences || sentences.length < 5) return line;
  const out = [];
  for (let i = 0; i < sentences.length; i += 3) {
    out.push(sentences.slice(i, i + 3).join('').trim());
  }
  return out.filter(Boolean).join('\n\n');
}

export function formatLectureNotesMarkdown(raw) {
  let s = String(raw || '').replace(/\r\n?/g, '\n');
  if (!s.trim()) return '';

  // The two top-level sections, wherever they ended up.
  s = s.replace(/[ \t]*(?:#{1,6}[ \t]*)?STRUCTURED NOTES[ \t]*:?[ \t]*/g, '\n\n## Structured notes\n\n');
  s = s.replace(/[ \t]*(?:#{1,6}[ \t]*)?DETAILED EXPLANATION[ \t]*:?[ \t]*/g, '\n\n## Detailed explanation\n\n');

  // Subsection labels ("Definitions:") become real subheadings, even when glued to a sentence.
  const labels = SUBSECTIONS.join('|');
  const labelRe = new RegExp(
    `(^|[\\s.!?)])[ \\t]*(?:#{1,6}[ \\t]*)?(?:\\*\\*)?(${labels})(?:\\*\\*)?[ \\t]*:(?:\\*\\*)?[ \\t]*`,
    'g'
  );
  s = s.replace(labelRe, (match, before, label) => `${before}\n\n### ${label}\n\n`);

  // Any other heading glued to the end of a line.
  s = s.replace(/([^\n#])[ \t]*(#{2,6}[ \t]+)/g, '$1\n\n$2');

  // Run-on paragraphs (no list / table / heading) get broken up so they can be read.
  s = s
    .split('\n')
    .map((line) => {
      const t = line.trim();
      if (t.length < LONG_PARAGRAPH || /^([-*+]|\d+[.)]|#|\||>)/.test(t)) return line;
      return splitLongParagraph(t);
    })
    .join('\n');

  return s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * "1. Define X\n2. Explain Y" or, after the old whitespace collapse, "1. Define X 2. Explain Y"
 * → ["Define X", "Explain Y"].
 */
export function splitNumberedItems(raw) {
  const text = String(raw || '')
    .replace(/\r\n?/g, '\n')
    .replace(/^\s*(?:#{1,6}\s*)?revision questions\s*:?\s*/i, '')
    .trim();
  if (!text) return [];
  let parts;
  if (/\n/.test(text)) {
    parts = text.split(/\n+/);
  } else {
    parts = text.split(/\s+(?=\d{1,2}[.)]\s)/);
  }
  const items = [];
  parts.forEach((p) => {
    const line = p.trim();
    if (!line) return;
    const m = /^(?:\d{1,2}[.)]|[-*•])\s+(.*)$/.exec(line);
    if (m) items.push(m[1].trim());
    else if (items.length) items[items.length - 1] += ` ${line}`;
    else items.push(line);
  });
  return items.filter(Boolean);
}

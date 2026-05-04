/** Drop blank lines when saving line-based summary fields (preserves multi-line editing UX). */
export function normalizeSummaryLineArrays(payload) {
  const lines = (arr) =>
    (Array.isArray(arr) ? arr : [])
      .map((x) => String(x ?? '').trim())
      .filter(Boolean);
  return {
    ...payload,
    keyPoints: lines(payload.keyPoints),
    decisions: lines(payload.decisions),
    nextSteps: lines(payload.nextSteps),
    importantNotes: lines(payload.importantNotes),
  };
}

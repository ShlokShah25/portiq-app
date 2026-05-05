/**
 * @param {string} value full textarea value
 * @param {number} start selectionStart
 * @param {number} end selectionEnd
 * @param {string} before
 * @param {string} [after] defaults to before (symmetric wrap)
 */
export function wrapSelection(value, start, end, before, after = before) {
  const sel = value.slice(start, end);
  const inner = sel.length ? sel : '';
  const inserted = before + (inner || 'text') + after;
  const next = value.slice(0, start) + inserted + value.slice(end);
  const caret = start + inserted.length;
  return { next, caret };
}

export function insertAtCursor(value, start, end, snippet) {
  const next = value.slice(0, start) + snippet + value.slice(end);
  const caret = start + snippet.length;
  return { next, caret };
}

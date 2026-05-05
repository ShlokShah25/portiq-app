import React from 'react';
import { wrapSelection, insertAtCursor } from '../utils/markdownEditorInsert';

const TABLE_3x2 = `\n\n| Concept | Notes |\n| --- | --- |\n|  |  |\n|  |  |\n\n`;

/**
 * Inserts markdown into a controlled textarea (must use matching textareaId).
 */
export default function EducationMarkdownToolbar({ textareaId, value, onChange }) {
  const run = (fn) => {
    const el = document.getElementById(textareaId);
    if (!el || typeof onChange !== 'function') return;
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? 0;
    const v = String(value ?? '');
    const { next, caret } = fn(v, start, end);
    onChange(next);
    requestAnimationFrame(() => {
      try {
        el.focus();
        el.setSelectionRange(caret, caret);
      } catch (_) {
        /* ignore */
      }
    });
  };

  return (
    <div className="education-md-toolbar" role="toolbar" aria-label="Markdown formatting">
      <button
        type="button"
        className="education-md-toolbar__btn"
        onClick={() => run((v, s, e) => wrapSelection(v, s, e, '**', '**'))}
        title="Bold — formatting appears in preview above"
      >
        <strong>B</strong>
      </button>
      <button
        type="button"
        className="education-md-toolbar__btn"
        onClick={() => run((v, s, e) => wrapSelection(v, s, e, '_', '_'))}
        title="Italic (_)"
      >
        <em>I</em>
      </button>
      <button
        type="button"
        className="education-md-toolbar__btn"
        onClick={() => run((v, s, e) => wrapSelection(v, s, e, '`', '`'))}
        title="Inline code"
      >
        {'<>'}
      </button>
      <span className="education-md-toolbar__sep" aria-hidden="true" />
      <button
        type="button"
        className="education-md-toolbar__btn"
        onClick={() => run((v, s, e) => insertAtCursor(v, s, e, '\n- '))}
        title="Bullet"
      >
        •
      </button>
      <button
        type="button"
        className="education-md-toolbar__btn"
        onClick={() => run((v, s, e) => insertAtCursor(v, s, e, '\n1. '))}
        title="Numbered item"
      >
        1.
      </button>
      <button
        type="button"
        className="education-md-toolbar__btn"
        onClick={() => run((v, s, e) => insertAtCursor(v, s, e, TABLE_3x2))}
        title="Insert markdown table"
      >
        Table
      </button>
      <button
        type="button"
        className="education-md-toolbar__btn"
        onClick={() => run((v, s, e) => insertAtCursor(v, s, e, '\n### Heading\n'))}
        title="Section heading"
      >
        H3
      </button>
    </div>
  );
}

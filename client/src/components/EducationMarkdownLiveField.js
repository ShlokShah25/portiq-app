import React from 'react';
import EducationMarkdownBlock from './EducationMarkdownBlock';
import EducationMarkdownToolbar from './EducationMarkdownToolbar';

/**
 * Markdown lecture field: live preview (formatted) above source textarea so **bold** reads as bold while editing.
 * @param {(next: string) => void} onMarkdownChange
 */
export default function EducationMarkdownLiveField({
  id,
  label,
  hint,
  value,
  onMarkdownChange,
  rows,
  textareaClassName = '',
  placeholder,
  previewHintEmpty,
  showPreview = false,
}) {
  const v = String(value ?? '');
  const trimmed = v.trim();
  return (
    <div className="education-md-live-field">
      {label ? <label htmlFor={id}>{label}</label> : null}
      {hint ? <small className="meeting-summary-edit-hint">{hint}</small> : null}
      <EducationMarkdownToolbar textareaId={id} value={v} onChange={onMarkdownChange} />
      {showPreview ? (
        <div className="education-md-live-field__preview" aria-live="polite">
          <span className="education-md-live-field__preview-label">Preview (how it looks published)</span>
          <div className="education-md-live-field__preview-body">
            {trimmed ? (
              <EducationMarkdownBlock className="education-markdown-block--compact">
                {v}
              </EducationMarkdownBlock>
            ) : (
              <p className="education-md-live-field__preview-empty">{previewHintEmpty}</p>
            )}
          </div>
        </div>
      ) : null}
      <textarea
        id={id}
        value={v}
        onChange={(e) => onMarkdownChange(e.target.value)}
        rows={rows}
        className={['meeting-summary-textarea', 'education-md-live-field__source', textareaClassName]
          .filter(Boolean)
          .join(' ')}
        spellCheck
        placeholder={placeholder}
      />
      {showPreview ? (
        <p className="education-md-live-field__source-note">
          The preview shows bold and lists; the box below is the editable source.
        </p>
      ) : null}
    </div>
  );
}

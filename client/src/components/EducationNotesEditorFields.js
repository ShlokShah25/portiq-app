import React from 'react';
import EducationMarkdownToolbar from './EducationMarkdownToolbar';

/**
 * PortIQ lecture editor: quick revision (keyPoints), layered summary + revision questions,
 * then assignments, concepts, optional admin sections.
 */
export default function EducationNotesEditorFields({ editableSummary, setEditableSummary }) {
  const kpText = (editableSummary.keyPoints || []).join('\n');
  return (
    <div className="meetings-edu-notes-editor">
      <p className="meetings-edu-notes-editor__lead">
        Output is four layers: <strong>Quick revision</strong> (key points), <strong>Structured notes</strong> and{' '}
        <strong>detailed explanation</strong> in the long text, then <strong>revision questions</strong>. Use{' '}
        <strong>Markdown</strong> sparingly—<code>**bold**</code> for key terms and headings, lists, pipe tables only for
        comparisons. Blank lines in line-based fields are trimmed when you save. Use <strong>Save review</strong> to
        checkpoint work, then send when ready.
      </p>
      <div className="meeting-summary-edit-field">
        <label htmlFor="edu-notes-quick">Quick revision (exam scan)</label>
        <small className="meeting-summary-edit-hint">
          5–8 one-line bullets—definitions, must-know facts, formula names—no long explanations here.
        </small>
        <EducationMarkdownToolbar
          textareaId="edu-notes-quick"
          value={kpText}
          onChange={(next) =>
            setEditableSummary({
              ...editableSummary,
              keyPoints: next.split('\n'),
            })
          }
        />
        <textarea
          id="edu-notes-quick"
          value={(editableSummary.keyPoints || []).join('\n')}
          onChange={(e) =>
            setEditableSummary({
              ...editableSummary,
              keyPoints: e.target.value.split('\n'),
            })
          }
          rows={8}
          className="meeting-summary-textarea"
          spellCheck
        />
      </div>
      <div className="meetings-edu-notes-editor__grid">
        <div className="meeting-summary-edit-field meetings-edu-notes-editor__primary">
          <label htmlFor="edu-notes-summary">Structured notes & detailed explanation</label>
          <small className="meeting-summary-edit-hint">
            STRUCTURED NOTES (Definitions, Objectives, Functions, Key Concepts) then DETAILED
            EXPLANATION—use markdown bold for key terms and tables to compare ideas when helpful.
          </small>
          <EducationMarkdownToolbar
            textareaId="edu-notes-summary"
            value={editableSummary.summary}
            onChange={(next) => setEditableSummary({ ...editableSummary, summary: next })}
          />
          <textarea
            id="edu-notes-summary"
            value={editableSummary.summary}
            onChange={(e) =>
              setEditableSummary({ ...editableSummary, summary: e.target.value })
            }
            rows={18}
            className="meeting-summary-textarea meeting-summary-textarea--lecture"
            spellCheck
          />
        </div>
        <div className="meeting-summary-edit-field">
          <label htmlFor="edu-notes-revision">Revision questions</label>
          <small className="meeting-summary-edit-hint">
            4–6 numbered exam-style questions (definition, short answer, conceptual)—one per line.
          </small>
          <EducationMarkdownToolbar
            textareaId="edu-notes-revision"
            value={String(editableSummary.revisionQuestions ?? '')}
            onChange={(next) =>
              setEditableSummary({ ...editableSummary, revisionQuestions: next })
            }
          />
          <textarea
            id="edu-notes-revision"
            value={String(editableSummary.revisionQuestions ?? '')}
            onChange={(e) =>
              setEditableSummary({
                ...editableSummary,
                revisionQuestions: e.target.value,
              })
            }
            rows={12}
            className="meeting-summary-textarea meeting-summary-textarea--revision"
            placeholder={'1. Define …\n2. What are the objectives of …?\n3. Explain how …'}
            spellCheck
          />
        </div>
      </div>
      <div className="meeting-summary-edit-field">
        <label htmlFor="edu-notes-actions">Assignments & reminders</label>
        <small className="meeting-summary-edit-hint">
          One per line. Format: Task | Who | Due date YYYY-MM-DD (optional)
        </small>
        <textarea
          id="edu-notes-actions"
          value={(editableSummary.actionItems || [])
            .map((item) => {
              let dueStr = '';
              if (item.dueDate) {
                const d = new Date(item.dueDate);
                dueStr = !Number.isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : '';
              }
              return `${item.task || ''} | ${item.assignee || ''} | ${dueStr}`;
            })
            .join('\n')}
          onChange={(e) => {
            const prev = editableSummary.actionItems || [];
            const lines = e.target.value.split('\n').filter((l) => l.trim());
            const items = lines.map((line, idx) => {
              const parts = line.split('|').map((p) => p.trim());
              let dueDate = null;
              if (parts[2]) {
                const raw = parts[2];
                const d = /^\d{4}-\d{2}-\d{2}$/.test(raw)
                  ? new Date(`${raw}T12:00:00.000Z`)
                  : new Date(raw);
                dueDate = !Number.isNaN(d.getTime()) ? d : null;
              }
              const carry = prev[idx];
              return {
                ...(carry?._id ? { _id: carry._id } : {}),
                task: parts[0] || '',
                assignee: parts[1] || '',
                dueDate,
                ...(carry?.status ? { status: carry.status } : {}),
              };
            });
            setEditableSummary({ ...editableSummary, actionItems: items });
          }}
          rows={8}
          className="meeting-summary-textarea meeting-summary-textarea--mono"
          placeholder="Homework set §3.2 | All students | 2026-05-01"
        />
      </div>
      <div className="meeting-summary-edit-field">
        <label htmlFor="edu-notes-important">Important concepts & caveats</label>
        <small className="meeting-summary-edit-hint">
          Misconceptions, exam traps, or nuances worth highlighting.
        </small>
        <textarea
          id="edu-notes-important"
          value={(editableSummary.importantNotes || []).join('\n')}
          onChange={(e) =>
            setEditableSummary({
              ...editableSummary,
              importantNotes: e.target.value.split('\n'),
            })
          }
          rows={8}
          className="meeting-summary-textarea"
          spellCheck
        />
      </div>
      <details className="meetings-edu-notes-editor__details">
        <summary className="meetings-edu-notes-editor__summary">
          Decisions & administrative follow-ups (optional)
        </summary>
        <p className="meetings-edu-notes-editor__details-hint">
          Use only if this session included formal decisions or admin next steps.
        </p>
        <div className="meeting-summary-edit-field">
          <label htmlFor="edu-notes-decisions">Decisions (one per line)</label>
          <textarea
            id="edu-notes-decisions"
            value={(editableSummary.decisions || []).join('\n')}
            onChange={(e) =>
              setEditableSummary({
                ...editableSummary,
                decisions: e.target.value.split('\n'),
              })
            }
            rows={4}
            className="meeting-summary-textarea"
          />
        </div>
        <div className="meeting-summary-edit-field">
          <label htmlFor="edu-notes-next">Next steps (one per line)</label>
          <textarea
            id="edu-notes-next"
            value={(editableSummary.nextSteps || []).join('\n')}
            onChange={(e) =>
              setEditableSummary({
                ...editableSummary,
                nextSteps: e.target.value.split('\n'),
              })
            }
            rows={4}
            className="meeting-summary-textarea"
          />
        </div>
      </details>
    </div>
  );
}

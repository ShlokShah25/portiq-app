import React from 'react';
import EducationMarkdownLiveField from './EducationMarkdownLiveField';

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
        <strong>detailed explanation</strong> in the long text, then <strong>revision questions</strong>. Keep editing
        simple: use toolbar buttons for bold/lists/tables; a live preview is shown only for the long summary block. Use{' '}
        <strong>Save review</strong> to checkpoint work, then send when ready.
      </p>
      <div className="meeting-summary-edit-field">
        <EducationMarkdownLiveField
          id="edu-notes-quick"
          label="Quick revision (exam scan)"
          hint="5–8 one-line bullets—definitions, must-know facts, formula names—no long explanations here."
          value={kpText}
          onMarkdownChange={(next) =>
            setEditableSummary({
              ...editableSummary,
              keyPoints: next.split('\n'),
            })
          }
          rows={6}
          showPreview={false}
          previewHintEmpty="Add one point per line. Use the B button or type **term** for bold (see preview above)."
        />
      </div>
      <div className="meetings-edu-notes-editor__grid">
        <div className="meeting-summary-edit-field meetings-edu-notes-editor__primary">
          <EducationMarkdownLiveField
            id="edu-notes-summary"
            label="Structured notes & detailed explanation"
            hint="STRUCTURED NOTES (Definitions, Objectives, Functions, Key Concepts) then DETAILED EXPLANATION—bold key terms; tables only for comparisons."
            value={editableSummary.summary}
            onMarkdownChange={(next) => setEditableSummary({ ...editableSummary, summary: next })}
            rows={14}
            textareaClassName="meeting-summary-textarea--lecture"
            showPreview
            previewHintEmpty="Notes from the class will appear here after generation, or start typing (preview updates live)."
          />
        </div>
        <div className="meeting-summary-edit-field">
          <EducationMarkdownLiveField
            id="edu-notes-revision"
            label="Revision questions"
            hint="4–6 numbered exam-style questions (definition, short answer, conceptual)—one per line."
            value={String(editableSummary.revisionQuestions ?? '')}
            onMarkdownChange={(next) =>
              setEditableSummary({ ...editableSummary, revisionQuestions: next })
            }
            rows={10}
            textareaClassName="meeting-summary-textarea--revision"
            showPreview={false}
            placeholder=""
            previewHintEmpty="Revision questions are generated with the lecture when possible, or add numbered questions here (e.g. 1. Define …)."
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

import React, { useState } from 'react';
import axios from 'axios';
import { getEffectiveDueDate } from '../utils/actionItemDueDate';
import {
  buildGoogleCalendarUrl,
  buildOutlookCalendarUrl,
  buildIcsContent,
} from '../utils/meetingCalendarLinks';
import './MeetingSummary.css';

/**
 * Read-only summary layout (matches MeetingSummary page): badge, minutes, action cards, checkmark key points, etc.
 */
export default function MeetingSummaryReadonlyBody({
  meeting,
  meetingId,
  summaryText = '',
  keyPoints = [],
  actionItems = [],
  decisions = [],
  nextSteps = [],
  importantNotes = [],
  isEducation,
  onMeetingPatched,
  showReadyBadge = true,
}) {
  const [statusSaving, setStatusSaving] = useState({});

  const decisionsDisplay = (decisions || []).filter(
    (d) => String(d || '').trim().toLowerCase() !== 'not specified'
  );

  const hasContent =
    (summaryText && String(summaryText).trim()) ||
    (keyPoints && keyPoints.length) ||
    (actionItems && actionItems.length) ||
    decisionsDisplay.length ||
    (nextSteps && nextSteps.length) ||
    (importantNotes && importantNotes.length);

  if (!hasContent) {
    return null;
  }

  const patchStatus = async (item, itemId, nextStatus) => {
    if (!item?._id || !meetingId) return;
    setStatusSaving((prev) => ({ ...prev, [itemId]: true }));
    try {
      const res = await axios.patch(`/meetings/${meetingId}/action-items/${item._id}`, {
        status: nextStatus,
      });
      if (onMeetingPatched && res.data?.meeting) {
        onMeetingPatched(res.data.meeting);
      }
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to update action item status.');
    } finally {
      setStatusSaving((prev) => ({ ...prev, [itemId]: false }));
    }
  };

  return (
    <div className="meeting-summary-content">
      {showReadyBadge && (
        <div className="meeting-summary-ready-badge" aria-live="polite">
          <span className="meeting-summary-ready-badge__dot" aria-hidden="true" />
          AI summary ready
        </div>
      )}

      {!!summaryText && String(summaryText).trim() && (
        <section className="meeting-summary-section meeting-summary-section--minutes">
          <h2 className="meeting-summary-heading">
            {isEducation ? 'Summary' : 'Minutes of the meeting'}
          </h2>
          <p className="meeting-summary-body">{summaryText}</p>
        </section>
      )}

      {actionItems && actionItems.length > 0 && (
        <section className="meeting-summary-section meeting-summary-section--tasks">
          <h2 className="meeting-summary-heading">Action Items</h2>
          <ul className="meeting-summary-list meeting-summary-list--action">
            {actionItems.map((item, idx) => {
              const itemId = item?._id || String(idx);
              const rawStatus = item?.status || 'not_started';
              const status =
                rawStatus === 'in_progress' || rawStatus === 'done' || rawStatus === 'not_started'
                  ? rawStatus
                  : 'not_started';
              const effectiveDue = getEffectiveDueDate(item, meeting);

              const title = item?.task || 'Action item';
              const details = [
                meeting?.title ? `Meeting: ${meeting.title}` : null,
                item?.assignee ? `Assignee: ${item.assignee}` : null,
              ]
                .filter(Boolean)
                .join('\n');

              const dueIso =
                effectiveDue && !Number.isNaN(effectiveDue.getTime())
                  ? effectiveDue.toISOString()
                  : null;

              const gcalUrl = buildGoogleCalendarUrl({
                title,
                details,
                dueDate: dueIso,
              });

              const outlookUrl = buildOutlookCalendarUrl({
                title,
                details,
                dueDate: dueIso,
              });

              const ics = dueIso
                ? buildIcsContent({
                    title,
                    description: details,
                    dueDate: dueIso,
                  })
                : null;

              const dueBadge =
                effectiveDue && !Number.isNaN(effectiveDue.getTime())
                  ? `DUE ${effectiveDue
                      .toLocaleDateString('en-US', { weekday: 'short' })
                      .toUpperCase()}`
                  : null;

              const isOverdue =
                dueBadge &&
                status !== 'done' &&
                effectiveDue &&
                !Number.isNaN(effectiveDue.getTime()) &&
                effectiveDue.getTime() < Date.now();

              const overdueBadge = isOverdue ? 'OVERDUE' : null;

              const statusGroupName = `action-status-${String(item._id || idx)}`;
              const statusDisabled = !!statusSaving[itemId] || !item?._id || !meetingId;

              return (
                <li key={itemId} className="meeting-action-item" data-action-status={status}>
                  {dueBadge || overdueBadge ? (
                    <div className="meeting-action-item-badges">
                      {dueBadge ? (
                        <span className="meeting-action-meta-pill">{dueBadge}</span>
                      ) : null}
                      {overdueBadge ? (
                        <span className="meeting-action-meta-pill meeting-action-meta-pill--overdue">
                          {overdueBadge}
                        </span>
                      ) : null}
                    </div>
                  ) : null}

                  <p className="meeting-action-item-text">
                    <span className="meeting-action-item-task">{item.task}</span>
                    {item.assignee ? (
                      <span className="meeting-action-item-assignee"> — {item.assignee}</span>
                    ) : null}
                  </p>

                  <fieldset className="meeting-action-status-fieldset">
                    <legend className="meeting-action-status-legend">Status</legend>
                    <div className="meeting-action-status-rail" role="presentation">
                      {[
                        { value: 'not_started', label: 'Not done', hint: 'Not started' },
                        { value: 'in_progress', label: 'In progress', hint: 'In progress' },
                        { value: 'done', label: 'Done', hint: 'Done' },
                      ].map((opt) => (
                        <label
                          key={opt.value}
                          className="meeting-action-status-option"
                          title={opt.hint}
                        >
                          <span className="meeting-action-status-hit">
                            <input
                              type="radio"
                              name={statusGroupName}
                              value={opt.value}
                              checked={status === opt.value}
                              disabled={statusDisabled}
                              onChange={() => patchStatus(item, itemId, opt.value)}
                            />
                            <span className="meeting-action-status-mark" aria-hidden />
                          </span>
                          <span className="meeting-action-status-label">{opt.label}</span>
                        </label>
                      ))}
                    </div>
                  </fieldset>

                  {(gcalUrl || outlookUrl || ics) && (
                    <div className="meeting-action-item-links">
                      {gcalUrl && (
                        <a
                          className="meeting-action-link meeting-action-link--minimal"
                          href={gcalUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="Add to Google Calendar"
                        >
                          Google Calendar
                        </a>
                      )}
                      {outlookUrl && (
                        <a
                          className="meeting-action-link meeting-action-link--minimal"
                          href={outlookUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="Add to Outlook Calendar"
                        >
                          Outlook
                        </a>
                      )}
                      {ics && (
                        <button
                          type="button"
                          className="meeting-action-link meeting-action-link--minimal meeting-action-link--button"
                          onClick={() => {
                            const blob = new Blob([ics], {
                              type: 'text/calendar;charset=utf-8',
                            });
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.href = url;
                            a.download = `action-item-${(item.task || 'task')
                              .slice(0, 40)
                              .replace(/[^a-z0-9]+/gi, '-')
                              .toLowerCase()}.ics`;
                            document.body.appendChild(a);
                            a.click();
                            a.remove();
                            URL.revokeObjectURL(url);
                          }}
                          title="Download .ics"
                        >
                          .ics
                        </button>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {keyPoints && keyPoints.length > 0 && (
        <section className="meeting-summary-section meeting-summary-section--keypoints">
          <h2 className="meeting-summary-heading">Key Points</h2>
          <ul className="meeting-summary-list meeting-summary-list--checks">
            {keyPoints.map((p, idx) => (
              <li key={idx}>{p}</li>
            ))}
          </ul>
        </section>
      )}

      {decisionsDisplay.length > 0 && (
        <section className="meeting-summary-section">
          <h2 className="meeting-summary-heading">Decisions</h2>
          <ul className="meeting-summary-list">
            {decisionsDisplay.map((d, idx) => (
              <li key={idx}>{d}</li>
            ))}
          </ul>
        </section>
      )}

      {nextSteps && nextSteps.length > 0 && (
        <section className="meeting-summary-section">
          <h2 className="meeting-summary-heading">Next Steps</h2>
          <ul className="meeting-summary-list">
            {nextSteps.map((s, idx) => (
              <li key={idx}>{s}</li>
            ))}
          </ul>
        </section>
      )}

      {importantNotes && importantNotes.length > 0 && (
        <section className="meeting-summary-section">
          <h2 className="meeting-summary-heading">
            {isEducation ? 'Important Concepts' : 'Important Notes'}
          </h2>
          <ul className="meeting-summary-list">
            {importantNotes.map((n, idx) => (
              <li key={idx}>{n}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

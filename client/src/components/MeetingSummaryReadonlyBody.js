import React, { useState } from 'react';
import axios from 'axios';
import {
  CheckSquare,
  FileText,
  ListChecks,
  CheckCircle,
  Square,
} from 'lucide-react';
import { getEffectiveDueDate } from '../utils/actionItemDueDate';
import {
  buildGoogleCalendarUrl,
  buildOutlookCalendarUrl,
  buildIcsContent,
} from '../utils/meetingCalendarLinks';
import './MeetingSummary.css';

/**
 * Read-only summary layout. Use includeSections to render only action items or everything except.
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
  includeSections = 'all',
  staggerSections = false,
}) {
  const [statusSaving, setStatusSaving] = useState({});

  const decisionsDisplay = (decisions || []).filter(
    (d) => String(d || '').trim().toLowerCase() !== 'not specified'
  );

  const hasRestContent =
    !!(summaryText && String(summaryText).trim()) ||
    (keyPoints && keyPoints.length) ||
    decisionsDisplay.length ||
    (nextSteps && nextSteps.length) ||
    (importantNotes && importantNotes.length);

  const hasActionItems = actionItems && actionItems.length > 0;

  const hasContent =
    hasRestContent || hasActionItems;

  const showAll = includeSections === 'all';
  const showActionsOnly = includeSections === 'actionItemsOnly';
  const showRestOnly = includeSections === 'withoutActionItems';

  if (showActionsOnly && !hasActionItems) {
    return null;
  }

  if (showRestOnly && !hasRestContent && !showReadyBadge) {
    return null;
  }

  if (showAll && !hasContent) {
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

  const renderActionSection = () => {
    if (!(showAll || showActionsOnly) || !hasActionItems) return null;

    return (
      <section
        className={`meeting-summary-section meeting-summary-section--tasks meeting-summary-section--tasks-top${showActionsOnly ? ' meeting-summary-section--after-title' : ''}${staggerSections ? ' meeting-summary-section--ux-reveal' : ''}`}
        style={staggerSections ? { animationDelay: '0ms' } : undefined}
      >
        <h2 className="meeting-summary-heading meeting-summary-heading--with-icon">
          <CheckSquare className="meeting-summary-heading-icon" strokeWidth={1.5} aria-hidden />
          Action Items
        </h2>
        <ul className="meeting-summary-list meeting-summary-list--action meeting-summary-list--tasks-notion">
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

            const dueLabel =
              effectiveDue && !Number.isNaN(effectiveDue.getTime())
                ? `Due ${effectiveDue.toLocaleDateString(undefined, {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })}`
                : null;

            const startOfDay = (d) => {
              const x = new Date(d);
              x.setHours(0, 0, 0, 0);
              return x;
            };
            const isOverdue =
              status !== 'done' &&
              effectiveDue &&
              !Number.isNaN(effectiveDue.getTime()) &&
              startOfDay(effectiveDue).getTime() < startOfDay(new Date()).getTime();

            const overdueBadge = isOverdue ? 'Overdue' : null;

            const statusDisabled = !!statusSaving[itemId] || !item?._id || !meetingId;

            return (
              <li key={itemId} className="meeting-task-row" data-action-status={status}>
                <div className="meeting-task-row__check">
                  <button
                    type="button"
                    className="meeting-task-checkbox-btn"
                    disabled={statusDisabled}
                    aria-label={status === 'done' ? 'Mark as not done' : 'Mark as done'}
                    onClick={() => patchStatus(item, itemId, status === 'done' ? 'not_started' : 'done')}
                  >
                    {status === 'done' ? (
                      <CheckSquare className="meeting-task-checkbox-icon meeting-task-checkbox-icon--on" strokeWidth={1.75} />
                    ) : (
                      <Square className="meeting-task-checkbox-icon" strokeWidth={1.75} />
                    )}
                  </button>
                </div>
                <div className="meeting-task-row__body">
                  {dueLabel || overdueBadge ? (
                    <div className="meeting-action-item-badges">
                      {dueLabel ? (
                        <span className="meeting-action-meta-pill meeting-action-meta-pill--due">
                          {dueLabel}
                        </span>
                      ) : null}
                      {overdueBadge ? (
                        <span className="meeting-action-meta-pill meeting-action-meta-pill--overdue">
                          {overdueBadge}
                        </span>
                      ) : null}
                    </div>
                  ) : null}

                  <div className="meeting-task-title">{item.task || 'Action item'}</div>
                  {item.assignee ? (
                    <div className="meeting-task-assignee">{item.assignee}</div>
                  ) : null}

                  <div className="meeting-task-status-row">
                    <label
                      className="meeting-task-status-label"
                      htmlFor={`task-status-${meetingId || 'meeting'}-${idx}`}
                    >
                      Status
                    </label>
                    <select
                      id={`task-status-${meetingId || 'meeting'}-${idx}`}
                      className="meeting-task-status-select"
                      value={status}
                      disabled={statusDisabled}
                      onChange={(e) => patchStatus(item, itemId, e.target.value)}
                    >
                      <option value="not_started">Not started</option>
                      <option value="in_progress">In progress</option>
                      <option value="done">Done</option>
                    </select>
                  </div>

                  {(gcalUrl || outlookUrl || ics) && (
                    <div className="meeting-action-item-links meeting-action-item-links--task">
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
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    );
  };

  const renderRest = () => {
    if (!(showAll || showRestOnly)) return null;

    return (
      <>
        {showReadyBadge && (
          <div
            className={`meeting-summary-ready-badge meeting-summary-ready-badge--sentence${staggerSections ? ' meeting-summary-section--ux-reveal' : ''}`}
            aria-live="polite"
            style={staggerSections ? { animationDelay: '40ms' } : undefined}
          >
            <span className="meeting-summary-ready-badge__dot" aria-hidden="true" />
            AI Generated • Ready for review
          </div>
        )}

        {!!summaryText && String(summaryText).trim() && (
          <section
            className={`meeting-summary-section meeting-summary-section--minutes${staggerSections ? ' meeting-summary-section--ux-reveal' : ''}`}
            style={staggerSections ? { animationDelay: showReadyBadge ? '80ms' : '40ms' } : undefined}
          >
            <h2 className="meeting-summary-heading meeting-summary-heading--with-icon">
              <FileText className="meeting-summary-heading-icon" strokeWidth={1.5} aria-hidden />
              {isEducation ? 'Summary' : 'Minutes of the meeting'}
            </h2>
            <p className="meeting-summary-body">{summaryText}</p>
          </section>
        )}

        {keyPoints && keyPoints.length > 0 && (
          <section
            className={`meeting-summary-section meeting-summary-section--keypoints${staggerSections ? ' meeting-summary-section--ux-reveal' : ''}`}
            style={staggerSections ? { animationDelay: '120ms' } : undefined}
          >
            <h2 className="meeting-summary-heading meeting-summary-heading--with-icon">
              <ListChecks className="meeting-summary-heading-icon" strokeWidth={1.5} aria-hidden />
              Key Points
            </h2>
            <ul className="meeting-summary-list meeting-summary-list--checks">
              {keyPoints.map((p, idx) => (
                <li key={idx}>{p}</li>
              ))}
            </ul>
          </section>
        )}

        {decisionsDisplay.length > 0 && (
          <section
            className={`meeting-summary-section${staggerSections ? ' meeting-summary-section--ux-reveal' : ''}`}
            style={staggerSections ? { animationDelay: '160ms' } : undefined}
          >
            <h2 className="meeting-summary-heading meeting-summary-heading--with-icon">
              <CheckCircle className="meeting-summary-heading-icon" strokeWidth={1.5} aria-hidden />
              Decisions
            </h2>
            <ul className="meeting-summary-list">
              {decisionsDisplay.map((d, idx) => (
                <li key={idx}>{d}</li>
              ))}
            </ul>
          </section>
        )}

        {nextSteps && nextSteps.length > 0 && (
          <section
            className={`meeting-summary-section${staggerSections ? ' meeting-summary-section--ux-reveal' : ''}`}
            style={staggerSections ? { animationDelay: '200ms' } : undefined}
          >
            <h2 className="meeting-summary-heading">Next Steps</h2>
            <ul className="meeting-summary-list">
              {nextSteps.map((s, idx) => (
                <li key={idx}>{s}</li>
              ))}
            </ul>
          </section>
        )}

        {importantNotes && importantNotes.length > 0 && (
          <section
            className={`meeting-summary-section${staggerSections ? ' meeting-summary-section--ux-reveal' : ''}`}
            style={staggerSections ? { animationDelay: '240ms' } : undefined}
          >
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
      </>
    );
  };

  if (showActionsOnly) {
    return <>{renderActionSection()}</>;
  }

  if (showRestOnly) {
    return <>{renderRest()}</>;
  }

  return (
    <div className="meeting-summary-content">
      {renderActionSection()}
      {renderRest()}
    </div>
  );
}

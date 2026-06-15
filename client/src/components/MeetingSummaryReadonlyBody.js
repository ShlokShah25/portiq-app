import React, { useState } from 'react';
import axios from 'axios';
import {
  CheckSquare,
  FileText,
  ListChecks,
  ListOrdered,
  CheckCircle,
  Square,
  Award,
  Users,
} from 'lucide-react';
import { getEffectiveDueDate } from '../utils/actionItemDueDate';
import {
  buildGoogleCalendarUrl,
  buildOutlookCalendarUrl,
  buildIcsContent,
} from '../utils/meetingCalendarLinks';
import './MeetingSummary.css';
import { FEATURE_INTERVIEW_UI } from '../config/featureFlags';
import { GoogleCalendarLogo, OutlookLogo } from './CalendarBrandIcons';
import SpeakerPoolResolveBanner from './SpeakerPoolResolveBanner';
import EducationMarkdownBlock from './EducationMarkdownBlock';

/**
 * Read-only summary layout. Use includeSections to render only action items or everything except.
 */
export default function MeetingSummaryReadonlyBody({
  meeting,
  meetingId,
  summaryText = '',
  /** Education: revision block split from summary in display layer (optional). */
  revisionQuestions = null,
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
  summaryMode: summaryModeProp,
  hiringRecommendation = '',
  hiringRecommendationReason = '',
  evaluationSignals = null,
  /** Education: hide checkboxes, progress, and calendar links (teacher / admin preview). */
  readOnlyEducationAssignments = false,
}) {
  const [statusSaving, setStatusSaving] = useState({});

  const summaryMode =
    summaryModeProp || (meeting?.summaryMode === 'interview' ? 'interview' : 'standard');
  const isInterview = FEATURE_INTERVIEW_UI && summaryMode === 'interview';

  const interviewerEmails = [
    ...(Array.isArray(meeting?.interviewInterviewerEmails) ? meeting.interviewInterviewerEmails : []),
    meeting?.interviewInterviewerEmail,
  ]
    .map((e) => String(e || '').trim().toLowerCase())
    .filter(Boolean)
    .filter((e, i, arr) => arr.indexOf(e) === i);
  const interviewerLabel = (() => {
    if (!interviewerEmails.length) return '';
    const parts = meeting?.participants;
    if (!Array.isArray(parts)) return interviewerEmails.join(', ');
    const labels = interviewerEmails.map((email) => {
      const p = parts.find((x) => x && String(x.email || '').trim().toLowerCase() === email);
      const nm = p && String(p.name || '').trim();
      return nm ? `${nm} (${email})` : `${email.split('@')[0]} (${email})`;
    });
    return labels.join(', ');
  })();

  const candidatesFromDoc = Array.isArray(meeting?.interviewCandidates)
    ? meeting.interviewCandidates.filter((c) => c && String(c.name || '').trim())
    : [];
  const legacyName = String(meeting?.interviewCandidateName || '').trim();
  const legacyRole = String(meeting?.interviewRole || '').trim();
  const rosterRows =
    candidatesFromDoc.length > 0
      ? candidatesFromDoc.map((c) => ({
          name: String(c.name || '').trim(),
          role: String(c.role || '').trim(),
        }))
      : legacyName
        ? [{ name: legacyName, role: legacyRole }]
        : [];

  const hasInterviewRoster = isInterview && (!!interviewerLabel || rosterRows.length > 0);
  const hasMultipleCandidates = isInterview && rosterRows.length > 1;
  const singleCandidate = isInterview && rosterRows.length === 1 ? rosterRows[0] : null;

  const decisionsDisplay = (decisions || []).filter(
    (d) => String(d || '').trim().toLowerCase() !== 'not specified'
  );

  const hireRec = String(hiringRecommendation || '').trim();
  const hireReason = String(hiringRecommendationReason || '').trim();
  const hasHiringBlock =
    isInterview && (hireRec || hireReason);
  const hasEvalSignals =
    isInterview &&
    evaluationSignals &&
    typeof evaluationSignals === 'object' &&
    Object.keys(evaluationSignals).length > 0;

  const revisionBlock = String(revisionQuestions || '').trim();
  const hasRestContent =
    hasInterviewRoster ||
    !!(summaryText && String(summaryText).trim()) ||
    !!revisionBlock ||
    (keyPoints && keyPoints.length) ||
    decisionsDisplay.length ||
    (nextSteps && nextSteps.length) ||
    (importantNotes && importantNotes.length) ||
    hasHiringBlock ||
    hasEvalSignals;

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
          {isEducation ? 'Assignments & follow-ups' : 'Action Items'}
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

            const title = item?.task || (isEducation ? 'Follow-up' : 'Action item');
            const details = [
              meeting?.title ? `${isEducation ? 'Lecture' : 'Meeting'}: ${meeting.title}` : null,
              item?.assignee ? `${isEducation ? 'Assigned to' : 'Assignee'}: ${item.assignee}` : null,
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
            const staticEduAssignments = isEducation && readOnlyEducationAssignments;

            return (
              <li
                key={itemId}
                className={`meeting-task-row${staticEduAssignments ? ' meeting-task-row--edu-static' : ''}`}
                data-action-status={status}
              >
                {!staticEduAssignments && (
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
                )}
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

                  <div className="meeting-task-title">{item.task || (isEducation ? 'Follow-up' : 'Action item')}</div>
                  {item.assignee ? (
                    <div className="meeting-task-assignee">
                      {isEducation ? <>Assigned to: {item.assignee}</> : item.assignee}
                    </div>
                  ) : null}

                  {!staticEduAssignments && (
                  <div className="meeting-task-status-row">
                    <label
                      className="meeting-task-status-label"
                      htmlFor={`task-status-${meetingId || 'meeting'}-${idx}`}
                    >
                      {isEducation ? 'Your progress' : 'Status'}
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
                  )}

                  {!staticEduAssignments && (gcalUrl || outlookUrl || ics) && (
                    <div className="meeting-action-item-links meeting-action-item-links--task">
                      {gcalUrl && (
                        <a
                          className="meeting-action-link meeting-action-link--minimal"
                          href={gcalUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="Add to Google Calendar"
                        >
                          <GoogleCalendarLogo size={16} className="meeting-action-link__calendar-icon" />
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
                          <OutlookLogo size={16} className="meeting-action-link__calendar-icon" />
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
                            a.download = `${isEducation ? 'follow-up' : 'action-item'}-${(item.task || 'task')
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

    const signalLabels = {
      communicationClarity: 'Communication clarity',
      ownershipSignals: 'Ownership signals',
      depthOfAnswers: 'Depth of answers',
      confidenceLevel: 'Confidence level',
    };

    return (
      <>
        {showReadyBadge && (
          <div
            className={`meeting-summary-ready-badge meeting-summary-ready-badge--sentence meeting-summary-ready-badge--compact${staggerSections ? ' meeting-summary-section--ux-reveal' : ''}`}
            aria-live="polite"
            style={staggerSections ? { animationDelay: '30ms' } : undefined}
          >
            <span className="meeting-summary-ready-badge__dot" aria-hidden="true" />
            AI generated • ready for review
          </div>
        )}

        <SpeakerPoolResolveBanner
          meeting={meeting}
          meetingId={meetingId}
          summaryText={summaryText}
          keyPoints={keyPoints}
          decisions={decisions}
          nextSteps={nextSteps}
          importantNotes={importantNotes}
          actionItems={actionItems}
          onMeetingPatched={onMeetingPatched}
          isInterview={isInterview}
        />

        {hasMultipleCandidates && (
          <section
            className={`meeting-summary-section meeting-summary-section--interview-roster${staggerSections ? ' meeting-summary-section--ux-reveal' : ''}`}
            style={staggerSections ? { animationDelay: '60ms' } : undefined}
          >
            <h2 className="meeting-summary-heading meeting-summary-heading--with-icon">
              <Users className="meeting-summary-heading-icon" strokeWidth={1.5} aria-hidden />
              Interview roster
            </h2>
            <p className="meeting-summary-interview-roster-note">
              People you set when creating this interview (not the AI summary).
            </p>
            <p className="meeting-summary-interview-roster-recommendation">
              Recommendation: for multiple candidates, configure voice profiles for clearer speaker attribution.
            </p>
            {interviewerLabel ? (
              <p className="meeting-summary-body meeting-summary-interview-roster-line">
                <strong>Interviewer:</strong> {interviewerLabel}
              </p>
            ) : null}
            {rosterRows.length > 0 ? (
              <div className="meeting-summary-interview-roster-table-wrap">
                <table className="meeting-summary-interview-roster-table">
                  <thead>
                    <tr>
                      <th scope="col">Candidate</th>
                      <th scope="col">Role</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rosterRows.map((row, idx) => (
                      <tr key={`${row.name}-${idx}`}>
                        <td>{row.name}</td>
                        <td>{row.role || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </section>
        )}

        {singleCandidate && (
          <section
            className={`meeting-summary-section meeting-summary-section--candidate-profile${staggerSections ? ' meeting-summary-section--ux-reveal' : ''}`}
            style={staggerSections ? { animationDelay: '60ms' } : undefined}
          >
            <h2 className="meeting-summary-heading meeting-summary-heading--with-icon">
              <Users className="meeting-summary-heading-icon" strokeWidth={1.5} aria-hidden />
              Candidate
            </h2>
            <p className="meeting-summary-body meeting-summary-interview-roster-line">
              <strong>{singleCandidate.name}</strong>
              {singleCandidate.role ? ` — ${singleCandidate.role}` : ''}
            </p>
            {interviewerLabel ? (
              <p className="meeting-summary-body meeting-summary-interview-roster-line">
                <strong>Interviewer:</strong> {interviewerLabel}
              </p>
            ) : null}
          </section>
        )}

        {hasHiringBlock && (
          <section
            className={`meeting-summary-section meeting-summary-section--hiring${staggerSections ? ' meeting-summary-section--ux-reveal' : ''}`}
            style={staggerSections ? { animationDelay: '0ms' } : undefined}
          >
            <h2 className="meeting-summary-heading meeting-summary-heading--with-icon">
              <Award className="meeting-summary-heading-icon" strokeWidth={1.5} aria-hidden />
              Hiring recommendation
            </h2>
            {hireRec ? (
              <p className="meeting-summary-hiring-verdict" data-verdict={hireRec.replace(/\s+/g, '-').toLowerCase()}>
                {hireRec}
              </p>
            ) : null}
            {hireReason ? (
              <p className="meeting-summary-body meeting-summary-hiring-reason">{hireReason}</p>
            ) : null}
          </section>
        )}

        {isEducation ? (
          <>
            {keyPoints && keyPoints.length > 0 && (
              <section
                className={`meeting-summary-section meeting-summary-section--keypoints${staggerSections ? ' meeting-summary-section--ux-reveal' : ''}`}
                style={
                  staggerSections
                    ? { animationDelay: hasHiringBlock ? '100ms' : showReadyBadge ? '80ms' : '40ms' }
                    : undefined
                }
              >
                <h2 className="meeting-summary-heading meeting-summary-heading--with-icon">
                  <ListChecks className="meeting-summary-heading-icon" strokeWidth={1.5} aria-hidden />
                  Quick revision
                </h2>
                <ul className="meeting-summary-list meeting-summary-list--checks meeting-summary-list--md">
                  {keyPoints.map((p, idx) => (
                    <li key={idx}>
                      <EducationMarkdownBlock className="education-markdown-block--tight">
                        {p}
                      </EducationMarkdownBlock>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {!!summaryText && String(summaryText).trim() && (
              <section
                className={`meeting-summary-section meeting-summary-section--minutes${staggerSections ? ' meeting-summary-section--ux-reveal' : ''}`}
                style={staggerSections ? { animationDelay: '120ms' } : undefined}
              >
                <h2 className="meeting-summary-heading meeting-summary-heading--with-icon">
                  <FileText className="meeting-summary-heading-icon" strokeWidth={1.5} aria-hidden />
                  Structured notes & detailed explanation
                </h2>
                <EducationMarkdownBlock className="education-markdown-block--tight">
                  {summaryText}
                </EducationMarkdownBlock>
              </section>
            )}
          </>
        ) : (
          <>
            {!!summaryText && String(summaryText).trim() && (
              <section
                className={`meeting-summary-section meeting-summary-section--minutes${staggerSections ? ' meeting-summary-section--ux-reveal' : ''}`}
                style={
                  staggerSections
                    ? { animationDelay: hasHiringBlock ? '100ms' : showReadyBadge ? '80ms' : '40ms' }
                    : undefined
                }
              >
                <h2 className="meeting-summary-heading meeting-summary-heading--with-icon">
                  <FileText className="meeting-summary-heading-icon" strokeWidth={1.5} aria-hidden />
                  {isInterview ? 'Summary' : 'Minutes of the meeting'}
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
                  {isInterview ? 'Key strengths' : 'Key Points'}
                </h2>
                <ul className="meeting-summary-list meeting-summary-list--checks">
                  {keyPoints.map((p, idx) => (
                    <li key={idx}>{p}</li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}

        {decisionsDisplay.length > 0 && (
          <section
            className={`meeting-summary-section${staggerSections ? ' meeting-summary-section--ux-reveal' : ''}`}
            style={staggerSections ? { animationDelay: '160ms' } : undefined}
          >
            <h2 className="meeting-summary-heading meeting-summary-heading--with-icon">
              <CheckCircle className="meeting-summary-heading-icon" strokeWidth={1.5} aria-hidden />
              {isEducation ? 'Takeaways & clarifications' : 'Decisions'}
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
            <h2 className="meeting-summary-heading">
              {isEducation ? 'Homework, prep & next steps' : 'Next Steps'}
            </h2>
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
              {isInterview
                ? 'Concerns / red flags'
                : isEducation
                  ? 'Extra notes from class'
                  : 'Important Notes'}
            </h2>
            <ul className="meeting-summary-list">
              {importantNotes.map((n, idx) => (
                <li key={idx}>{n}</li>
              ))}
            </ul>
          </section>
        )}

        {isEducation && revisionBlock && (
          <section
            className={`meeting-summary-section meeting-summary-section--revision${staggerSections ? ' meeting-summary-section--ux-reveal' : ''}`}
            style={staggerSections ? { animationDelay: '260ms' } : undefined}
          >
            <h2 className="meeting-summary-heading meeting-summary-heading--with-icon">
              <ListOrdered className="meeting-summary-heading-icon" strokeWidth={1.5} aria-hidden />
              Revision questions
            </h2>
            <div className="meeting-summary-revision-body">
              <EducationMarkdownBlock className="education-markdown-block--tight">{revisionBlock}</EducationMarkdownBlock>
            </div>
          </section>
        )}

        {hasEvalSignals && (
          <section
            className={`meeting-summary-section meeting-summary-section--signals${staggerSections ? ' meeting-summary-section--ux-reveal' : ''}`}
            style={staggerSections ? { animationDelay: '280ms' } : undefined}
          >
            <h2 className="meeting-summary-heading">Evaluation signals</h2>
            <dl className="meeting-summary-signals">
              {Object.keys(signalLabels).map((k) => {
                const row = evaluationSignals[k];
                if (!row || typeof row !== 'object') return null;
                const level = row.level != null ? String(row.level) : '';
                const just = row.justification != null ? String(row.justification) : '';
                return (
                  <div key={k} className="meeting-summary-signal-row">
                    <dt>{signalLabels[k]}</dt>
                    <dd>
                      {level ? (
                        <span className="meeting-summary-signal-level">{level}</span>
                      ) : null}
                      {just ? <span className="meeting-summary-signal-just">{just}</span> : null}
                    </dd>
                  </div>
                );
              })}
            </dl>
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

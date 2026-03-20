import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import axios from 'axios';
import TopNav from './TopNav';
import { T } from '../config/terminology';
import { isEducation } from '../config/product';
import './MeetingSummary.css';
import { getEffectiveDueDate } from '../utils/actionItemDueDate';

function buildGoogleCalendarUrl({ title, details, dueDate }) {
  if (!dueDate) return null;
  const d = new Date(dueDate);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const start = `${y}${m}${day}`;
  const endDate = new Date(d.getTime() + 24 * 60 * 60 * 1000);
  const ey = endDate.getFullYear();
  const em = String(endDate.getMonth() + 1).padStart(2, '0');
  const ed = String(endDate.getDate()).padStart(2, '0');
  const end = `${ey}${em}${ed}`;

  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: title || 'Action item',
    details: details || '',
    dates: `${start}/${end}`,
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

function buildOutlookCalendarUrl({ title, details, dueDate }) {
  if (!dueDate) return null;
  const d = new Date(dueDate);
  if (Number.isNaN(d.getTime())) return null;

  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');

  // Outlook deep link works well for M365 web calendar.
  // Use an all-day event on the due date.
  const startdt = `${y}-${m}-${day}`;
  const endDate = new Date(d.getTime() + 24 * 60 * 60 * 1000);
  const ey = endDate.getFullYear();
  const em = String(endDate.getMonth() + 1).padStart(2, '0');
  const ed = String(endDate.getDate()).padStart(2, '0');
  const enddt = `${ey}-${em}-${ed}`;

  const params = new URLSearchParams({
    path: '/calendar/action/compose',
    subject: title || 'Action item',
    body: details || '',
    startdt,
    enddt,
    allday: 'true',
  });

  return `https://outlook.office.com/calendar/0/deeplink/compose?${params.toString()}`;
}

function buildIcsContent({ title, description, dueDate }) {
  const d = new Date(dueDate);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const dtStart = `${y}${m}${day}`;
  const endDate = new Date(d.getTime() + 24 * 60 * 60 * 1000);
  const ey = endDate.getFullYear();
  const em = String(endDate.getMonth() + 1).padStart(2, '0');
  const ed = String(endDate.getDate()).padStart(2, '0');
  const dtEnd = `${ey}${em}${ed}`;

  const uid = `${Date.now()}-${Math.random().toString(16).slice(2)}@portiq`;
  const dtStamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');

  const esc = (s) =>
    String(s || '')
      .replace(/\\/g, '\\\\')
      .replace(/\n/g, '\\n')
      .replace(/,/g, '\\,')
      .replace(/;/g, '\\;');

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//PortIQ//Meeting Assistant//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${dtStamp}`,
    `DTSTART;VALUE=DATE:${dtStart}`,
    `DTEND;VALUE=DATE:${dtEnd}`,
    `SUMMARY:${esc(title || 'Action item')}`,
    description ? `DESCRIPTION:${esc(description)}` : null,
    'END:VEVENT',
    'END:VCALENDAR',
  ]
    .filter(Boolean)
    .join('\r\n');
}

const MeetingSummary = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [meeting, setMeeting] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editingSummary, setEditingSummary] = useState(false);
  const [editableSummary, setEditableSummary] = useState(null);
  const [actionError, setActionError] = useState('');
  const [saving, setSaving] = useState(false);
  const [translationLanguage, setTranslationLanguage] = useState('');
  const [statusSaving, setStatusSaving] = useState({});

  const fetchMeeting = async () => {
    if (!id) return;
    try {
      const res = await axios.get(`/meetings/${id}`);
      setMeeting(res.data.meeting);
      setError('');
    } catch (err) {
      setError(err.response?.data?.error || 'Meeting not found');
      setMeeting(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMeeting();
  }, [id]);

  if (loading) {
    return (
      <div className="meeting-summary-screen">
        <TopNav />
        <div className="meeting-summary-loading">
          <div className="loading-spinner" />
          <p>Loading summary...</p>
        </div>
      </div>
    );
  }

  if (error && !meeting) {
    return (
      <div className="meeting-summary-screen">
        <TopNav />
        <div className="meeting-summary-container">
          <div className="meeting-summary-error">{error}</div>
        </div>
      </div>
    );
  }

  if (!meeting) return null;

  const summaryText =
    meeting.pendingSummary ||
    meeting.summary ||
    '';
  const keyPoints =
    (meeting.pendingKeyPoints && meeting.pendingKeyPoints.length) ? meeting.pendingKeyPoints
      : meeting.keyPoints || [];
  const actionItems =
    (meeting.pendingActionItems && meeting.pendingActionItems.length) ? meeting.pendingActionItems
      : meeting.actionItems || [];
  const decisions =
    (meeting.pendingDecisions && meeting.pendingDecisions.length) ? meeting.pendingDecisions
      : meeting.decisions || [];
  const nextSteps =
    (meeting.pendingNextSteps && meeting.pendingNextSteps.length) ? meeting.pendingNextSteps
      : meeting.nextSteps || [];
  const importantNotes =
    (meeting.pendingImportantNotes && meeting.pendingImportantNotes.length) ? meeting.pendingImportantNotes
      : meeting.importantNotes || [];

  const decisionsDisplay = (decisions || []).filter(
    (d) => String(d || '').trim().toLowerCase() !== 'not specified'
  );

  const hasContent =
    summaryText ||
    keyPoints.length ||
    actionItems.length ||
    decisionsDisplay.length ||
    nextSteps.length ||
    importantNotes.length;
  const pendingApproval = meeting.summaryStatus === 'Pending Approval';

  const startEditing = () => {
    setEditableSummary({
      summary: summaryText,
      keyPoints: [...keyPoints],
      actionItems: (actionItems || []).map((item) => ({
        task: item.task || '',
        assignee: item.assignee || '',
        dueDate: item.dueDate || null
      })),
      decisions: [...(decisions || [])],
      nextSteps: [...(nextSteps || [])],
      importantNotes: [...(importantNotes || [])]
    });
    setEditingSummary(true);
    setActionError('');
  };

  const handleApproveAndSend = async () => {
    setSaving(true);
    setActionError('');
    try {
      if (editingSummary && editableSummary) {
        await axios.put(`/meetings/${id}/pending-summary`, {
          summary: editableSummary.summary,
          keyPoints: editableSummary.keyPoints,
          actionItems: editableSummary.actionItems,
          decisions: editableSummary.decisions,
          nextSteps: editableSummary.nextSteps,
          importantNotes: editableSummary.importantNotes
        });
      }
      const res = await axios.post(`/meetings/${id}/approve-and-send`, {
        additionalParticipants: [],
        translationLanguage: translationLanguage || null,
      });
      setMeeting(res.data.meeting);
      setEditingSummary(false);
      setEditableSummary(null);
      const msg = res.data.message || (res.data.emailSent ? 'Summary approved and sent to participants.' : 'Summary approved and saved. Emails could not be sent (check mail configuration).');
      alert(msg);
      navigate('/meetings');
    } catch (err) {
      setActionError(err.response?.data?.error || 'Failed to save or send summary.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="meeting-summary-screen">
      <TopNav />
      <div className="meeting-summary-container">
        <div className="meeting-summary-card">
          <h1 className="meeting-summary-page-title">{meeting.title || 'Untitled meeting'}</h1>
          <p className="meeting-summary-subtitle">{T.meetingSummary()}</p>

          <div className="meeting-summary-see-all-row">
            <button
              type="button"
              className="meeting-summary-btn meeting-summary-btn--secondary meeting-summary-btn--see-all"
              onClick={() => navigate('/meetings')}
            >
              See all meetings
            </button>
          </div>

          <p
            style={{
              marginTop: '4px',
              marginBottom: '16px',
              fontSize: '12px',
              color: 'rgba(148, 163, 184, 0.95)',
              fontStyle: 'italic',
            }}
          >
            This summary and its action items are generated by AI and may not be 100% accurate.
            Please review carefully before sharing or acting on them.
          </p>

          {pendingApproval && !!hasContent && (
            <div className="meeting-summary-language-row">
              <label className="meeting-summary-language-label">
                Also send translated summary in:
              </label>
              <select
                className="meeting-summary-language-select"
                value={translationLanguage}
                onChange={e => setTranslationLanguage(e.target.value)}
              >
                <option value="">English only</option>
                <option value="Hindi">Hindi</option>
                <option value="Spanish">Spanish</option>
                <option value="French">French</option>
                <option value="German">German</option>
                <option value="Russian">Russian</option>
                <option value="Chinese (Simplified)">Chinese (Simplified)</option>
                <option value="Japanese">Japanese</option>
              </select>
            </div>
          )}

          {pendingApproval && !!hasContent && (
            <div className="meeting-summary-actions">
              <button
                type="button"
                className="meeting-summary-btn meeting-summary-btn--secondary"
                onClick={() => (editingSummary ? (setEditingSummary(false), setEditableSummary(null), setActionError('')) : startEditing())}
              >
                {editingSummary ? 'Cancel Edit' : 'Edit Summary'}
              </button>
              <button
                type="button"
                className="meeting-summary-btn meeting-summary-btn--primary"
                disabled={saving}
                onClick={handleApproveAndSend}
              >
                {saving ? 'Sending…' : (isEducation ? 'Approve & Send Lecture Notes' : 'Approve & Send')}
              </button>
            </div>
          )}
          {actionError && <div className="meeting-summary-action-error">{actionError}</div>}

          {!hasContent && !editingSummary && (
            <div className="meeting-summary-empty">
              {meeting.transcriptionStatus === 'Processing'
                ? 'Summary is being generated. Check back in a moment.'
                : 'No summary available yet.'}
            </div>
          )}

          {editingSummary && editableSummary && (
            <div className="meeting-summary-edit">
              <div className="meeting-summary-edit-field">
                <label>{isEducation ? 'Summary' : 'Minutes of the meeting'}</label>
                <textarea
                  value={editableSummary.summary}
                  onChange={e => setEditableSummary({ ...editableSummary, summary: e.target.value })}
                  rows={5}
                  className="meeting-summary-textarea"
                />
              </div>
              <div className="meeting-summary-edit-field">
                <label>Key Points (one per line)</label>
                <textarea
                  value={(editableSummary.keyPoints || []).join('\n')}
                  onChange={e => setEditableSummary({ ...editableSummary, keyPoints: e.target.value.split('\n').filter(l => l.trim()) })}
                  rows={5}
                  className="meeting-summary-textarea"
                />
              </div>
              <div className="meeting-summary-edit-field">
                <label>Decisions (one per line)</label>
                <textarea
                  value={(editableSummary.decisions || []).join('\n')}
                  onChange={e => setEditableSummary({ ...editableSummary, decisions: e.target.value.split('\n').filter(l => l.trim()) })}
                  rows={4}
                  className="meeting-summary-textarea"
                />
              </div>
              <div className="meeting-summary-edit-field">
                <label>Next Steps (one per line)</label>
                <textarea
                  value={(editableSummary.nextSteps || []).join('\n')}
                  onChange={e => setEditableSummary({ ...editableSummary, nextSteps: e.target.value.split('\n').filter(l => l.trim()) })}
                  rows={4}
                  className="meeting-summary-textarea"
                />
              </div>
              <div className="meeting-summary-edit-field">
                <label>{isEducation ? 'Important Concepts (one per line)' : 'Important Notes (one per line)'}</label>
                <textarea
                  value={(editableSummary.importantNotes || []).join('\n')}
                  onChange={e => setEditableSummary({ ...editableSummary, importantNotes: e.target.value.split('\n').filter(l => l.trim()) })}
                  rows={4}
                  className="meeting-summary-textarea"
                />
              </div>
              <div className="meeting-summary-edit-field">
                <label>Action Items</label>
                <small className="meeting-summary-edit-hint">Format: Task | Assignee | Due Date (optional)</small>
                <textarea
                  value={(editableSummary.actionItems || []).map(item =>
                    `${item.task || ''} | ${item.assignee || ''} | ${item.dueDate ? new Date(item.dueDate).toLocaleDateString() : ''}`
                  ).join('\n')}
                  onChange={e => {
                    const lines = e.target.value.split('\n').filter(l => l.trim());
                    const items = lines.map(line => {
                      const parts = line.split('|').map(p => p.trim());
                      return {
                        task: parts[0] || '',
                        assignee: parts[1] || '',
                        dueDate: parts[2] ? new Date(parts[2]) : null
                      };
                    });
                    setEditableSummary({ ...editableSummary, actionItems: items });
                  }}
                  rows={5}
                  className="meeting-summary-textarea"
                />
              </div>
            </div>
          )}

          {!!hasContent && !editingSummary && (
            <div className="meeting-summary-content">
              {summaryText && (
                <section className="meeting-summary-section">
                  <h2 className="meeting-summary-heading">
                    {isEducation ? 'Summary' : 'Minutes of the meeting'}
                  </h2>
                  <p className="meeting-summary-body">{summaryText}</p>
                </section>
              )}

              {keyPoints.length > 0 && (
                <section className="meeting-summary-section">
                  <h2 className="meeting-summary-heading">Key Points</h2>
                  <ul className="meeting-summary-list">
                    {keyPoints.map((p, idx) => (
                      <li key={idx}>{p}</li>
                    ))}
                  </ul>
                </section>
              )}

              {actionItems.length > 0 && (
                <section className="meeting-summary-section">
                  <h2 className="meeting-summary-heading">Action Items</h2>
                  <ul className="meeting-summary-list meeting-summary-list--action">
                    {actionItems.map((item, idx) => {
                      const itemId = item?._id || String(idx);
                      const status = item?.status || 'not_started';
                      const effectiveDue = getEffectiveDueDate(item, meeting);
                      const dueText =
                        effectiveDue && !Number.isNaN(effectiveDue.getTime())
                          ? effectiveDue.toLocaleDateString()
                          : null;

                      const title = item?.task || 'Action item';
                      const details = [
                        meeting?.title ? `Meeting: ${meeting.title}` : null,
                        item?.assignee ? `Assignee: ${item.assignee}` : null,
                      ]
                        .filter(Boolean)
                        .join('\n');

                      const dueIso = effectiveDue && !Number.isNaN(effectiveDue.getTime())
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

                      const statusClass =
                        status === 'in_progress' || status === 'done'
                          ? status
                          : 'not_started';

                      return (
                        <li
                          key={itemId}
                          className={`meeting-action-item meeting-action-item--${statusClass}`}
                          data-action-status={statusClass}
                        >
                          <div className="meeting-action-item-main">
                            <div className="meeting-action-item-title">
                              <strong>{item.task}</strong>
                              {item.assignee && <span> — {item.assignee}</span>}
                            </div>
                            {dueText && (
                              <div className="meeting-action-item-meta">
                                <span className="meeting-summary-due">Due {dueText}</span>
                              </div>
                            )}
                          </div>

                          <div className="meeting-action-item-actions">
                            <select
                              className="meeting-action-status-select"
                              value={status}
                              disabled={!!statusSaving[itemId] || !item?._id}
                              onChange={async (e) => {
                                const nextStatus = e.target.value;
                                if (!item?._id) return;
                                setStatusSaving((prev) => ({ ...prev, [itemId]: true }));
                                try {
                                  const res = await axios.patch(
                                    `/meetings/${id}/action-items/${item._id}`,
                                    { status: nextStatus }
                                  );
                                  setMeeting(res.data.meeting);
                                } catch (err) {
                                  alert(
                                    err.response?.data?.error ||
                                      'Failed to update action item status.'
                                  );
                                } finally {
                                  setStatusSaving((prev) => ({ ...prev, [itemId]: false }));
                                }
                              }}
                            >
                              <option value="not_started">Not started</option>
                              <option value="in_progress">In progress</option>
                              <option value="done">Done</option>
                            </select>

                            {gcalUrl && (
                              <a
                                className="meeting-action-link"
                                href={gcalUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                title="Add to Google Calendar"
                              >
                                Add to Google Calendar
                              </a>
                            )}

                            {outlookUrl && (
                              <a
                                className="meeting-action-link"
                                href={outlookUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                title="Add to Outlook Calendar"
                              >
                                Add to Outlook
                              </a>
                            )}

                            {ics && (
                              <button
                                type="button"
                                className="meeting-action-link meeting-action-link--button"
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
                                Download .ics
                              </button>
                            )}
                          </div>
                        </li>
                      );
                    })}
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

              {nextSteps.length > 0 && (
                <section className="meeting-summary-section">
                  <h2 className="meeting-summary-heading">Next Steps</h2>
                  <ul className="meeting-summary-list">
                    {nextSteps.map((s, idx) => (
                      <li key={idx}>{s}</li>
                    ))}
                  </ul>
                </section>
              )}

              {importantNotes.length > 0 && (
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
          )}
        </div>
      </div>
    </div>
  );
};

export default MeetingSummary;

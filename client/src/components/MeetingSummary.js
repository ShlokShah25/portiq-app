import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import axios from 'axios';
import TopNav from './TopNav';
import { T } from '../config/terminology';
import { isEducation } from '../config/product';
import './MeetingSummary.css';
import MeetingSummaryReadonlyBody from './MeetingSummaryReadonlyBody';

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
  const [allowsTranslatedSummary, setAllowsTranslatedSummary] = useState(false);

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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await axios.get('/admin/profile');
        const v = !!res.data?.admin?.allowsTranslatedSummary;
        if (!cancelled) setAllowsTranslatedSummary(v);
      } catch (_) {
        if (!cancelled) setAllowsTranslatedSummary(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <div className="meeting-summary-screen">
        <TopNav />
        <div className="meeting-summary-loading">
          <div className="loading-spinner" />
          <p className="meeting-summary-thinking" role="status">
            Understanding your conversation
            <span className="meeting-summary-thinking-dots" aria-hidden>
              <span className="meeting-summary-thinking-dot" />
              <span className="meeting-summary-thinking-dot" />
              <span className="meeting-summary-thinking-dot" />
            </span>
          </p>
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

  // Use explicit length checks — a bare `.length` chain can evaluate to `0`, which React then renders.
  const hasContent =
    !!String(summaryText || '').trim() ||
    keyPoints.length > 0 ||
    actionItems.length > 0 ||
    decisionsDisplay.length > 0 ||
    nextSteps.length > 0 ||
    importantNotes.length > 0;
  /** Any state before distribution — not only strict "Pending Approval" (legacy rows may omit status). */
  const canEditAndSend = meeting.summaryStatus !== 'Sent' && hasContent;

  const startEditing = () => {
    setEditableSummary({
      summary: summaryText,
      keyPoints: [...keyPoints],
      actionItems: (actionItems || []).map((item) => ({
        ...(item._id ? { _id: item._id } : {}),
        task: item.task || '',
        assignee: item.assignee || '',
        dueDate: item.dueDate || null,
        ...(item.status ? { status: item.status } : {}),
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
      if (editableSummary) {
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
        translationLanguage:
          allowsTranslatedSummary && translationLanguage
            ? translationLanguage
            : null,
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
      <div className="meeting-summary-container ux-screen-enter">
        <div className="meeting-summary-card">
          <h1 className="meeting-summary-page-title">{meeting.title || 'Untitled meeting'}</h1>

          {!editingSummary && !!hasContent && actionItems.length > 0 && (
            <MeetingSummaryReadonlyBody
              meeting={meeting}
              meetingId={id}
              summaryText=""
              keyPoints={[]}
              actionItems={actionItems}
              decisions={[]}
              nextSteps={[]}
              importantNotes={[]}
              isEducation={isEducation}
              onMeetingPatched={setMeeting}
              showReadyBadge={false}
              includeSections="actionItemsOnly"
              staggerSections
            />
          )}

          <p className="meeting-summary-subtitle">{T.meetingSummary()}</p>

          <div className="meeting-summary-see-all-row">
            <button
              type="button"
              className="meeting-summary-btn meeting-summary-btn--secondary meeting-summary-btn--see-all"
              onClick={() =>
                navigate('/meetings', { state: { showAllMeetings: true } })
              }
            >
              View All Meetings
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

          {canEditAndSend && allowsTranslatedSummary && (
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

          {!hasContent && !editingSummary && (
            <div className="meeting-summary-empty">
              {meeting.transcriptionStatus === 'Processing' ? (
                <p className="meeting-summary-thinking meeting-summary-thinking--muted" role="status">
                  Understanding your conversation
                  <span className="meeting-summary-thinking-dots" aria-hidden>
                    <span className="meeting-summary-thinking-dot" />
                    <span className="meeting-summary-thinking-dot" />
                    <span className="meeting-summary-thinking-dot" />
                  </span>
                </p>
              ) : (
                'No summary available yet.'
              )}
            </div>
          )}

          {editingSummary && editableSummary && (
            <>
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
                  <label>Action Items</label>
                  <small className="meeting-summary-edit-hint">
                    One per line. Format: Task | Assignee | Due date as YYYY-MM-DD (optional)
                  </small>
                  <textarea
                    value={(editableSummary.actionItems || []).map((item) => {
                      let dueStr = '';
                      if (item.dueDate) {
                        const d = new Date(item.dueDate);
                        dueStr = !Number.isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : '';
                      }
                      return `${item.task || ''} | ${item.assignee || ''} | ${dueStr}`;
                    }).join('\n')}
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
                    rows={6}
                    className="meeting-summary-textarea"
                    style={{ fontFamily: 'ui-monospace, monospace' }}
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
              </div>
              {canEditAndSend && (
                <div className="meeting-summary-actions meeting-summary-actions--send-first">
                  <button
                    type="button"
                    className="meeting-summary-btn meeting-summary-btn--primary meeting-summary-btn--send"
                    disabled={saving}
                    onClick={handleApproveAndSend}
                  >
                    {saving ? (
                      <>
                        <span className="meeting-summary-btn-spinner" aria-hidden />
                        Sending…
                      </>
                    ) : isEducation ? (
                      'Send Lecture Notes to Participants'
                    ) : (
                      'Send Summary to Participants'
                    )}
                  </button>
                  <button
                    type="button"
                    className="meeting-summary-btn meeting-summary-btn--secondary"
                    onClick={() =>
                      (setEditingSummary(false), setEditableSummary(null), setActionError(''))
                    }
                  >
                    Cancel Edit
                  </button>
                </div>
              )}
            </>
          )}

          {actionError && <div className="meeting-summary-action-error">{actionError}</div>}

          {!!hasContent && !editingSummary && (
            <>
              <div
                className={
                  actionItems.length > 0 ? 'meeting-summary-secondary-block' : undefined
                }
              >
                <MeetingSummaryReadonlyBody
                  meeting={meeting}
                  meetingId={id}
                  summaryText={summaryText}
                  keyPoints={keyPoints}
                  actionItems={actionItems}
                  decisions={decisions}
                  nextSteps={nextSteps}
                  importantNotes={importantNotes}
                  isEducation={isEducation}
                  onMeetingPatched={setMeeting}
                  includeSections="withoutActionItems"
                  staggerSections
                />
              </div>
              {canEditAndSend && (
                <div className="meeting-summary-actions meeting-summary-actions--send-first meeting-summary-actions--after-body">
                  <button
                    type="button"
                    className="meeting-summary-btn meeting-summary-btn--primary meeting-summary-btn--send"
                    disabled={saving}
                    onClick={handleApproveAndSend}
                  >
                    {saving ? (
                      <>
                        <span className="meeting-summary-btn-spinner" aria-hidden />
                        Sending…
                      </>
                    ) : isEducation ? (
                      'Send Lecture Notes to Participants'
                    ) : (
                      'Send Summary to Participants'
                    )}
                  </button>
                  <button
                    type="button"
                    className="meeting-summary-btn meeting-summary-btn--secondary"
                    onClick={startEditing}
                  >
                    Edit Summary
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default MeetingSummary;

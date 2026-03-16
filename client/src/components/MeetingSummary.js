import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import axios from 'axios';
import TopNav from './TopNav';
import { T } from '../config/terminology';
import { isEducation } from '../config/product';
import './MeetingSummary.css';

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

  const hasContent = summaryText || keyPoints.length || actionItems.length || decisions.length || nextSteps.length || importantNotes.length;
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
                <label>{isEducation ? 'Summary' : 'Executive Summary'}</label>
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
                    {isEducation ? 'Summary' : 'Executive Summary'}
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
                    {actionItems.map((item, idx) => (
                      <li key={idx}>
                        <strong>{item.task}</strong>
                        {item.assignee && <span> — {item.assignee}</span>}
                        {item.dueDate && (
                          <span className="meeting-summary-due">
                            Due: {new Date(item.dueDate).toLocaleDateString()}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {decisions.length > 0 && (
                <section className="meeting-summary-section">
                  <h2 className="meeting-summary-heading">Decisions</h2>
                  <ul className="meeting-summary-list">
                    {decisions.map((d, idx) => (
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

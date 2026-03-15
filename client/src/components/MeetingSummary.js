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
          <button type="button" className="meeting-summary-back" onClick={() => navigate(`/meetings/${id}`)}>
            ← Back to {T.meeting()}
          </button>
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

  return (
    <div className="meeting-summary-screen">
      <TopNav />
      <div className="meeting-summary-container">
        <button type="button" className="meeting-summary-back" onClick={() => navigate(`/meetings/${id}`)}>
          ← Back to {T.meeting()}
        </button>

        <div className="meeting-summary-card">
          <h1 className="meeting-summary-page-title">{meeting.title || 'Untitled meeting'}</h1>
          <p className="meeting-summary-subtitle">{T.meetingSummary()}</p>

          {pendingApproval && (
            <div className="meeting-summary-pending-banner">
              This summary is pending approval. Go to <button type="button" className="meeting-summary-inline-link" onClick={() => navigate('/meetings')}>Meetings</button> to review and send to participants.
            </div>
          )}

          {!hasContent && (
            <div className="meeting-summary-empty">
              {meeting.transcriptionStatus === 'Processing'
                ? 'Summary is being generated. Check back in a moment.'
                : 'No summary available yet.'}
            </div>
          )}

          {hasContent && (
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

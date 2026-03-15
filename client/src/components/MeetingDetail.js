import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import axios from 'axios';
import TopNav from './TopNav';
import { T } from '../config/terminology';
import './MeetingDetail.css';

const MeetingDetail = () => {
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
    const interval = setInterval(fetchMeeting, 10000);
    return () => clearInterval(interval);
  }, [id]);

  const formatDate = (dateString) => {
    if (!dateString) return '—';
    return new Date(dateString).toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  };

  const formatTime = (dateString) => {
    if (!dateString) return '—';
    return new Date(dateString).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });
  };

  const handleStartMeeting = async () => {
    try {
      await axios.post(`/meetings/${id}/start`);
      navigate(`/meetings/${id}/room`);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to start meeting');
    }
  };

  if (loading) {
    return (
      <div className="meeting-detail-screen">
        <TopNav />
        <div className="meeting-detail-loading">
          <div className="loading-spinner" />
          <p>Loading meeting...</p>
        </div>
      </div>
    );
  }

  if (error && !meeting) {
    return (
      <div className="meeting-detail-screen">
        <TopNav />
        <div className="meeting-detail-container">
          <button type="button" className="meeting-detail-back" onClick={() => navigate('/meetings')}>
            ← Back to {T.meetings()}
          </button>
          <div className="meeting-detail-error">{error}</div>
        </div>
      </div>
    );
  }

  if (!meeting) {
    return null;
  }

  const isScheduled = meeting.status === 'Scheduled';
  const isInProgress = meeting.status === 'In Progress';
  const isCompleted = meeting.status === 'Completed';
  const hasSummary = meeting.transcriptionStatus === 'Completed' && (meeting.summary || meeting.pendingSummary);
  const pendingApproval = meeting.summaryStatus === 'Pending Approval' && hasSummary;

  return (
    <div className="meeting-detail-screen">
      <TopNav />
      <div className="meeting-detail-container">
        <button type="button" className="meeting-detail-back" onClick={() => navigate('/meetings')}>
          ← Back to {T.meetings()}
        </button>

        <div className="meeting-detail-card">
          <div className="meeting-detail-header">
            <span className={`meeting-detail-status meeting-detail-status--${(meeting.status || '').toLowerCase().replace(' ', '-')}`}>
              {meeting.status || 'Scheduled'}
            </span>
            <h1 className="meeting-detail-title">{meeting.title || 'Untitled meeting'}</h1>
            {meeting.meetingRoom && (
              <p className="meeting-detail-room">{meeting.meetingRoom}</p>
            )}
          </div>

          <div className="meeting-detail-meta">
            <div className="meeting-detail-meta-item">
              <span className="meeting-detail-meta-label">Date</span>
              <span className="meeting-detail-meta-value">{formatDate(meeting.scheduledTime || meeting.startTime)}</span>
            </div>
            <div className="meeting-detail-meta-item">
              <span className="meeting-detail-meta-label">Time</span>
              <span className="meeting-detail-meta-value">{formatTime(meeting.scheduledTime || meeting.startTime)}</span>
            </div>
            {meeting.participants && meeting.participants.length > 0 && (
              <div className="meeting-detail-meta-item">
                <span className="meeting-detail-meta-label">Participants</span>
                <span className="meeting-detail-meta-value">{meeting.participants.length}</span>
              </div>
            )}
          </div>

          <div className="meeting-detail-actions">
            {isScheduled && (
              <button type="button" className="meeting-detail-btn meeting-detail-btn--primary" onClick={handleStartMeeting}>
                {T.startMeeting()}
              </button>
            )}
            {isInProgress && (
              <button
                type="button"
                className="meeting-detail-btn meeting-detail-btn--primary"
                onClick={() => navigate(`/meetings/${id}/room`)}
              >
                Open meeting
              </button>
            )}
            {isCompleted && hasSummary && !pendingApproval && (
              <button
                type="button"
                className="meeting-detail-btn meeting-detail-btn--primary"
                onClick={() => navigate(`/meetings/${id}/summary`)}
              >
                View {T.meetingSummary()}
              </button>
            )}
            {isCompleted && pendingApproval && (
              <button
                type="button"
                className="meeting-detail-btn meeting-detail-btn--primary"
                onClick={() => navigate(`/meetings/${id}/summary`, { state: { approve: true } })}
              >
                Review & send summary
              </button>
            )}
            {isCompleted && meeting.transcriptionEnabled && meeting.transcriptionStatus === 'Processing' && (
              <p className="meeting-detail-hint">Summary is being generated. Check back in a moment.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default MeetingDetail;

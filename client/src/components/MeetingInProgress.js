import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import axios from 'axios';
import { T } from '../config/terminology';
import TopNav from './TopNav';
import './MeetingSummary.css';
import './MeetingInProgress.css';
import './MeetingDetail.css';

const MeetingInProgress = () => {
  const { id: meetingId } = useParams();
  const navigate = useNavigate();
  const [meetingEnded, setMeetingEnded] = useState(false);
  const [meeting, setMeeting] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [elapsedTime, setElapsedTime] = useState(0);
  const [recording, setRecording] = useState(false);
  const [paused, setPaused] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [maxDurationMinutes, setMaxDurationMinutes] = useState(null);
  const [autoEnded, setAutoEnded] = useState(false);
  const [followUpOpen, setFollowUpOpen] = useState(false);
  const [followUpDt, setFollowUpDt] = useState('');
  const [checkpointText, setCheckpointText] = useState('');
  const [sendEmailParticipants, setSendEmailParticipants] = useState(true);
  const [followUpSubmitting, setFollowUpSubmitting] = useState(false);
  const [followUpError, setFollowUpError] = useState('');
  const [voiceProfiles, setVoiceProfiles] = useState({});
  const mediaRecorderRef = React.useRef(null);
  const streamRef = React.useRef(null);

  useEffect(() => {
    const emails = (meeting?.participants || [])
      .map((p) => (p.email && String(p.email).trim()) || '')
      .filter(Boolean);
    if (emails.length === 0) {
      setVoiceProfiles({});
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await axios.get(
          `/meetings/voice/profiles?emails=${encodeURIComponent(emails.join(','))}`
        );
        const profiles = res.data?.profiles || [];
        const next = {};
        emails.forEach((email) => {
          const profile = profiles.find(
            (pr) =>
              pr.email && pr.email.toLowerCase() === email.toLowerCase()
          );
          next[email.toLowerCase()] = { hasProfile: !!profile };
        });
        if (!cancelled) setVoiceProfiles(next);
      } catch (_) {
        if (!cancelled) setVoiceProfiles({});
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [meeting?.participants]);

  useEffect(() => {
    if (meetingId) {
      fetchMeeting();
      const interval = setInterval(fetchMeeting, 5000); // Poll every 5 seconds
      return () => clearInterval(interval);
    }
  }, [meetingId]);

  useEffect(() => {
    if (!meeting?.startTime || !recording || paused) return;
    const interval = setInterval(() => {
      const start = new Date(meeting.startTime);
      const now = new Date();
      setElapsedTime(Math.floor((now - start) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [meeting?.startTime, recording, paused]);

  // Fetch plan limits to optionally auto-end long recordings on starter / other plans
  useEffect(() => {
    const fetchPlan = async () => {
      try {
        const res = await axios.get('/admin/profile');
        const productType = res.data?.admin?.productType || 'workplace';
        const plan = (res.data?.admin?.plan || 'starter').toLowerCase();

        // Mirror planConstraints.js (workplace + education use the same tier caps for now).
        if (productType === 'workplace' || productType === 'education') {
          if (plan === 'starter') setMaxDurationMinutes(60);
          else if (plan === 'professional') setMaxDurationMinutes(180);
          else if (plan === 'business') setMaxDurationMinutes(480);
          else setMaxDurationMinutes(null);
        } else {
          setMaxDurationMinutes(null);
        }
      } catch (e) {
        // If this fails, we just won't auto-end on the client
        console.warn('Unable to fetch admin profile for plan limits', e);
      }
    };
    fetchPlan();
  }, []);

  // Watch elapsed time while recording and auto-end if we exceed plan limit
  useEffect(() => {
    if (!recording || !maxDurationMinutes || autoEnded) return;
    const limitSeconds = maxDurationMinutes * 60;
    if (elapsedTime >= limitSeconds) {
      setAutoEnded(true);
      setError(
        `Your plan allows meetings up to ${maxDurationMinutes} minutes. This meeting has been ended automatically.`
      );
      handleEndMeeting();
    }
  }, [elapsedTime, recording, maxDurationMinutes, autoEnded]);

  const fetchMeeting = async () => {
    try {
      const res = await axios.get(`/meetings/${meetingId}`);
      setMeeting(res.data.meeting);
      setLoading(false);
    } catch (err) {
      console.error('Error fetching meeting:', err);
      setError('Failed to load meeting details');
      setLoading(false);
    }
  };

  const startRecording = async () => {
    try {
      // Call API to set start time
      await axios.post(`/meetings/${meetingId}/start-recording`);
      await fetchMeeting(); // Refresh meeting data
      
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mediaRecorder = new MediaRecorder(stream);
      const chunks = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunks.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const blob = new Blob(chunks, { type: 'audio/webm' });
        if (streamRef.current) {
          streamRef.current.getTracks().forEach(t => t.stop());
        }
        await uploadAudio(blob);
      };

      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.start();
      setRecording(true);
      setPaused(false);
      setError('');
    } catch (err) {
      console.error('Error starting recording:', err);
      setError('Unable to access microphone. Please check browser permissions.');
    }
  };

  const pauseRecording = () => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state === 'recording') {
      recorder.pause();
      setPaused(true);
    }
  };

  const resumeRecording = () => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state === 'paused') {
      recorder.resume();
      setPaused(false);
    }
  };

  const stopRecording = () => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop();
      setRecording(false);
      setPaused(false);
    }
  };

  const uploadAudio = async (blob) => {
    if (!meeting) return;
    setUploading(true);
    try {
      const fileToSend = new File([blob], 'meeting-audio.webm', { type: 'audio/webm' });
      const data = new FormData();
      data.append('audio', fileToSend);
      const res = await axios.post(`/meetings/${meeting._id}/end`, data, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      setMeeting(res.data.meeting);
      setUploading(false);
    } catch (err) {
      console.error('Error uploading audio:', err);
      setError('Failed to upload audio');
      setUploading(false);
    }
  };

  const handleEndMeeting = async () => {
    if (!meeting) return;
    try {
      // Stop recording if active
      if (recording) {
        stopRecording();
      }
      await axios.post(`/meetings/${meeting._id}/end`);
      setMeetingEnded(true);
    } catch (err) {
      console.error('Error ending meeting:', err);
      setError('Failed to end meeting');
    }
  };

  const formatTime = (seconds) => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    if (hrs > 0) {
      return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'Not scheduled';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { 
      weekday: 'long', 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    });
  };

  const formatTimeOnly = (dateString) => {
    if (!dateString) return 'Not scheduled';
    const date = new Date(dateString);
    return date.toLocaleTimeString('en-US', { 
      hour: '2-digit', 
      minute: '2-digit',
      hour12: true 
    });
  };

  const openFollowUpFromRoom = () => {
    if (!meeting) return;
    const t = new Date();
    t.setDate(t.getDate() + 1);
    t.setHours(10, 0, 0, 0);
    const pad = (n) => String(n).padStart(2, '0');
    const local = `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}T${pad(t.getHours())}:${pad(t.getMinutes())}`;
    setFollowUpDt(local);
    const parts = [
      meeting.summary,
      meeting.pendingSummary,
      Array.isArray(meeting.keyPoints) && meeting.keyPoints.length
        ? meeting.keyPoints.slice(0, 10).map((k) => `• ${k}`).join('\n')
        : '',
      meeting.sessionCheckpointSummary,
      meeting.parentContinuation?.sessionCheckpointSummary,
    ].filter((x) => x && String(x).trim());
    setCheckpointText(parts.length ? String(parts[0]).trim().slice(0, 4000) : '');
    setFollowUpError('');
    setFollowUpOpen(true);
  };

  const handleScheduleFollowUpFromRoom = async (e) => {
    e.preventDefault();
    setFollowUpError('');
    const when = new Date(followUpDt);
    if (Number.isNaN(when.getTime())) {
      setFollowUpError('Pick a valid date and time for the follow-up.');
      return;
    }
    if (!checkpointText.trim()) {
      setFollowUpError('Add a short recap of what you covered.');
      return;
    }
    if (recording) {
      setFollowUpError('Stop recording first (Stop & Upload), or use End Meeting — then schedule follow-up from the meeting details page.');
      return;
    }
    setFollowUpSubmitting(true);
    try {
      const res = await axios.post(`/meetings/${meetingId}/schedule-follow-up`, {
        scheduledTime: when.toISOString(),
        checkpointSummary: checkpointText.trim(),
        sendEmail: sendEmailParticipants,
        endCurrentSession: true,
      });
      setFollowUpOpen(false);
      const nextId = res.data?.followUpMeeting?._id;
      if (nextId) {
        navigate(`/meetings/${nextId}`);
      } else {
        navigate(`/meetings/${meetingId}`);
      }
    } catch (err) {
      setFollowUpError(
        err.response?.data?.error || err.message || 'Could not schedule follow-up.'
      );
    } finally {
      setFollowUpSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="meeting-summary-screen meeting-in-progress">
        <TopNav />
        <div className="meeting-summary-loading">
          <div className="loading-spinner" />
          <p>Loading meeting details...</p>
        </div>
      </div>
    );
  }

  if (error && !meeting) {
    return (
      <div className="meeting-summary-screen meeting-in-progress">
        <TopNav />
        <div className="meeting-summary-container">
          <div className="meeting-summary-error">{error}</div>
          <button
            type="button"
            className="meeting-summary-btn meeting-summary-btn--secondary"
            style={{ marginTop: 16 }}
            onClick={() => navigate('/meetings')}
          >
            Back to {T.meetings()}
          </button>
        </div>
      </div>
    );
  }

  if (!meeting) {
    return (
      <div className="meeting-summary-screen meeting-in-progress">
        <TopNav />
        <div className="meeting-summary-container">
          <div className="meeting-summary-error">Meeting not found</div>
          <button
            type="button"
            className="meeting-summary-btn meeting-summary-btn--secondary"
            style={{ marginTop: 16 }}
            onClick={() => navigate('/meetings')}
          >
            Back to {T.meetings()}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="meeting-summary-screen meeting-in-progress">
      <TopNav />
      <div className="meeting-summary-container">
        <div className="meeting-summary-card mip-card">
          {meetingEnded ? (
            <>
              <div className="meeting-summary-ready-badge mip-ready-badge mip-ready-badge--neutral">
                <span className="meeting-summary-ready-badge__dot mip-ready-badge__dot--neutral" />
                Meeting ended
              </div>
              <h1 className="meeting-summary-page-title">{meeting.title || 'Untitled meeting'}</h1>
              <p className="meeting-summary-subtitle">Session ended</p>
              <div className="meeting-summary-see-all-row">
                <button
                  type="button"
                  className="meeting-summary-btn meeting-summary-btn--secondary meeting-summary-btn--see-all"
                  onClick={() => navigate('/meetings', { state: { showAllMeetings: true } })}
                >
                  See all meetings
                </button>
              </div>
              <p className="mip-ai-disclaimer">
                Your {T.meeting().toLowerCase()} is closed. Open the summary to review the transcript and AI-generated
                minutes before you send anything to participants.
              </p>
              <div className="meeting-summary-actions">
                <button
                  type="button"
                  className="meeting-summary-btn meeting-summary-btn--primary"
                  onClick={() => navigate(`/meetings/${meetingId}/summary`)}
                >
                  View {T.meetingSummary()}
                </button>
                <button
                  type="button"
                  className="meeting-summary-btn meeting-summary-btn--secondary"
                  onClick={() => navigate(`/meetings/${meetingId}`)}
                >
                  Back to {T.meeting()} details
                </button>
              </div>
            </>
          ) : (
            <>
              <h1 className="meeting-summary-page-title">{meeting.title || 'Untitled meeting'}</h1>
              <p className="meeting-summary-subtitle">Meeting in progress</p>
              <div className="meeting-summary-see-all-row">
                <button
                  type="button"
                  className="meeting-summary-btn meeting-summary-btn--secondary meeting-summary-btn--see-all"
                  onClick={() => navigate('/meetings', { state: { showAllMeetings: true } })}
                >
                  See all meetings
                </button>
              </div>
              <p className="mip-ai-disclaimer">
                Audio is captured in your browser. When you stop recording or end the meeting, we&apos;ll upload audio
                and generate your transcript and summary.
              </p>

              <div
                className={`meeting-summary-ready-badge mip-ready-badge${
                  recording && !paused ? ' mip-ready-badge--live' : ''
                }`}
              >
                <span className="meeting-summary-ready-badge__dot" />
                {uploading
                  ? 'Uploading audio'
                  : recording
                    ? paused
                      ? 'Recording paused'
                      : 'Recording'
                    : 'Session active'}
              </div>

              {meeting.parentContinuation && (
                <div className="meeting-detail-continuation mip-continuation">
                  <p className="meeting-detail-continuation-title">Continuing from prior session</p>
                  {meeting.parentContinuation.title && (
                    <p className="mip-continuation-parent-title">{meeting.parentContinuation.title}</p>
                  )}
                  {meeting.parentContinuation.sessionCheckpointSummary && (
                    <p className="meeting-detail-continuation-recap">
                      {meeting.parentContinuation.sessionCheckpointSummary}
                    </p>
                  )}
                </div>
              )}

              <div className="meeting-summary-section">
                <h2 className="meeting-summary-heading">Session details</h2>
                <div className="meeting-details-grid mip-details-grid">
          <div className="meeting-detail-card">
            <div className="detail-icon">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
                <rect x="3" y="4" width="18" height="18" rx="3" ry="3" />
                <line x1="3" y1="10" x2="21" y2="10" />
                <line x1="9" y1="2" x2="9" y2="6" />
                <line x1="15" y1="2" x2="15" y2="6" />
              </svg>
            </div>
            <div className="detail-content">
              <div className="detail-label">Date</div>
              <div className="detail-value">{formatDate(meeting.scheduledTime || meeting.startTime)}</div>
            </div>
          </div>

          <div className="meeting-detail-card">
            <div className="detail-icon">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
                <circle cx="12" cy="12" r="9" />
                <polyline points="12 7 12 12 16 14" />
              </svg>
            </div>
            <div className="detail-content">
              <div className="detail-label">Scheduled Time</div>
              <div className="detail-value">{formatTimeOnly(meeting.scheduledTime)}</div>
            </div>
          </div>

          <div className="meeting-detail-card">
            <div className="detail-icon">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
                <circle cx="12" cy="14" r="7" />
                <line x1="12" y1="7" x2="12" y2="3" />
                <polyline points="12 14 15 12" />
              </svg>
            </div>
            <div className="detail-content">
              <div className="detail-label">Duration</div>
              <div className="detail-value duration-value">{formatTime(elapsedTime)}</div>
            </div>
          </div>

          <div className="meeting-detail-card">
            <div className="detail-icon">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
                <rect x="3" y="3" width="7" height="18" rx="1" />
                <rect x="14" y="7" width="7" height="14" rx="1" />
                <line x1="6.5" y1="7" x2="6.5" y2="7" />
                <line x1="6.5" y1="11" x2="6.5" y2="11" />
                <line x1="6.5" y1="15" x2="6.5" y2="15" />
                <line x1="17.5" y1="11" x2="17.5" y2="11" />
                <line x1="17.5" y1="15" x2="17.5" y2="15" />
              </svg>
            </div>
            <div className="detail-content">
              <div className="detail-label">Location</div>
              <div className="detail-value">{meeting.meetingRoom || 'Not specified'}</div>
            </div>
          </div>

          <div className="meeting-detail-card">
            <div className="detail-icon">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                <circle cx="12" cy="7" r="4"></circle>
              </svg>
            </div>
            <div className="detail-content">
              <div className="detail-label">Organizer</div>
              <div className="detail-value">{meeting.organizer || 'Not specified'}</div>
            </div>
          </div>

          <div className="meeting-detail-card">
            <div className="detail-icon">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
                <path d="M5 21v-2a4 4 0 0 1 4-4h2" />
                <path d="M17 21v-2a4 4 0 0 0-4-4h-2" />
                <circle cx="9" cy="7" r="3" />
                <circle cx="17" cy="7" r="3" />
              </svg>
            </div>
            <div className="detail-content">
              <div className="detail-label">Participants</div>
              <div className="detail-value">{meeting.participants?.length || 0} people</div>
            </div>
          </div>
        </div>
              </div>

        {meeting.participants && meeting.participants.length > 0 && (
          <div className="meeting-summary-section meeting-summary-section--keypoints mip-participants-section">
            <h2 className="meeting-summary-heading">Participants</h2>
            <div className="participants-list participants-list--room mip-participants-list">
            <div className="participants-grid participants-grid--room">
              {meeting.participants.map((p, idx) => {
                const emailKey = p.email && String(p.email).trim().toLowerCase();
                const hasVoice =
                  emailKey && voiceProfiles[emailKey]?.hasProfile;
                return (
                  <div key={idx} className="mip-participant-row">
                    <div className="mip-participant-avatar" aria-hidden>
                      <span className="mip-participant-initials">
                        {(p.name || p.email || '?').trim().charAt(0).toUpperCase()}
                      </span>
                    </div>
                    <div className="mip-participant-text">
                      <div className="mip-participant-name">{p.name || 'Unnamed'}</div>
                      {p.email ? (
                        <div className="mip-participant-email">{p.email}</div>
                      ) : null}
                    </div>
                    {hasVoice ? (
                      <span
                        className="mip-participant-voice"
                        title="Voice profile configured"
                      >
                        <svg
                          width="18"
                          height="18"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          aria-hidden
                        >
                          <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                          <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                          <line x1="12" y1="19" x2="12" y2="23" />
                          <line x1="8" y1="23" x2="16" y2="23" />
                        </svg>
                      </span>
                    ) : null}
                  </div>
                );
              })}
            </div>
            </div>
          </div>
        )}

        {meeting.transcriptionEnabled && (
          <div className="meeting-summary-section mip-recording-section">
            <h2 className="meeting-summary-heading">Recording</h2>
            <div className="recording-controls mip-recording-controls">
            {!recording && !uploading && (
              <button
                type="button"
                className="meeting-summary-btn meeting-summary-btn--primary mip-btn-start-recording"
                onClick={startRecording}
              >
                <span className="mip-record-dot" aria-hidden />
                Start recording
              </button>
            )}
            {recording && (
              <>
                {!paused ? (
                  <button
                    type="button"
                    className="meeting-summary-btn meeting-summary-btn--secondary"
                    onClick={pauseRecording}
                  >
                    Pause
                  </button>
                ) : (
                  <button
                    type="button"
                    className="meeting-summary-btn meeting-summary-btn--primary mip-btn-start-recording"
                    onClick={resumeRecording}
                  >
                    <span className="mip-record-dot" aria-hidden />
                    Resume
                  </button>
                )}
                <button
                  type="button"
                  className="meeting-summary-btn mip-btn-stop-upload"
                  onClick={stopRecording}
                >
                  Stop &amp; upload
                </button>
              </>
            )}
            {uploading && (
              <div className="mip-uploading-status">
                <div className="upload-spinner" />
                <span>Uploading audio…</span>
              </div>
            )}
            </div>
          </div>
        )}

        {error && <div className="meeting-summary-action-error">{error}</div>}

        <div className="meeting-summary-actions mip-footer-actions">
          <button
            type="button"
            className="meeting-summary-btn meeting-summary-btn--secondary"
            onClick={openFollowUpFromRoom}
            disabled={uploading || followUpSubmitting || recording}
            title={recording ? 'Stop recording first' : undefined}
          >
            Schedule follow-up &amp; close
          </button>
          <button
            type="button"
            className="meeting-summary-btn mip-btn-end-meeting"
            onClick={handleEndMeeting}
            disabled={uploading}
          >
            End meeting
          </button>
        </div>
            </>
          )}
        </div>
      </div>
      {followUpOpen && (
        <div
          className="meeting-followup-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="mip-followup-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) setFollowUpOpen(false);
          }}
        >
          <form className="meeting-followup-modal" onSubmit={handleScheduleFollowUpFromRoom}>
            <h3 id="mip-followup-title">Schedule follow-up</h3>
            <p className="meeting-followup-modal-desc">
              We&apos;ll save your recap, end this session, create the next meeting on the date you
              pick, and optionally email everyone.
            </p>
            {followUpError && <div className="meeting-followup-error">{followUpError}</div>}
            <div className="meeting-followup-field">
              <label htmlFor="mip-followup-when">Follow-up date &amp; time</label>
              <input
                id="mip-followup-when"
                type="datetime-local"
                value={followUpDt}
                onChange={(e) => setFollowUpDt(e.target.value)}
                required
              />
            </div>
            <div className="meeting-followup-field">
              <label htmlFor="mip-followup-recap">What we covered</label>
              <textarea
                id="mip-followup-recap"
                value={checkpointText}
                onChange={(e) => setCheckpointText(e.target.value)}
                required
              />
            </div>
            <label className="meeting-followup-check">
              <input
                type="checkbox"
                checked={sendEmailParticipants}
                onChange={(e) => setSendEmailParticipants(e.target.checked)}
              />
              <span>Email participants the recap and follow-up time</span>
            </label>
            <div className="meeting-followup-actions">
              <button
                type="submit"
                className="meeting-detail-btn meeting-detail-btn--primary"
                disabled={followUpSubmitting}
              >
                {followUpSubmitting ? 'Scheduling…' : 'Schedule &amp; close session'}
              </button>
              <button
                type="button"
                className="meeting-detail-btn meeting-detail-btn--secondary"
                onClick={() => setFollowUpOpen(false)}
                disabled={followUpSubmitting}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

export default MeetingInProgress;

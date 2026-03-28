import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import axios from 'axios';
import TopNav from './TopNav';
import { isEducation } from '../config/product';
import { T } from '../config/terminology';
import { getClassrooms } from '../utils/classroomsStorage';
import { PORTIQ_MEETINGS_HINT, PORTIQ_PRICE_ROW } from '../config/productPitch';
import MeetingSummaryReadonlyBody from './MeetingSummaryReadonlyBody';
import {
  VOICE_ENROLLMENT_API_TEMPLATE,
  VOICE_ENROLLMENT_BOOK_PHRASE,
  voiceEnrollmentSentenceForParticipant,
} from '../utils/voiceEnrollment';
import { Loader2, Mic, Video } from 'lucide-react';
import MeetingCreateForm from './MeetingCreateForm';
import MeetingStatusBadge from './MeetingStatusBadge';
import { isOnlineMeeting } from '../utils/meetingDisplayStatus';
import './MeetingSummary.css';
import './MeetingsScreen.css';
import './MeetingUiBadges.css';

const MARKETING_URL =
  process.env.REACT_APP_MARKETING_URL ||
  process.env.REACT_APP_WEBSITE_URL ||
  'https://www.portiqtechnologies.com';

const MeetingsScreen = ({ config }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [meetings, setMeetings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedMeeting, setSelectedMeeting] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [polling, setPolling] = useState(false);
  const [recording, setRecording] = useState(false);
  const [rightTab, setRightTab] = useState('scheduled'); // 'scheduled' | 'recent'
  const [showAllMeetings, setShowAllMeetings] = useState(false);

  const mediaRecorderRef = useRef(null);
  const recordingFileInputRef = useRef(null);

  // Approval workflow state
  const [verificationEmail, setVerificationEmail] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [verificationStep, setVerificationStep] = useState(''); // 'request', 'verify', 'edit', 'approved'
  const [editableSummary, setEditableSummary] = useState(null);
  const [editingSummary, setEditingSummary] = useState(false);
  const [additionalParticipants, setAdditionalParticipants] = useState([
    { name: '', email: '' }
  ]);

  const [maxParticipantsPerMeeting, setMaxParticipantsPerMeeting] = useState(null); // 10/20/30 by plan, null = no limit
  /** null = loading profile; ok = can create; inactive / payment_pending = blocked */
  const [subscriptionGate, setSubscriptionGate] = useState(null);
  const newMeetingFormRef = useRef(null);

  const syncMeetingAfterActionItemPatch = (m) => {
    setSelectedMeeting(m);
    setEditableSummary((prev) => {
      if (!prev) return prev;
      return {
        summary: m.pendingSummary || m.summary || prev.summary,
        keyPoints: m.pendingKeyPoints?.length ? m.pendingKeyPoints : m.keyPoints ?? prev.keyPoints,
        actionItems: m.pendingActionItems?.length ? m.pendingActionItems : m.actionItems ?? prev.actionItems,
        decisions: m.pendingDecisions?.length ? m.pendingDecisions : m.decisions ?? prev.decisions,
        nextSteps: m.pendingNextSteps?.length ? m.pendingNextSteps : m.nextSteps ?? prev.nextSteps,
        importantNotes: m.pendingImportantNotes?.length
          ? m.pendingImportantNotes
          : m.importantNotes ?? prev.importantNotes,
      };
    });
  };

  const fetchMeetings = useCallback(async () => {
    try {
      setLoading(true);
      const res = await axios.get('/meetings');
      setMeetings(res.data?.meetings || []);
      setError('');
    } catch (err) {
      console.error('Error fetching meetings:', err);
      setError(
        err.response?.data?.error ||
          err.message ||
          'Failed to load meetings'
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMeetings();
  }, [fetchMeetings]);

  // Profile: plan limits + subscription gate for creating meetings
  useEffect(() => {
    const fetchProfile = async () => {
      try {
        const res = await axios.get('/admin/profile');
        const admin = res.data?.admin;
        if (!admin) {
          setSubscriptionGate('ok');
          setMaxParticipantsPerMeeting(null);
          return;
        }
        const u = String(admin.username || '').toLowerCase();
        if (u === 'admin' || admin.hasActiveSubscription || admin.complimentaryAccess) {
          setSubscriptionGate('ok');
        } else if (admin.subscriptionPaymentPending) {
          setSubscriptionGate('payment_pending');
        } else {
          setSubscriptionGate('inactive');
        }

        const plan = (admin.plan || 'starter').toLowerCase();
        const maxByPlan = { starter: 10, professional: 20, business: 30 };
        setMaxParticipantsPerMeeting(maxByPlan[plan] ?? null);
      } catch (e) {
        setMaxParticipantsPerMeeting(null);
        setSubscriptionGate('ok');
      }
    };
    fetchProfile();
  }, []);

  // Refresh meetings periodically and on window focus
  useEffect(() => {
    const interval = setInterval(() => {
      fetchMeetings();
    }, 10000); // Refresh every 10 seconds

    const handleFocus = () => {
      fetchMeetings();
    };
    window.addEventListener('focus', handleFocus);

    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', handleFocus);
    };
  }, [fetchMeetings]);

  // Open "All meetings" card gallery when linked from meeting summary (View All Meetings)
  useEffect(() => {
    if (!location.state?.showAllMeetings) return;
    setShowAllMeetings(true);
    fetchMeetings();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    const next = { ...(location.state || {}) };
    delete next.showAllMeetings;
    navigate(location.pathname, {
      replace: true,
      state: Object.keys(next).length ? next : undefined,
    });
  }, [location.state?.showAllMeetings, fetchMeetings, location.pathname, navigate]);

  useEffect(() => {
    if (!location.state?.openStartModal) return;
    const next = { ...(location.state || {}) };
    delete next.openStartModal;
    navigate(location.pathname, {
      replace: true,
      state: Object.keys(next).length ? next : undefined,
    });
    requestAnimationFrame(() => {
      newMeetingFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }, [location.state?.openStartModal, location.pathname, navigate]);

  useEffect(() => {
    if (!location.state?.focusRecordingUpload || !meetings.length) return;

    const next = { ...(location.state || {}) };
    delete next.focusRecordingUpload;

    const candidate =
      meetings.find((m) => m.transcriptionEnabled && m.status === 'In Progress') ||
      meetings.find((m) => m.transcriptionEnabled && m.status === 'Scheduled') ||
      meetings.find((m) => m.transcriptionEnabled);

    navigate(location.pathname, {
      replace: true,
      state: Object.keys(next).length ? next : undefined,
    });

    if (!candidate) {
      setError(
        'No meeting with transcription is available. Create a meeting first, then upload a recording from its details.'
      );
      return;
    }

    setSelectedMeeting(candidate);
    setRightTab('recent');
    setTimeout(() => {
      recordingFileInputRef.current?.click();
    }, 400);
  }, [meetings, location.state?.focusRecordingUpload, location.pathname, navigate]);

  // Auto-select meeting: from location state (e.g. "Review & send" from quick card) or first needing approval
  useEffect(() => {
    if (meetings.length === 0) return;
    const focusId = location.state?.focusMeetingId;
    if (focusId) {
      const found = meetings.find(m => m._id === focusId);
      if (found) setSelectedMeeting(found);
      navigate(location.pathname, { replace: true, state: {} });
      return;
    }
    if (!selectedMeeting) {
      const pendingApproval = meetings.find(m =>
        m.summaryStatus === 'Pending Approval' &&
        m.transcriptionStatus === 'Completed'
      );
      if (pendingApproval) setSelectedMeeting(pendingApproval);
    }
  }, [meetings, location.state?.focusMeetingId]);


  const handleAudioUpload = async (e) => {
    if (!selectedMeeting) return;
    const file = e.target.files[0];
    if (!file) return;
    await uploadAudio(file);
  };

  const pollForSummary = async (id) => {
    let attempts = 0;
    const maxAttempts = 40; // Increased to wait longer for transcription
    const interval = 5000;

    const poll = async () => {
      try {
        const res = await axios.get(`/meetings/${id}`);
        const m = res.data.meeting;
        setSelectedMeeting(m);
        
        // If summary is sent, stop polling and redirect to home
        if (m.summaryStatus === 'Sent') {
          setPolling(false);
          setTimeout(() => navigate('/'), 2000);
          return;
        }
        
        // If transcription completed or failed, stop polling
        if (m.transcriptionStatus === 'Completed' || m.transcriptionStatus === 'Failed' || attempts >= maxAttempts) {
          setPolling(false);
          // If summary is ready for approval, ensure meeting is selected
          if (m.summaryStatus === 'Pending Approval' && m.transcriptionStatus === 'Completed') {
            setSelectedMeeting(m);
            // Auto-fill authorized editor email if available (but don't auto-show code entry)
            if (m.authorizedEditorEmail && !verificationEmail) {
              setVerificationEmail(m.authorizedEditorEmail);
            }
            // Stay on page to show code entry prompt
            return;
          }
          // If no authorized editor or summary failed, redirect to home after delay
          if (!m.authorizedEditorEmail || m.transcriptionStatus === 'Failed') {
            setTimeout(() => navigate('/'), 3000);
          }
          return;
        }
        attempts += 1;
        setTimeout(poll, interval);
      } catch (err) {
        console.error('Error polling meeting summary:', err);
        setPolling(false);
      }
    };

    poll();
  };

  const companyName = config?.companyName || 'Your Company';

  const scheduledMeetings = (meetings || [])
    .filter(m => m && m.status === 'Scheduled')
    .slice()
    .sort((a, b) => {
      const da = a.scheduledTime ? new Date(a.scheduledTime).getTime() : 0;
      const db = b.scheduledTime ? new Date(b.scheduledTime).getTime() : 0;
      return da - db;
    });

  const recentMeetings = (meetings || [])
    .slice()
    .sort((a, b) => {
      const da = new Date(a.updatedAt || a.createdAt || a.startTime || a.scheduledTime || 0).getTime();
      const db = new Date(b.updatedAt || b.createdAt || b.startTime || b.scheduledTime || 0).getTime();
      return db - da;
    });

  const allMeetingsSorted = (meetings || [])
    .filter(Boolean)
    .slice()
    .sort((a, b) => {
      const da = new Date(a.updatedAt || a.createdAt || a.startTime || a.scheduledTime || 0).getTime();
      const db = new Date(b.updatedAt || b.createdAt || b.startTime || b.scheduledTime || 0).getTime();
      return db - da;
    });

  const meetingCardBadge = (m) => {
    const s = m.status || 'Scheduled';
    if (s === 'Completed') return { label: 'COMPLETED', mod: 'completed' };
    if (s === 'In Progress') return { label: 'IN PROGRESS', mod: 'live' };
    if (s === 'Cancelled') return { label: 'CANCELLED', mod: 'cancelled' };
    return { label: 'SCHEDULED', mod: 'scheduled' };
  };

  const meetingCardWhen = (m) => {
    const raw = m.scheduledTime || m.startTime || m.createdAt;
    if (!raw) return null;
    const dt = new Date(raw);
    return Number.isNaN(dt.getTime()) ? null : dt;
  };

  const meetingCardPrimaryAction = (m) => {
    const status = m.status || 'Scheduled';
    if (status === 'Completed') {
      return {
        label: `View ${T.meetingSummary()}`,
        path: `/meetings/${m._id}/summary`,
      };
    }
    if (status === 'In Progress') {
      return {
        label: 'Continue meeting',
        path: `/meetings/${m._id}/room`,
      };
    }
    if (status === 'Scheduled') {
      return {
        label: 'View meeting',
        path: `/meetings/${m._id}`,
      };
    }
    return {
      label: `View ${T.meetingSummary()}`,
      path: `/meetings/${m._id}/summary`,
    };
  };

  const getMeetingDurationLabel = (meeting) => {
    if (!meeting || !meeting.startTime || !meeting.endTime) return '';
    const start = new Date(meeting.startTime);
    const end = new Date(meeting.endTime);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) return '';
    const minutes = Math.max(1, Math.round((end.getTime() - start.getTime()) / 60000));
    return `Meeting duration: ${minutes} minutes`;
  };

  const uploadAudio = async (fileOrBlob) => {
    if (!selectedMeeting) return;
    setUploading(true);
    setError('');

    try {
      const data = new FormData();
      // If we received a raw Blob (from MediaRecorder), wrap it in a File with a proper extension
      let fileToSend = fileOrBlob;
      if (fileOrBlob instanceof Blob && !(fileOrBlob instanceof File)) {
        fileToSend = new File([fileOrBlob], 'meeting-audio.webm', { type: 'audio/webm' });
      }

      data.append('audio', fileToSend);
      const res = await axios.post(`/meetings/${selectedMeeting._id}/end`, data, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      setSelectedMeeting(res.data.meeting);
      setUploading(false);
      setPolling(true);
      pollForSummary(res.data.meeting._id);
    } catch (err) {
      console.error('Error uploading audio:', err);
      let serverError =
        err.response?.data?.error ||
        err.response?.data?.details ||
        err.message;
      if (err.message === 'Network Error') {
        serverError = 'Cannot reach workplace server. Please ensure the backend is running on port 5001.';
      }
      setError(serverError || 'Failed to upload audio');
      setUploading(false);
    }
  };

  const startRecording = async () => {
    if (!selectedMeeting) {
      setError('Please select or create a meeting first.');
      return;
    }
    try {
      // Call API to set start time when recording begins
      await axios.post(`/meetings/${selectedMeeting._id}/start-recording`);
      await fetchMeetings(); // Refresh to get updated start time
      
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      const chunks = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunks.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const blob = new Blob(chunks, { type: 'audio/webm' });
        stream.getTracks().forEach(t => t.stop());
        await uploadAudio(blob);
      };

      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.start();
      setRecording(true);
      setError('');
    } catch (err) {
      console.error('Error starting recording:', err);
      setError('Unable to access microphone. Please check browser permissions.');
    }
  };

  const stopRecording = () => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop();
      setRecording(false);
    }
  };

  return (
    <div className="meetings-screen">
      <TopNav />
      <div className="meetings-wrapper">
        <div className="meetings-top-bar">
          <h1 className="meetings-top-bar-title">{T.meetings()}</h1>
          <div className="meetings-top-bar-actions">
            <button
              type="button"
              className="meetings-see-all-btn"
              aria-expanded={showAllMeetings}
              onClick={() => {
                setSelectedMeeting(null);
                setRightTab('scheduled');
                fetchMeetings();
                setShowAllMeetings((prev) => !prev);
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
            >
              {showAllMeetings ? 'Hide meetings' : 'View All Meetings'}
            </button>
            {false && selectedMeeting && (
              <button
                className="btn btn-secondary"
                onClick={() => setSelectedMeeting(null)}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
                Close
              </button>
            )}
          </div>
        </div>
        
        <div
          className={`meetings-content${showAllMeetings ? ' meetings-content--all-open' : ''}`}
        >

        {error && <div className="error-message">{error}</div>}

        {showAllMeetings && (
          <section className="meetings-all-panel" aria-label="All meetings">
            <div className="meetings-all-panel-head">
              <h2 className="meetings-all-panel-title">All meetings</h2>
              <p className="meetings-all-panel-sub">
                Browse every meeting with date, time, and participants at a glance.
              </p>
            </div>
            {allMeetingsSorted.length === 0 ? (
              <div className="meetings-all-empty-block">
                <p className="info-text meetings-all-empty">No meetings yet. Start your first session.</p>
                <p className="meetings-all-empty-sub">Create a live or online meeting to see it here.</p>
              </div>
            ) : (
              <div className="meetings-all-grid">
                {allMeetingsSorted.map((m) => {
                  const badge = meetingCardBadge(m);
                  const when = meetingCardWhen(m);
                  const dateStr = when
                    ? when.toLocaleDateString(undefined, {
                        weekday: 'short',
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })
                    : '—';
                  const timeStr = when
                    ? when.toLocaleTimeString(undefined, {
                        hour: 'numeric',
                        minute: '2-digit',
                      })
                    : '—';
                  const participantCount = Array.isArray(m.participants) ? m.participants.length : 0;
                  const action = meetingCardPrimaryAction(m);
                  return (
                    <article key={m._id} className="meeting-card-portiq">
                      <div className="meeting-card-portiq-body">
                        <span
                          className={`meeting-card-badge meeting-card-badge--${badge.mod}`}
                        >
                          {badge.label}
                        </span>
                        <h3 className="meeting-card-portiq-title">{m.title || 'Untitled'}</h3>
                        <p className="meeting-card-portiq-location">
                          {m.meetingRoom || 'No location'}
                        </p>
                        <div className="meeting-card-portiq-meta">
                          <div className="meeting-card-portiq-meta-cell">
                            <span className="meeting-card-portiq-label">DATE</span>
                            <span className="meeting-card-portiq-value">{dateStr}</span>
                          </div>
                          <div className="meeting-card-portiq-meta-cell">
                            <span className="meeting-card-portiq-label">TIME</span>
                            <span className="meeting-card-portiq-value">{timeStr}</span>
                          </div>
                          <div className="meeting-card-portiq-meta-cell">
                            <span className="meeting-card-portiq-label">PARTICIPANTS</span>
                            <span className="meeting-card-portiq-value">{participantCount}</span>
                          </div>
                        </div>
                        <div className="meeting-card-portiq-divider" role="presentation" />
                        <button
                          type="button"
                          className="meeting-card-portiq-cta"
                          onClick={() => navigate(action.path)}
                        >
                          {action.label}
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {(() => {
          const needsApproval = (meetings || []).filter(
            m => m.summaryStatus === 'Pending Approval' && m.transcriptionStatus === 'Completed'
          );
          if (needsApproval.length === 0) return null;
          return (
            <div className="summaries-quick-card">
              <h2 className="summaries-quick-title">Pending Summaries</h2>
              <p className="summaries-quick-desc">
                Quick access to {T.meetingSummary().toLowerCase()}s that are waiting for your approval.
              </p>
              <div className="summaries-quick-grid">
                <div className="summaries-quick-block">
                  <h3 className="summaries-quick-block-title">Your summary is ready</h3>
                  <p className="summaries-quick-block-desc">Review it and send to participants.</p>
                  <ul className="summaries-quick-list">
                    {needsApproval.slice(0, 5).map(m => (
                      <li key={m._id}>
                        <span className="summaries-quick-name">{m.title}</span>
                        <button
                          type="button"
                          className="summaries-quick-btn summaries-quick-btn--primary summaries-quick-btn--link"
                          onClick={() => navigate(`/meetings/${m._id}/summary`)}
                        >
                          Review Summary
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          );
        })()}

        <div className="meetings-layout">
          <div className="meetings-left">
            <div className="card">
              <div className="card-header">
                <h2>{T.newMeeting()}</h2>
              </div>
              {subscriptionGate === 'inactive' && (
                <div className="meetings-subscription-banner meetings-subscription-banner--inactive" role="alert">
                  <div className="meetings-subscription-banner-text">
                    <p>No active plan—you need one to start a meeting.</p>
                    <p className="meetings-subscription-banner-prices">{PORTIQ_PRICE_ROW}</p>
                  </div>
                  <a className="meetings-subscription-banner-link" href={`${MARKETING_URL}#pricing`}>
                    See plans
                  </a>
                </div>
              )}
              {subscriptionGate === 'payment_pending' && (
                <div className="meetings-subscription-banner meetings-subscription-banner--payment" role="alert">
                  <div className="meetings-subscription-banner-text">
                    <p>{'Almost there—finish checkout and you\'re in.'}</p>
                  </div>
                  <a className="meetings-subscription-banner-link" href={`${MARKETING_URL}#pricing`}>
                    Finish payment
                  </a>
                </div>
              )}
              <div ref={newMeetingFormRef} className="meetings-new-meeting-form-wrap">
                <MeetingCreateForm
                  inline
                  active
                  companyName={companyName}
                  subscriptionGate={subscriptionGate}
                  maxParticipantsPerMeeting={maxParticipantsPerMeeting}
                  onMeetingCreated={fetchMeetings}
                />
              </div>
            </div>

            {false && selectedMeeting && (
              <div className="card">
                <div className="card-header">
                  <h2>Current Meeting</h2>
                </div>
                <div className="meeting-details">
                  {getMeetingDurationLabel(selectedMeeting) && (
                    <p><strong>{getMeetingDurationLabel(selectedMeeting)}</strong></p>
                  )}
                  <p><strong>Title:</strong> {selectedMeeting.title}</p>
                  <p><strong>Location:</strong> {selectedMeeting.meetingRoom}</p>
                  {selectedMeeting.scheduledTime && (
                    <p>
                      <strong>Scheduled:</strong>{' '}
                      {new Date(selectedMeeting.scheduledTime).toLocaleString()}
                    </p>
                  )}
                  {(selectedMeeting.startTime || selectedMeeting.scheduledTime) && (
                    <p>
                      <strong>Start Time:</strong>{' '}
                      {selectedMeeting.status === 'Scheduled' && selectedMeeting.scheduledTime
                        ? new Date(selectedMeeting.scheduledTime).toLocaleString()
                        : selectedMeeting.startTime
                        ? new Date(selectedMeeting.startTime).toLocaleString()
                        : ''}
                    </p>
                  )}
                  {selectedMeeting.endTime && (
                    <p>
                      <strong>End Time:</strong>{' '}
                      {new Date(selectedMeeting.endTime).toLocaleString()}
                    </p>
                  )}
                  <p><strong>Status:</strong> {selectedMeeting.status}</p>
                  {selectedMeeting.transcriptionEnabled && (
                    <p>
                      <strong>Transcription:</strong>{' '}
                      {selectedMeeting.transcriptionStatus || 'Not Started'}
                    </p>
                  )}
                </div>

                <div className="form-group-inline">
                  {selectedMeeting.status === 'Scheduled' && (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => navigate(`/meetings/${selectedMeeting._id}/room`)}
                    >
                      {T.startMeeting()}
                    </button>
                  )}
                </div>

                {selectedMeeting.status !== 'Completed' && (
                  <div className="form-group-inline" style={{ marginTop: '8px' }}>
                    <button
                      type="button"
                      className="btn btn-danger"
                      onClick={async () => {
                        try {
                          const res = await axios.post(`/meetings/${selectedMeeting._id}/end`);
                          setSelectedMeeting(res.data.meeting);
                          fetchMeetings();
                          
                          // If transcription is enabled, start polling for summary completion
                          if (res.data.meeting.transcriptionEnabled) {
                            setPolling(true);
                            pollForSummary(res.data.meeting._id);
                          } else {
                            // No transcription, redirect to home immediately
                            setTimeout(() => navigate('/'), 2000);
                          }
                        } catch (err) {
                          console.error('Error ending meeting:', err);
                          let serverError =
                            err.response?.data?.error ||
                            err.response?.data?.details ||
                            err.message;
                          setError(serverError || 'Failed to end meeting');
                        }
                      }}
                    >
                      {T.endMeeting()}
                    </button>
                  </div>
                )}

                {selectedMeeting.transcriptionEnabled && (
                  <div className="form-group">
                    <label style={{ color: 'white', fontSize: '15px', fontWeight: '600', marginBottom: '10px', display: 'block' }}>Or upload existing audio file</label>
                    <input
                      ref={recordingFileInputRef}
                      type="file"
                      accept="audio/*"
                      onChange={handleAudioUpload}
                      disabled={uploading}
                      style={{
                        width: '100%',
                        padding: '12px',
                        background: 'rgba(255, 255, 255, 0.15)',
                        border: '2px solid rgba(255, 255, 255, 0.3)',
                        borderRadius: '12px',
                        color: 'white',
                        fontSize: '15px',
                        cursor: uploading ? 'not-allowed' : 'pointer'
                      }}
                    />
                    <small style={{ display: 'block', marginTop: '8px', color: 'rgba(255, 255, 255, 0.8)', fontSize: '13px' }}>Use this if you already have a recording.</small>
                  </div>
                )}

                {/* Show "Process Transcription" button if audio exists but transcription hasn't started */}
                {selectedMeeting.audioFile && 
                 selectedMeeting.transcriptionEnabled && 
                 (selectedMeeting.transcriptionStatus === 'Not Started' || selectedMeeting.transcriptionStatus === 'Failed') && (
                  <div className="form-group-inline" style={{ marginTop: '8px' }}>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={async () => {
                        if (!selectedMeeting.audioFile) {
                          setError('No audio file found. Please upload an audio file first.');
                          return;
                        }
                        setUploading(true);
                        setError('');
                        try {
                          // End the meeting (which will trigger transcription if audioFile exists)
                          const res = await axios.post(`/meetings/${selectedMeeting._id}/end`);
                          setSelectedMeeting(res.data.meeting);
                          setPolling(true);
                          pollForSummary(selectedMeeting._id);
                        } catch (err) {
                          console.error('Error processing transcription:', err);
                          let serverError =
                            err.response?.data?.error ||
                            err.response?.data?.details ||
                            err.message;
                          setError(serverError || 'Failed to process transcription');
                        } finally {
                          setUploading(false);
                        }
                      }}
                      disabled={uploading || polling}
                    >
                      {uploading ? 'Processing...' : 'Process Transcription'}
                    </button>
                  </div>
                )}

                {(polling || (selectedMeeting && selectedMeeting.transcriptionEnabled && selectedMeeting.transcriptionStatus === 'Processing')) && (
                  <div style={{ 
                    background: 'rgba(255, 255, 255, 0.1)', 
                    backdropFilter: 'blur(10px)',
                    border: '2px solid rgba(255, 255, 255, 0.2)', 
                    borderRadius: '16px', 
                    padding: '32px', 
                    textAlign: 'center',
                    marginTop: '20px'
                  }}>
                    <div className="meetings-summary-polling-icon" aria-hidden>
                      <Loader2 size={40} strokeWidth={1.5} className="meetings-summary-polling-spinner" />
                    </div>
                    <h3 style={{ color: 'white', marginBottom: '8px', fontSize: '20px', fontWeight: '600' }}>Please wait while we generate the summary</h3>
                    <p style={{ color: 'rgba(255, 255, 255, 0.9)', fontSize: '15px' }}>
                      This may take a few minutes. The summary will appear here once ready.
                    </p>
                  </div>
                )}
                
                {/* Success message when summary is sent */}
                {selectedMeeting.summaryStatus === 'Sent' && (
                  <div style={{ 
                    background: 'rgba(34, 197, 94, 0.15)', 
                    backdropFilter: 'blur(10px)',
                    border: '2px solid rgba(34, 197, 94, 0.4)', 
                    borderRadius: '16px', 
                    padding: '32px', 
                    textAlign: 'center',
                    marginTop: '20px'
                  }}>
                    <div style={{ marginBottom: '16px', display: 'flex', justifyContent: 'center' }}>
                      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: '#22c55e' }}>
                        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                        <polyline points="22 4 12 14.01 9 11.01"></polyline>
                      </svg>
                    </div>
                    <h3 style={{ color: 'white', marginBottom: '8px', fontSize: '20px', fontWeight: '600' }}>Summary Sent Successfully!</h3>
                    <p style={{ color: 'rgba(255, 255, 255, 0.9)', fontSize: '15px' }}>
                      The meeting summary has been approved and sent to all participants.
                    </p>
                  </div>
                )}

                {/* Summary ready - no verification step, just open for review/edit */}
                {selectedMeeting.summaryStatus === 'Pending Approval' &&
                  selectedMeeting.transcriptionStatus === 'Completed' &&
                  !editableSummary && selectedMeeting.summary && (
                    <div className="meeting-summary-card meetings-inline-summary">
                      <div
                        className="meeting-summary-ready-badge meeting-summary-ready-badge--sentence"
                        style={{ marginBottom: 16 }}
                      >
                        <span className="meeting-summary-ready-badge__dot" aria-hidden="true" />
                        AI Generated • Ready for review
                      </div>
                      <h3 className="meeting-summary-page-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <svg
                          width="20"
                          height="20"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          aria-hidden="true"
                        >
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                          <polyline points="14 2 14 8 20 8"></polyline>
                          <line x1="16" y1="13" x2="8" y2="13"></line>
                          <line x1="16" y1="17" x2="8" y2="17"></line>
                          <polyline points="10 9 9 9 8 9"></polyline>
                        </svg>
                        Review before send
                      </h3>
                      <p className="meeting-summary-body" style={{ marginBottom: 12 }}>
                        The summary is generated and can be emailed to participants once you approve it.
                      </p>
                      <p style={{ marginBottom: 20, color: '#9ca3af', fontSize: 13 }}>
                        Open to review, edit if needed, add late participants, then approve and send.
                      </p>
                      <button
                        type="button"
                        className="meeting-summary-btn meeting-summary-btn--primary"
                        style={{ width: '100%' }}
                        onClick={() => {
                          const base = {
                            summary:
                              selectedMeeting.pendingSummary ||
                              selectedMeeting.summary ||
                              '',
                            keyPoints:
                              selectedMeeting.pendingKeyPoints?.length
                                ? selectedMeeting.pendingKeyPoints
                                : selectedMeeting.keyPoints || [],
                            actionItems:
                              selectedMeeting.pendingActionItems?.length
                                ? selectedMeeting.pendingActionItems
                                : selectedMeeting.actionItems || [],
                            decisions:
                              selectedMeeting.pendingDecisions?.length
                                ? selectedMeeting.pendingDecisions
                                : selectedMeeting.decisions || [],
                            nextSteps:
                              selectedMeeting.pendingNextSteps?.length
                                ? selectedMeeting.pendingNextSteps
                                : selectedMeeting.nextSteps || [],
                            importantNotes:
                              selectedMeeting.pendingImportantNotes?.length
                                ? selectedMeeting.pendingImportantNotes
                                : selectedMeeting.importantNotes || []
                          };

                          setEditableSummary(base);
                          setVerificationStep('edit');
                          setError('');
                          setAdditionalParticipants([{ name: '', email: '' }]);
                        }}
                      >
                        View &amp; Edit Summary
                      </button>
                    </div>
                  )}

                {/* Summary View & Edit (ONLY after code is verified) */}
                {verificationStep === 'edit' && editableSummary && (
                  <div className="meeting-summary-card meetings-inline-summary">
                    <h3 className="meeting-summary-page-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                        <polyline points="14 2 14 8 20 8"></polyline>
                        <line x1="16" y1="13" x2="8" y2="13"></line>
                        <line x1="16" y1="17" x2="8" y2="17"></line>
                        <polyline points="10 9 9 9 8 9"></polyline>
                      </svg>
                      {T.meetingSummary()}
                    </h3>

                    <div className="meeting-summary-actions meeting-summary-actions--send-first">
                          <button
                            type="button"
                            className="meeting-summary-btn meeting-summary-btn--primary meeting-summary-btn--send"
                            onClick={async () => {
                              try {
                                const emailToUse = verificationEmail || selectedMeeting.authorizedEditorEmail;
                                
                                // Filter out empty participants
                                const validAdditionalParticipants = additionalParticipants
                                  .filter(p => p.email && p.email.trim())
                                  .map(p => ({
                                    name: p.name.trim() || '',
                                    email: p.email.trim(),
                                    role: 'participant'
                                  }));
                                
                                // Save any edits first
                                if (editingSummary) {
                                  await axios.put(`/meetings/${selectedMeeting._id}/pending-summary`, {
                                    email: emailToUse,
                                    code: verificationCode,
                                    summary: editableSummary.summary,
                                    keyPoints: editableSummary.keyPoints,
                                    actionItems: editableSummary.actionItems,
                                    decisions: editableSummary.decisions,
                                    nextSteps: editableSummary.nextSteps,
                                    importantNotes: editableSummary.importantNotes
                                  });
                                }
                                
                                // Approve and send with additional participants
                                const res = await axios.post(`/meetings/${selectedMeeting._id}/approve-and-send`, {
                                  email: emailToUse,
                                  code: verificationCode,
                                  additionalParticipants: validAdditionalParticipants
                                });
                                setSelectedMeeting(res.data.meeting);
                                setVerificationStep('approved');
                                setError('');
                                const msg = res.data.message || (res.data.emailSent ? 'Summary approved and sent to all participants!' : 'Summary approved and saved. Emails could not be sent (check mail configuration).');
                                alert(msg);
                                setTimeout(() => navigate('/meetings'), 2000);
                              } catch (err) {
                                setError(err.response?.data?.error || 'Failed to save summary');
                              }
                            }}
                          >
                            {editingSummary
                              ? 'Save & Send'
                              : isEducation
                                ? 'Send Lecture Notes to Participants'
                                : 'Send Summary to Participants'}
                          </button>
                          <button
                            type="button"
                            className="meeting-summary-btn meeting-summary-btn--secondary"
                            onClick={() => setEditingSummary(!editingSummary)}
                          >
                            {editingSummary ? 'Cancel Edit' : 'Edit Summary'}
                          </button>
                        </div>
                        
                        {editingSummary ? (
                          <div className="meeting-summary-edit">
                            <div className="meeting-summary-edit-field">
                              <label>{isEducation ? 'Summary' : 'Minutes of the meeting'}</label>
                              <textarea
                                value={editableSummary.summary}
                                onChange={e => setEditableSummary({ ...editableSummary, summary: e.target.value })}
                                rows="5"
                                className="meeting-summary-textarea"
                              />
                            </div>
                            <div className="meeting-summary-edit-field">
                              <label>Key Points (one per line)</label>
                              <textarea
                                value={(editableSummary.keyPoints || []).join('\n')}
                                onChange={e => setEditableSummary({ ...editableSummary, keyPoints: e.target.value.split('\n').filter(l => l.trim()) })}
                                rows="6"
                                className="meeting-summary-textarea"
                              />
                            </div>
                            <div className="meeting-summary-edit-field">
                              <label>Decisions (one per line)</label>
                              <textarea
                                value={(editableSummary.decisions || []).join('\n')}
                                onChange={e => setEditableSummary({ ...editableSummary, decisions: e.target.value.split('\n').filter(l => l.trim()) })}
                                rows="4"
                                className="meeting-summary-textarea"
                              />
                            </div>
                            <div className="meeting-summary-edit-field">
                              <label>Next Steps (one per line)</label>
                              <textarea
                                value={(editableSummary.nextSteps || []).join('\n')}
                                onChange={e => setEditableSummary({ ...editableSummary, nextSteps: e.target.value.split('\n').filter(l => l.trim()) })}
                                rows="4"
                                className="meeting-summary-textarea"
                              />
                            </div>
                            <div className="meeting-summary-edit-field">
                              <label>
                                {isEducation ? 'Important Concepts (one per line)' : 'Important Notes (one per line)'}
                              </label>
                              <textarea
                                value={(editableSummary.importantNotes || []).join('\n')}
                                onChange={e => setEditableSummary({ ...editableSummary, importantNotes: e.target.value.split('\n').filter(l => l.trim()) })}
                                rows="4"
                                className="meeting-summary-textarea"
                              />
                            </div>
                            <div className="meeting-summary-edit-field">
                              <label>Action Items</label>
                              <small className="meeting-summary-edit-hint">
                                Format: Task | Assignee | Due Date (optional)
                              </small>
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
                                rows="6"
                                className="meeting-summary-textarea"
                                style={{ fontFamily: 'ui-monospace, monospace' }}
                                placeholder="Complete project documentation | John Doe | 2024-03-15"
                              />
                            </div>
                          </div>
                        ) : (
                          <div>
                            <MeetingSummaryReadonlyBody
                              meeting={selectedMeeting}
                              meetingId={selectedMeeting._id}
                              summaryText={editableSummary.summary}
                              keyPoints={editableSummary.keyPoints}
                              actionItems={editableSummary.actionItems}
                              decisions={editableSummary.decisions}
                              nextSteps={editableSummary.nextSteps}
                              importantNotes={editableSummary.importantNotes}
                              isEducation={isEducation}
                              onMeetingPatched={syncMeetingAfterActionItemPatch}
                            />

                            {/* Add Additional Participants Section - Only after summary is visible */}
                            <div style={{ 
                              background: 'rgba(255, 255, 255, 0.05)', 
                              border: '1px solid rgba(255, 255, 255, 0.2)', 
                              borderRadius: '12px', 
                              padding: '20px', 
                              marginTop: '24px' 
                            }}>
                              <h4 style={{ color: 'white', marginBottom: '12px', fontSize: '16px' }}>
                                Add Participants Called In During Meeting
                              </h4>
                              <p style={{ color: 'rgba(255, 255, 255, 0.7)', fontSize: '13px', marginBottom: '16px' }}>
                                Add anyone who joined the meeting after it started. They will also receive the summary.
                              </p>
                              {additionalParticipants.map((p, idx) => (
                                <div key={idx} style={{ display: 'flex', gap: '8px', marginBottom: '12px', alignItems: 'center' }}>
                                  <input
                                    type="text"
                                    placeholder="Name"
                                    value={p.name}
                                    onChange={e => {
                                      const updated = [...additionalParticipants];
                                      updated[idx].name = e.target.value;
                                      setAdditionalParticipants(updated);
                                    }}
                                    style={{ 
                                      flex: 1, 
                                      padding: '10px', 
                                      background: 'rgba(255, 255, 255, 0.15)',
                                      border: '2px solid rgba(255, 255, 255, 0.3)',
                                      borderRadius: '8px',
                                      color: 'white',
                                      fontSize: '14px'
                                    }}
                                  />
                                  <input
                                    type="email"
                                    placeholder="Email"
                                    value={p.email}
                                    onChange={e => {
                                      const updated = [...additionalParticipants];
                                      updated[idx].email = e.target.value;
                                      setAdditionalParticipants(updated);
                                    }}
                                    style={{ 
                                      flex: 2, 
                                      padding: '10px', 
                                      background: 'rgba(255, 255, 255, 0.15)',
                                      border: '2px solid rgba(255, 255, 255, 0.3)',
                                      borderRadius: '8px',
                                      color: 'white',
                                      fontSize: '14px'
                                    }}
                                  />
                                  {additionalParticipants.length > 1 && (
                                    <button
                                      type="button"
                                      onClick={() => setAdditionalParticipants(additionalParticipants.filter((_, i) => i !== idx))}
                                      style={{
                                        padding: '10px 16px',
                                        background: 'rgba(239, 68, 68, 0.2)',
                                        border: '1px solid rgba(239, 68, 68, 0.4)',
                                        borderRadius: '8px',
                                        color: '#ef4444',
                                        cursor: 'pointer',
                                        fontSize: '14px',
                                        fontWeight: '600'
                                      }}
                                    >
                                      Remove
                                    </button>
                                  )}
                                </div>
                              ))}
                              <button
                                type="button"
                                onClick={() => setAdditionalParticipants([...additionalParticipants, { name: '', email: '' }])}
                                style={{
                                  padding: '10px 16px',
                                  background: 'rgba(37, 99, 235, 0.2)',
                                  border: '1px solid rgba(37, 99, 235, 0.4)',
                                  borderRadius: '8px',
                                  color: '#60a5fa',
                                  cursor: 'pointer',
                                  fontSize: '14px',
                                  fontWeight: '600'
                                }}
                              >
                                + Add Another Participant
                              </button>
                            </div>
                          </div>
                        )}
                  </div>
                )}
                
                {/* Sent / archived summary (same layout as full Meeting Summary page) */}
                {selectedMeeting.summary &&
                  selectedMeeting.summaryStatus !== 'Pending Approval' &&
                  !(verificationStep === 'edit' && editableSummary) && (
                  <div className="meeting-summary-card meetings-inline-summary">
                    <h3 className="meeting-summary-page-title">
                      {isEducation ? 'Lecture notes' : 'Meeting summary'}
                    </h3>
                    <MeetingSummaryReadonlyBody
                      meeting={selectedMeeting}
                      meetingId={selectedMeeting._id}
                      summaryText={selectedMeeting.summary}
                      keyPoints={selectedMeeting.keyPoints}
                      actionItems={selectedMeeting.actionItems}
                      decisions={selectedMeeting.decisions}
                      nextSteps={selectedMeeting.nextSteps}
                      importantNotes={selectedMeeting.importantNotes}
                      isEducation={isEducation}
                      onMeetingPatched={(m) => setSelectedMeeting(m)}
                    />
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="meetings-right">
            <div className="card">
                  <div className="card-header">
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
                      <h2 style={{ margin: 0 }}>{T.meetings()}</h2>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          style={{
                            padding: '8px 12px',
                            borderRadius: '10px',
                            opacity: rightTab === 'scheduled' ? 1 : 0.75,
                            borderColor: rightTab === 'scheduled' ? '#2563eb' : undefined,
                          }}
                          onClick={() => setRightTab('scheduled')}
                        >
                          Scheduled
                        </button>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          style={{
                            padding: '8px 12px',
                            borderRadius: '10px',
                            opacity: rightTab === 'recent' ? 1 : 0.75,
                            borderColor: rightTab === 'recent' ? '#2563eb' : undefined,
                          }}
                          onClick={() => setRightTab('recent')}
                        >
                          Recent
                        </button>
                      </div>
                    </div>
              </div>
              <div className="meetings-list">
                {rightTab === 'scheduled' && (
                  <>
                    {scheduledMeetings.length === 0 ? (
                      <div className="meetings-list-empty">
                        <p className="info-text">No meetings yet. Start your first session.</p>
                        <p className="meetings-list-empty-sub">Use Start session to create one.</p>
                      </div>
                    ) : (
                      scheduledMeetings.map(m => {
                        const online = isOnlineMeeting(m);
                        const p = String(m.conferenceProvider || '').toLowerCase();
                        return (
                        <div
                          key={m._id}
                          className="meeting-item"
                          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}
                        >
                          <div
                            onClick={() => navigate(`/meetings/${m._id}`)}
                            role="button"
                            tabIndex={0}
                            style={{ flex: 1, minWidth: 0 }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                navigate(`/meetings/${m._id}`);
                              }
                            }}
                          >
                            <div className="meeting-title" style={{ marginBottom: '6px' }}>{m.title}</div>
                            <div className="meetings-list-badges-row">
                              {online ? (
                                <span className="meeting-ui-badge meeting-ui-badge--mode">
                                  <Video className="meeting-ui-badge__icon" size={11} strokeWidth={2} aria-hidden />
                                  Online Meeting
                                </span>
                              ) : (
                                <span className="meeting-ui-badge meeting-ui-badge--mode">
                                  <Mic className="meeting-ui-badge__icon" size={11} strokeWidth={2} aria-hidden />
                                  Live Recording
                                </span>
                              )}
                              {p === 'zoom' && (
                                <span className="meeting-ui-badge meeting-ui-badge--platform-zoom">Zoom</span>
                              )}
                              {p === 'teams' && (
                                <span className="meeting-ui-badge meeting-ui-badge--platform-teams">Teams</span>
                              )}
                              <MeetingStatusBadge meeting={m} />
                            </div>
                            <div className="meeting-meta" style={{ marginTop: 8 }}>
                              <span>{m.scheduledTime ? new Date(m.scheduledTime).toLocaleString() : 'No time set'}</span>
                            </div>
                          </div>
                          <button
                            type="button"
                            className="btn btn-primary"
                            style={{ padding: '8px 12px', borderRadius: '10px', flexShrink: 0 }}
                            onClick={(e) => {
                              e.stopPropagation();
                              navigate(online ? `/meetings/${m._id}` : `/meetings/${m._id}/room`);
                            }}
                            title={online ? 'Open meeting' : 'Start meeting'}
                          >
                            {online ? 'Open' : 'Start'}
                          </button>
                        </div>
                        );
                      })
                    )}
                  </>
                )}

                {rightTab === 'recent' && (
                  <>
                    {recentMeetings.length === 0 && (
                      <div className="meetings-list-empty">
                        <p className="info-text">No meetings yet. Start your first session.</p>
                      </div>
                    )}
                    {recentMeetings.map(m => {
                      const online = isOnlineMeeting(m);
                      const p = String(m.conferenceProvider || '').toLowerCase();
                      const when = m.scheduledTime || m.startTime || m.createdAt;
                      return (
                      <div
                        key={m._id}
                        className={`meeting-item ${selectedMeeting && selectedMeeting._id === m._id ? 'active' : ''} ${m.summaryStatus === 'Pending Approval' && m.transcriptionStatus === 'Completed' ? 'needs-approval' : ''}`}
                        onClick={() => navigate(`/meetings/${m._id}`)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(`/meetings/${m._id}`); } }}
                      >
                        <div className="meeting-title">
                          {m.title}
                          {m.summaryStatus === 'Pending Approval' && m.transcriptionStatus === 'Completed' && (
                            <span className="approval-badge" style={{
                              display: 'inline-block',
                              marginLeft: '8px',
                              padding: '2px 8px',
                              background: '#2563eb',
                              color: 'white',
                              borderRadius: '12px',
                              fontSize: '11px',
                              fontWeight: '600'
                            }}>
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: '4px' }}>
                                <circle cx="12" cy="12" r="10"></circle>
                                <line x1="12" y1="8" x2="12" y2="12"></line>
                                <line x1="12" y1="16" x2="12.01" y2="16"></line>
                              </svg>
                              Needs Approval
                            </span>
                          )}
                        </div>
                        <div className="meetings-list-badges-row" style={{ marginTop: 6 }}>
                          {online ? (
                            <span className="meeting-ui-badge meeting-ui-badge--mode">
                              <Video className="meeting-ui-badge__icon" size={11} strokeWidth={2} aria-hidden />
                              Online Meeting
                            </span>
                          ) : (
                            <span className="meeting-ui-badge meeting-ui-badge--mode">
                              <Mic className="meeting-ui-badge__icon" size={11} strokeWidth={2} aria-hidden />
                              Live Recording
                            </span>
                          )}
                          {p === 'zoom' && (
                            <span className="meeting-ui-badge meeting-ui-badge--platform-zoom">Zoom</span>
                          )}
                          {p === 'teams' && (
                            <span className="meeting-ui-badge meeting-ui-badge--platform-teams">Teams</span>
                          )}
                          <MeetingStatusBadge meeting={m} />
                        </div>
                        <div className="meeting-meta" style={{ marginTop: 8 }}>
                          <span>{when ? new Date(when).toLocaleString() : '—'}</span>
                        </div>
                      </div>
                      );
                    })}
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
        </div>
      </div>

    </div>
  );
};

export default MeetingsScreen;


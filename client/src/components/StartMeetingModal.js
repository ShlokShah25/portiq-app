import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { X, Mic, Video, Bot } from 'lucide-react';
import { isEducation } from '../config/product';
import { getClassrooms } from '../utils/classroomsStorage';
import { detectConferenceProvider, conferenceProviderLabel } from '../utils/detectConferenceLink';
import './StartMeetingModal.css';

export default function StartMeetingModal({
  open,
  onClose,
  companyName = 'Your Company',
  subscriptionGate,
}) {
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [agenda, setAgenda] = useState('');
  const [captureMode, setCaptureMode] = useState('live');
  const [meetingLink, setMeetingLink] = useState('');
  const [happeningNow, setHappeningNow] = useState(true);
  const [selectedClassroomId, setSelectedClassroomId] = useState('');
  const [organizerDefault, setOrganizerDefault] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [postSubmit, setPostSubmit] = useState(null);
  const [createdMeetingId, setCreatedMeetingId] = useState(null);

  useEffect(() => {
    if (!open) return;
    (async () => {
      try {
        const res = await axios.get('/admin/profile');
        const a = res.data?.admin;
        const o = (a?.email && String(a.email).trim()) || (a?.username && String(a.username).trim()) || '';
        setOrganizerDefault(o);
      } catch {
        setOrganizerDefault('');
      }
    })();
  }, [open]);

  useEffect(() => {
    if (!open) {
      setTitle('');
      setAgenda('');
      setCaptureMode('live');
      setMeetingLink('');
      setHappeningNow(true);
      setError('');
      setPostSubmit(null);
      setCreatedMeetingId(null);
      setLoading(false);
      setSelectedClassroomId('');
    }
  }, [open]);

  if (!open) return null;

  const detected = detectConferenceProvider(meetingLink);
  const detectedLabel = detected ? conferenceProviderLabel(detected) : null;

  const runOnlineAssistantFlow = async (meetingId) => {
    if (!happeningNow) {
      setCreatedMeetingId(meetingId);
      setPostSubmit({ kind: 'scheduled_wait' });
      return;
    }
    try {
      await axios.patch(`/meetings/${meetingId}`, { conferenceBotStatus: 'joining' });
    } catch (_) {}
    setPostSubmit({ kind: 'joining' });
    await new Promise((r) => setTimeout(r, 1600));
    try {
      await axios.patch(`/meetings/${meetingId}`, { conferenceBotStatus: 'in_meeting' });
    } catch (_) {}
    setPostSubmit({ kind: 'joined' });
    await new Promise((r) => setTimeout(r, 900));
    onClose();
    navigate(`/meetings/${meetingId}`);
  };

  const submitLive = async () => {
    setError('');
    if (subscriptionGate === 'inactive' || subscriptionGate === 'payment_pending') {
      setError('Subscription required to create a meeting.');
      return;
    }
    if (isEducation && !selectedClassroomId) {
      setError('Select a classroom.');
      return;
    }
    if (!title.trim()) {
      setError('Meeting title is required.');
      return;
    }
    setLoading(true);
    try {
      let payloadParticipants = [];
      if (isEducation && selectedClassroomId) {
        const classroom = getClassrooms().find((c) => c.id === selectedClassroomId);
        payloadParticipants = (classroom?.studentEmails || []).map((email) => ({
          name: email.split('@')[0],
          email,
          role: 'participant',
        }));
      }

      const res = await axios.post(
        '/meetings',
        {
          title: title.trim(),
          agenda: agenda.trim() || undefined,
          organizer: organizerDefault || undefined,
          meetingRoom: 'Live recording',
          participants: payloadParticipants,
          sendNotification: payloadParticipants.length > 0,
        },
        { timeout: 30000 }
      );
      const id = res.data?.meeting?._id;
      onClose();
      navigate(`/meetings/${id}/room?autostart=1`);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Could not create meeting.');
    } finally {
      setLoading(false);
    }
  };

  const submitOnline = async () => {
    setError('');
    if (subscriptionGate === 'inactive' || subscriptionGate === 'payment_pending') {
      setError('Subscription required to create a meeting.');
      return;
    }
    if (!title.trim()) {
      setError('Meeting title is required.');
      return;
    }
    const link = meetingLink.trim();
    if (!link) {
      setError('Paste a meeting link.');
      return;
    }
    const prov = detectConferenceProvider(link);
    if (!prov) {
      setError('Use a Zoom or Teams meeting link.');
      return;
    }
    setLoading(true);
    try {
      let scheduledTimeValue;
      if (happeningNow) {
        scheduledTimeValue = new Date().toISOString();
      }

      const res = await axios.post(
        '/meetings',
        {
          title: title.trim(),
          agenda: agenda.trim() || undefined,
          organizer: organizerDefault || undefined,
          meetingRoom: 'Online meeting',
          conferenceJoinUrl: link,
          conferenceProvider: prov,
          scheduledTime: scheduledTimeValue,
          participants: [],
          sendNotification: false,
        },
        { timeout: 30000 }
      );
      const id = res.data?.meeting?._id;
      await runOnlineAssistantFlow(id);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Could not create meeting.');
    } finally {
      setLoading(false);
    }
  };

  const overlayClose = (e) => {
    if (e.target === e.currentTarget && !loading) onClose();
  };

  return (
    <div className="start-meeting-overlay" role="presentation" onMouseDown={overlayClose}>
      <div
        className="start-meeting-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="start-meeting-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="start-meeting-modal__head">
          <h2 id="start-meeting-title" className="start-meeting-modal__title">
            Start Meeting
          </h2>
          <button
            type="button"
            className="start-meeting-modal__close"
            onClick={() => !loading && onClose()}
            aria-label="Close"
          >
            <X size={18} strokeWidth={2} />
          </button>
        </div>

        {postSubmit?.kind === 'joining' && (
          <div className="start-meeting-status">
            <Bot className="start-meeting-btn__icon" size={28} strokeWidth={1.5} style={{ margin: '0 auto 12px', color: '#93c5fd' }} />
            <p className="start-meeting-status__title">Joining…</p>
          </div>
        )}

        {postSubmit?.kind === 'joined' && (
          <div className="start-meeting-status">
            <p className="start-meeting-status__title">Joined</p>
          </div>
        )}

        {postSubmit?.kind === 'scheduled_wait' && (
          <div className="start-meeting-status">
            <p className="start-meeting-status__title">Scheduled</p>
            <p className="start-meeting-status__sub">
              PortIQ Assistant will join when the meeting starts
            </p>
            <div className="start-meeting-actions" style={{ marginTop: 20 }}>
              <button
                type="button"
                className="start-meeting-btn start-meeting-btn--primary"
                onClick={() => {
                  const mid = createdMeetingId;
                  onClose();
                  navigate(mid ? `/meetings/${mid}` : '/meetings');
                }}
              >
                Done
              </button>
            </div>
          </div>
        )}

        {!postSubmit && (
          <>
            {isEducation && (
              <div className="start-meeting-field start-meeting-classroom">
                <label htmlFor="sm-classroom">Classroom</label>
                <select
                  id="sm-classroom"
                  value={selectedClassroomId}
                  onChange={(e) => setSelectedClassroomId(e.target.value)}
                >
                  <option value="">Select a classroom</option>
                  {getClassrooms().map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.className}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="start-meeting-field">
              <label htmlFor="sm-title">Meeting Title</label>
              <input
                id="sm-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={`Project review — ${companyName}`}
                required
                autoComplete="off"
              />
            </div>

            <div className="start-meeting-field">
              <label htmlFor="sm-agenda">Agenda (optional)</label>
              <textarea
                id="sm-agenda"
                value={agenda}
                onChange={(e) => setAgenda(e.target.value)}
                placeholder="Goals, topics, decisions…"
              />
            </div>

            <div className="start-meeting-section-label">How would you like to capture this meeting?</div>

            <button
              type="button"
              className={`start-meeting-option ${captureMode === 'live' ? 'start-meeting-option--active' : ''}`}
              onClick={() => setCaptureMode('live')}
            >
              <input type="radio" readOnly checked={captureMode === 'live'} tabIndex={-1} aria-hidden />
              <Mic size={18} strokeWidth={1.75} style={{ flexShrink: 0, color: '#a78bfa', marginTop: 2 }} />
              <div className="start-meeting-option__body">
                <strong>Record Live Meeting</strong>
                <span>Record and summarize an in-person or device-based meeting</span>
              </div>
            </button>

            <button
              type="button"
              className={`start-meeting-option ${captureMode === 'online' ? 'start-meeting-option--active' : ''}`}
              onClick={() => setCaptureMode('online')}
            >
              <input type="radio" readOnly checked={captureMode === 'online'} tabIndex={-1} aria-hidden />
              <Video size={18} strokeWidth={1.75} style={{ flexShrink: 0, color: '#38bdf8', marginTop: 2 }} />
              <div className="start-meeting-option__body">
                <strong>Join Online Meeting</strong>
                <span>Join a Zoom or Teams meeting using a link</span>
              </div>
            </button>

            {captureMode === 'online' && (
              <>
                <div className="start-meeting-field" style={{ marginTop: 16 }}>
                  <label htmlFor="sm-link">Meeting Link</label>
                  <input
                    id="sm-link"
                    value={meetingLink}
                    onChange={(e) => setMeetingLink(e.target.value)}
                    placeholder="Paste Zoom or Teams meeting link"
                    autoComplete="off"
                  />
                  {detectedLabel && (
                    <p className="start-meeting-detected">Detected: {detectedLabel}</p>
                  )}
                </div>
                <label className="start-meeting-checkbox">
                  <input
                    type="checkbox"
                    checked={happeningNow}
                    onChange={(e) => setHappeningNow(e.target.checked)}
                  />
                  <span>This meeting is happening now</span>
                </label>
              </>
            )}

            {error && <div className="start-meeting-error">{error}</div>}

            <div className="start-meeting-actions">
              {captureMode === 'live' ? (
                <button
                  type="button"
                  className="start-meeting-btn start-meeting-btn--primary"
                  onClick={submitLive}
                  disabled={loading}
                >
                  <Mic size={18} strokeWidth={1.75} />
                  Start Recording
                </button>
              ) : (
                <button
                  type="button"
                  className="start-meeting-btn start-meeting-btn--primary"
                  onClick={submitOnline}
                  disabled={loading || !detected}
                >
                  <Bot size={18} strokeWidth={1.75} />
                  Join with PortIQ Assistant
                </button>
              )}
              <button type="button" className="start-meeting-btn start-meeting-btn--ghost" onClick={onClose} disabled={loading}>
                Cancel
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import axios from 'axios';
import { X, Mic, Video, Bot, ExternalLink } from 'lucide-react';
import { isEducation } from '../config/product';
import { getClassrooms } from '../utils/classroomsStorage';
import { detectConferenceProvider, conferenceProviderLabel } from '../utils/detectConferenceLink';
import './StartMeetingModal.css';

function pad2(n) {
  return String(n).padStart(2, '0');
}

function defaultDateTimeLocal() {
  const t = new Date();
  t.setMinutes(t.getMinutes() + 30);
  t.setSeconds(0, 0);
  const d = `${t.getFullYear()}-${pad2(t.getMonth() + 1)}-${pad2(t.getDate())}`;
  const tm = `${pad2(t.getHours())}:${pad2(t.getMinutes())}`;
  return { date: d, time: tm };
}

export default function StartMeetingModal({
  open,
  onClose,
  companyName = 'Your Company',
  subscriptionGate,
  maxParticipantsPerMeeting = null,
}) {
  const navigate = useNavigate();
  const defaults = defaultDateTimeLocal();
  const [title, setTitle] = useState('');
  const [agenda, setAgenda] = useState('');
  const [scheduledDate, setScheduledDate] = useState(defaults.date);
  const [scheduledTime, setScheduledTime] = useState(defaults.time);
  const [organizer, setOrganizer] = useState('');
  const [liveLocation, setLiveLocation] = useState('');
  const [captureMode, setCaptureMode] = useState('live');
  const [meetingLink, setMeetingLink] = useState('');
  const [selectedClassroomId, setSelectedClassroomId] = useState('');
  /** Workplace: emails selected from participant book only */
  const [selectedBookEmails, setSelectedBookEmails] = useState([]);
  const [participantBook, setParticipantBook] = useState([]);
  const [participantBookError, setParticipantBookError] = useState('');
  const [authorizedEditorEmail, setAuthorizedEditorEmail] = useState('');
  const [sendNotification, setSendNotification] = useState(true);
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
        setOrganizer(o);
      } catch {
        setOrganizer('');
      }
      if (!isEducation) {
        setParticipantBookError('');
        try {
          const bookRes = await axios.get('/admin/participant-book');
          const list = bookRes.data?.participants || [];
          setParticipantBook(Array.isArray(list) ? list : []);
        } catch (e) {
          setParticipantBook([]);
          setParticipantBookError(
            e.response?.status === 403
              ? 'Participant book requires an active plan.'
              : 'Could not load participant book.'
          );
        }
      }
    })();
  }, [open]);

  useEffect(() => {
    if (!open) {
      const d = defaultDateTimeLocal();
      setTitle('');
      setAgenda('');
      setScheduledDate(d.date);
      setScheduledTime(d.time);
      setLiveLocation('');
      setCaptureMode('live');
      setMeetingLink('');
      setSelectedClassroomId('');
      setSelectedBookEmails([]);
      setParticipantBook([]);
      setParticipantBookError('');
      setAuthorizedEditorEmail('');
      setSendNotification(true);
      setError('');
      setPostSubmit(null);
      setCreatedMeetingId(null);
      setLoading(false);
    }
  }, [open]);

  if (!open) return null;

  const detected = detectConferenceProvider(meetingLink);
  const detectedLabel = detected ? conferenceProviderLabel(detected) : null;

  const scheduledIso = () => {
    if (!scheduledDate || !scheduledTime) return null;
    const iso = new Date(`${scheduledDate}T${scheduledTime}`).toISOString();
    return Number.isNaN(new Date(iso).getTime()) ? null : iso;
  };

  const payloadParticipants = () => {
    if (isEducation && selectedClassroomId) {
      const classroom = getClassrooms().find((c) => c.id === selectedClassroomId);
      return (classroom?.studentEmails || []).map((email) => ({
        name: email.split('@')[0],
        email: email.trim(),
        role: 'participant',
      }));
    }
    return selectedBookEmails.map((email) => {
      const em = String(email).trim().toLowerCase();
      const row = participantBook.find(
        (p) => p.email && String(p.email).trim().toLowerCase() === em
      );
      return {
        name: (row?.name && String(row.name).trim()) || em.split('@')[0] || '',
        email: em,
        role: 'participant',
      };
    });
  };

  const validateCommon = () => {
    if (!title.trim()) return 'Meeting title is required.';
    if (!agenda.trim()) return 'Agenda is required.';
    if (!scheduledDate || !scheduledTime) return 'Meeting date and time are required.';
    if (!scheduledIso()) return 'Invalid date or time.';
    if (!organizer.trim()) return 'Organizer is required.';
    const parts = payloadParticipants();
    if (parts.length === 0) {
      return isEducation
        ? 'Add at least one participant with an email.'
        : 'Select at least one participant from your participant book.';
    }
    if (maxParticipantsPerMeeting != null && parts.length > maxParticipantsPerMeeting) {
      return `Your plan allows up to ${maxParticipantsPerMeeting} participants per meeting.`;
    }
    if (!authorizedEditorEmail.trim()) return 'Authorized editor is required.';
    const editorLower = authorizedEditorEmail.trim().toLowerCase();
    const emails = parts.map((p) => p.email.toLowerCase());
    if (!emails.includes(editorLower)) return 'Authorized editor must be one of the participants.';
    if (isEducation && !selectedClassroomId) return 'Select a classroom.';
    return '';
  };

  const runOnlineAssistantFlow = async (meetingId) => {
    const st = scheduledIso();
    const startMs = st ? new Date(st).getTime() : 0;
    const soon = Date.now() + 90 * 1000;
    if (startMs > soon) {
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

  const buildBody = (extra) => ({
    title: title.trim(),
    agenda: agenda.trim(),
    organizer: organizer.trim(),
    scheduledTime: scheduledIso(),
    participants: payloadParticipants(),
    sendNotification,
    authorizedEditorEmail: authorizedEditorEmail.trim(),
    transcriptionEnabled: true,
    ...extra,
  });

  const submitLive = async () => {
    setError('');
    if (subscriptionGate === 'inactive' || subscriptionGate === 'payment_pending') {
      setError('Subscription required to create a meeting.');
      return;
    }
    const v = validateCommon();
    if (v) {
      setError(v);
      return;
    }
    if (!liveLocation.trim()) return setError('Location is required for a live meeting.');
    setLoading(true);
    try {
      const res = await axios.post('/meetings', buildBody({ meetingRoom: liveLocation.trim() }), {
        timeout: 30000,
      });
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
    const v = validateCommon();
    if (v) {
      setError(v);
      return;
    }
    const link = meetingLink.trim();
    if (!link) return setError('Paste a meeting link.');
    const prov = detectConferenceProvider(link);
    if (!prov) return setError('Use a Zoom or Teams meeting link.');
    setLoading(true);
    try {
      const res = await axios.post(
        '/meetings',
        buildBody({
          meetingRoom: 'Online meeting',
          conferenceJoinUrl: link,
          conferenceProvider: prov,
        }),
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

  const editorOptions = payloadParticipants();

  const toggleBookParticipant = (email) => {
    const em = String(email).trim().toLowerCase();
    if (!em) return;
    setSelectedBookEmails((prev) => {
      if (prev.includes(em)) {
        setAuthorizedEditorEmail((cur) =>
          cur.trim().toLowerCase() === em ? '' : cur
        );
        return prev.filter((x) => x !== em);
      }
      if (maxParticipantsPerMeeting != null && prev.length >= maxParticipantsPerMeeting) {
        return prev;
      }
      return [...prev, em];
    });
  };

  const overlayClose = (e) => {
    if (e.target === e.currentTarget && !loading) onClose();
  };

  return (
    <div className="start-meeting-overlay" role="presentation" onMouseDown={overlayClose}>
      <div
        className="start-meeting-modal start-meeting-modal--wide"
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
            <Bot size={28} strokeWidth={1.5} style={{ margin: '0 auto 12px', color: '#93c5fd' }} />
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
            <div className="start-meeting-section-label start-meeting-section-label--first">
              How would you like to capture this meeting?
            </div>

            <button
              type="button"
              className={`start-meeting-option ${captureMode === 'live' ? 'start-meeting-option--active' : ''}`}
              onClick={() => setCaptureMode('live')}
            >
              <input type="radio" readOnly checked={captureMode === 'live'} tabIndex={-1} aria-hidden />
              <Mic size={18} strokeWidth={1.75} style={{ flexShrink: 0, color: '#a78bfa', marginTop: 2 }} />
              <div className="start-meeting-option__body">
                <strong>Record live meeting</strong>
                <span>In-person or device recording</span>
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
                <strong>Online meeting</strong>
                <span>Add a Zoom or Teams link below</span>
              </div>
            </button>

            {isEducation && (
              <div className="start-meeting-field start-meeting-classroom" style={{ marginTop: 16 }}>
                <label htmlFor="sm-classroom">Classroom</label>
                <select
                  id="sm-classroom"
                  value={selectedClassroomId}
                  onChange={(e) => setSelectedClassroomId(e.target.value)}
                  required
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

            <div className="start-meeting-field" style={{ marginTop: 16 }}>
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
              <label htmlFor="sm-agenda">Agenda</label>
              <textarea
                id="sm-agenda"
                value={agenda}
                onChange={(e) => setAgenda(e.target.value)}
                placeholder="Goals, topics, decisions…"
                required
              />
            </div>

            <div className="start-meeting-datetime-row">
              <div className="start-meeting-field">
                <label htmlFor="sm-date">Date</label>
                <input
                  id="sm-date"
                  type="date"
                  value={scheduledDate}
                  onChange={(e) => setScheduledDate(e.target.value)}
                  required
                />
              </div>
              <div className="start-meeting-field">
                <label htmlFor="sm-time">Time</label>
                <input
                  id="sm-time"
                  type="time"
                  value={scheduledTime}
                  onChange={(e) => setScheduledTime(e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="start-meeting-field">
              <label htmlFor="sm-organizer">Organizer</label>
              <input
                id="sm-organizer"
                value={organizer}
                onChange={(e) => setOrganizer(e.target.value)}
                placeholder="Name or email"
                required
                autoComplete="off"
              />
            </div>

            {captureMode === 'live' && (
              <div className="start-meeting-field">
                <label htmlFor="sm-location">Location</label>
                <input
                  id="sm-location"
                  value={liveLocation}
                  onChange={(e) => setLiveLocation(e.target.value)}
                  placeholder="e.g. Conference Room A"
                  required
                />
              </div>
            )}

            {captureMode === 'online' && (
              <div className="start-meeting-field">
                <label htmlFor="sm-link">Zoom or Teams meeting link</label>
                <input
                  id="sm-link"
                  value={meetingLink}
                  onChange={(e) => setMeetingLink(e.target.value)}
                  placeholder="Paste meeting link"
                  autoComplete="off"
                />
                {detectedLabel && <p className="start-meeting-detected">Detected: {detectedLabel}</p>}
              </div>
            )}

            {!isEducation && (
              <>
                <div className="start-meeting-section-label" style={{ marginTop: 16 }}>
                  Participants
                </div>
                <p className="start-meeting-field-hint">
                  Select people from your participant book (no manual entry here).
                </p>
                {participantBookError && (
                  <p className="start-meeting-field-hint start-meeting-field-hint--warn">
                    {participantBookError}{' '}
                    <Link to="/participants" className="start-meeting-inline-link" onClick={onClose}>
                      Participant book
                    </Link>
                  </p>
                )}
                {!participantBookError && participantBook.length === 0 && (
                  <p className="start-meeting-field-hint">
                    Your book is empty.{' '}
                    <Link to="/participants" className="start-meeting-inline-link" onClick={onClose}>
                      Add people in Participant book
                    </Link>
                  </p>
                )}
                {participantBook.length > 0 && (
                  <div className="start-meeting-book-list">
                    {participantBook.map((p) => {
                      const em = (p.email && String(p.email).trim().toLowerCase()) || '';
                      if (!em) return null;
                      const checked = selectedBookEmails.includes(em);
                      return (
                        <label
                          key={em}
                          className={`start-meeting-book-row${checked ? ' start-meeting-book-row--checked' : ''}`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleBookParticipant(em)}
                          />
                          <span className="start-meeting-book-row__text">
                            <span className="start-meeting-book-name">{p.name || em.split('@')[0]}</span>
                            <span className="start-meeting-book-email">{em}</span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                )}
                <Link to="/participants" className="start-meeting-book-manage" onClick={onClose}>
                  <ExternalLink size={14} aria-hidden />
                  Manage participant book
                </Link>
                {maxParticipantsPerMeeting != null && (
                  <p className="start-meeting-field-hint">
                    Up to {maxParticipantsPerMeeting} participants per meeting on your plan.
                  </p>
                )}
              </>
            )}

            <div className="start-meeting-field" style={{ marginTop: 16 }}>
              <label htmlFor="sm-editor">Authorized editor</label>
              <select
                id="sm-editor"
                value={authorizedEditorEmail}
                onChange={(e) => setAuthorizedEditorEmail(e.target.value)}
                required
              >
                <option value="">Select a participant</option>
                {editorOptions.map((p) => (
                  <option key={p.email} value={p.email}>
                    {(p.name || p.email) + ` (${p.email})`}
                  </option>
                ))}
              </select>
              <p className="start-meeting-field-hint">Must be one of the selected participants.</p>
            </div>

            <label className="start-meeting-checkbox">
              <input
                type="checkbox"
                checked={sendNotification}
                onChange={(e) => setSendNotification(e.target.checked)}
              />
              <span>Send email notification to participants when the meeting is created</span>
            </label>

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
              <button
                type="button"
                className="start-meeting-btn start-meeting-btn--ghost"
                onClick={onClose}
                disabled={loading}
              >
                Cancel
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

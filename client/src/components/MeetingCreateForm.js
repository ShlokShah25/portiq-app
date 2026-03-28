import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import axios from 'axios';
import {
  X,
  Mic,
  Bot,
  ExternalLink,
  FileText,
  List,
  Calendar,
  Clock,
  User,
  MapPin,
  Link2,
  Users,
  CheckCircle2,
  CircleDashed,
  GraduationCap,
  UserCheck,
  Video,
  Square,
  Mail,
  BookUser,
} from 'lucide-react';
import { isEducation } from '../config/product';
import { getClassrooms } from '../utils/classroomsStorage';
import { detectConferenceProvider, conferenceProviderLabel } from '../utils/detectConferenceLink';
import {
  VOICE_ENROLLMENT_API_TEMPLATE,
  voiceEnrollmentSentenceForParticipant,
} from '../utils/voiceEnrollment';
import './StartMeetingModal.css';

function FieldLabel({ htmlFor, icon: Icon, children }) {
  return (
    <label className="start-meeting-label-with-icon" htmlFor={htmlFor}>
      {Icon ? (
        <Icon className="start-meeting-label-with-icon__ic" size={16} strokeWidth={1.75} aria-hidden />
      ) : null}
      <span>{children}</span>
    </label>
  );
}

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

function resetAllState(setters) {
  const d = defaultDateTimeLocal();
  setters.setTitle('');
  setters.setAgenda('');
  setters.setScheduledDate(d.date);
  setters.setScheduledTime(d.time);
  setters.setLiveLocation('');
  setters.setCaptureMode('live');
  setters.setMeetingLink('');
  setters.setSelectedClassroomId('');
  setters.setSelectedBookEmails([]);
  setters.setParticipantBook([]);
  setters.setParticipantBookError('');
  setters.setAuthorizedEditorEmail('');
  setters.setSendNotification(true);
  setters.setError('');
  setters.setPostSubmit(null);
  setters.setCreatedMeetingId(null);
  setters.setLoading(false);
}

/**
 * Shared new-meeting form — inline on Meetings page or inside StartMeetingModal.
 */
export default function MeetingCreateForm({
  inline = false,
  /** When false (e.g. modal closed), reset and skip data fetch */
  active = true,
  companyName = 'Your Company',
  subscriptionGate,
  maxParticipantsPerMeeting = null,
  onClose,
  onMeetingCreated,
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
  const [selectedBookEmails, setSelectedBookEmails] = useState([]);
  const [participantBook, setParticipantBook] = useState([]);
  const [participantBookError, setParticipantBookError] = useState('');
  const [authorizedEditorEmail, setAuthorizedEditorEmail] = useState('');
  const [sendNotification, setSendNotification] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [postSubmit, setPostSubmit] = useState(null);
  const [createdMeetingId, setCreatedMeetingId] = useState(null);
  const [voiceProfiles, setVoiceProfiles] = useState({});
  const [recordingEmail, setRecordingEmail] = useState(null);
  const [voiceUploading, setVoiceUploading] = useState(false);
  const voiceRecorderRef = useRef(null);

  const runReset = useCallback(() => {
    try {
      if (voiceRecorderRef.current && voiceRecorderRef.current.state !== 'inactive') {
        voiceRecorderRef.current.stop();
      }
    } catch (_) {}
    voiceRecorderRef.current = null;
    setRecordingEmail(null);
    setVoiceUploading(false);
    setVoiceProfiles({});
    resetAllState({
      setTitle,
      setAgenda,
      setScheduledDate,
      setScheduledTime,
      setLiveLocation,
      setCaptureMode,
      setMeetingLink,
      setSelectedClassroomId,
      setSelectedBookEmails,
      setParticipantBook,
      setParticipantBookError,
      setAuthorizedEditorEmail,
      setSendNotification,
      setError,
      setPostSubmit,
      setCreatedMeetingId,
      setLoading,
    });
  }, []);

  useEffect(() => {
    if (!active) {
      runReset();
    }
  }, [active, runReset]);

  useEffect(() => {
    if (!active) return;
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
  }, [active]);

  useEffect(() => {
    if (!active || isEducation) {
      setVoiceProfiles({});
      return;
    }
    if (!participantBook.length) {
      setVoiceProfiles({});
      return;
    }
    const emails = participantBook
      .map((p) => String(p.email || '').trim().toLowerCase())
      .filter(Boolean);
    if (!emails.length) return;
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
            (pr) => pr.email && String(pr.email).trim().toLowerCase() === email
          );
          next[email] = { hasProfile: !!profile };
        });
        if (!cancelled) setVoiceProfiles(next);
      } catch {
        if (!cancelled) setVoiceProfiles({});
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [active, participantBook, isEducation]);

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
    const editorTrim = authorizedEditorEmail.trim();
    if (editorTrim) {
      const editorLower = editorTrim.toLowerCase();
      const emails = parts.map((p) => p.email.toLowerCase());
      if (!emails.includes(editorLower)) {
        return 'Authorized editor must be one of the selected participants.';
      }
    }
    if (isEducation && !selectedClassroomId) return 'Select a classroom.';
    return '';
  };

  const afterCreate = () => {
    onMeetingCreated?.();
  };

  const runOnlineAssistantFlow = async (meetingId) => {
    const st = scheduledIso();
    const startMs = st ? new Date(st).getTime() : 0;
    const soon = Date.now() + 90 * 1000;
    if (startMs > soon) {
      setCreatedMeetingId(meetingId);
      setPostSubmit({ kind: 'scheduled_wait' });
      afterCreate();
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
    navigate(`/meetings/${meetingId}`);
    afterCreate();
    if (onClose) onClose();
  };

  const buildBody = (extra) => ({
    title: title.trim(),
    agenda: agenda.trim(),
    organizer: organizer.trim(),
    scheduledTime: scheduledIso(),
    participants: payloadParticipants(),
    sendNotification,
    authorizedEditorEmail: authorizedEditorEmail.trim() || undefined,
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
      const raw = res.data?.meeting;
      const id = raw?._id ?? raw?.id;
      const idStr = id != null ? String(id) : '';
      if (!idStr) {
        setError('Meeting was created but the app did not receive a meeting id. Open it from the Scheduled list.');
        return;
      }
      navigate(`/meetings/${idStr}/room?autostart=1`);
      afterCreate();
      if (onClose) onClose();
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
      const raw = res.data?.meeting;
      const id = raw?._id ?? raw?.id;
      const idStr = id != null ? String(id) : '';
      if (!idStr) {
        setError('Meeting was created but the app did not receive a meeting id. Open it from the Scheduled list.');
        return;
      }
      await runOnlineAssistantFlow(idStr);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Could not create meeting.');
    } finally {
      setLoading(false);
    }
  };

  const editorOptions = payloadParticipants();

  const onParticipantMultiselectChange = (e) => {
    let next = Array.from(e.target.selectedOptions, (o) => o.value);
    if (maxParticipantsPerMeeting != null && next.length > maxParticipantsPerMeeting) {
      next = next.slice(0, maxParticipantsPerMeeting);
      setError(`Your plan allows up to ${maxParticipantsPerMeeting} participants per meeting.`);
    } else {
      setError((cur) =>
        /^Your plan allows up to \d+ participants per meeting\.$/.test(String(cur)) ? '' : cur
      );
    }
    setSelectedBookEmails(next);
    setAuthorizedEditorEmail((cur) => {
      const c = cur.trim().toLowerCase();
      return c && next.includes(c) ? cur : '';
    });
  };

  const uploadVoiceSample = async (audioBlob, targetParticipant) => {
    try {
      setVoiceUploading(true);
      setError('');
      const participantList = participantBook
        .filter((p) => p.email && String(p.email).trim())
        .map((p) => ({ name: p.name || '', email: String(p.email).trim() }));
      const formData = new FormData();
      const audioFile = new File([audioBlob], `voice-sample-${Date.now()}.webm`, {
        type: 'audio/webm',
      });
      formData.append('audio', audioFile);
      formData.append('participants', JSON.stringify(participantList));
      formData.append('standardSentence', VOICE_ENROLLMENT_API_TEMPLATE);
      if (targetParticipant?.email) {
        formData.append('email', String(targetParticipant.email).trim());
        if (targetParticipant.name) formData.append('name', String(targetParticipant.name));
      }
      const res = await axios.post('/meetings/voice/register', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const matched = res.data?.voiceProfile?.email;
      if (matched) {
        const key = String(matched).trim().toLowerCase();
        setVoiceProfiles((prev) => ({ ...prev, [key]: { hasProfile: true } }));
      }
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Voice upload failed.');
    } finally {
      setVoiceUploading(false);
      setRecordingEmail(null);
      voiceRecorderRef.current = null;
    }
  };

  const startVoiceRecording = async (participant) => {
    const em = String(participant?.email || '').trim().toLowerCase();
    if (!em || formDisabled) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      const audioChunks = [];
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunks.push(event.data);
      };
      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
        stream.getTracks().forEach((t) => t.stop());
        await uploadVoiceSample(audioBlob, participant);
      };
      mediaRecorder.start();
      voiceRecorderRef.current = mediaRecorder;
      setRecordingEmail(em);
    } catch (err) {
      console.error(err);
      setError('Unable to access microphone. Check browser permissions.');
    }
  };

  const stopVoiceRecording = () => {
    const rec = voiceRecorderRef.current;
    if (rec && rec.state !== 'inactive') rec.stop();
  };

  const linkClose = onClose || undefined;

  if (!active) return null;

  const formDisabled =
    subscriptionGate === null || subscriptionGate === 'inactive' || subscriptionGate === 'payment_pending';

  return (
    <div className={inline ? 'meetings-inline-meeting-form' : undefined}>
      {!inline && (
        <div className="start-meeting-modal__head">
          <h2 id="start-meeting-title" className="start-meeting-modal__title">
            Start Meeting
          </h2>
          <button
            type="button"
            className="start-meeting-modal__close"
            onClick={() => !loading && onClose?.()}
            aria-label="Close"
          >
            <X size={18} strokeWidth={2} />
          </button>
        </div>
      )}

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
                runReset();
                if (onClose) onClose();
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
          <div className="meeting-create-segment" role="group" aria-label="Meeting capture type">
            <button
              type="button"
              className={captureMode === 'live' ? 'active' : ''}
              onClick={() => setCaptureMode('live')}
            >
              <Mic size={14} strokeWidth={1.75} aria-hidden />
              Live
            </button>
            <button
              type="button"
              className={captureMode === 'online' ? 'active' : ''}
              onClick={() => setCaptureMode('online')}
            >
              <Video size={14} strokeWidth={1.75} aria-hidden />
              Online
            </button>
          </div>

          {isEducation && (
            <div className="start-meeting-field start-meeting-classroom" style={{ marginTop: 4 }}>
              <FieldLabel htmlFor="sm-classroom" icon={GraduationCap}>
                Classroom
              </FieldLabel>
              <select
                id="sm-classroom"
                value={selectedClassroomId}
                onChange={(e) => setSelectedClassroomId(e.target.value)}
                required
                disabled={formDisabled}
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
            <FieldLabel htmlFor="sm-title" icon={FileText}>
              Meeting title
            </FieldLabel>
            <input
              id="sm-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={`Project review — ${companyName}`}
              required
              autoComplete="off"
              disabled={formDisabled}
            />
          </div>

          <div className="start-meeting-field">
            <FieldLabel htmlFor="sm-agenda" icon={List}>
              Agenda
            </FieldLabel>
            <textarea
              id="sm-agenda"
              value={agenda}
              onChange={(e) => setAgenda(e.target.value)}
              placeholder="Goals, topics, decisions…"
              required
              disabled={formDisabled}
            />
          </div>

          <div className="start-meeting-datetime-row">
            <div className="start-meeting-field">
              <FieldLabel htmlFor="sm-date" icon={Calendar}>
                Date
              </FieldLabel>
              <input
                id="sm-date"
                type="date"
                value={scheduledDate}
                onChange={(e) => setScheduledDate(e.target.value)}
                required
                disabled={formDisabled}
              />
            </div>
            <div className="start-meeting-field">
              <FieldLabel htmlFor="sm-time" icon={Clock}>
                Time
              </FieldLabel>
              <input
                id="sm-time"
                type="time"
                value={scheduledTime}
                onChange={(e) => setScheduledTime(e.target.value)}
                required
                disabled={formDisabled}
              />
            </div>
          </div>

          <div className="start-meeting-field">
            <FieldLabel htmlFor="sm-organizer" icon={User}>
              Organizer
            </FieldLabel>
            <input
              id="sm-organizer"
              value={organizer}
              onChange={(e) => setOrganizer(e.target.value)}
              placeholder="Name or email"
              required
              autoComplete="off"
              disabled={formDisabled}
            />
          </div>

          {captureMode === 'live' && (
            <div className="start-meeting-field">
              <FieldLabel htmlFor="sm-location" icon={MapPin}>
                Location
              </FieldLabel>
              <input
                id="sm-location"
                value={liveLocation}
                onChange={(e) => setLiveLocation(e.target.value)}
                placeholder="e.g. Conference Room A"
                required
                disabled={formDisabled}
              />
            </div>
          )}

          {captureMode === 'online' && (
            <div className="start-meeting-field">
              <FieldLabel htmlFor="sm-link" icon={Link2}>
                Zoom or Teams meeting link
              </FieldLabel>
              <input
                id="sm-link"
                value={meetingLink}
                onChange={(e) => setMeetingLink(e.target.value)}
                placeholder="Paste meeting link"
                autoComplete="off"
                disabled={formDisabled}
              />
              {detectedLabel && <p className="start-meeting-detected">Detected: {detectedLabel}</p>}
            </div>
          )}

          {!isEducation && (
            <>
              <div className="start-meeting-section-label start-meeting-section-label--row" style={{ marginTop: 8 }}>
                <Users size={16} strokeWidth={1.75} className="start-meeting-section-label__ic" aria-hidden />
                Participants
              </div>
              <p className="start-meeting-field-hint">
                Choose from your participant book (hold ⌘ or Ctrl to select multiple). Options show voice enrollment
                status.
              </p>
              {participantBookError && (
                <p className="start-meeting-field-hint start-meeting-field-hint--warn">
                  {participantBookError}{' '}
                  <Link to="/participants" className="start-meeting-inline-link" onClick={linkClose}>
                    Participant book
                  </Link>
                </p>
              )}
              {!participantBookError && participantBook.length === 0 && (
                <p className="start-meeting-field-hint">
                  Your book is empty.{' '}
                  <Link to="/participants" className="start-meeting-inline-link" onClick={linkClose}>
                    Add people in Participant book
                  </Link>
                </p>
              )}
              {participantBook.length > 0 && (
                <div className="start-meeting-field" style={{ marginBottom: 12 }}>
                  <FieldLabel htmlFor="sm-participants" icon={BookUser}>
                    Participant book
                  </FieldLabel>
                  <select
                    id="sm-participants"
                    multiple
                    className="meeting-create-participant-multiselect"
                    value={selectedBookEmails}
                    onChange={onParticipantMultiselectChange}
                    disabled={formDisabled}
                    size={Math.min(10, Math.max(4, participantBook.length))}
                    aria-describedby="sm-participants-hint"
                  >
                    {participantBook.map((p) => {
                      const em = (p.email && String(p.email).trim().toLowerCase()) || '';
                      if (!em) return null;
                      const hasVoice = !!voiceProfiles[em]?.hasProfile;
                      const label = `${p.name || em.split('@')[0]} — ${em} · ${hasVoice ? 'Voice configured' : 'Voice not configured'}`;
                      return (
                        <option key={em} value={em}>
                          {label}
                        </option>
                      );
                    })}
                  </select>
                  <p id="sm-participants-hint" className="start-meeting-field-hint">
                    Selected: {selectedBookEmails.length}
                    {maxParticipantsPerMeeting != null ? ` / max ${maxParticipantsPerMeeting}` : ''}
                  </p>
                </div>
              )}
              {selectedBookEmails.length > 0 && participantBook.length > 0 && (
                <div className="meeting-create-voice-block">
                  <div className="start-meeting-section-label start-meeting-section-label--row">
                    <Mic size={16} strokeWidth={1.75} className="start-meeting-section-label__ic" aria-hidden />
                    Voice samples
                  </div>
                  <p className="start-meeting-field-hint">
                    Record the standard phrase for each selected participant (same as Participant book). This helps
                    speaker recognition in transcripts.
                  </p>
                  {selectedBookEmails.map((em) => {
                    const p = participantBook.find(
                      (x) => x.email && String(x.email).trim().toLowerCase() === em
                    );
                    if (!p) return null;
                    const hasVoice = !!voiceProfiles[em]?.hasProfile;
                    const rec = recordingEmail === em;
                    const participantPayload = {
                      name: (p.name && String(p.name).trim()) || em.split('@')[0] || '',
                      email: em,
                    };
                    return (
                      <div key={em} className="meeting-create-voice-row">
                        <div className="meeting-create-voice-row__head">
                          <span className="meeting-create-voice-row__name">{p.name || em}</span>
                          {hasVoice ? (
                            <span className="meeting-create-voice-row__badge meeting-create-voice-row__badge--ok">
                              <CheckCircle2 size={14} aria-hidden /> Configured
                            </span>
                          ) : (
                            <span className="meeting-create-voice-row__badge">
                              <CircleDashed size={14} aria-hidden /> Not configured
                            </span>
                          )}
                        </div>
                        <p className="meeting-create-voice-row__phrase">
                          {voiceEnrollmentSentenceForParticipant(participantPayload.name)}
                        </p>
                        <div className="meeting-create-voice-row__actions">
                          {!rec ? (
                            <button
                              type="button"
                              className="start-meeting-btn start-meeting-btn--ghost meeting-create-voice-btn"
                              disabled={formDisabled || voiceUploading}
                              onClick={() => startVoiceRecording(participantPayload)}
                            >
                              <Mic size={16} aria-hidden />
                              {hasVoice ? 'Re-record voice' : 'Configure voice'}
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="start-meeting-btn start-meeting-btn--primary meeting-create-voice-btn"
                              onClick={stopVoiceRecording}
                              disabled={voiceUploading}
                            >
                              <Square size={14} aria-hidden />
                              Stop & upload
                            </button>
                          )}
                          {rec && <span className="meeting-create-voice-row__rec">Recording…</span>}
                          {voiceUploading && recordingEmail === em && (
                            <span className="meeting-create-voice-row__rec">Uploading…</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              <Link to="/participants" className="start-meeting-book-manage" onClick={linkClose}>
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

          <div className="start-meeting-field" style={{ marginTop: 12 }}>
            <FieldLabel htmlFor="sm-editor" icon={UserCheck}>
              Authorized editor (optional)
            </FieldLabel>
            <select
              id="sm-editor"
              value={authorizedEditorEmail}
              onChange={(e) => setAuthorizedEditorEmail(e.target.value)}
              disabled={formDisabled}
            >
              <option value="">No authorized editor</option>
              {editorOptions.map((p) => (
                <option key={p.email} value={p.email}>
                  {(p.name || p.email) + ` (${p.email})`}
                </option>
              ))}
            </select>
            <p className="start-meeting-field-hint">
              Leave blank or pick someone from the participant list. If you pick someone, they must be a selected
              participant.
            </p>
          </div>

          <label className="start-meeting-checkbox start-meeting-checkbox--with-icon">
            <Mail size={16} strokeWidth={1.75} className="start-meeting-checkbox__ic" aria-hidden />
            <input
              type="checkbox"
              checked={sendNotification}
              onChange={(e) => setSendNotification(e.target.checked)}
              disabled={formDisabled}
            />
            <span>Send email notification to participants when the meeting is created</span>
          </label>

          {error && <div className="start-meeting-error">{error}</div>}

          <div className={`start-meeting-actions${inline ? ' start-meeting-actions--inline' : ''}`}>
            {captureMode === 'live' ? (
              <button
                type="button"
                className="start-meeting-btn start-meeting-btn--primary"
                onClick={submitLive}
                disabled={loading || formDisabled}
              >
                Start Meeting
              </button>
            ) : (
              <button
                type="button"
                className="start-meeting-btn start-meeting-btn--primary"
                onClick={submitOnline}
                disabled={loading || !detected || formDisabled}
              >
                <Bot size={18} strokeWidth={1.75} />
                Join with PortIQ Assistant
              </button>
            )}
            {!inline && (
              <button
                type="button"
                className="start-meeting-btn start-meeting-btn--ghost"
                onClick={onClose}
                disabled={loading}
              >
                Cancel
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

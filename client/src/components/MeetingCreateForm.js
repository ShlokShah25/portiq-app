import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import axios from 'axios';
import {
  X,
  Mic,
  ExternalLink,
  FileText,
  Calendar,
  Clock,
  User,
  MapPin,
  Users,
  CircleDashed,
  GraduationCap,
  UserCheck,
  Square,
  Mail,
  BookUser,
  ChevronDown,
  Search,
} from 'lucide-react';
import { isEducation } from '../config/product';
import { getClassrooms } from '../utils/classroomsStorage';
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

function splitTitleAgenda(raw) {
  const s = String(raw || '').trim();
  if (!s) return { title: '', agenda: '' };
  const nl = s.indexOf('\n');
  if (nl === -1) return { title: s, agenda: s };
  const title = s.slice(0, nl).trim();
  const rest = s.slice(nl + 1).trim();
  const agenda = rest || title;
  return { title: title || s, agenda };
}

function resetAllState(setters) {
  const d = defaultDateTimeLocal();
  setters.setTitleAgendaCombined('');
  setters.setScheduledDate(d.date);
  setters.setScheduledTime(d.time);
  setters.setLiveLocation('');
  setters.setSelectedClassroomId('');
  setters.setSelectedBookEmails([]);
  setters.setParticipantBook([]);
  setters.setParticipantBookError('');
  setters.setAuthorizedEditorEmail('');
  setters.setSendNotification(true);
  setters.setError('');
  setters.setLoading(false);
  setters.setVoiceRecognitionEnabled(false);
  if (setters.setOptionalDetailsOpen) setters.setOptionalDetailsOpen(false);
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
  const [titleAgendaCombined, setTitleAgendaCombined] = useState('');
  const [scheduledDate, setScheduledDate] = useState(defaults.date);
  const [scheduledTime, setScheduledTime] = useState(defaults.time);
  const [organizer, setOrganizer] = useState('');
  const [liveLocation, setLiveLocation] = useState('');
  const [selectedClassroomId, setSelectedClassroomId] = useState('');
  const [selectedBookEmails, setSelectedBookEmails] = useState([]);
  const [participantBook, setParticipantBook] = useState([]);
  const [participantBookError, setParticipantBookError] = useState('');
  const [authorizedEditorEmail, setAuthorizedEditorEmail] = useState('');
  const [sendNotification, setSendNotification] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [voiceProfiles, setVoiceProfiles] = useState({});
  const [recordingEmail, setRecordingEmail] = useState(null);
  const [voiceUploading, setVoiceUploading] = useState(false);
  const voiceRecorderRef = useRef(null);
  const [voiceRecognitionEnabled, setVoiceRecognitionEnabled] = useState(false);
  const [participantDropdownOpen, setParticipantDropdownOpen] = useState(false);
  const [participantSearchQuery, setParticipantSearchQuery] = useState('');
  const participantDropdownRef = useRef(null);
  const [optionalDetailsOpen, setOptionalDetailsOpen] = useState(false);

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
      setTitleAgendaCombined,
      setScheduledDate,
      setScheduledTime,
      setLiveLocation,
      setSelectedClassroomId,
      setSelectedBookEmails,
      setParticipantBook,
      setParticipantBookError,
      setAuthorizedEditorEmail,
      setSendNotification,
      setError,
      setLoading,
      setVoiceRecognitionEnabled,
      setOptionalDetailsOpen,
    });
    setParticipantDropdownOpen(false);
    setParticipantSearchQuery('');
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

  useEffect(() => {
    if (!participantDropdownOpen) return;
    const onDoc = (e) => {
      if (participantDropdownRef.current && !participantDropdownRef.current.contains(e.target)) {
        setParticipantDropdownOpen(false);
      }
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setParticipantDropdownOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [participantDropdownOpen]);

  useEffect(() => {
    if (selectedBookEmails.length === 0) {
      setVoiceRecognitionEnabled(false);
    }
  }, [selectedBookEmails.length]);

  const filteredParticipantBook = useMemo(() => {
    const q = participantSearchQuery.trim().toLowerCase();
    if (!q) return participantBook;
    return participantBook.filter((p) => {
      const em = (p.email && String(p.email).toLowerCase()) || '';
      const nm = (p.name && String(p.name).toLowerCase()) || '';
      return em.includes(q) || nm.includes(q);
    });
  }, [participantBook, participantSearchQuery]);

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

  const buildBody = (extra) => {
    const { title, agenda } = splitTitleAgenda(titleAgendaCombined);
    const fallback = `Session · ${scheduledDate} ${scheduledTime}`;
    const effTitle = (title.trim() || fallback).slice(0, 500);
    const effAgenda = (agenda.trim() || title.trim() || fallback).slice(0, 8000);
    const room = liveLocation.trim() || 'Live recording';
    return {
      title: effTitle,
      agenda: effAgenda,
      organizer: organizer.trim(),
      scheduledTime: scheduledIso(),
      participants: payloadParticipants(),
      sendNotification,
      authorizedEditorEmail: authorizedEditorEmail.trim() || undefined,
      transcriptionEnabled: true,
      meetingRoom: room,
      ...extra,
    };
  };

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
    setLoading(true);
    try {
      const res = await axios.post('/meetings', buildBody(), {
        timeout: 30000,
      });
      const raw = res.data?.meeting;
      const id = raw?._id ?? raw?.id;
      const idStr = id != null ? String(id) : '';
      if (!idStr) {
        setError('Meeting was created but the app did not receive a meeting id. Open it from the Scheduled list.');
        return;
      }
      navigate(`/meetings/${idStr}`);
      afterCreate();
      if (onClose) onClose();
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Could not create meeting.');
    } finally {
      setLoading(false);
    }
  };

  const editorOptions = payloadParticipants();

  const toggleBookParticipantEmail = (email) => {
    const em = String(email).trim().toLowerCase();
    if (!em) return;
    setSelectedBookEmails((prev) => {
      if (prev.includes(em)) {
        setAuthorizedEditorEmail((cur) => (cur.trim().toLowerCase() === em ? '' : cur));
        return prev.filter((x) => x !== em);
      }
      let next = [...prev, em];
      if (maxParticipantsPerMeeting != null && next.length > maxParticipantsPerMeeting) {
        next = next.slice(0, maxParticipantsPerMeeting);
        setError(`Your plan allows up to ${maxParticipantsPerMeeting} participants per meeting.`);
      } else {
        setError((cur) =>
          /^Your plan allows up to \d+ participants per meeting\.$/.test(String(cur)) ? '' : cur
        );
      }
      return next;
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
      const d = err.response?.data;
      setError(
        [d?.error, d?.details].filter(Boolean).join(' — ') ||
          err.message ||
          'Voice upload failed.'
      );
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
            {isEducation ? 'Create lecture' : 'Create meeting'}
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

      <>
              <div className="meeting-create-primary-block">
                <div className="start-meeting-field" style={{ marginTop: isEducation ? 4 : 0 }}>
                  <FieldLabel htmlFor="sm-title-agenda" icon={FileText}>
                    {isEducation ? 'Lecture title & notes' : 'Meeting title & agenda'}
                  </FieldLabel>
                  <textarea
                    id="sm-title-agenda"
                    className="meeting-create-title-agenda-single"
                    value={titleAgendaCombined}
                    onChange={(e) => setTitleAgendaCombined(e.target.value)}
                    placeholder={`First line: title (e.g. Project review — ${companyName}).\nFollowing lines: agenda, topics, decisions…`}
                    rows={3}
                    autoComplete="off"
                    disabled={formDisabled}
                  />
                </div>

                {isEducation && (
                  <div className="start-meeting-field start-meeting-classroom">
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

          {!isEducation && (
            <>
              <div className="start-meeting-section-label start-meeting-section-label--row" style={{ marginTop: 8 }}>
                <Users size={16} strokeWidth={1.75} className="start-meeting-section-label__ic" aria-hidden />
                Participants
              </div>
              <p className="start-meeting-field-hint">
                Search and select people from your book — name and email are used for the meeting. Voice is optional and
                can be set later.
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
                  <FieldLabel htmlFor="sm-participants-trigger" icon={BookUser}>
                    Participant book
                  </FieldLabel>
                  <div className="meeting-create-participant-dd" ref={participantDropdownRef}>
                    <button
                      id="sm-participants-trigger"
                      type="button"
                      className="meeting-create-participant-dd__trigger"
                      onClick={() => setParticipantDropdownOpen((o) => !o)}
                      disabled={formDisabled}
                      aria-expanded={participantDropdownOpen}
                      aria-haspopup="listbox"
                    >
                      <span className="meeting-create-participant-dd__trigger-text">
                        {selectedBookEmails.length === 0
                          ? 'Select people…'
                          : `${selectedBookEmails.length} selected${
                              maxParticipantsPerMeeting != null
                                ? ` · max ${maxParticipantsPerMeeting}`
                                : ''
                            }`}
                      </span>
                      <ChevronDown
                        size={18}
                        strokeWidth={2}
                        className={
                          participantDropdownOpen
                            ? 'meeting-create-participant-dd__chev meeting-create-participant-dd__chev--open'
                            : 'meeting-create-participant-dd__chev'
                        }
                        aria-hidden
                      />
                    </button>
                    {participantDropdownOpen && (
                      <div className="meeting-create-participant-dd__panel" role="listbox" aria-multiselectable>
                        <div className="meeting-create-participant-dd__search-wrap">
                          <Search size={16} strokeWidth={2} className="meeting-create-participant-dd__search-icon" aria-hidden />
                          <input
                            type="search"
                            className="meeting-create-participant-dd__search"
                            value={participantSearchQuery}
                            onChange={(e) => setParticipantSearchQuery(e.target.value)}
                            placeholder="Search by name or email…"
                            autoComplete="off"
                          />
                        </div>
                        <div className="meeting-create-participant-dd__list">
                          {filteredParticipantBook.length === 0 ? (
                            <p className="meeting-create-participant-dd__empty">No matches</p>
                          ) : (
                            filteredParticipantBook.map((p) => {
                              const em = (p.email && String(p.email).trim().toLowerCase()) || '';
                              if (!em) return null;
                              const checked = selectedBookEmails.includes(em);
                              const hasVoice = !!voiceProfiles[em]?.hasProfile;
                              return (
                                <button
                                  key={em}
                                  type="button"
                                  role="option"
                                  aria-selected={checked}
                                  className={`meeting-create-participant-dd__item${checked ? ' meeting-create-participant-dd__item--selected' : ''}`}
                                  onClick={() => toggleBookParticipantEmail(em)}
                                >
                                  <span
                                    className={`meeting-create-participant-dd__check${checked ? ' meeting-create-participant-dd__check--on' : ''}`}
                                    aria-hidden
                                  />
                                  <span className="meeting-create-participant-dd__item-body">
                                    <span className="meeting-create-participant-dd__name">
                                      {p.name || em.split('@')[0]}
                                    </span>
                                    <span className="meeting-create-participant-dd__email">{em}</span>
                                  </span>
                                  {hasVoice ? (
                                    <span className="meeting-create-participant-dd__voice-status meeting-create-participant-dd__voice-status--ok">
                                      <Mic size={12} strokeWidth={2} aria-hidden />
                                      Configured
                                    </span>
                                  ) : (
                                    <span className="meeting-create-participant-dd__voice-status">
                                      <CircleDashed size={12} strokeWidth={2} aria-hidden />
                                      Not configured
                                    </span>
                                  )}
                                </button>
                              );
                            })
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                  <p id="sm-participants-hint" className="start-meeting-field-hint">
                    Selected: {selectedBookEmails.length}
                    {maxParticipantsPerMeeting != null ? ` / max ${maxParticipantsPerMeeting}` : ''}
                  </p>
                </div>
              )}
              {selectedBookEmails.length > 0 && participantBook.length > 0 && (
                <div className="meeting-create-voice-optional">
                  <button
                    type="button"
                    className={`meeting-create-voice-optional__toggle${voiceRecognitionEnabled ? ' meeting-create-voice-optional__toggle--open' : ''}`}
                    onClick={() => setVoiceRecognitionEnabled((v) => !v)}
                    aria-expanded={voiceRecognitionEnabled}
                    disabled={formDisabled}
                  >
                    <Mic size={16} strokeWidth={1.75} aria-hidden />
                    <span>Configure voice (optional)</span>
                    <ChevronDown
                      size={18}
                      strokeWidth={2}
                      className="meeting-create-voice-optional__chev"
                      aria-hidden
                    />
                  </button>
                  {voiceRecognitionEnabled && (
                    <div className="meeting-create-voice-block meeting-create-voice-block--primary">
                      <p className="start-meeting-field-hint meeting-create-voice-optional__hint">
                        Record a short sample so transcripts can label speakers more accurately. Skip this and enroll
                        later from Participant book if you prefer.
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
                                  <Mic size={14} strokeWidth={2} aria-hidden /> Configured
                                </span>
                              ) : (
                                <span className="meeting-create-voice-row__badge">
                                  <CircleDashed size={14} strokeWidth={2} aria-hidden /> Not configured
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
                                  {hasVoice ? 'Re-record voice' : 'Record sample'}
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

                {error && <div className="start-meeting-error">{error}</div>}

                <div className={`start-meeting-actions meeting-create-primary-actions${inline ? ' start-meeting-actions--inline' : ''}`}>
                  <button
                    type="button"
                    className="start-meeting-btn start-meeting-btn--primary"
                    onClick={submitLive}
                    disabled={loading || formDisabled}
                  >
                    {loading ? (
                      <>
                        <span className="start-meeting-btn-spinner" aria-hidden />
                        Creating…
                      </>
                    ) : isEducation ? (
                      'Create lecture'
                    ) : (
                      'Start Meeting'
                    )}
                  </button>
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
              </div>

              <div className="meeting-create-optional-block">
                <button
                  type="button"
                  className="meeting-create-optional-toggle"
                  onClick={() => setOptionalDetailsOpen((o) => !o)}
                  aria-expanded={optionalDetailsOpen}
                  aria-controls="meeting-create-details-region"
                >
                  {optionalDetailsOpen ? '− Hide optional details' : '+ Add details (optional)'}
                </button>
                <div
                  id="meeting-create-details-region"
                  className={`meeting-create-details-collapse${optionalDetailsOpen ? ' meeting-create-details-collapse--open' : ''}`}
                  aria-hidden={!optionalDetailsOpen}
                >
                  <div className="meeting-create-details-collapse__inner">
                    <div className="meeting-create-optional-panel">
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

                      <div className="start-meeting-field">
                        <FieldLabel htmlFor="sm-location" icon={MapPin}>
                          Location
                        </FieldLabel>
                        <input
                          id="sm-location"
                          value={liveLocation}
                          onChange={(e) => setLiveLocation(e.target.value)}
                          placeholder="e.g. Conference Room A (optional — defaults to live recording)"
                          disabled={formDisabled}
                        />
                      </div>

                      <div className="start-meeting-field" style={{ marginTop: 4 }}>
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
                          Leave blank or pick someone from the participant list. If you pick someone, they must be a
                          selected participant.
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
                    </div>
                  </div>
                </div>
              </div>
      </>
    </div>
  );
}

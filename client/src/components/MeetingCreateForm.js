import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import axios from 'axios';
import {
  X,
  Mic,
  FileText,
  Calendar,
  Clock,
  User,
  MapPin,
  CircleDashed,
  GraduationCap,
  UserCheck,
  Square,
  Mail,
  ChevronDown,
  Search,
  Plus,
  Trash2,
  Briefcase,
} from 'lucide-react';
import { isEducation } from '../config/product';
import { FEATURE_INTERVIEW_UI } from '../config/featureFlags';
import {
  getClassrooms,
  MAX_CLASSROOMS,
  MAX_STUDENTS_PER_CLASSROOM,
  MAX_SUBJECTS_PER_CLASSROOM,
} from '../utils/classroomsStorage';
import {
  VOICE_ENROLLMENT_API_TEMPLATE,
  voiceEnrollmentSentenceForParticipant,
} from '../utils/voiceEnrollment';
import './StartMeetingModal.css';

/** Education: do not email students on lecture create unless the teacher opts in. */
const DEFAULT_SEND_NOTIFICATION_ON_CREATE = !isEducation;

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

function buildInterviewMeetingTitle(candidateName, role) {
  const safeCandidate = String(candidateName || '').trim().slice(0, 200) || 'Candidate';
  const safeRole = String(role || '').trim().slice(0, 200);
  return `Interview- ${safeCandidate}${safeRole ? ` | Role: ${safeRole}` : ''}`.slice(0, 500);
}

function makeInterviewCandidateVoiceEmail() {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return `ivc-${crypto.randomUUID().replace(/-/g, '')}@candidates.portiq.internal`;
    }
  } catch (_) {}
  return `ivc-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 14)}@candidates.portiq.internal`;
}

function createEmptyInterviewCandidate() {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
    name: '',
    role: '',
    voiceEmail: makeInterviewCandidateVoiceEmail(),
  };
}

function getTitleAgendaPlaceholder(companyName) {
  if (isEducation) {
    return 'First line: lecture title (e.g. Algebra Revision - Grade 10).\nFollowing lines: lesson goals, topics, assignments...';
  }
  return `First line: title (e.g. Project review - ${companyName}).\nFollowing lines: agenda, topics, decisions…`;
}

function resetAllState(setters) {
  const d = defaultDateTimeLocal();
  setters.setTitleAgendaCombined('');
  setters.setScheduledDate(d.date);
  setters.setScheduledTime(d.time);
  setters.setLiveLocation('');
  setters.setSelectedClassroomId('');
  if (setters.setSelectedSubject) setters.setSelectedSubject('');
  setters.setSelectedBookEmails([]);
  setters.setParticipantBook([]);
  setters.setParticipantBookError('');
  setters.setAuthorizedEditorEmail('');
  setters.setSendNotification(DEFAULT_SEND_NOTIFICATION_ON_CREATE);
  setters.setError('');
  if (setters.setVoiceSuccessMessage) setters.setVoiceSuccessMessage('');
  setters.setLoading(false);
  setters.setVoiceRecognitionEnabled(false);
  if (setters.setOptionalDetailsOpen) setters.setOptionalDetailsOpen(false);
  if (setters.setInterviewInterviewerEmails) setters.setInterviewInterviewerEmails([]);
  if (setters.setInterviewCandidates) {
    setters.setInterviewCandidates([createEmptyInterviewCandidate()]);
  }
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
  /** Locked to interview mode; navigates to /interview/:id/session after create */
  interviewSurface = false,
}) {
  const navigate = useNavigate();
  const defaults = defaultDateTimeLocal();
  const [titleAgendaCombined, setTitleAgendaCombined] = useState('');
  const [scheduledDate, setScheduledDate] = useState(defaults.date);
  const [scheduledTime, setScheduledTime] = useState(defaults.time);
  const [organizer, setOrganizer] = useState('');
  /** Server account product — voice + participant book are workplace-only. */
  const [accountProductType, setAccountProductType] = useState(null);
  const [liveLocation, setLiveLocation] = useState('');
  const [selectedClassroomId, setSelectedClassroomId] = useState('');
  const [selectedSubject, setSelectedSubject] = useState('');
  const [selectedBookEmails, setSelectedBookEmails] = useState([]);
  const [participantBook, setParticipantBook] = useState([]);
  const [participantBookError, setParticipantBookError] = useState('');
  const [authorizedEditorEmail, setAuthorizedEditorEmail] = useState('');
  const [sendNotification, setSendNotification] = useState(DEFAULT_SEND_NOTIFICATION_ON_CREATE);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [voiceSuccessMessage, setVoiceSuccessMessage] = useState('');
  const [voiceProfiles, setVoiceProfiles] = useState({});
  const [recordingEmail, setRecordingEmail] = useState(null);
  const [voiceUploading, setVoiceUploading] = useState(false);
  const voiceRecorderRef = useRef(null);
  const [voiceRecognitionEnabled, setVoiceRecognitionEnabled] = useState(false);
  const [participantDropdownOpen, setParticipantDropdownOpen] = useState(false);
  const [participantSearchQuery, setParticipantSearchQuery] = useState('');
  const participantDropdownRef = useRef(null);
  const [optionalDetailsOpen, setOptionalDetailsOpen] = useState(false);
  const [interviewInterviewerEmails, setInterviewInterviewerEmails] = useState([]);
  const [interviewCandidates, setInterviewCandidates] = useState(() => [
    createEmptyInterviewCandidate(),
  ]);

  /** Interview pipeline only on /interview, never from the meetings create form. */
  const summaryModeEffective = useMemo(
    () => (interviewSurface && FEATURE_INTERVIEW_UI && !isEducation ? 'interview' : 'standard'),
    [interviewSurface, isEducation]
  );

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
      setSelectedSubject,
      setSelectedBookEmails,
      setParticipantBook,
      setParticipantBookError,
      setAuthorizedEditorEmail,
      setSendNotification,
      setError,
      setVoiceSuccessMessage,
      setLoading,
      setVoiceRecognitionEnabled,
      setOptionalDetailsOpen,
      setInterviewInterviewerEmails,
      setInterviewCandidates,
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
        const pt = String(a?.productType || 'workplace').trim().toLowerCase();
        setAccountProductType(pt);
        const o = (a?.email && String(a.email).trim()) || (a?.username && String(a.username).trim()) || '';
        setOrganizer(o);
        if (pt === 'education') {
          setParticipantBook([]);
          setParticipantBookError('');
          return;
        }
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
      } catch {
        setOrganizer('');
        setAccountProductType(null);
      }
    })();
  }, [active]);

  useEffect(() => {
    if (!active || accountProductType === 'education') {
      setVoiceProfiles({});
      return;
    }
    const bookEmails = participantBook
      .map((p) => String(p.email || '').trim().toLowerCase())
      .filter(Boolean);
    const extra = [];
    if (summaryModeEffective === 'interview') {
      interviewInterviewerEmails.forEach((e) => {
        const ie = String(e || '').trim().toLowerCase();
        if (ie) extra.push(ie);
      });
      interviewCandidates.forEach((c) => {
        const ve = String(c.voiceEmail || '').trim().toLowerCase();
        if (ve) extra.push(ve);
      });
    }
    const emails = [...new Set([...bookEmails, ...extra])];
    if (!emails.length) {
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
  }, [
    active,
    accountProductType,
    participantBook,
    summaryModeEffective,
    interviewInterviewerEmails,
    interviewCandidates,
  ]);

  useEffect(() => {
    if (isEducation || summaryModeEffective !== 'interview') return;
    setInterviewCandidates((prev) =>
      prev.length === 0 ? [createEmptyInterviewCandidate()] : prev
    );
  }, [summaryModeEffective, isEducation]);

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

  const interviewerOptions = useMemo(
    () =>
      participantBook
        .map((p) => {
          const em = String(p?.email || '').trim().toLowerCase();
          if (!em) return null;
          return {
            email: em,
            label: `${String(p?.name || '').trim() || em.split('@')[0]} (${em})`,
          };
        })
        .filter(Boolean),
    [participantBook]
  );

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

  const selectedClassroom = useMemo(() => {
    if (!isEducation || !selectedClassroomId) return null;
    return getClassrooms().find((c) => c.id === selectedClassroomId) || null;
  }, [selectedClassroomId]);

  const selectedClassroomAssignments = useMemo(() => {
    if (!selectedClassroom) return [];
    if (Array.isArray(selectedClassroom.subjectAssignments) && selectedClassroom.subjectAssignments.length) {
      return selectedClassroom.subjectAssignments;
    }
    const legacy = Array.isArray(selectedClassroom.subjects) ? selectedClassroom.subjects : [];
    return legacy.map((s) => ({ subject: s }));
  }, [selectedClassroom]);

  const educationClassrooms = useMemo(() => (isEducation ? getClassrooms() : []), [selectedClassroomId]);
  const selectedClassroomStudentCount = Array.isArray(selectedClassroom?.studentEmails)
    ? selectedClassroom.studentEmails.length
    : 0;
  const selectedClassroomSubjectCount = Array.isArray(selectedClassroom?.subjects)
    ? selectedClassroom.subjects.length
    : selectedClassroomAssignments.length;

  useEffect(() => {
    if (!isEducation || !selectedClassroomId) return;
    if (!selectedClassroomAssignments.length) {
      setSelectedSubject('');
      return;
    }
    if (!selectedClassroomAssignments.some((x) => x.subject === selectedSubject)) {
      setSelectedSubject(selectedClassroomAssignments[0].subject);
    }
  }, [isEducation, selectedClassroomId, selectedClassroomAssignments, selectedSubject]);

  const validateCommon = () => {
    if (!scheduledDate || !scheduledTime) {
      return isEducation ? 'Lecture date and time are required.' : 'Meeting date and time are required.';
    }
    if (!scheduledIso()) return 'Invalid date or time.';
    if (!isEducation && summaryModeEffective === 'interview') {
      const intEmails = Array.isArray(interviewInterviewerEmails)
        ? interviewInterviewerEmails.map((e) => String(e || '').trim().toLowerCase()).filter(Boolean)
        : [];
      if (intEmails.length === 0) {
        return 'Select at least one interviewer from your participant book.';
      }
      const invalid = intEmails.find((e) => !selectedBookEmails.includes(e));
      if (invalid) {
        return 'Every interviewer must be one of the selected people from your book.';
      }
      const named = interviewCandidates.filter((c) => String(c.name || '').trim());
      if (named.length === 0) {
        return 'Candidate name is required.';
      }
      if (!String(named[0].role || '').trim()) {
        return 'Role (position) is required.';
      }
      if (named.length > 12) {
        return 'Too many interview candidates (max 12).';
      }
    }
    const parts = payloadParticipants();
    if (parts.length === 0) {
      if (isEducation) return 'Add at least one student with an email.';
      if (!isEducation && summaryModeEffective === 'interview') {
        return 'Select at least one interviewer from your participant book.';
      }
      return 'Select at least one participant from your participant book.';
    }
    if (maxParticipantsPerMeeting != null && parts.length > maxParticipantsPerMeeting) {
      return isEducation
        ? `Your plan allows up to ${maxParticipantsPerMeeting} students per lecture.`
        : `Your plan allows up to ${maxParticipantsPerMeeting} participants per meeting.`;
    }
    const editorTrim = authorizedEditorEmail.trim();
    if (editorTrim) {
      const editorLower = editorTrim.toLowerCase();
      const emails = parts.map((p) => p.email.toLowerCase());
      if (!emails.includes(editorLower)) {
        return isEducation
          ? 'Authorized reviewer must be one of the selected students.'
          : 'Authorized editor must be one of the selected participants.';
      }
    }
    if (isEducation && !selectedClassroomId) return 'Select a classroom.';
    if (isEducation && !selectedSubject) return 'Select a subject.';
    if (
      isEducation &&
      selectedClassroom &&
      Array.isArray(selectedClassroom.subjects) &&
      selectedClassroom.subjects.length > MAX_SUBJECTS_PER_CLASSROOM
    ) {
      return `This classroom exceeds the current subject cap (${MAX_SUBJECTS_PER_CLASSROOM}). Edit classroom subjects first.`;
    }
    if (
      isEducation &&
      selectedClassroom &&
      Array.isArray(selectedClassroom.studentEmails) &&
      selectedClassroom.studentEmails.length > MAX_STUDENTS_PER_CLASSROOM
    ) {
      return `This classroom exceeds the current student cap (${MAX_STUDENTS_PER_CLASSROOM}). Edit classroom students first.`;
    }
    return '';
  };

  const afterCreate = () => {
    onMeetingCreated?.();
  };

  const buildBody = (extra) => {
    const { title, agenda } = splitTitleAgenda(titleAgendaCombined);
    const fallback = `Session · ${scheduledDate} ${scheduledTime}`;
    const primaryInterviewCandidate =
      !isEducation && summaryModeEffective === 'interview'
        ? interviewCandidates.find((c) => String(c.name || '').trim())
        : null;
    const effTitle =
      !isEducation && summaryModeEffective === 'interview'
        ? buildInterviewMeetingTitle(
            String(primaryInterviewCandidate?.name || '').trim(),
            String(primaryInterviewCandidate?.role || '').trim()
          )
        : (title.trim() || fallback).slice(0, 500);
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
      educationClassroomId: isEducation ? selectedClassroomId : undefined,
      educationClassroomName: isEducation ? String(selectedClassroom?.className || '').trim() : undefined,
      educationSubject: isEducation ? selectedSubject : undefined,
      educationTeacherName: undefined,
      educationTeacherEmail: undefined,
      summaryMode: isEducation ? 'standard' : summaryModeEffective === 'interview' ? 'interview' : 'standard',
      interviewInterviewerEmails:
        !isEducation && summaryModeEffective === 'interview'
          ? interviewInterviewerEmails
              .map((e) => String(e || '').trim().toLowerCase())
              .filter(Boolean)
          : [],
      interviewInterviewerEmail:
        !isEducation && summaryModeEffective === 'interview'
          ? String(interviewInterviewerEmails[0] || '').trim().toLowerCase()
          : '',
      interviewCandidates:
        !isEducation && summaryModeEffective === 'interview'
          ? interviewCandidates
              .filter((c) => String(c.name || '').trim())
              .map((c) => ({
                name: String(c.name || '').trim().slice(0, 200),
                role: String(c.role || '').trim().slice(0, 200),
                voiceEmail: String(c.voiceEmail || '').trim().toLowerCase(),
              }))
          : [],
      interviewCandidateName:
        !isEducation && summaryModeEffective === 'interview'
          ? (
              interviewCandidates.find((c) => String(c.name || '').trim())?.name || ''
            )
              .trim()
              .slice(0, 200)
          : '',
      interviewRole:
        !isEducation && summaryModeEffective === 'interview'
          ? (
              interviewCandidates.find((c) => String(c.name || '').trim())?.role || ''
            )
              .trim()
              .slice(0, 200)
          : '',
      ...extra,
    };
  };

  const submitLive = async () => {
    setError('');
    if (
      subscriptionGate === 'inactive' ||
      subscriptionGate === 'payment_pending' ||
      subscriptionGate === 'trial_exhausted'
    ) {
      setError(
        subscriptionGate === 'trial_exhausted'
          ? isEducation
            ? 'You have reached your free lecture allowance. Upgrade when you are ready to create more.'
            : 'You’ve reached your free meeting allowance. Upgrade when you’re ready to create more.'
          : isEducation
            ? 'Subscription required to create a lecture.'
            : 'Subscription required to create a meeting.'
      );
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
        setError(
          isEducation
            ? 'Lecture was created but the app did not receive an id. Open it from Scheduled lectures.'
            : 'Meeting was created but the app did not receive a meeting id. Open it from the Scheduled list.'
        );
        return;
      }
      const nextPath =
        interviewSurface && FEATURE_INTERVIEW_UI
          ? `/interview/${idStr}/session`
          : `/meetings/${idStr}`;
      navigate(nextPath);
      afterCreate();
      if (onClose) onClose();
    } catch (err) {
      const d = err.response?.data;
      if (err.response?.status === 403 && d?.code === 'TRIAL_LIMIT_REACHED') {
        try {
          window.dispatchEvent(new CustomEvent('portiq-trial-limit'));
        } catch (e) {
          /* ignore */
        }
      }
      setError(
        [d?.error, d?.details].filter(Boolean).join(' — ') ||
          err.message ||
          (isEducation ? 'Could not create lecture.' : 'Could not create meeting.')
      );
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
        setError(
          isEducation
            ? `Your plan allows up to ${maxParticipantsPerMeeting} students per lecture.`
            : `Your plan allows up to ${maxParticipantsPerMeeting} participants per meeting.`
        );
      } else {
        setError((cur) =>
          /^Your plan allows up to \d+ (participants per meeting|students per lecture)\.$/.test(
            String(cur)
          )
            ? ''
            : cur
        );
      }
      return next;
    });
  };

  const uploadVoiceSample = async (audioBlob, targetParticipant) => {
    try {
      setVoiceUploading(true);
      setError('');
      setVoiceSuccessMessage('');
      let participantList = participantBook
        .filter((p) => p.email && String(p.email).trim())
        .map((p) => ({
          name: p.name || '',
          email: String(p.email).trim().toLowerCase(),
        }));
      if (summaryModeEffective === 'interview') {
        interviewCandidates.forEach((c) => {
          const em = String(c.voiceEmail || '').trim().toLowerCase();
          const nm = String(c.name || '').trim();
          if (em && nm) participantList.push({ name: nm, email: em });
        });
      }
      const formData = new FormData();
      const audioFile = new File([audioBlob], `voice-sample-${Date.now()}.webm`, {
        type: 'audio/webm',
      });
      formData.append('participants', JSON.stringify(participantList));
      formData.append('standardSentence', VOICE_ENROLLMENT_API_TEMPLATE);
      if (targetParticipant?.email) {
        formData.append('email', String(targetParticipant.email).trim().toLowerCase());
        if (targetParticipant.name) {
          formData.append('name', String(targetParticipant.name).trim());
        }
      }
      formData.append('audio', audioFile);
      const res = await axios.post('/meetings/voice/register', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      if (res.data?.success) {
        setVoiceSuccessMessage(
          res.data.message || 'Voice profile saved. Your sample will be used on the next transcription.'
        );
      }
      const matched = res.data?.voiceProfile?.email;
      if (matched) {
        const key = String(matched).trim().toLowerCase();
        setVoiceProfiles((prev) => ({ ...prev, [key]: { hasProfile: true } }));
      }
    } catch (err) {
      setVoiceSuccessMessage('');
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
    subscriptionGate === null ||
    subscriptionGate === 'inactive' ||
    subscriptionGate === 'payment_pending' ||
    subscriptionGate === 'trial_exhausted';

  const isInterviewForm = !isEducation && summaryModeEffective === 'interview';
  const primaryCandidate = interviewCandidates[0];

  const updatePrimaryCandidate = (patch) => {
    setInterviewCandidates((rows) => {
      if (!rows.length) return [{ ...createEmptyInterviewCandidate(), ...patch }];
      return rows.map((row, idx) => (idx === 0 ? { ...row, ...patch } : row));
    });
  };

  return (
    <div className={inline ? 'meetings-inline-meeting-form' : undefined}>
      {!inline && (
        <div className="start-meeting-modal__head">
          <h2 id="start-meeting-title" className="start-meeting-modal__title">
            {isEducation
              ? 'Create lecture'
              : summaryModeEffective === 'interview'
                ? 'Start interview'
                : 'Create meeting'}
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
                {!(summaryModeEffective === 'interview' && !isEducation) ? (
                  <div className="start-meeting-field" style={{ marginTop: isEducation ? 4 : 0 }}>
                    <FieldLabel htmlFor="sm-title-agenda" icon={FileText}>
                      {isEducation ? 'Lecture title & notes' : 'Meeting title & agenda'}
                    </FieldLabel>
                    <textarea
                      id="sm-title-agenda"
                      className="meeting-create-title-agenda-single"
                      value={titleAgendaCombined}
                      onChange={(e) => setTitleAgendaCombined(e.target.value)}
                      placeholder={getTitleAgendaPlaceholder(companyName)}
                      rows={3}
                      autoComplete="off"
                      disabled={formDisabled}
                    />
                  </div>
                ) : (
                  <p className="meeting-create-interview-title-auto">
                    Title is auto-generated from candidate and role.
                  </p>
                )}

                {isInterviewForm && interviewSurface && primaryCandidate && (
                  <div className="meeting-create-interview-fields meeting-create-interview-fields--primary">
                    <div className="start-meeting-field">
                      <FieldLabel htmlFor="sm-interview-candidate-name" icon={User}>
                        Candidate name <span className="start-meeting-required" aria-hidden>*</span>
                      </FieldLabel>
                      <input
                        id="sm-interview-candidate-name"
                        type="text"
                        className="meeting-create-interview-input"
                        value={primaryCandidate.name}
                        onChange={(e) => updatePrimaryCandidate({ name: e.target.value })}
                        placeholder="e.g. Alex Johnson"
                        autoComplete="name"
                        required
                        aria-required="true"
                        disabled={formDisabled}
                      />
                    </div>
                  </div>
                )}

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
                      {educationClassrooms.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.className}
                        </option>
                      ))}
                    </select>
                    <p className="start-meeting-field-hint">
                      Caps: {educationClassrooms.length}/{MAX_CLASSROOMS} classrooms
                    </p>
                    {selectedClassroom && Array.isArray(selectedClassroom.subjects) && selectedClassroom.subjects.length > 0 ? (
                      <p className="start-meeting-field-hint">
                        Subjects: {selectedClassroom.subjects.slice(0, MAX_SUBJECTS_PER_CLASSROOM).join(', ')} ({selectedClassroomSubjectCount}/{MAX_SUBJECTS_PER_CLASSROOM})
                      </p>
                    ) : null}
                    {selectedClassroom ? (
                      <p className="start-meeting-field-hint">
                        Students: {selectedClassroomStudentCount}/{MAX_STUDENTS_PER_CLASSROOM}
                      </p>
                    ) : null}
                    {selectedClassroomAssignments.length > 0 ? (
                      <>
                        <FieldLabel htmlFor="sm-subject" icon={FileText}>
                          Subject
                        </FieldLabel>
                        <select
                          id="sm-subject"
                          value={selectedSubject}
                          onChange={(e) => setSelectedSubject(e.target.value)}
                          required
                          disabled={formDisabled}
                        >
                          <option value="">Select subject</option>
                          {selectedClassroomAssignments.map((row) => (
                            <option key={row.subject} value={row.subject}>
                              {row.subject}
                            </option>
                          ))}
                        </select>
                      </>
                    ) : null}
                  </div>
                )}

          {!isEducation && (
            <>
              {isInterviewForm && interviewSurface && primaryCandidate && (
                <div className="meeting-create-interview-fields meeting-create-interview-fields--role">
                  <h3 className="meeting-create-interview-section-title">Select interviewer and role</h3>
                  <div className="start-meeting-field">
                    <FieldLabel htmlFor="sm-interview-role" icon={Briefcase}>
                      Role (position) <span className="start-meeting-required" aria-hidden>*</span>
                    </FieldLabel>
                    <input
                      id="sm-interview-role"
                      type="text"
                      className="meeting-create-interview-input"
                      value={primaryCandidate.role}
                      onChange={(e) => updatePrimaryCandidate({ role: e.target.value })}
                      placeholder="e.g. Senior Product Designer"
                      autoComplete="off"
                      required
                      aria-required="true"
                      disabled={formDisabled}
                    />
                  </div>
                </div>
              )}

              <div className="start-meeting-participants-bar">
                <span className="start-meeting-participants-bar__label">
                  {isInterviewForm ? 'Select interviewer' : 'Select people'}
                </span>
                <Link to="/participants" className="start-meeting-participants-bar__add" onClick={linkClose}>
                  + Add new
                </Link>
              </div>
              <div className="start-meeting-field" style={{ marginBottom: 12 }}>
                <div className="meeting-create-participant-dd" ref={participantDropdownRef}>
                  <button
                    id="sm-participants-trigger"
                    type="button"
                    className="meeting-create-participant-dd__trigger"
                    onClick={() => setParticipantDropdownOpen((o) => !o)}
                    disabled={formDisabled}
                    aria-expanded={participantDropdownOpen}
                    aria-haspopup="listbox"
                    aria-label={
                      isInterviewForm
                        ? 'Select interviewer from your participant book'
                        : 'Select people from your book'
                    }
                  >
                    <span className="meeting-create-participant-dd__trigger-text">
                      {selectedBookEmails.length === 0
                        ? participantBook.length === 0
                          ? 'No people in participant book yet'
                          : isInterviewForm
                            ? 'Select interviewer'
                            : 'Select people'
                        : `${selectedBookEmails.length} selected${
                            maxParticipantsPerMeeting != null ? ` · max ${maxParticipantsPerMeeting}` : ''
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
                          disabled={participantBook.length === 0}
                        />
                      </div>
                      <div className="meeting-create-participant-dd__list">
                        {participantBookError ? (
                          <p className="meeting-create-participant-dd__empty">{participantBookError}</p>
                        ) : filteredParticipantBook.length === 0 ? (
                          <p className="meeting-create-participant-dd__empty">
                            {participantBook.length === 0 ? 'No people in participant book yet' : 'No matches'}
                          </p>
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
              </div>
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
              {maxParticipantsPerMeeting != null && (
                <p className="start-meeting-field-hint">
                  Up to {maxParticipantsPerMeeting} participants per meeting on your plan.
                </p>
              )}

              {isInterviewForm && interviewSurface && (
                <div className="meeting-create-interview-panel meeting-create-interview-panel--surface">
                  <div className="meeting-create-field-stack">
                    <label className="meeting-create-interview-label" htmlFor="sm-interviewer-surface">
                      Interviewers <span className="start-meeting-required" aria-hidden>*</span>
                    </label>
                    <p className="start-meeting-field-hint meeting-create-interview-panel--surface-hint">
                      Choose who will conduct this interview from your participant book.
                    </p>
                    <div
                      id="sm-interviewer-surface"
                      className="meeting-create-interview-multi"
                      role="group"
                      aria-label="Select interviewers"
                    >
                      {interviewerOptions.length === 0 ? (
                        <p className="meeting-create-interview-multi__empty">
                          Add people in your participant book, then select them above.
                        </p>
                      ) : (
                        interviewerOptions.map((opt) => {
                          const checked = interviewInterviewerEmails.includes(opt.email);
                          return (
                            <label
                              key={opt.email}
                              className={`meeting-create-interview-multi__item${
                                checked ? ' meeting-create-interview-multi__item--selected' : ''
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(e) => {
                                  const on = !!e.target.checked;
                                  setInterviewInterviewerEmails((prev) => {
                                    if (on) return prev.includes(opt.email) ? prev : [...prev, opt.email];
                                    return prev.filter((x) => x !== opt.email);
                                  });
                                  if (on) {
                                    setSelectedBookEmails((prev) =>
                                      prev.includes(opt.email) ? prev : [...prev, opt.email]
                                    );
                                  }
                                }}
                                disabled={formDisabled}
                              />
                              <span>{opt.label}</span>
                            </label>
                          );
                        })
                      )}
                    </div>
                  </div>
                </div>
              )}
            </>
          )}

                {error && <div className="start-meeting-error">{error}</div>}
                {voiceSuccessMessage && !error && (
                  <div className="success-message" role="status">
                    {voiceSuccessMessage}
                  </div>
                )}

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
                        {isEducation ? 'Creating…' : summaryModeEffective === 'interview' ? 'Starting…' : 'Creating…'}
                      </>
                    ) : isEducation ? (
                      'Create lecture'
                    ) : summaryModeEffective === 'interview' ? (
                      'Start interview'
                    ) : (
                      'Create meeting'
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
                  {optionalDetailsOpen
                    ? '− Hide optional details'
                    : isEducation
                      ? '+ Add lecture details (optional)'
                      : '+ Add details (optional)'}
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
                          {isEducation ? 'Teacher (optional)' : 'Organizer (optional)'}
                        </FieldLabel>
                        <input
                          id="sm-organizer"
                          value={organizer}
                          onChange={(e) => setOrganizer(e.target.value)}
                          placeholder="Defaults to your account if empty"
                          autoComplete="off"
                          disabled={formDisabled}
                        />
                      </div>

                      <div className="start-meeting-field">
                        <FieldLabel htmlFor="sm-location" icon={MapPin}>
                          {isEducation ? 'Classroom location' : 'Location'}
                        </FieldLabel>
                        <input
                          id="sm-location"
                          value={liveLocation}
                          onChange={(e) => setLiveLocation(e.target.value)}
                          placeholder={
                            isEducation
                              ? 'e.g. Room 203 (optional - defaults to live recording)'
                              : 'e.g. Conference Room A (optional - defaults to live recording)'
                          }
                          disabled={formDisabled}
                        />
                      </div>

                      <div className="start-meeting-field" style={{ marginTop: 4 }}>
                        <FieldLabel htmlFor="sm-editor" icon={UserCheck}>
                          {isEducation ? 'Authorized reviewer (optional)' : 'Authorized editor (optional)'}
                        </FieldLabel>
                        <select
                          id="sm-editor"
                          value={authorizedEditorEmail}
                          onChange={(e) => setAuthorizedEditorEmail(e.target.value)}
                          disabled={formDisabled}
                        >
                          <option value="">
                            {isEducation ? 'No authorized reviewer' : 'No authorized editor'}
                          </option>
                          {editorOptions.map((p) => (
                            <option key={p.email} value={p.email}>
                              {(p.name || p.email) + ` (${p.email})`}
                            </option>
                          ))}
                        </select>
                        <p className="start-meeting-field-hint">
                          {isEducation
                            ? 'Leave blank or pick someone from the student list. If you pick someone, they must be selected for this lecture.'
                            : 'Leave blank or pick someone from the participant list. If you pick someone, they must be a selected participant.'}
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
                        <span>
                          {isEducation
                            ? 'Send email notification to students when the lecture is created'
                            : 'Send email notification to participants when the meeting is created'}
                        </span>
                      </label>
                    </div>
                  </div>
                </div>
              </div>
      </>
    </div>
  );
}

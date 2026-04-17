import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useTrialExperience } from './TrialExperienceProvider';
import { BookOpen, GraduationCap, Zap } from 'lucide-react';
import { getClassrooms } from '../utils/classroomsStorage';
import './Dashboard.css';

function buildParticipantsFromClassroom(classroom, subject) {
  if (!classroom) return [];
  return Array.isArray(classroom.studentEmails)
    ? classroom.studentEmails
        .map((email) => String(email || '').trim())
        .filter(Boolean)
        .map((email) => ({
          name: email.split('@')[0],
          email,
          role: 'participant',
        }))
    : [];
}

/** Local calendar YYYY-MM-DD for comparison (browser timezone). */
function getLocalDayKey(d = new Date()) {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  return `${y}-${mo}-${da}`;
}

function getMeetingSortDate(m) {
  const v = m?.startTime || m?.scheduledTime || m?.createdAt;
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function isMeetingOnLocalDay(m, dayKey) {
  const d = getMeetingSortDate(m);
  if (!d) return false;
  return getLocalDayKey(d) === dayKey;
}

export default function TeacherDashboard() {
  const trial = useTrialExperience();
  const profile = trial?.profile;
  const navigate = useNavigate();

  const [selectedClassroomId, setSelectedClassroomId] = useState('');
  const [lectureTitle, setLectureTitle] = useState('');
  const [selectedSubject, setSelectedSubject] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [lectureRecords, setLectureRecords] = useState([]);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [recordsError, setRecordsError] = useState('');
  /** Bumps when the local calendar day changes so we refetch / refilter “today’s” list. */
  const [localDayKey, setLocalDayKey] = useState(() => getLocalDayKey());
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [spotlightRect, setSpotlightRect] = useState(null);
  const classroomFieldRef = useRef(null);
  const subjectFieldRef = useRef(null);
  const startButtonRef = useRef(null);

  const classrooms = useMemo(() => getClassrooms(), []);

  const selectedClassroom = useMemo(
    () => classrooms.find((c) => c.id === selectedClassroomId) || null,
    [classrooms, selectedClassroomId]
  );
  const subjectAssignments = useMemo(() => {
    if (!selectedClassroom) return [];
    if (
      Array.isArray(selectedClassroom.subjectAssignments) &&
      selectedClassroom.subjectAssignments.length
    ) {
      return selectedClassroom.subjectAssignments;
    }
    const legacy = Array.isArray(selectedClassroom.subjects)
      ? selectedClassroom.subjects
      : [];
    return legacy.map((s) => ({ subject: s }));
  }, [selectedClassroom]);
  const teacherName =
    (profile?.username && String(profile.username).trim()) ||
    (profile?.email && String(profile.email).trim()) ||
    'Teacher';
  const teacherEmail = String(profile?.email || '').trim().toLowerCase();

  const onboardingSteps = [
    {
      title: 'Choose your classroom',
      body: 'Select the group you are teaching. The roster is linked automatically so your session stays aligned with that class.',
      target: 'classroom',
      Icon: GraduationCap,
    },
    {
      title: 'Select the subject',
      body: 'Match the subject you are covering today. Notes and summaries stay grouped by subject for easy review later.',
      target: 'subject',
      Icon: BookOpen,
    },
    {
      title: 'Go live in one tap',
      body: 'Hit Start lecture to open the room with recording and live notes ready—no extra setup.',
      target: 'start',
      Icon: Zap,
    },
  ];

  const currentStep = onboardingSteps[onboardingStep] || onboardingSteps[0];
  const StepIcon = currentStep?.Icon;

  const updateSpotlightRect = () => {
    if (!onboardingOpen) return;
    const target =
      currentStep?.target === 'classroom'
        ? classroomFieldRef.current
        : currentStep?.target === 'subject'
          ? subjectFieldRef.current
          : startButtonRef.current;
    if (!target) return;
    const rect = target.getBoundingClientRect();
    const pad = 8;
    setSpotlightRect({
      top: rect.top - pad,
      left: rect.left - pad,
      width: rect.width + pad * 2,
      height: rect.height + pad * 2,
      cardTop: rect.bottom + 14,
      cardLeft: rect.left,
    });
  };

  useEffect(() => {
    const uid = String(profile?.id || profile?._id || profile?.email || '').trim();
    if (!uid) return;
    const key = `portiq_teacher_onboarding_v1_${uid}`;
    try {
      const done = window.localStorage.getItem(key) === '1';
      if (!done) {
        setOnboardingOpen(true);
        setOnboardingStep(0);
      }
    } catch (_) {
      setOnboardingOpen(true);
      setOnboardingStep(0);
    }
  }, [profile?.id, profile?._id, profile?.email]);

  useEffect(() => {
    if (!onboardingOpen) return undefined;
    updateSpotlightRect();
    const onResize = () => updateSpotlightRect();
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onResize, true);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onResize, true);
    };
  }, [onboardingOpen, onboardingStep]);

  const closeOnboarding = (markDone = true) => {
    const uid = String(profile?.id || profile?._id || profile?.email || '').trim();
    if (markDone && uid) {
      try {
        window.localStorage.setItem(`portiq_teacher_onboarding_v1_${uid}`, '1');
      } catch (_) {
        // ignore
      }
    }
    setOnboardingOpen(false);
  };

  useEffect(() => {
    const syncLocalDay = () => {
      const next = getLocalDayKey();
      setLocalDayKey((prev) => (prev !== next ? next : prev));
    };

    const msToNextMidnight = () => {
      const n = new Date();
      const next = new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1, 0, 0, 0, 0);
      return Math.max(5_000, next.getTime() - n.getTime());
    };

    const poll = setInterval(syncLocalDay, 60 * 1000);
    const midnight = setTimeout(syncLocalDay, msToNextMidnight());
    const onVis = () => {
      if (document.visibilityState === 'visible') syncLocalDay();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(poll);
      clearTimeout(midnight);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [localDayKey]);

  useEffect(() => {
    let cancelled = false;
    const loadRecords = async () => {
      setRecordsLoading(true);
      setRecordsError('');
      try {
        const res = await axios.get('/meetings', { timeout: 30000 });
        if (cancelled) return;
        const rows = Array.isArray(res.data?.meetings) ? res.data.meetings : [];
        const teacherRecords = rows
          .filter((m) => {
            if (!isMeetingOnLocalDay(m, localDayKey)) return false;
            const ownerEmail = String(m?.educationTeacherEmail || '').trim().toLowerCase();
            const organizer = String(m?.organizer || '').trim().toLowerCase();
            if (teacherEmail) {
              return ownerEmail === teacherEmail || organizer === teacherEmail;
            }
            return String(m?.educationTeacherName || '').trim().toLowerCase() === teacherName.toLowerCase();
          })
          .sort((a, b) => {
            const aTime = new Date(a?.startTime || a?.scheduledTime || a?.createdAt || 0).getTime();
            const bTime = new Date(b?.startTime || b?.scheduledTime || b?.createdAt || 0).getTime();
            return bTime - aTime;
          })
          .slice(0, 20);
        setLectureRecords(teacherRecords);
      } catch (err) {
        if (cancelled) return;
        const d = err.response?.data;
        setRecordsError(
          [d?.error, d?.details].filter(Boolean).join(' — ') ||
            err.message ||
            'Could not load lecture records.'
        );
      } finally {
        if (!cancelled) setRecordsLoading(false);
      }
    };
    loadRecords();
    return () => {
      cancelled = true;
    };
  }, [teacherEmail, teacherName, localDayKey]);

  const formatLectureTime = (meeting) => {
    const value = meeting?.startTime || meeting?.scheduledTime || meeting?.createdAt;
    if (!value) return 'Not set';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return 'Not set';
    return d.toLocaleString();
  };

  const handleCreateAndStart = async () => {
    setError('');
    if (!lectureTitle.trim()) {
      setError('Enter a lecture title.');
      return;
    }
    if (!selectedClassroomId) {
      setError('Select a classroom to start a lecture.');
      return;
    }
    if (!selectedSubject) {
      setError('Select a subject for this lecture.');
      return;
    }

    const classroom = selectedClassroom;
    const participants = buildParticipantsFromClassroom(classroom, selectedSubject);
    if (!participants.length) {
      setError('Add at least one student to this classroom before starting a lecture.');
      return;
    }

    setCreating(true);
    try {
      const now = new Date();
      const iso = now.toISOString();
      const className = String(classroom?.className || 'Classroom').trim();
      const subjectLabel = String(selectedSubject || 'Lecture').trim();
      const titleLabel = String(lectureTitle || '').trim();

      const body = {
        title: titleLabel,
        agenda: `Lecture for ${className} · Subject: ${subjectLabel}`,
        organizer:
          (profile?.email && String(profile.email).trim()) ||
          (profile?.username && String(profile.username).trim()) ||
          'Teacher',
        scheduledTime: iso,
        participants,
        sendNotification: false,
        authorizedEditorEmail: undefined,
        transcriptionEnabled: true,
        meetingRoom: className || 'Live classroom',
        educationClassroomId: classroom.id,
        educationClassroomName: className,
        educationSubject: subjectLabel,
        educationTeacherName: teacherName,
        educationTeacherEmail:
          String(profile?.email || '').trim().toLowerCase() || undefined,
        summaryMode: 'standard',
      };

      const res = await axios.post('/meetings', body, { timeout: 30000 });
      const meeting = res.data?.meeting;
      const id = meeting?._id || meeting?.id;
      if (!id) {
        setError(
          'Lecture was created but the app did not receive an id. Open it from Recent lectures.'
        );
        return;
      }

      navigate(`/meetings/${String(id)}/room`);
    } catch (err) {
      const d = err.response?.data;
      setError(
        [d?.error, d?.details].filter(Boolean).join(' — ') ||
          err.message ||
          'Could not start lecture.'
      );
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="dashboard-screen">
      <div className="dashboard-wrapper">
        <div className="dashboard-content">
          <header
            className="dashboard-hero-minimal ux-dashboard-stagger"
            style={{ animationDelay: '0ms' }}
            aria-label="Teacher dashboard"
          >
            <h1 className="dashboard-title">Welcome, {teacherName}</h1>
            <p className="dashboard-subtitle">
              Start faster. Pick classroom and subject, then begin your lecture in one click.
            </p>
          </header>

          <section
            className="dashboard-education-strip dashboard-teacher-shell ux-dashboard-stagger"
            style={{ animationDelay: '40ms' }}
          >
            <div className="dashboard-education-strip__title-row">
              <span className="dashboard-stat-chip__icon dashboard-teacher-shell__ic" aria-hidden>
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                >
                  <path d="M3 7.5L12 3l9 4.5-9 4.5-9-4.5z" />
                  <path d="M7 10.5V15c0 1.8 2.2 3.2 5 3.2s5-1.4 5-3.2v-4.5" />
                </svg>
              </span>
              <h2>Start a lecture</h2>
            </div>
            <div className="dashboard-teacher-grid">
              <div className="dashboard-education-pill dashboard-education-pill--wide dashboard-teacher-card">
                <span className="dashboard-education-pill__k">Lecture title</span>
                <input
                  type="text"
                  value={lectureTitle}
                  onChange={(e) => setLectureTitle(e.target.value)}
                  placeholder="e.g. Algebra Revision - Grade 10"
                />
              </div>
              <div
                ref={classroomFieldRef}
                className={`dashboard-education-pill dashboard-education-pill--wide dashboard-teacher-card${
                  onboardingOpen && currentStep?.target === 'classroom' ? ' dashboard-teacher-focus' : ''
                }`}
              >
                <span className="dashboard-education-pill__k">Classroom</span>
                <select
                  value={selectedClassroomId}
                  onChange={(e) => {
                    setSelectedClassroomId(e.target.value);
                    setSelectedSubject('');
                  }}
                >
                  <option value="">Select classroom</option>
                  {classrooms.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.className}
                    </option>
                  ))}
                </select>
              </div>
              <div
                ref={subjectFieldRef}
                className={`dashboard-education-pill dashboard-education-pill--wide dashboard-teacher-card${
                  onboardingOpen && currentStep?.target === 'subject' ? ' dashboard-teacher-focus' : ''
                }`}
              >
                <span className="dashboard-education-pill__k">Subject</span>
                <select
                  value={selectedSubject}
                  onChange={(e) => setSelectedSubject(e.target.value)}
                  disabled={!subjectAssignments.length}
                >
                  <option value="">
                    {subjectAssignments.length ? 'Select subject' : 'Select classroom first'}
                  </option>
                  {subjectAssignments.map((row) => (
                    <option key={row.subject} value={row.subject}>
                      {row.subject}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {error && <div className="start-meeting-error">{error}</div>}

            <div className="dashboard-start-meeting__actions">
              <button
                ref={startButtonRef}
                type="button"
                className={`dashboard-btn-primary dashboard-btn-primary--hero dashboard-btn-micro${
                  onboardingOpen && currentStep?.target === 'start' ? ' dashboard-teacher-focus-btn' : ''
                }`}
                onClick={handleCreateAndStart}
                disabled={creating}
              >
                {creating ? 'Starting…' : 'Start lecture'}
              </button>
              <button
                type="button"
                className="dashboard-btn-secondary dashboard-btn-micro"
                onClick={() => setOnboardingOpen(true)}
              >
                Quick help
              </button>
            </div>
          </section>

          <section
            className="dashboard-education-strip dashboard-teacher-shell ux-dashboard-stagger"
            style={{ animationDelay: '80ms' }}
          >
            <div className="dashboard-education-strip__title-row">
              <h2>My lecture records</h2>
            </div>
            <p className="dashboard-education-strip__hint">
              Today&apos;s lectures only — this list clears when the day ends. Use Meetings for your full
              history.
            </p>
            <div className="dashboard-start-meeting__actions" style={{ marginBottom: 10 }}>
              <button
                type="button"
                className="dashboard-btn-secondary dashboard-btn-micro"
                onClick={() => navigate('/meetings')}
              >
                View all lectures
              </button>
            </div>
            {recordsError && <div className="start-meeting-error">{recordsError}</div>}
            {recordsLoading ? (
              <p className="dashboard-education-strip__hint">Loading your lecture records…</p>
            ) : lectureRecords.length ? (
              <ul className="dashboard-education-admin-list">
                {lectureRecords.map((m) => (
                  <li key={String(m?._id || m?.id || `${m?.title}-${m?.createdAt || ''}`)}>
                    <span>{m?.title || 'Untitled lecture'}</span>
                    <small>
                      {(m?.educationClassroomName || 'Classroom') +
                        ' · ' +
                        (m?.educationSubject || 'Subject') +
                        ' · ' +
                        formatLectureTime(m) +
                        ' · ' +
                        (m?.status || 'Scheduled')}
                    </small>
                    <div className="dashboard-start-meeting__actions" style={{ marginTop: 8 }}>
                      <button
                        type="button"
                        className="dashboard-btn-secondary dashboard-btn-micro"
                        onClick={() => {
                          const id = m?._id || m?.id;
                          if (id) navigate(`/meetings/${String(id)}`);
                        }}
                      >
                        Open record
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="dashboard-education-strip__hint">
                No lectures today yet. Start one above, or open Meetings to see every lecture.
              </p>
            )}
          </section>

          {onboardingOpen && (
            <div className="dashboard-teacher-tour" role="dialog" aria-modal="true">
              <div className="dashboard-teacher-tour__backdrop" onClick={() => closeOnboarding(true)} />
              {spotlightRect && (
                <div
                  className="dashboard-teacher-tour__spotlight"
                  style={{
                    top: `${spotlightRect.top}px`,
                    left: `${spotlightRect.left}px`,
                    width: `${spotlightRect.width}px`,
                    height: `${spotlightRect.height}px`,
                  }}
                />
              )}
              <div
                className="dashboard-teacher-tour__card dashboard-teacher-tour__card--spotlight"
                style={
                  spotlightRect
                    ? {
                        top: `${Math.min(
                          spotlightRect.cardTop,
                          window.innerHeight - 210
                        )}px`,
                        left: `${Math.min(
                          spotlightRect.cardLeft,
                          window.innerWidth - 460
                        )}px`,
                      }
                    : undefined
                }
              >
                <div className="dashboard-teacher-tour__card-accent" aria-hidden />
                <div className="dashboard-teacher-tour__head">
                  {StepIcon ? (
                    <div className="dashboard-teacher-tour__icon-wrap">
                      <StepIcon
                        className="dashboard-teacher-tour__icon"
                        size={28}
                        strokeWidth={1.75}
                        aria-hidden
                      />
                    </div>
                  ) : null}
                  <div className="dashboard-teacher-tour__head-text">
                    <p className="dashboard-teacher-tour__eyebrow">Your quick tour</p>
                    <p className="dashboard-teacher-tour__step">
                      Step {onboardingStep + 1} of {onboardingSteps.length}
                    </p>
                  </div>
                </div>
                <div className="dashboard-teacher-tour__dots" role="tablist" aria-label="Tour progress">
                  {onboardingSteps.map((_, i) => (
                    <span
                      key={String(i)}
                      className={
                        i === onboardingStep
                          ? 'dashboard-teacher-tour__dot dashboard-teacher-tour__dot--active'
                          : 'dashboard-teacher-tour__dot'
                      }
                    />
                  ))}
                </div>
                <h3 className="dashboard-teacher-tour__title">{currentStep.title}</h3>
                <p className="dashboard-teacher-tour__body">{currentStep.body}</p>
                <div className="dashboard-teacher-tour__actions">
                  <button
                    type="button"
                    className="dashboard-btn-secondary dashboard-btn-micro"
                    onClick={() => closeOnboarding(true)}
                  >
                    Skip
                  </button>
                  {onboardingStep > 0 ? (
                    <button
                      type="button"
                      className="dashboard-btn-secondary dashboard-btn-micro"
                      onClick={() => setOnboardingStep((s) => Math.max(0, s - 1))}
                    >
                      Back
                    </button>
                  ) : null}
                  {onboardingStep < onboardingSteps.length - 1 ? (
                    <button
                      type="button"
                      className="dashboard-btn-primary dashboard-btn-micro"
                      onClick={() => setOnboardingStep((s) => Math.min(onboardingSteps.length - 1, s + 1))}
                    >
                      Next
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="dashboard-btn-primary dashboard-btn-micro"
                      onClick={() => closeOnboarding(true)}
                    >
                      Finish
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}


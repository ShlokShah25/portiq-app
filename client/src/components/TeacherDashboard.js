import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useTrialExperience } from './TrialExperienceProvider';
import { BookOpen, GraduationCap, Layers, Lightbulb, Zap } from 'lucide-react';
import { listCourses } from '../utils/coursesApi';
import { T } from '../config/terminology';
import { TEACHER_FACULTY_TIPS, pickTipIndex, TIP_ROTATION_MS } from '../config/dashboardTips';
import OnboardingTour, { hasSeenTour } from './OnboardingTour';
import './Dashboard.css';

/** Same key pattern the teacher live-room tour (MeetingInProgress.js) reads to
 * know whether this first leg of the tour was already seen/skipped. */
export function teacherDashboardTourKey(uid) {
  return `portiq_teacher_onboarding_v1_${uid}`;
}

function buildParticipantsFromSemester(semester) {
  if (!semester || !Array.isArray(semester.studentRoster)) return [];
  return semester.studentRoster
    .map((s) => String(s?.email || '').trim())
    .filter(Boolean)
    .map((email) => ({
      name: email.split('@')[0],
      email,
      role: 'participant',
    }));
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

  const [courses, setCourses] = useState([]);
  const [coursesLoading, setCoursesLoading] = useState(true);
  const [coursesError, setCoursesError] = useState('');
  const [selectedCourseId, setSelectedCourseId] = useState('');
  const [selectedSemesterId, setSelectedSemesterId] = useState('');
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
  const [tipIndex, setTipIndex] = useState(() =>
    pickTipIndex('portiq_teacher_tip_idx', TEACHER_FACULTY_TIPS.length)
  );
  const courseFieldRef = useRef(null);
  const semesterFieldRef = useRef(null);
  const subjectFieldRef = useRef(null);
  const startButtonRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setCoursesLoading(true);
      setCoursesError('');
      try {
        const { courses: list } = await listCourses();
        if (!cancelled) setCourses(list);
      } catch (err) {
        if (!cancelled) {
          setCoursesError(
            err.response?.data?.error || err.message || 'Could not load courses.'
          );
        }
      } finally {
        if (!cancelled) setCoursesLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedCourse = useMemo(
    () => courses.find((c) => c._id === selectedCourseId) || null,
    [courses, selectedCourseId]
  );
  const semesters = useMemo(
    () => (Array.isArray(selectedCourse?.semesters) ? selectedCourse.semesters : []),
    [selectedCourse]
  );
  const selectedSemester = useMemo(
    () => semesters.find((s) => s._id === selectedSemesterId) || null,
    [semesters, selectedSemesterId]
  );
  const subjects = useMemo(
    () => (Array.isArray(selectedSemester?.subjects) ? selectedSemester.subjects : []),
    [selectedSemester]
  );
  const teacherName =
    (profile?.username && String(profile.username).trim()) ||
    (profile?.email && String(profile.email).trim()) ||
    'Teacher';
  const teacherEmail = String(profile?.email || '').trim().toLowerCase();

  const onboardingSteps = useMemo(
    () => [
      {
        id: 'course',
        title: 'Choose your course',
        body: 'Select the course you are teaching (e.g. MBA Tech AI). Your admin sets these up, along with semesters and rosters.',
        target: courseFieldRef,
        icon: GraduationCap,
      },
      {
        id: 'semester',
        title: 'Pick the semester',
        body: 'The roster for this semester is linked automatically so your session stays aligned with that batch.',
        target: semesterFieldRef,
        icon: Layers,
      },
      {
        id: 'subject',
        title: 'Select the subject',
        body: 'Match the subject you are covering today. Notes and summaries stay grouped by subject for easy review later.',
        target: subjectFieldRef,
        icon: BookOpen,
      },
      {
        id: 'start',
        title: 'Go live in one tap',
        body: 'Hit Start lecture to open the room with recording and live notes ready—no extra setup.',
        target: startButtonRef,
        icon: Zap,
      },
    ],
    []
  );

  useEffect(() => {
    const id = window.setInterval(() => {
      setTipIndex((i) => (i + 1) % TEACHER_FACULTY_TIPS.length);
    }, TIP_ROTATION_MS);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const uid = String(profile?.id || profile?._id || profile?.email || '').trim();
    if (!uid) return;
    if (!hasSeenTour(teacherDashboardTourKey(uid))) {
      setOnboardingOpen(true);
      setOnboardingStep(0);
    }
  }, [profile?.id, profile?._id, profile?.email]);

  const teacherUid = String(profile?.id || profile?._id || profile?.email || '').trim();

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
    if (!selectedCourseId) {
      setError('Select a course to start a lecture.');
      return;
    }
    if (!selectedSemesterId) {
      setError('Select a semester to start a lecture.');
      return;
    }
    if (!selectedSubject) {
      setError('Select a subject for this lecture.');
      return;
    }

    const course = selectedCourse;
    const semester = selectedSemester;
    const participants = buildParticipantsFromSemester(semester);
    if (!participants.length) {
      setError('Add at least one student to this semester before starting a lecture. Ask your admin to add students under Courses.');
      return;
    }

    setCreating(true);
    try {
      const now = new Date();
      const iso = now.toISOString();
      const courseName = String(course?.name || 'Course').trim();
      const semesterName = String(semester?.name || 'Semester').trim();
      const groupLabel = `${courseName} — ${semesterName}`;
      const subjectLabel = String(selectedSubject || 'Lecture').trim();
      const titleLabel = String(lectureTitle || '').trim();

      const body = {
        title: titleLabel,
        agenda: `Lecture for ${groupLabel} · Subject: ${subjectLabel}`,
        organizer:
          (profile?.email && String(profile.email).trim()) ||
          (profile?.username && String(profile.username).trim()) ||
          'Teacher',
        scheduledTime: iso,
        participants,
        sendNotification: false,
        authorizedEditorEmail: undefined,
        transcriptionEnabled: true,
        meetingRoom: groupLabel || 'Live classroom',
        educationClassroomId: `${course._id}:${semester._id || semesterName}`,
        educationClassroomName: groupLabel,
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
              Start faster. Pick your course, semester, and subject, then begin your lecture in one click.
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
                ref={courseFieldRef}
                className="dashboard-education-pill dashboard-education-pill--wide dashboard-teacher-card"
              >
                <span className="dashboard-education-pill__k">Course</span>
                <select
                  value={selectedCourseId}
                  onChange={(e) => {
                    setSelectedCourseId(e.target.value);
                    setSelectedSemesterId('');
                    setSelectedSubject('');
                  }}
                  disabled={coursesLoading}
                >
                  <option value="">{coursesLoading ? 'Loading courses…' : 'Select course'}</option>
                  {courses.map((c) => (
                    <option key={c._id} value={c._id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div
                ref={semesterFieldRef}
                className="dashboard-education-pill dashboard-education-pill--wide dashboard-teacher-card"
              >
                <span className="dashboard-education-pill__k">Semester</span>
                <select
                  value={selectedSemesterId}
                  onChange={(e) => {
                    setSelectedSemesterId(e.target.value);
                    setSelectedSubject('');
                  }}
                  disabled={!semesters.length}
                >
                  <option value="">{semesters.length ? 'Select semester' : 'Select course first'}</option>
                  {semesters.map((s) => (
                    <option key={s._id} value={s._id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
              <div
                ref={subjectFieldRef}
                className="dashboard-education-pill dashboard-education-pill--wide dashboard-teacher-card"
              >
                <span className="dashboard-education-pill__k">Subject</span>
                <select
                  value={selectedSubject}
                  onChange={(e) => setSelectedSubject(e.target.value)}
                  disabled={!subjects.length}
                >
                  <option value="">
                    {subjects.length ? 'Select subject' : 'Select semester first'}
                  </option>
                  {subjects.map((subject) => (
                    <option key={subject} value={subject}>
                      {subject}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {coursesError && <div className="start-meeting-error">{coursesError}</div>}
            {error && <div className="start-meeting-error">{error}</div>}

            <div className="dashboard-start-meeting__actions">
              <button
                ref={startButtonRef}
                type="button"
                className="dashboard-btn-primary dashboard-btn-primary--hero dashboard-btn-micro"
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
              Only today&apos;s lectures are listed here.
            </p>
            <p className="dashboard-education-strip__hint dashboard-education-strip__hint--emph">
              Start a new lecture with the form above.
            </p>
            <div className="dashboard-start-meeting__actions" style={{ marginBottom: 10 }}>
              <button
                type="button"
                className="dashboard-btn-secondary dashboard-btn-micro"
                onClick={() => navigate('/meetings')}
                title={`Same as “${T.meetings()}” in the sidebar — your full archive`}
              >
                Go to {T.meetings()}
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
                  </li>
                ))}
              </ul>
            ) : null}
          </section>

          <div
            className="dashboard-tip-strip ux-dashboard-stagger"
            style={{ animationDelay: '120ms' }}
            role="status"
            aria-live="polite"
          >
            <Lightbulb className="dashboard-tip-strip__ic" strokeWidth={1.5} aria-hidden />
            <span key={tipIndex} className="dashboard-tip-strip__text ux-dashboard-tip-fade">
              {TEACHER_FACULTY_TIPS[tipIndex]}
            </span>
          </div>

          <OnboardingTour
            steps={onboardingSteps}
            open={onboardingOpen}
            currentStep={onboardingStep}
            onNext={() => setOnboardingStep((s) => Math.min(onboardingSteps.length - 1, s + 1))}
            onBack={() => setOnboardingStep((s) => Math.max(0, s - 1))}
            onSkip={() => setOnboardingOpen(false)}
            onFinish={() => setOnboardingOpen(false)}
            storageKey={teacherUid ? teacherDashboardTourKey(teacherUid) : undefined}
          />
        </div>
      </div>
    </div>
  );
}


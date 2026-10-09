import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useTrialExperience } from './TrialExperienceProvider';
import {
  BookOpen,
  Zap,
  CalendarDays,
  Target,
  AlertCircle,
  FileCheck2,
  Radio,
  ArrowRight,
  Users,
  Check,
  PlayCircle,
  Inbox,
  HelpCircle,
  Type,
} from 'lucide-react';
import { listCourses } from '../utils/coursesApi';
import { T } from '../config/terminology';
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
    .map((s) => ({ email: String(s?.email || '').trim(), name: String(s?.name || '').trim() }))
    .filter((s) => s.email)
    .map((s) => ({
      name: s.name || s.email.split('@')[0],
      email: s.email,
      role: 'participant',
    }));
}

function lectureDate(m) {
  const v = m?.startTime || m?.scheduledTime || m?.createdAt;
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function greetingFor(d = new Date()) {
  const h = d.getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function relativeDay(d) {
  if (!d) return '';
  const today = new Date();
  const start = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(today) - start(d)) / 86400000);
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (diff === 0) return `Today, ${time}`;
  if (diff === 1) return `Yesterday, ${time}`;
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

/**
 * Where a lecture is in its life, and the one thing the teacher should do next.
 *   live → rejoin the room · writing → wait · review → open publish page · sent → view
 */
function lectureStage(m) {
  const status = String(m?.status || '');
  if (status === 'In Progress') return { key: 'live', label: 'Live now', action: 'Rejoin', to: `/meetings/${m._id}/room` };
  if (status === 'Scheduled' || status === 'Not Started' || !status) {
    return { key: 'ready', label: 'Not started', action: 'Open room', to: `/meetings/${m._id}/room` };
  }
  if (m?.summaryStatus === 'Sent') return { key: 'sent', label: 'Sent to class', action: 'View', to: `/meetings/${m._id}/summary` };
  const hasNotes = Boolean(String(m?.pendingSummary || m?.summary || '').trim());
  if (!hasNotes && m?.transcriptionStatus === 'Failed') {
    return { key: 'failed', label: 'Notes failed', action: 'Fix', to: `/meetings/${m._id}/summary` };
  }
  if (!hasNotes) return { key: 'writing', label: 'Writing notes', action: 'Open', to: `/meetings/${m._id}/summary` };
  return { key: 'review', label: 'Needs review', action: 'Review & send', to: `/meetings/${m._id}/summary` };
}

export default function TeacherDashboard() {
  const trial = useTrialExperience();
  const profile = trial?.profile;
  const navigate = useNavigate();

  const [courses, setCourses] = useState([]);
  const [coursesLoading, setCoursesLoading] = useState(true);
  const [coursesError, setCoursesError] = useState('');
  const [selectedKey, setSelectedKey] = useState('');
  const [topic, setTopic] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [lectures, setLectures] = useState([]);
  const [lecturesLoading, setLecturesLoading] = useState(true);
  const [lecturesError, setLecturesError] = useState('');
  const [quizStats, setQuizStats] = useState({ loading: true, avgPct: null, pendingMandatory: 0, attempts: 0 });
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [onboardingStep, setOnboardingStep] = useState(0);
  const classesRef = useRef(null);
  const topicRef = useRef(null);
  const startButtonRef = useRef(null);
  const queueRef = useRef(null);

  const teacherName =
    (profile?.username && String(profile.username).trim()) ||
    (profile?.email && String(profile.email).trim()) ||
    'Teacher';
  const teacherEmail = String(profile?.email || '').trim().toLowerCase();
  const teacherUid = String(profile?.id || profile?._id || profile?.email || '').trim();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setCoursesLoading(true);
      setCoursesError('');
      try {
        const { courses: list } = await listCourses();
        if (!cancelled) setCourses(Array.isArray(list) ? list : []);
      } catch (err) {
        if (!cancelled) setCoursesError(err.response?.data?.error || err.message || 'Could not load your classes.');
      } finally {
        if (!cancelled) setCoursesLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLecturesLoading(true);
      setLecturesError('');
      try {
        const res = await axios.get('/meetings', { timeout: 30000 });
        if (cancelled) return;
        const rows = Array.isArray(res.data?.meetings) ? res.data.meetings : [];
        const mine = rows.filter((m) => {
          const owner = String(m?.educationTeacherEmail || '').trim().toLowerCase();
          const organizer = String(m?.organizer || '').trim().toLowerCase();
          if (teacherEmail) return owner === teacherEmail || organizer === teacherEmail;
          return String(m?.educationTeacherName || '').trim().toLowerCase() === teacherName.toLowerCase();
        });
        mine.sort((a, b) => (lectureDate(b)?.getTime() || 0) - (lectureDate(a)?.getTime() || 0));
        setLectures(mine);
      } catch (err) {
        if (cancelled) return;
        const d = err.response?.data;
        setLecturesError([d?.error, d?.details].filter(Boolean).join(' — ') || err.message || 'Could not load your lectures.');
      } finally {
        if (!cancelled) setLecturesLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [teacherEmail, teacherName]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await axios.get('/meetings/quiz-results/summary');
        if (cancelled) return;
        const list = Array.isArray(res.data?.lectures) ? res.data.lectures : [];
        let correct = 0;
        let total = 0;
        let attempts = 0;
        let pendingMandatory = 0;
        list.forEach((lec) => {
          const a = Array.isArray(lec.attempts) ? lec.attempts : [];
          if (lec.mandatory && a.length === 0) pendingMandatory += 1;
          attempts += a.length;
          a.forEach((x) => {
            if (x.total > 0) {
              correct += x.score;
              total += x.total;
            }
          });
        });
        setQuizStats({ loading: false, avgPct: total > 0 ? Math.round((correct / total) * 100) : null, pendingMandatory, attempts });
      } catch {
        if (!cancelled) setQuizStats({ loading: false, avgPct: null, pendingMandatory: 0, attempts: 0 });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /** Every course → semester → subject this teacher can teach, as one flat list of classes. */
  const classes = useMemo(() => {
    const out = [];
    courses.forEach((c) => {
      (Array.isArray(c?.semesters) ? c.semesters : []).forEach((s) => {
        (Array.isArray(s?.subjects) ? s.subjects : []).forEach((subject) => {
          const subj = String(subject || '').trim();
          if (!subj) return;
          out.push({
            key: `${c._id}|${s._id}|${subj}`,
            course: c,
            semester: s,
            subject: subj,
            classroomId: `${c._id}:${s._id || s.name}`,
            label: `${String(c.name || 'Course').trim()} — ${String(s.name || 'Semester').trim()}`,
            students: buildParticipantsFromSemester(s).length,
          });
        });
      });
    });
    // Classes taught most recently first, so today's class is usually the first tile.
    const lastTaught = new Map();
    lectures.forEach((m) => {
      const k = `${m.educationClassroomId}|${m.educationSubject}`;
      const t = lectureDate(m)?.getTime() || 0;
      if (!lastTaught.has(k) || lastTaught.get(k) < t) lastTaught.set(k, t);
    });
    out.forEach((x) => {
      x.lastTaughtAt = lastTaught.get(`${x.classroomId}|${x.subject}`) || 0;
    });
    return out.sort((a, b) => b.lastTaughtAt - a.lastTaughtAt);
  }, [courses, lectures]);

  const selected = classes.find((x) => x.key === selectedKey) || null;

  const weekAgo = Date.now() - 7 * 86400000;
  const weekCount = lectures.filter((m) => (lectureDate(m)?.getTime() || 0) >= weekAgo).length;
  const staged = lectures.map((m) => ({ m, stage: lectureStage(m) }));
  const liveNow = staged.find((x) => x.stage.key === 'live') || null;
  const queue = staged.filter((x) => ['review', 'writing', 'failed'].includes(x.stage.key)).slice(0, 6);
  const reviewCount = staged.filter((x) => x.stage.key === 'review').length;
  const recent = staged.slice(0, 8);

  const onboardingSteps = useMemo(
    () => [
      {
        id: 'class',
        title: 'Pick the class you are teaching',
        body: 'Every course, semester and subject your admin assigned to you is here. One tap selects it — the student list comes with it.',
        target: classesRef,
        icon: BookOpen,
      },
      {
        id: 'topic',
        title: "Name today's topic",
        body: 'Optional. It becomes the lecture title students see in their recap.',
        target: topicRef,
        icon: Type,
      },
      {
        id: 'start',
        title: 'Go live',
        body: 'Opens the room with recording, slides and the whiteboard ready. When you end the lecture you land straight on the notes.',
        target: startButtonRef,
        icon: Zap,
      },
      {
        id: 'queue',
        title: 'Finish what is waiting',
        body: 'Lectures whose notes are ready for you show up here. Review, add a quiz and send — three steps.',
        target: queueRef,
        icon: Inbox,
      },
    ],
    []
  );

  useEffect(() => {
    if (!teacherUid) return;
    if (!hasSeenTour(teacherDashboardTourKey(teacherUid))) {
      setOnboardingOpen(true);
      setOnboardingStep(0);
    }
  }, [teacherUid]);

  const handleStart = async () => {
    setError('');
    if (!selected) {
      setError('Pick a class first.');
      return;
    }
    const participants = buildParticipantsFromSemester(selected.semester);
    if (!participants.length) {
      setError('This semester has no students yet. Ask your admin to add the class list under Courses.');
      return;
    }
    setCreating(true);
    try {
      const now = new Date();
      const title =
        topic.trim() || `${selected.subject} — ${now.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`;
      const body = {
        title,
        agenda: `Lecture for ${selected.label} · Subject: ${selected.subject}`,
        organizer: (profile?.email && String(profile.email).trim()) || teacherName,
        scheduledTime: now.toISOString(),
        participants,
        sendNotification: false,
        transcriptionEnabled: true,
        meetingRoom: selected.label,
        educationClassroomId: selected.classroomId,
        educationClassroomName: selected.label,
        educationSubject: selected.subject,
        educationTeacherName: teacherName,
        educationTeacherEmail: teacherEmail || undefined,
        summaryMode: 'standard',
      };
      const res = await axios.post('/meetings', body, { timeout: 30000 });
      const id = res.data?.meeting?._id || res.data?.meeting?.id;
      if (!id) {
        setError('The lecture was created but did not open. Find it under Recent lectures.');
        return;
      }
      navigate(`/meetings/${String(id)}/room`);
    } catch (err) {
      const d = err.response?.data;
      setError([d?.error, d?.details].filter(Boolean).join(' — ') || err.message || 'Could not start the lecture.');
    } finally {
      setCreating(false);
    }
  };

  const today = new Date();
  const firstName = teacherName.replace(/^(dr|prof|mr|mrs|ms)\.?\s+/i, '').split(/\s+/)[0] || teacherName;
  const honorific = /^(dr|prof)\.?\s/i.test(teacherName) ? teacherName : firstName;

  return (
    <div className="dashboard-screen tdash">
      <div className="dashboard-wrapper">
        <div className="dashboard-content tdash__content">
          <header className="tdash__header ux-dashboard-stagger" style={{ animationDelay: '0ms' }}>
            <div>
              <p className="tdash__eyebrow">
                {today.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
              </p>
              <h1 className="tdash__title">
                {greetingFor(today)}, {honorific}
              </h1>
              <p className="tdash__subtitle">
                {reviewCount > 0
                  ? `${reviewCount} lecture${reviewCount === 1 ? ' is' : 's are'} ready for your review. Start today's class below.`
                  : 'Pick a class and go live. Notes, quiz and student recap are written for you.'}
              </p>
            </div>
            <div className="tdash__header-actions">
              <button type="button" className="tdash__btn tdash__btn--ghost" onClick={() => { setOnboardingStep(0); setOnboardingOpen(true); }}>
                <HelpCircle size={16} strokeWidth={2} aria-hidden /> Quick tour
              </button>
              <button type="button" className="tdash__btn tdash__btn--ghost" onClick={() => navigate('/meetings')}>
                All {T.meetings().toLowerCase()} <ArrowRight size={15} strokeWidth={2} aria-hidden />
              </button>
            </div>
          </header>

          {liveNow && (
            <button type="button" className="tdash__live ux-dashboard-stagger" onClick={() => navigate(liveNow.stage.to)}>
              <span className="tdash__live-dot" aria-hidden />
              <Radio size={17} strokeWidth={2} aria-hidden />
              <span className="tdash__live-text">
                <strong>{liveNow.m.title || 'Lecture'}</strong> is still live
                {liveNow.m.educationClassroomName ? ` · ${liveNow.m.educationClassroomName}` : ''}
              </span>
              <span className="tdash__live-cta">
                Rejoin <ArrowRight size={15} strokeWidth={2} aria-hidden />
              </span>
            </button>
          )}

          <div className="tdash__stats ux-dashboard-stagger" style={{ animationDelay: '30ms' }}>
            <div className="tdash__stat">
              <span className="tdash__stat-ic" aria-hidden>
                <CalendarDays size={18} strokeWidth={1.9} />
              </span>
              <div>
                <div className="tdash__stat-value">{lecturesLoading ? '—' : weekCount}</div>
                <div className="tdash__stat-label">Lectures this week</div>
              </div>
            </div>
            <div className={`tdash__stat${reviewCount > 0 ? ' is-accent' : ''}`}>
              <span className="tdash__stat-ic" aria-hidden>
                <FileCheck2 size={18} strokeWidth={1.9} />
              </span>
              <div>
                <div className="tdash__stat-value">{lecturesLoading ? '—' : reviewCount}</div>
                <div className="tdash__stat-label">Awaiting your review</div>
              </div>
            </div>
            <button type="button" className="tdash__stat tdash__stat--link" onClick={() => navigate('/quiz-results')}>
              <span className="tdash__stat-ic" aria-hidden>
                <Target size={18} strokeWidth={1.9} />
              </span>
              <div>
                <div className="tdash__stat-value">
                  {quizStats.loading ? '—' : quizStats.avgPct === null ? '—' : `${quizStats.avgPct}%`}
                </div>
                <div className="tdash__stat-label">
                  Avg quiz score{quizStats.attempts ? ` · ${quizStats.attempts} attempt${quizStats.attempts === 1 ? '' : 's'}` : ''}
                </div>
              </div>
            </button>
            <button
              type="button"
              className={`tdash__stat tdash__stat--link${quizStats.pendingMandatory > 0 ? ' is-alert' : ''}`}
              onClick={() => navigate('/quiz-results')}
            >
              <span className="tdash__stat-ic" aria-hidden>
                <AlertCircle size={18} strokeWidth={1.9} />
              </span>
              <div>
                <div className="tdash__stat-value">{quizStats.loading ? '—' : quizStats.pendingMandatory}</div>
                <div className="tdash__stat-label">Required quizzes, no attempts</div>
              </div>
            </button>
          </div>

          <div className="tdash__grid">
            <section className="tdash__card tdash__start ux-dashboard-stagger" style={{ animationDelay: '60ms' }} aria-label="Start a lecture">
              <div className="tdash__card-head">
                <div>
                  <h2 className="tdash__card-title">Start a lecture</h2>
                  <p className="tdash__card-sub">Choose the class, add today&apos;s topic, go live.</p>
                </div>
              </div>

              <p className="tdash__step-label">
                <span>1</span> Class
              </p>
              <div className="tdash__classes" ref={classesRef} role="radiogroup" aria-label="Class">
                {coursesLoading ? (
                  [0, 1, 2].map((i) => <div key={i} className="tdash__subject tdash__subject--skeleton" aria-hidden />)
                ) : classes.length ? (
                  classes.map((x) => {
                    const on = x.key === selectedKey;
                    return (
                      <button
                        key={x.key}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        className={`tdash__subject${on ? ' is-selected' : ''}`}
                        onClick={() => {
                          setSelectedKey(on ? '' : x.key);
                          setError('');
                        }}
                      >
                        <span className="tdash__subject-check" aria-hidden>
                          {on ? <Check size={13} strokeWidth={3} /> : null}
                        </span>
                        <span className="tdash__subject-name">{x.subject}</span>
                        <span className="tdash__subject-meta">{x.label}</span>
                        <span className="tdash__subject-foot">
                          <Users size={13} strokeWidth={2} aria-hidden /> {x.students} student{x.students === 1 ? '' : 's'}
                          {x.lastTaughtAt ? <em>Taught {relativeDay(new Date(x.lastTaughtAt)).replace(/,.*$/, '').replace(/^(Today|Yesterday)$/, (w) => w.toLowerCase())}</em> : null}
                        </span>
                      </button>
                    );
                  })
                ) : (
                  <div className="tdash__empty">
                    <BookOpen size={20} strokeWidth={1.8} aria-hidden />
                    <div>
                      <strong>No classes assigned yet</strong>
                      <p>Your admin assigns courses, semesters and subjects to you. Once they do, they appear here.</p>
                    </div>
                  </div>
                )}
              </div>

              <p className="tdash__step-label">
                <span>2</span> Topic <em>optional</em>
              </p>
              <input
                ref={topicRef}
                type="text"
                className="tdash__topic"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && selected && !creating) handleStart();
                }}
                placeholder={selected ? `e.g. ${selected.subject}: introduction and key ideas` : 'e.g. Bias, variance and cross-validation'}
                maxLength={140}
              />

              {(coursesError || error) && <div className="tdash__error">{coursesError || error}</div>}

              <div className={`tdash__launch${selected ? ' is-ready' : ''}`}>
                <div className="tdash__launch-summary">
                  {selected ? (
                    <>
                      <strong>{selected.subject}</strong>
                      <span>
                        {selected.label} · {selected.students} student{selected.students === 1 ? '' : 's'} get the recap
                      </span>
                    </>
                  ) : (
                    <>
                      <strong>No class selected</strong>
                      <span>Pick a class above to start.</span>
                    </>
                  )}
                </div>
                <button
                  ref={startButtonRef}
                  type="button"
                  className="tdash__btn tdash__btn--primary tdash__btn--lg"
                  onClick={handleStart}
                  disabled={!selected || creating}
                  data-action="start-lecture"
                >
                  <PlayCircle size={18} strokeWidth={2} aria-hidden />
                  {creating ? 'Starting…' : 'Start lecture'}
                </button>
              </div>
            </section>

            <section
              className="tdash__card tdash__queue ux-dashboard-stagger"
              style={{ animationDelay: '90ms' }}
              ref={queueRef}
              aria-label="Needs your attention"
            >
              <div className="tdash__card-head">
                <div>
                  <h2 className="tdash__card-title">Needs your attention</h2>
                  <p className="tdash__card-sub">Review, add a quiz, send to class.</p>
                </div>
                {queue.length > 0 && <span className="tdash__count">{queue.length}</span>}
              </div>
              {lecturesLoading ? (
                <div className="tdash__queue-list">
                  {[0, 1].map((i) => (
                    <div key={i} className="tdash__queue-item tdash__queue-item--skeleton" aria-hidden />
                  ))}
                </div>
              ) : queue.length ? (
                <ul className="tdash__queue-list">
                  {queue.map(({ m, stage }) => (
                    <li key={m._id}>
                      <button type="button" className="tdash__queue-item" onClick={() => navigate(stage.to)}>
                        <span className={`tdash__badge tdash__badge--${stage.key}`}>{stage.label}</span>
                        <span className="tdash__queue-title">{m.title || 'Untitled lecture'}</span>
                        <span className="tdash__queue-meta">
                          {[m.educationSubject, relativeDay(lectureDate(m))].filter(Boolean).join(' · ')}
                        </span>
                        <span className="tdash__queue-cta">
                          {stage.action} <ArrowRight size={14} strokeWidth={2} aria-hidden />
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="tdash__all-clear">
                  <span className="tdash__all-clear-ic" aria-hidden>
                    <Check size={18} strokeWidth={2.5} />
                  </span>
                  <strong>All caught up</strong>
                  <p>Every lecture has been sent to its class. New ones appear here as soon as you end them.</p>
                </div>
              )}
            </section>
          </div>

          <section className="tdash__card tdash__recent ux-dashboard-stagger" style={{ animationDelay: '120ms' }} aria-label="Recent lectures">
            <div className="tdash__card-head">
              <div>
                <h2 className="tdash__card-title">Recent lectures</h2>
              </div>
              <button type="button" className="tdash__link" onClick={() => navigate('/meetings')}>
                View all <ArrowRight size={14} strokeWidth={2} aria-hidden />
              </button>
            </div>
            {lecturesError && <div className="tdash__error">{lecturesError}</div>}
            {lecturesLoading ? (
              <div className="tdash__table-skeleton" aria-hidden />
            ) : recent.length ? (
              <div className="tdash__table-wrap">
                <table className="tdash__table">
                  <thead>
                    <tr>
                      <th>Lecture</th>
                      <th>Class</th>
                      <th>When</th>
                      <th>Quiz</th>
                      <th>Status</th>
                      <th aria-label="Action" />
                    </tr>
                  </thead>
                  <tbody>
                    {recent.map(({ m, stage }) => {
                      const qn = (m.quiz?.questions || []).length;
                      const attempts = (m.quiz?.attempts || []).length;
                      return (
                        <tr key={m._id} onClick={() => navigate(stage.to)}>
                          <td>
                            <span className="tdash__cell-title">{m.title || 'Untitled lecture'}</span>
                            <span className="tdash__cell-sub">{m.educationSubject || ''}</span>
                          </td>
                          <td className="tdash__cell-muted">{m.educationClassroomName || '—'}</td>
                          <td className="tdash__cell-muted">{relativeDay(lectureDate(m))}</td>
                          <td className="tdash__cell-muted">
                            {qn ? `${attempts} attempt${attempts === 1 ? '' : 's'}${m.quiz?.mandatory ? ' · req.' : ''}` : '—'}
                          </td>
                          <td>
                            <span className={`tdash__badge tdash__badge--${stage.key}`}>{stage.label}</span>
                          </td>
                          <td className="tdash__cell-action">
                            <button
                              type="button"
                              className="tdash__link"
                              onClick={(e) => {
                                e.stopPropagation();
                                navigate(stage.to);
                              }}
                            >
                              {stage.action}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="tdash__empty tdash__empty--wide">
                <PlayCircle size={20} strokeWidth={1.8} aria-hidden />
                <div>
                  <strong>No lectures yet</strong>
                  <p>Your first lecture shows up here with its notes, quiz and results.</p>
                </div>
              </div>
            )}
          </section>

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

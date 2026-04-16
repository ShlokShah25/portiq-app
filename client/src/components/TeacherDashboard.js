import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useTrialExperience } from './TrialExperienceProvider';
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

export default function TeacherDashboard() {
  const trial = useTrialExperience();
  const profile = trial?.profile;
  const navigate = useNavigate();

  const [selectedClassroomId, setSelectedClassroomId] = useState('');
  const [selectedSubject, setSelectedSubject] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [onboardingStep, setOnboardingStep] = useState(0);

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

  const onboardingSteps = [
    {
      title: 'Choose your classroom',
      body: 'Pick the classroom you are teaching right now. This automatically links the right student list.',
    },
    {
      title: 'Select the subject',
      body: 'Choose the lecture subject from your classroom setup so notes and summaries stay organized.',
    },
    {
      title: 'Start lecture instantly',
      body: 'Click Start lecture and you are taken directly into the live lecture room with no extra form.',
    },
  ];

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

  const handleCreateAndStart = async () => {
    setError('');
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

      const body = {
        title: `${subjectLabel} – ${className}`,
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
              <div className="dashboard-education-pill dashboard-education-pill--wide dashboard-teacher-card">
                <span className="dashboard-education-pill__k">Subject</span>
                <select
                  value={selectedSubject}
                  onChange={(e) => setSelectedSubject(e.target.value)}
                  disabled={!subjectAssignments.length}
                >
                  <option value="">Select subject</option>
                  {subjectAssignments.map((row) => (
                    <option key={row.subject} value={row.subject}>
                      {row.subject}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {selectedClassroom && (
              <p className="dashboard-education-strip__hint">
                {Array.isArray(selectedClassroom.studentEmails)
                  ? `${selectedClassroom.studentEmails.length} students in this classroom.`
                  : 'Add students to this classroom so they receive lecture notes.'}
              </p>
            )}
            {error && <div className="start-meeting-error">{error}</div>}

            <div className="dashboard-start-meeting__actions">
              <button
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

          {onboardingOpen && (
            <div className="dashboard-teacher-tour" role="dialog" aria-modal="true">
              <div className="dashboard-teacher-tour__backdrop" onClick={() => closeOnboarding(true)} />
              <div className="dashboard-teacher-tour__card">
                <p className="dashboard-teacher-tour__step">
                  Step {onboardingStep + 1} of {onboardingSteps.length}
                </p>
                <h3 className="dashboard-teacher-tour__title">{onboardingSteps[onboardingStep].title}</h3>
                <p className="dashboard-teacher-tour__body">{onboardingSteps[onboardingStep].body}</p>
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


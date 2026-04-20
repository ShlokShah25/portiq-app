import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import { BarChart3, GraduationCap, Users } from 'lucide-react';
import { getClassrooms } from '../utils/classroomsStorage';
import { useTrialExperience } from './TrialExperienceProvider';

export default function EducationAdminDashboard() {
  const trial = useTrialExperience();
  const profile = trial?.profile;
  const role = String(profile?.role || '').toLowerCase();
  const isEducationAccount = String(profile?.productType || '').toLowerCase() === 'education';
  const canManageTeachers = isEducationAccount && (role === 'admin' || role === 'super_admin');
  const classrooms = useMemo(() => getClassrooms(), []);
  const [teachers, setTeachers] = useState([]);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [onboardingStep, setOnboardingStep] = useState(0);

  const studentsCount = useMemo(
    () =>
      classrooms.reduce(
        (sum, c) => sum + (Array.isArray(c.studentEmails) ? c.studentEmails.length : 0),
        0
      ),
    [classrooms]
  );

  const subjectsCount = useMemo(
    () =>
      classrooms.reduce(
        (sum, c) =>
          sum +
          (Array.isArray(c.subjectAssignments)
            ? c.subjectAssignments.filter((s) => String(s?.subject || '').trim()).length
            : 0),
        0
      ),
    [classrooms]
  );

  useEffect(() => {
    if (!canManageTeachers) {
      setTeachers([]);
      return undefined;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await axios.get('/admin/teachers');
        if (!cancelled) {
          const list = Array.isArray(res.data?.teachers) ? res.data.teachers : [];
          setTeachers(list);
        }
      } catch (_) {
        if (!cancelled) setTeachers([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [canManageTeachers]);

  const onboardingSteps = [
    {
      title: 'Build your class roster',
      body: 'Add classrooms, enroll students, and map subjects per class. Teachers then pick from what you configure—no duplicate data entry.',
      Icon: GraduationCap,
    },
    {
      title: 'Invite your teaching team',
      body: 'Create teacher accounts from the Teachers page. Everyone signs in separately; lecture tools stay on their dashboards.',
      Icon: Users,
    },
    {
      title: 'Watch your school at a glance',
      body: 'These cards summarize classrooms, students, and subjects so you can spot gaps before the term gets busy.',
      Icon: BarChart3,
    },
  ];

  useEffect(() => {
    const uid = String(profile?.id || profile?._id || profile?.email || '').trim();
    if (!uid) return;
    const key = `portiq_edu_admin_onboarding_v1_${uid}`;
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
        window.localStorage.setItem(`portiq_edu_admin_onboarding_v1_${uid}`, '1');
      } catch (_) {
        // ignore storage errors
      }
    }
    setOnboardingOpen(false);
  };

  const currentStep = onboardingSteps[onboardingStep] || onboardingSteps[0];
  const StepIcon = currentStep?.Icon;

  const adminName =
    String(profile?.username || '').trim() || String(profile?.email || '').trim() || 'Admin';

  return (
    <div className="dashboard-screen">
      <div className="dashboard-wrapper">
        <div className="dashboard-content">
          <header className="dashboard-hero-minimal" aria-label="Organization dashboard">
            <h1 className="dashboard-title">Organization Dashboard</h1>
            <p className="dashboard-subtitle">
              Welcome, {adminName}. Manage classrooms and teachers. Lecture controls stay on teacher
              accounts.
            </p>
          </header>

          <section className="dashboard-education-admin-grid">
            <article className="dashboard-education-admin-card">
              <div className="dashboard-education-admin-card__head">
                <GraduationCap size={18} strokeWidth={1.75} />
                <h2>Classrooms</h2>
              </div>
              <div className="dashboard-education-admin-stats">
                <div>
                  <span>Classrooms</span>
                  <strong>{classrooms.length}</strong>
                </div>
                <div>
                  <span>Students</span>
                  <strong>{studentsCount}</strong>
                </div>
                <div>
                  <span>Subjects</span>
                  <strong>{subjectsCount}</strong>
                </div>
              </div>
              <p className="dashboard-education-admin-card__hint">
                Create and manage classrooms, students, and subject-teacher mappings (7 classrooms,
                40 students/classroom, 9 subjects/classroom).
              </p>
              <div className="dashboard-start-meeting__actions">
                <Link className="dashboard-btn-primary dashboard-btn-micro" to="/classes">
                  Open Classrooms
                </Link>
                <button
                  type="button"
                  className="dashboard-btn-secondary dashboard-btn-micro"
                  onClick={() => {
                    setOnboardingStep(0);
                    setOnboardingOpen(true);
                  }}
                >
                  Quick help
                </button>
              </div>
            </article>

            <article className="dashboard-education-admin-card">
              <div className="dashboard-education-admin-card__head">
                <Users size={18} strokeWidth={1.75} />
                <h2>Teachers</h2>
              </div>
              <div className="dashboard-education-admin-stats">
                <div>
                  <span>Active teachers</span>
                  <strong>{teachers.length}</strong>
                </div>
              </div>
              {teachers.length > 0 ? (
                <ul className="dashboard-education-admin-list">
                  {teachers.slice(0, 3).map((t) => (
                    <li key={String(t._id || t.id || t.email)}>
                      <span>{t.username || t.email?.split('@')[0] || 'Teacher'}</span>
                      <small>{t.email}</small>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="dashboard-education-admin-card__hint">
                  No teachers yet. Create one from the teachers page (teacher accounts are unlimited).
                </p>
              )}
              <div className="dashboard-start-meeting__actions" style={{ marginTop: 10 }}>
                <Link className="dashboard-btn-secondary dashboard-btn-micro" to="/teachers">
                  View all teachers
                </Link>
              </div>
            </article>
          </section>

          {onboardingOpen && (
            <div className="dashboard-teacher-tour" role="dialog" aria-modal="true">
              <div className="dashboard-teacher-tour__backdrop" onClick={() => closeOnboarding(true)} />
              <div className="dashboard-teacher-tour__card dashboard-teacher-tour__card--centered">
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
                    <p className="dashboard-teacher-tour__eyebrow">Welcome to PortIQ</p>
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


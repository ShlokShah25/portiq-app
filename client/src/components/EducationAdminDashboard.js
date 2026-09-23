import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import { BarChart3, GraduationCap, Users } from 'lucide-react';
import { listCourses } from '../utils/coursesApi';
import { useTrialExperience } from './TrialExperienceProvider';
import OnboardingTour, { hasSeenTour } from './OnboardingTour';

/** Admin onboarding uses its own key prefix, distinct from the teacher tour. */
function adminDashboardTourKey(uid) {
  return `portiq_edu_admin_onboarding_v1_${uid}`;
}

export default function EducationAdminDashboard() {
  const trial = useTrialExperience();
  const profile = trial?.profile;
  const role = String(profile?.role || '').toLowerCase();
  const isEducationAccount = String(profile?.productType || '').toLowerCase() === 'education';
  const canManageTeachers = isEducationAccount && (role === 'admin' || role === 'super_admin');
  const [courses, setCourses] = useState([]);
  const [teachers, setTeachers] = useState([]);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [onboardingStep, setOnboardingStep] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { courses: list } = await listCourses();
        if (!cancelled) setCourses(list);
      } catch (_) {
        if (!cancelled) setCourses([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const semestersCount = useMemo(
    () => courses.reduce((sum, c) => sum + (Array.isArray(c.semesters) ? c.semesters.length : 0), 0),
    [courses]
  );

  const studentsCount = useMemo(
    () =>
      courses.reduce(
        (sum, c) =>
          sum +
          (Array.isArray(c.semesters)
            ? c.semesters.reduce(
                (s2, sem) => s2 + (Array.isArray(sem.studentRoster) ? sem.studentRoster.length : 0),
                0
              )
            : 0),
        0
      ),
    [courses]
  );

  const subjectsCount = useMemo(
    () =>
      courses.reduce(
        (sum, c) =>
          sum +
          (Array.isArray(c.semesters)
            ? c.semesters.reduce((s2, sem) => s2 + (Array.isArray(sem.subjects) ? sem.subjects.length : 0), 0)
            : 0),
        0
      ),
    [courses]
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

  const onboardingSteps = useMemo(
    () => [
      {
        id: 'courses',
        title: 'Set up your courses',
        body: 'Add courses (e.g. MBA Tech AI), semesters, subjects, and student rosters. Faculty then pick from what you configure—no duplicate data entry.',
        target: null,
        icon: GraduationCap,
      },
      {
        id: 'teachers',
        title: 'Invite your teaching team',
        body: 'Create faculty accounts from the Teachers page. Everyone signs in separately; lecture tools stay on their dashboards.',
        target: null,
        icon: Users,
      },
      {
        id: 'overview',
        title: 'Watch your college at a glance',
        body: 'These cards summarize courses, semesters, students, and subjects so you can spot gaps before the term gets busy.',
        target: null,
        icon: BarChart3,
      },
    ],
    []
  );

  const adminUid = String(profile?.id || profile?._id || profile?.email || '').trim();

  useEffect(() => {
    if (!adminUid) return;
    if (!hasSeenTour(adminDashboardTourKey(adminUid))) {
      setOnboardingOpen(true);
      setOnboardingStep(0);
    }
  }, [adminUid]);

  const adminName =
    String(profile?.username || '').trim() || String(profile?.email || '').trim() || 'Admin';

  return (
    <div className="dashboard-screen">
      <div className="dashboard-wrapper">
        <div className="dashboard-content">
          <header className="dashboard-hero-minimal" aria-label="Organization dashboard">
            <h1 className="dashboard-title">Organization Dashboard</h1>
            <p className="dashboard-subtitle">
              Welcome, {adminName}. Manage courses and faculty. Lecture controls stay on faculty
              accounts.
            </p>
          </header>

          <section className="dashboard-education-admin-grid">
            <article className="dashboard-education-admin-card">
              <div className="dashboard-education-admin-card__head">
                <GraduationCap size={18} strokeWidth={1.75} />
                <h2>Courses</h2>
              </div>
              <div className="dashboard-education-admin-stats">
                <div>
                  <span>Courses</span>
                  <strong>{courses.length}</strong>
                </div>
                <div>
                  <span>Semesters</span>
                  <strong>{semestersCount}</strong>
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
                Create courses, add semesters with subjects, and enroll students per semester.
                Faculty pick from this when starting a lecture.
              </p>
              <div className="dashboard-start-meeting__actions">
                <Link className="dashboard-btn-primary dashboard-btn-micro" to="/courses">
                  Open Courses
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

          <OnboardingTour
            steps={onboardingSteps}
            open={onboardingOpen}
            currentStep={onboardingStep}
            onNext={() => setOnboardingStep((s) => Math.min(onboardingSteps.length - 1, s + 1))}
            onBack={() => setOnboardingStep((s) => Math.max(0, s - 1))}
            onSkip={() => setOnboardingOpen(false)}
            onFinish={() => setOnboardingOpen(false)}
            storageKey={adminUid ? adminDashboardTourKey(adminUid) : undefined}
          />
        </div>
      </div>
    </div>
  );
}


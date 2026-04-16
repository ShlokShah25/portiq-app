import React, { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { GraduationCap, Users, BookOpenCheck } from 'lucide-react';
import { getClassrooms } from '../utils/classroomsStorage';
import { useTrialExperience } from './TrialExperienceProvider';

function collectTeacherRows(classrooms) {
  const map = new Map();
  classrooms.forEach((c) => {
    const className = String(c.className || '').trim() || 'Classroom';
    const rows = Array.isArray(c.subjectAssignments) ? c.subjectAssignments : [];
    rows.forEach((row) => {
      const email = String(row.teacherEmail || '').trim().toLowerCase();
      if (!email) return;
      const key = email;
      const existing = map.get(key) || {
        email,
        teacherName: String(row.teacherName || '').trim() || email.split('@')[0],
        subjects: new Set(),
        classrooms: new Set(),
      };
      if (row.subject) existing.subjects.add(String(row.subject).trim());
      existing.classrooms.add(className);
      map.set(key, existing);
    });
  });
  return [...map.values()]
    .map((x) => ({
      ...x,
      subjects: [...x.subjects],
      classrooms: [...x.classrooms],
    }))
    .sort((a, b) => a.teacherName.localeCompare(b.teacherName));
}

export default function EducationAdminDashboard() {
  const navigate = useNavigate();
  const trial = useTrialExperience();
  const profile = trial?.profile;
  const classrooms = useMemo(() => getClassrooms(), []);

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

  const teachers = useMemo(() => collectTeacherRows(classrooms), [classrooms]);
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
                Create and manage classrooms, students, and subject-teacher mappings.
              </p>
              <div className="dashboard-start-meeting__actions">
                <Link className="dashboard-btn-primary dashboard-btn-micro" to="/classes">
                  Open Classrooms
                </Link>
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
                  {teachers.slice(0, 6).map((t) => (
                    <li key={t.email}>
                      <span>{t.teacherName}</span>
                      <small>{t.email}</small>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="dashboard-education-admin-card__hint">
                  No teacher mappings yet. Add subject-teacher rows inside classrooms.
                </p>
              )}
            </article>
          </section>

          <section className="dashboard-education-admin-card">
            <div className="dashboard-education-admin-card__head">
              <BookOpenCheck size={18} strokeWidth={1.75} />
              <h2>Lecture records</h2>
            </div>
            <p className="dashboard-education-admin-card__hint">
              Admins can review lecture records and summaries; teachers start and run lectures.
            </p>
            <div className="dashboard-start-meeting__actions">
              <button
                type="button"
                className="dashboard-btn-secondary dashboard-btn-micro"
                onClick={() => navigate('/admin')}
              >
                Open Records
              </button>
              <button
                type="button"
                className="dashboard-btn-secondary dashboard-btn-micro"
                onClick={() => navigate('/settings')}
              >
                Open Settings
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}


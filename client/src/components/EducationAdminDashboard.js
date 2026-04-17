import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import { GraduationCap, Users } from 'lucide-react';
import { getClassrooms } from '../utils/classroomsStorage';
import { useTrialExperience } from './TrialExperienceProvider';

export default function EducationAdminDashboard() {
  const trial = useTrialExperience();
  const profile = trial?.profile;
  const classrooms = useMemo(() => getClassrooms(), []);
  const [teachers, setTeachers] = useState([]);

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
  }, []);
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
        </div>
      </div>
    </div>
  );
}


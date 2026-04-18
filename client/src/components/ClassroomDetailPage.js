import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  getClassroomById,
  updateClassroom,
  deleteClassroom,
  MAX_STUDENTS_PER_CLASSROOM,
  MAX_SUBJECTS_PER_CLASSROOM,
} from '../utils/classroomsStorage';
import './ClassesPage.css';
import './ClassroomDetailPage.css';

function rosterForClassroom(c) {
  if (!c) return [];
  if (Array.isArray(c.studentRoster) && c.studentRoster.length > 0) return c.studentRoster;
  if (Array.isArray(c.studentEmails)) {
    return c.studentEmails.map((email) => ({
      name: '',
      email: String(email || '').trim().toLowerCase(),
    }));
  }
  return [];
}

const ClassroomDetailPage = () => {
  const { classroomId } = useParams();
  const navigate = useNavigate();
  const [classroom, setClassroom] = useState(null);
  const [missing, setMissing] = useState(false);

  const refresh = useCallback(() => {
    const c = getClassroomById(classroomId);
    if (!c) {
      setMissing(true);
      setClassroom(null);
      return;
    }
    setMissing(false);
    setClassroom(c);
  }, [classroomId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const roster = useMemo(() => rosterForClassroom(classroom), [classroom]);

  const handleRemoveStudent = (studentEmail) => {
    if (!classroom) return;
    const email = String(studentEmail || '').trim().toLowerCase();
    if (!email) return;
    if (!window.confirm(`Remove ${email} from ${classroom.className}?`)) return;

    const nextRoster = roster.filter((s) => String(s?.email || '').trim().toLowerCase() !== email);
    updateClassroom(classroom.id, {
      studentRoster: nextRoster,
      studentEmails: nextRoster.map((s) => s.email),
    });
    refresh();
  };

  const handleDeleteClassroom = () => {
    if (!classroom) return;
    if (!window.confirm(`Delete classroom “${classroom.className}”? This cannot be undone.`)) return;
    deleteClassroom(classroom.id);
    navigate('/classes', { replace: true });
  };

  if (missing) {
    return (
      <div className="classes-page class-detail-page">
        <div className="classes-wrapper class-detail-wrapper">
          <nav className="class-detail-breadcrumb">
            <Link to="/classes" className="class-detail-back-link">
              ← All classrooms
            </Link>
          </nav>
          <div className="class-detail-card class-detail-card--center">
            <h1 className="class-detail-title">Classroom not found</h1>
            <p className="class-detail-muted">It may have been deleted or the link is invalid.</p>
            <Link to="/classes" className="classes-btn-primary class-detail-primary-link">
              Back to classrooms
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (!classroom) {
    return (
      <div className="classes-page class-detail-page">
        <div className="classes-wrapper class-detail-wrapper">
          <p className="class-detail-muted">Loading classroom…</p>
        </div>
      </div>
    );
  }

  const subjects =
    Array.isArray(classroom.subjectAssignments) && classroom.subjectAssignments.length > 0
      ? classroom.subjectAssignments
      : (Array.isArray(classroom.subjects) ? classroom.subjects : []).map((subject) => ({ subject }));

  return (
    <div className="classes-page class-detail-page">
      <div className="classes-wrapper class-detail-wrapper">
        <nav className="class-detail-breadcrumb">
          <Link to="/classes" className="class-detail-back-link">
            ← All classrooms
          </Link>
        </nav>

        <header className="class-detail-header">
          <div className="class-detail-header-main">
            <h1 className="class-detail-title">{classroom.className}</h1>
            <p className="class-detail-muted">
              Up to {MAX_SUBJECTS_PER_CLASSROOM} subjects and {MAX_STUDENTS_PER_CLASSROOM} students per classroom.
            </p>
          </div>
          <div className="class-detail-header-actions">
            <Link to={`/classes?edit=${encodeURIComponent(classroom.id)}`} className="classes-btn-primary">
              Edit classroom
            </Link>
            <button type="button" className="classes-btn-secondary class-detail-btn-danger" onClick={handleDeleteClassroom}>
              Delete
            </button>
          </div>
        </header>

        <div className="class-detail-stats">
          <div className="class-detail-stat">
            <span className="class-detail-stat__label">Subjects</span>
            <span className="class-detail-stat__value">
              {subjects.length}/{MAX_SUBJECTS_PER_CLASSROOM}
            </span>
          </div>
          <div className="class-detail-stat">
            <span className="class-detail-stat__label">Students</span>
            <span className="class-detail-stat__value">
              {roster.length}/{MAX_STUDENTS_PER_CLASSROOM}
            </span>
          </div>
        </div>

        <section className="class-detail-section">
          <h2 className="class-detail-section-title">Subjects</h2>
          {subjects.length ? (
            <div className="classes-table-mappings class-detail-subject-wrap">
              {subjects.map((row) => (
                <span key={`${classroom.id}-${row.subject}`} className="classes-mapping-pill">
                  {row.subject}
                </span>
              ))}
            </div>
          ) : (
            <p className="class-detail-muted">No subjects assigned.</p>
          )}
        </section>

        <section className="class-detail-section">
          <h2 className="class-detail-section-title">Student roster</h2>
          {roster.length === 0 ? (
            <p className="class-detail-muted">No students yet. Add them when you edit this classroom.</p>
          ) : (
            <div className="classes-students-table-wrap class-detail-roster-wrap">
              <table className="classes-students-table">
                <thead>
                  <tr>
                    <th className="classes-students-table__roll">Roll no.</th>
                    <th>Name</th>
                    <th>Email</th>
                    <th className="class-detail-roster-actions-head"> </th>
                  </tr>
                </thead>
                <tbody>
                  {roster.map((s, index) => (
                    <tr key={s.email}>
                      <td className="classes-students-table__roll">{index + 1}</td>
                      <td>{s.name || '—'}</td>
                      <td>{s.email}</td>
                      <td className="class-detail-roster-actions">
                        <button
                          type="button"
                          className="classes-btn-sm classes-btn-danger"
                          onClick={() => handleRemoveStudent(s.email)}
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

export default ClassroomDetailPage;

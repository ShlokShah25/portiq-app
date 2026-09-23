import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import axios from 'axios';
import { getCourse, updateCourse, deleteCourse } from '../utils/coursesApi';
import './ClassesPage.css';
import './ClassroomDetailPage.css';

const DEFAULT_LIMITS = {
  MAX_SEMESTERS_PER_COURSE: 12,
  MAX_SUBJECTS_PER_SEMESTER: 15,
  MAX_STUDENTS_PER_SEMESTER: 120,
};

function rowKey(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function emptySemester() {
  return {
    rowKey: rowKey('sem'),
    name: '',
    subjects: [''],
    studentRoster: [{ name: '', email: '' }],
    assignedFacultyIds: [],
  };
}

const CourseDetailPage = () => {
  const { courseId } = useParams();
  const navigate = useNavigate();
  const [course, setCourse] = useState(null);
  const [limits, setLimits] = useState(DEFAULT_LIMITS);
  const [semesters, setSemesters] = useState([]);
  const [missing, setMissing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [openSemesterKey, setOpenSemesterKey] = useState(null);
  const [faculty, setFaculty] = useState([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await axios.get('/admin/teachers');
        if (!cancelled) setFaculty(Array.isArray(res.data?.teachers) ? res.data.teachers : []);
      } catch (_) {
        if (!cancelled) setFaculty([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setMissing(false);
    setError('');
    try {
      const { course: c, limits: lim } = await getCourse(courseId);
      if (!c) {
        setMissing(true);
        return;
      }
      setCourse(c);
      if (lim && Object.keys(lim).length) setLimits(lim);
      const withKeys = (Array.isArray(c.semesters) ? c.semesters : []).map((s) => ({
        rowKey: s._id || rowKey('sem'),
        name: s.name || '',
        subjects: Array.isArray(s.subjects) && s.subjects.length ? s.subjects : [''],
        studentRoster:
          Array.isArray(s.studentRoster) && s.studentRoster.length
            ? s.studentRoster
            : [{ name: '', email: '' }],
        assignedFacultyIds: Array.isArray(s.assignedFacultyIds)
          ? s.assignedFacultyIds.map((id) => String(id))
          : [],
      }));
      setSemesters(withKeys.length ? withKeys : []);
      if (withKeys.length) setOpenSemesterKey(withKeys[0].rowKey);
    } catch (err) {
      if (err.response?.status === 404) setMissing(true);
      else setError(err.response?.data?.error || err.message || 'Could not load course.');
    } finally {
      setLoading(false);
    }
  }, [courseId]);

  useEffect(() => {
    load();
  }, [load]);

  const addSemester = () => {
    setSemesters((prev) => {
      if (prev.length >= limits.MAX_SEMESTERS_PER_COURSE) return prev;
      const next = [...prev, emptySemester()];
      setOpenSemesterKey(next[next.length - 1].rowKey);
      return next;
    });
  };

  const removeSemester = (key) => {
    if (!window.confirm('Remove this semester? Its subjects and roster will be deleted too.')) return;
    setSemesters((prev) => prev.filter((s) => s.rowKey !== key));
  };

  const updateSemesterName = (key, name) => {
    setSemesters((prev) => prev.map((s) => (s.rowKey === key ? { ...s, name } : s)));
  };

  const updateSubject = (key, index, value) => {
    setSemesters((prev) =>
      prev.map((s) =>
        s.rowKey === key ? { ...s, subjects: s.subjects.map((sub, i) => (i === index ? value : sub)) } : s
      )
    );
  };

  const addSubject = (key) => {
    setSemesters((prev) =>
      prev.map((s) => {
        if (s.rowKey !== key) return s;
        if (s.subjects.length >= limits.MAX_SUBJECTS_PER_SEMESTER) return s;
        return { ...s, subjects: [...s.subjects, ''] };
      })
    );
  };

  const removeSubject = (key, index) => {
    setSemesters((prev) =>
      prev.map((s) => {
        if (s.rowKey !== key) return s;
        const next = s.subjects.filter((_, i) => i !== index);
        return { ...s, subjects: next.length ? next : [''] };
      })
    );
  };

  const updateStudent = (key, index, field, value) => {
    setSemesters((prev) =>
      prev.map((s) =>
        s.rowKey === key
          ? { ...s, studentRoster: s.studentRoster.map((row, i) => (i === index ? { ...row, [field]: value } : row)) }
          : s
      )
    );
  };

  const addStudent = (key) => {
    setSemesters((prev) =>
      prev.map((s) => {
        if (s.rowKey !== key) return s;
        if (s.studentRoster.length >= limits.MAX_STUDENTS_PER_SEMESTER) return s;
        return { ...s, studentRoster: [...s.studentRoster, { name: '', email: '' }] };
      })
    );
  };

  const removeStudent = (key, index) => {
    setSemesters((prev) =>
      prev.map((s) => {
        if (s.rowKey !== key) return s;
        const next = s.studentRoster.filter((_, i) => i !== index);
        return { ...s, studentRoster: next.length ? next : [{ name: '', email: '' }] };
      })
    );
  };

  const toggleFaculty = (key, teacherId) => {
    setSemesters((prev) =>
      prev.map((s) => {
        if (s.rowKey !== key) return s;
        const has = s.assignedFacultyIds.includes(teacherId);
        return {
          ...s,
          assignedFacultyIds: has
            ? s.assignedFacultyIds.filter((id) => id !== teacherId)
            : [...s.assignedFacultyIds, teacherId],
        };
      })
    );
  };

  const handleSaveAll = async () => {
    setError('');
    setNotice('');
    const cleanSemesters = semesters
      .map((s) => ({
        name: s.name.trim(),
        subjects: s.subjects.map((x) => String(x || '').trim()).filter(Boolean),
        studentRoster: s.studentRoster
          .map((r) => ({ name: String(r.name || '').trim(), email: String(r.email || '').trim().toLowerCase() }))
          .filter((r) => r.email),
        assignedFacultyIds: s.assignedFacultyIds,
      }))
      .filter((s) => s.name);

    setSaving(true);
    try {
      const updated = await updateCourse(courseId, { semesters: cleanSemesters });
      setCourse(updated);
      setNotice('Saved.');
      await load();
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Could not save changes.');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteCourse = async () => {
    if (!course) return;
    if (!window.confirm(`Delete course "${course.name}"? This cannot be undone.`)) return;
    try {
      await deleteCourse(course._id);
      navigate('/courses', { replace: true });
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Could not delete course.');
    }
  };

  const totals = useMemo(() => {
    const subjectTotal = semesters.reduce((sum, s) => sum + s.subjects.filter((x) => x.trim()).length, 0);
    const studentTotal = semesters.reduce((sum, s) => sum + s.studentRoster.filter((r) => r.email.trim()).length, 0);
    return { subjectTotal, studentTotal };
  }, [semesters]);

  if (loading) {
    return (
      <div className="classes-page class-detail-page">
        <div className="classes-wrapper class-detail-wrapper">
          <p className="class-detail-muted">Loading course…</p>
        </div>
      </div>
    );
  }

  if (missing) {
    return (
      <div className="classes-page class-detail-page">
        <div className="classes-wrapper class-detail-wrapper">
          <nav className="class-detail-breadcrumb">
            <Link to="/courses" className="class-detail-back-link">
              ← All courses
            </Link>
          </nav>
          <div className="class-detail-card class-detail-card--center">
            <h1 className="class-detail-title">Course not found</h1>
            <p className="class-detail-muted">It may have been deleted or the link is invalid.</p>
            <Link to="/courses" className="classes-btn-primary class-detail-primary-link">
              Back to courses
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="classes-page class-detail-page">
      <div className="classes-wrapper class-detail-wrapper">
        <nav className="class-detail-breadcrumb">
          <Link to="/courses" className="class-detail-back-link">
            ← All courses
          </Link>
        </nav>

        <header className="class-detail-header">
          <div className="class-detail-header-main">
            <h1 className="class-detail-title">{course?.name}</h1>
            <p className="class-detail-muted">
              Up to {limits.MAX_SEMESTERS_PER_COURSE} semesters, {limits.MAX_SUBJECTS_PER_SEMESTER} subjects/semester,{' '}
              {limits.MAX_STUDENTS_PER_SEMESTER} students/semester.
            </p>
          </div>
          <div className="class-detail-header-actions">
            <button type="button" className="classes-btn-secondary class-detail-btn-danger" onClick={handleDeleteCourse}>
              Delete course
            </button>
          </div>
        </header>

        <div className="class-detail-stats">
          <div className="class-detail-stat">
            <span className="class-detail-stat__label">Semesters</span>
            <span className="class-detail-stat__value">
              {semesters.length}/{limits.MAX_SEMESTERS_PER_COURSE}
            </span>
          </div>
          <div className="class-detail-stat">
            <span className="class-detail-stat__label">Subjects</span>
            <span className="class-detail-stat__value">{totals.subjectTotal}</span>
          </div>
          <div className="class-detail-stat">
            <span className="class-detail-stat__label">Students</span>
            <span className="class-detail-stat__value">{totals.studentTotal}</span>
          </div>
        </div>

        {error ? <p className="classes-error">{error}</p> : null}
        {notice ? <p className="class-detail-muted">{notice}</p> : null}

        <div className="classes-assignments-head">
          <h3>Semesters</h3>
          <button
            type="button"
            className="classes-btn-secondary"
            onClick={addSemester}
            disabled={semesters.length >= limits.MAX_SEMESTERS_PER_COURSE}
          >
            Add semester
          </button>
        </div>

        {semesters.length === 0 ? (
          <p className="class-detail-muted">
            No semesters yet. Add one (e.g. "Semester 1"), then add subjects and students to it.
          </p>
        ) : (
          semesters.map((s) => {
            const isOpen = openSemesterKey === s.rowKey;
            return (
              <section key={s.rowKey} className="class-detail-section">
                <div className="classes-assignments-head">
                  <input
                    value={s.name}
                    onChange={(e) => updateSemesterName(s.rowKey, e.target.value)}
                    placeholder="e.g. Semester 1"
                    style={{ maxWidth: 260 }}
                  />
                  <div className="classes-actions-cell">
                    <button
                      type="button"
                      className="classes-btn-sm"
                      onClick={() => setOpenSemesterKey(isOpen ? null : s.rowKey)}
                    >
                      {isOpen ? 'Collapse' : 'Expand'}
                    </button>
                    <button type="button" className="classes-btn-sm classes-btn-danger" onClick={() => removeSemester(s.rowKey)}>
                      Remove
                    </button>
                  </div>
                </div>

                {isOpen && (
                  <>
                    <div className="classes-assignments-head">
                      <h3>
                        Subjects ({s.subjects.filter((x) => x.trim()).length}/{limits.MAX_SUBJECTS_PER_SEMESTER})
                      </h3>
                      <button
                        type="button"
                        className="classes-btn-secondary"
                        onClick={() => addSubject(s.rowKey)}
                        disabled={s.subjects.length >= limits.MAX_SUBJECTS_PER_SEMESTER}
                      >
                        Add subject
                      </button>
                    </div>
                    <div className="classes-assignments-list">
                      {s.subjects.map((subject, index) => (
                        <div className="classes-assignment-row" key={`${s.rowKey}-subj-${index}`}>
                          <label>
                            Subject
                            <input
                              type="text"
                              value={subject}
                              onChange={(e) => updateSubject(s.rowKey, index, e.target.value)}
                              placeholder="e.g. Machine Learning"
                            />
                          </label>
                          <button
                            type="button"
                            className="classes-btn-sm classes-btn-danger"
                            onClick={() => removeSubject(s.rowKey, index)}
                            disabled={s.subjects.length === 1}
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>

                    <div className="classes-assignments-head">
                      <h3>Assigned faculty ({s.assignedFacultyIds.length})</h3>
                    </div>
                    {faculty.length === 0 ? (
                      <p className="class-detail-muted">
                        No faculty accounts yet — add teachers from the Teachers page first, then assign
                        them here so they only see the semesters they teach.
                      </p>
                    ) : (
                      <div className="classes-table-mappings class-detail-subject-wrap">
                        {faculty.map((t) => {
                          const checked = s.assignedFacultyIds.includes(t._id || t.id);
                          const tid = t._id || t.id;
                          return (
                            <label
                              key={tid}
                              className="classes-mapping-pill"
                              style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleFaculty(s.rowKey, tid)}
                              />
                              {t.username || t.email}
                            </label>
                          );
                        })}
                      </div>
                    )}

                    <div className="classes-assignments-head classes-assignments-head--students">
                      <h3>
                        Students ({s.studentRoster.filter((r) => r.email.trim()).length}/
                        {limits.MAX_STUDENTS_PER_SEMESTER})
                      </h3>
                      <button
                        type="button"
                        className="classes-btn-secondary"
                        onClick={() => addStudent(s.rowKey)}
                        disabled={s.studentRoster.length >= limits.MAX_STUDENTS_PER_SEMESTER}
                      >
                        Add student
                      </button>
                    </div>
                    <div className="classes-students-table-wrap">
                      <table className="classes-students-table">
                        <thead>
                          <tr>
                            <th className="classes-students-table__roll">Roll no.</th>
                            <th>Name (optional)</th>
                            <th>Email (required)</th>
                            <th>Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {s.studentRoster.map((row, index) => (
                            <tr key={`${s.rowKey}-stu-${index}`}>
                              <td className="classes-students-table__roll">{index + 1}</td>
                              <td>
                                <input
                                  value={row.name}
                                  onChange={(e) => updateStudent(s.rowKey, index, 'name', e.target.value)}
                                  placeholder="Student name"
                                />
                              </td>
                              <td>
                                <input
                                  type="email"
                                  value={row.email}
                                  onChange={(e) => updateStudent(s.rowKey, index, 'email', e.target.value)}
                                  placeholder="student@college.edu"
                                />
                              </td>
                              <td>
                                <button
                                  type="button"
                                  className="classes-btn-sm classes-btn-danger"
                                  onClick={() => removeStudent(s.rowKey, index)}
                                  disabled={s.studentRoster.length === 1}
                                >
                                  Remove
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </section>
            );
          })
        )}

        <div className="classes-form-actions">
          <button type="button" className="classes-btn-primary" onClick={handleSaveAll} disabled={saving}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default CourseDetailPage;

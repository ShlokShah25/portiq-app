import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  getClassrooms,
  createClassroom,
  updateClassroom,
  deleteClassroom,
  MAX_CLASSROOMS,
  MAX_STUDENTS_PER_CLASSROOM,
  MAX_SUBJECTS_PER_CLASSROOM,
} from '../utils/classroomsStorage';
import './ClassesPage.css';

const SUBJECT_OPTIONS = [
  'Mathematics',
  'Physics',
  'Chemistry',
  'Biology',
  'English Literature',
  'English Language',
  'Commerce',
  'Arts',
  'Fashion Design',
  'Home Science',
  'Engineering Drawing',
  'History',
  'Geography',
];

function emptyAssignment() {
  return {
    rowKey: `row_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
    subject: '',
  };
}

function emptyStudent() {
  return {
    rowKey: `student_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
    name: '',
    email: '',
  };
}

const ClassesPage = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [classrooms, setClassrooms] = useState([]);
  const [editing, setEditing] = useState(null);
  const [query, setQuery] = useState('');
  const [studentQuery, setStudentQuery] = useState('');
  const [form, setForm] = useState({
    className: '',
    subjectAssignments: [emptyAssignment()],
    studentRoster: [emptyStudent()],
  });
  const [error, setError] = useState('');

  const load = () => setClassrooms(getClassrooms());

  useEffect(() => {
    load();
  }, []);

  const handleEdit = useCallback((c) => {
    const rows =
      Array.isArray(c.subjectAssignments) && c.subjectAssignments.length > 0
        ? c.subjectAssignments
        : (Array.isArray(c.subjects) ? c.subjects : []).map((subject) => ({ subject }));

    const students =
      Array.isArray(c.studentRoster) && c.studentRoster.length > 0
        ? c.studentRoster
        : (Array.isArray(c.studentEmails) ? c.studentEmails : []).map((email) => ({ name: '', email }));

    setEditing(c);
    setForm({
      className: c.className || '',
      subjectAssignments: rows.length ? rows.map((r) => ({ ...emptyAssignment(), ...r })) : [emptyAssignment()],
      studentRoster: students.length ? students.map((s) => ({ ...emptyStudent(), ...s })) : [emptyStudent()],
    });
  }, []);

  useEffect(() => {
    const editId = searchParams.get('edit');
    if (!editId) return;
    const c = classrooms.find((x) => x.id === editId);
    if (!c) {
      if (classrooms.length > 0) {
        const next = new URLSearchParams(searchParams);
        next.delete('edit');
        setSearchParams(next, { replace: true });
      }
      return;
    }
    handleEdit(c);
    const next = new URLSearchParams(searchParams);
    next.delete('edit');
    setSearchParams(next, { replace: true });
  }, [classrooms, searchParams, handleEdit, setSearchParams]);

  const resetForm = () => {
    setForm({ className: '', subjectAssignments: [emptyAssignment()], studentRoster: [emptyStudent()] });
    setError('');
    setStudentQuery('');
    setEditing(null);
  };

  const normalizeAssignments = (rows) => {
    const out = [];
    const seen = new Set();
    for (const row of Array.isArray(rows) ? rows : []) {
      const subject = String(row?.subject || '').trim();
      if (!subject) continue;
      const key = subject.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ subject });
      if (out.length >= MAX_SUBJECTS_PER_CLASSROOM) break;
    }
    return out;
  };

  const normalizeStudents = (rows) => {
    const out = [];
    const seen = new Set();
    for (const row of Array.isArray(rows) ? rows : []) {
      const email = String(row?.email || '').trim().toLowerCase();
      if (!email || seen.has(email)) continue;
      seen.add(email);
      out.push({
        name: String(row?.name || '').trim(),
        email,
      });
      if (out.length >= MAX_STUDENTS_PER_CLASSROOM) break;
    }
    return out;
  };

  const filteredStudentRows = useMemo(() => {
    const q = studentQuery.trim().toLowerCase();
    if (!q) return form.studentRoster;
    return form.studentRoster.filter((row) => {
      const nm = String(row?.name || '').toLowerCase();
      const em = String(row?.email || '').toLowerCase();
      return nm.includes(q) || em.includes(q);
    });
  }, [form.studentRoster, studentQuery]);

  const handleSubmit = (e) => {
    e.preventDefault();
    setError('');
    if (!editing && classrooms.length >= MAX_CLASSROOMS) {
      setError(`Classroom limit reached (${MAX_CLASSROOMS}).`);
      return;
    }

    const subjectAssignments = normalizeAssignments(form.subjectAssignments);
    if (subjectAssignments.length === 0) {
      setError('Add at least one subject.');
      return;
    }

    const studentRoster = normalizeStudents(form.studentRoster);
    if (studentRoster.length > MAX_STUDENTS_PER_CLASSROOM) {
      setError(`Student limit reached (${MAX_STUDENTS_PER_CLASSROOM} per classroom).`);
      return;
    }

    const payload = {
      className: form.className.trim(),
      subjectAssignments,
      subjects: subjectAssignments.map((x) => x.subject),
      teacher: '',
      studentRoster,
      studentEmails: studentRoster.map((s) => s.email),
    };

    if (editing) {
      updateClassroom(editing.id, payload);
    } else {
      try {
        createClassroom(payload);
      } catch (err) {
        setError(err.message || 'Could not create classroom.');
        return;
      }
    }

    resetForm();
    load();
  };

  const handleDelete = (id) => {
    if (!window.confirm('Delete this classroom?')) return;
    deleteClassroom(id);
    load();
    resetForm();
  };

  const updateAssignment = (index, value) => {
    setForm((prev) => ({
      ...prev,
      subjectAssignments: prev.subjectAssignments.map((row, i) =>
        i === index ? { ...row, subject: value } : row
      ),
    }));
  };

  const addAssignment = () => {
    setForm((prev) => {
      if (prev.subjectAssignments.length >= MAX_SUBJECTS_PER_CLASSROOM) return prev;
      return { ...prev, subjectAssignments: [...prev.subjectAssignments, emptyAssignment()] };
    });
  };

  const removeAssignment = (index) => {
    setForm((prev) => {
      const next = prev.subjectAssignments.filter((_, i) => i !== index);
      return { ...prev, subjectAssignments: next.length ? next : [emptyAssignment()] };
    });
  };

  const updateStudent = (index, field, value) => {
    setForm((prev) => ({
      ...prev,
      studentRoster: prev.studentRoster.map((row, i) =>
        i === index ? { ...row, [field]: value } : row
      ),
    }));
  };

  const addStudent = () => {
    setForm((prev) => {
      if (prev.studentRoster.length >= MAX_STUDENTS_PER_CLASSROOM) return prev;
      return { ...prev, studentRoster: [...prev.studentRoster, emptyStudent()] };
    });
  };

  const removeStudent = (index) => {
    setForm((prev) => {
      const next = prev.studentRoster.filter((_, i) => i !== index);
      return { ...prev, studentRoster: next.length ? next : [emptyStudent()] };
    });
  };

  const filteredClassrooms = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return classrooms;
    return classrooms.filter((c) => {
      const className = String(c.className || '').toLowerCase();
      const subjects = (Array.isArray(c.subjectAssignments) ? c.subjectAssignments : [])
        .map((s) => String(s?.subject || '').toLowerCase())
        .join(' ');
      const students = (Array.isArray(c.studentRoster) && c.studentRoster.length > 0
        ? c.studentRoster
        : (Array.isArray(c.studentEmails) ? c.studentEmails.map((email) => ({ name: '', email })) : [])
      )
        .map((s) => `${String(s?.name || '').toLowerCase()} ${String(s?.email || '').toLowerCase()}`)
        .join(' ');
      return className.includes(q) || subjects.includes(q) || students.includes(q);
    });
  }, [classrooms, query]);

  return (
    <div className="classes-page">
      <div className="classes-wrapper">
        <div className="classes-header">
          <h1>Classrooms</h1>
          <p>
            Create and manage classrooms with visible caps: {MAX_CLASSROOMS} classrooms,
            {' '}{MAX_STUDENTS_PER_CLASSROOM} students/classroom, and {MAX_SUBJECTS_PER_CLASSROOM}{' '}
            subjects/classroom.
          </p>
        </div>

        <form className="classes-form" onSubmit={handleSubmit}>
          <div className="classes-form-row">
            <label>
              Class Name
              <input
                value={form.className}
                onChange={(e) => setForm({ ...form, className: e.target.value })}
                placeholder="e.g. Math 101"
                required
              />
            </label>
          </div>

          <div className="classes-assignments-head">
            <h3>Subjects ({normalizeAssignments(form.subjectAssignments).length}/{MAX_SUBJECTS_PER_CLASSROOM})</h3>
            <button
              type="button"
              className="classes-btn-secondary"
              onClick={addAssignment}
              disabled={form.subjectAssignments.length >= MAX_SUBJECTS_PER_CLASSROOM}
            >
              Add subject
            </button>
          </div>
          <div className="classes-assignments-list">
            {form.subjectAssignments.map((row, index) => (
              <div className="classes-assignment-row" key={row.rowKey}>
                <label>
                  Subject
                  <input
                    type="text"
                    list={`subject-options-${row.rowKey}`}
                    value={row.subject}
                    onChange={(e) => updateAssignment(index, e.target.value)}
                    placeholder="Search or type subject"
                    required
                  />
                  <datalist id={`subject-options-${row.rowKey}`}>
                    {SUBJECT_OPTIONS.map((subject) => (
                      <option key={subject} value={subject}>
                        {subject}
                      </option>
                    ))}
                  </datalist>
                </label>
                <button
                  type="button"
                  className="classes-btn-sm classes-btn-danger"
                  onClick={() => removeAssignment(index)}
                  disabled={form.subjectAssignments.length === 1}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>

          <div className="classes-assignments-head classes-assignments-head--students">
            <h3>Students ({normalizeStudents(form.studentRoster).length}/{MAX_STUDENTS_PER_CLASSROOM})</h3>
            <div className="classes-assignments-actions">
              <input
                type="search"
                className="classes-search classes-search--students"
                value={studentQuery}
                onChange={(e) => setStudentQuery(e.target.value)}
                placeholder="Search students by name or email"
              />
              <button
                type="button"
                className="classes-btn-secondary"
                onClick={addStudent}
                disabled={form.studentRoster.length >= MAX_STUDENTS_PER_CLASSROOM}
              >
                Add student
              </button>
            </div>
          </div>

          <div className="classes-students-table-wrap">
            <table className="classes-students-table">
              <thead>
                <tr>
                  <th scope="col" className="classes-students-table__roll">
                    Roll no.
                  </th>
                  <th scope="col">Name (optional)</th>
                  <th scope="col">Email (required)</th>
                  <th scope="col">Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredStudentRows.map((row) => {
                  const index = form.studentRoster.findIndex((s) => s.rowKey === row.rowKey);
                  if (index === -1) return null;
                  return (
                  <tr key={row.rowKey}>
                    <td className="classes-students-table__roll" aria-label={`Roll number ${index + 1}`}>
                      {index + 1}
                    </td>
                    <td>
                      <input
                        value={row.name}
                        onChange={(e) => updateStudent(index, 'name', e.target.value)}
                        placeholder="Student name"
                      />
                    </td>
                    <td>
                      <input
                        type="email"
                        value={row.email}
                        onChange={(e) => updateStudent(index, 'email', e.target.value)}
                        placeholder="student@school.edu"
                      />
                    </td>
                    <td>
                      <button
                        type="button"
                        className="classes-btn-sm classes-btn-danger"
                        onClick={() => removeStudent(index)}
                        disabled={form.studentRoster.length === 1}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {error ? <p className="classes-error">{error}</p> : null}
          <div className="classes-form-actions">
            <button
              type="submit"
              className="classes-btn-primary"
              disabled={!editing && classrooms.length >= MAX_CLASSROOMS}
            >
              {editing ? 'Update Classroom' : 'Create Classroom'}
            </button>
            {editing && (
              <button type="button" className="classes-btn-secondary" onClick={resetForm}>
                Cancel
              </button>
            )}
          </div>
        </form>

        <div className="classes-list classes-list-panel">
          <div className="classes-list-head">
            <h2>All Classrooms ({classrooms.length}/{MAX_CLASSROOMS})</h2>
            <input
              type="search"
              className="classes-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by class, subject, student name, or email"
            />
          </div>
          {filteredClassrooms.length === 0 ? (
            <p className="classes-empty">
              {classrooms.length === 0 ? 'No classrooms yet. Create one above.' : 'No classrooms match this search.'}
            </p>
          ) : (
            <div className="classes-table-scroll">
              <table className="classes-table">
                <thead>
                  <tr>
                    <th className="classes-table__class">Class</th>
                    <th className="classes-table__subjects">Subjects</th>
                    <th className="classes-table__students">Students</th>
                    <th className="classes-table__actions">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredClassrooms.map((c) => {
                    const roster =
                      Array.isArray(c.studentRoster) && c.studentRoster.length > 0
                        ? c.studentRoster
                        : (Array.isArray(c.studentEmails) ? c.studentEmails.map((email) => ({ name: '', email })) : []);
                    const n = roster.length;
                    return (
                      <tr key={c.id} className="classes-table-row">
                        <td className="classes-table__class">
                          <Link to={`/classes/${c.id}`} className="classes-class-link">
                            {c.className}
                          </Link>
                        </td>
                        <td className="classes-table__subjects">
                          {Array.isArray(c.subjectAssignments) && c.subjectAssignments.length ? (
                            <div className="classes-table-mappings">
                              {c.subjectAssignments.map((row) => (
                                <span key={`${c.id}-${row.subject}`} className="classes-mapping-pill">
                                  {row.subject}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="classes-table-dash">—</span>
                          )}
                        </td>
                        <td className="classes-table__students">
                          <div className="classes-student-summary">
                            <span className="classes-student-count" title="Enrolled / capacity">
                              {n}/{MAX_STUDENTS_PER_CLASSROOM}
                            </span>
                            <Link to={`/classes/${c.id}`} className="classes-roster-link">
                              {n === 0 ? 'Add students' : 'View roster'}
                            </Link>
                          </div>
                        </td>
                        <td className="classes-table__actions">
                          <div className="classes-actions-cell">
                            <button type="button" className="classes-btn-sm" onClick={() => handleEdit(c)}>
                              Edit
                            </button>
                            <button
                              type="button"
                              className="classes-btn-sm classes-btn-danger"
                              onClick={() => handleDelete(c.id)}
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ClassesPage;

import React, { useState, useEffect } from 'react';
import {
  getClassrooms,
  createClassroom,
  updateClassroom,
  deleteClassroom,
  MAX_SUBJECTS_PER_CLASSROOM,
} from '../utils/classroomsStorage';
import './ClassesPage.css';

function emptyAssignment() {
  return {
    // Stable React list key — must NOT include `subject` or keys change while typing.
    rowKey: `row_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
    subject: '',
    teacherName: '',
    teacherEmail: '',
  };
}

const ClassesPage = () => {
  const [classrooms, setClassrooms] = useState([]);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({
    className: '',
    subjectAssignments: [emptyAssignment()],
    studentEmailsStr: ''
  });
  const [error, setError] = useState('');

  const load = () => setClassrooms(getClassrooms());

  useEffect(() => {
    load();
  }, []);

  const resetForm = () => {
    setForm({ className: '', subjectAssignments: [emptyAssignment()], studentEmailsStr: '' });
    setError('');
    setEditing(null);
  };

  const studentEmailsFromStr = (str) =>
    str
      .split(/[\n,;]+/)
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);

  const normalizeAssignments = (rows) => {
    const out = [];
    const seen = new Set();
    for (const row of Array.isArray(rows) ? rows : []) {
      const subject = String(row?.subject || '').trim();
      const teacherName = String(row?.teacherName || '').trim();
      const teacherEmail = String(row?.teacherEmail || '').trim().toLowerCase();
      if (!subject && !teacherName && !teacherEmail) continue;
      const key = subject.toLowerCase();
      if (!subject || seen.has(key)) continue;
      seen.add(key);
      out.push({ subject, teacherName, teacherEmail }); // rowKey omitted when saving
      if (out.length >= MAX_SUBJECTS_PER_CLASSROOM) break;
    }
    return out;
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    setError('');
    const studentEmails = studentEmailsFromStr(form.studentEmailsStr);
    const subjectAssignments = normalizeAssignments(form.subjectAssignments);
    if (subjectAssignments.length === 0) {
      setError('Add at least one subject-teacher mapping.');
      return;
    }
    const missingTeacherEmail = subjectAssignments.find((x) => !x.teacherEmail);
    if (missingTeacherEmail) {
      setError(`Add teacher email for "${missingTeacherEmail.subject}".`);
      return;
    }
    const emailInvalid = subjectAssignments.find(
      (x) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(x.teacherEmail || ''))
    );
    if (emailInvalid) {
      setError(`Enter a valid teacher email for "${emailInvalid.subject}".`);
      return;
    }
    if (editing) {
      updateClassroom(editing.id, {
        className: form.className.trim(),
        subjectAssignments,
        subjects: subjectAssignments.map((x) => x.subject),
        teacher: '',
        studentEmails
      });
    } else {
      createClassroom({
        className: form.className.trim(),
        subjectAssignments,
        subjects: subjectAssignments.map((x) => x.subject),
        teacher: '',
        studentEmails
      });
    }
    resetForm();
    load();
  };

  const handleEdit = (c) => {
    const rows =
      Array.isArray(c.subjectAssignments) && c.subjectAssignments.length > 0
        ? c.subjectAssignments
        : (Array.isArray(c.subjects) ? c.subjects : [])
            .map((subject) => ({
              subject,
              teacherName: c.teacher || '',
              teacherEmail: '',
            }));
    setEditing(c);
    setForm({
      className: c.className || '',
      subjectAssignments: rows.length
        ? rows.map((r) => ({ ...emptyAssignment(), ...r }))
        : [emptyAssignment()],
      studentEmailsStr: (c.studentEmails || []).join('\n')
    });
  };

  const handleDelete = (id) => {
    if (window.confirm('Delete this classroom?')) {
      deleteClassroom(id);
      load();
      resetForm();
    }
  };

  const updateAssignment = (index, field, value) => {
    setForm((prev) => ({
      ...prev,
      subjectAssignments: prev.subjectAssignments.map((row, i) =>
        i === index ? { ...row, [field]: value } : row
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

  return (
    <div className="classes-page">
      <div className="classes-wrapper">
        <div className="classes-header">
          <h1>Classrooms</h1>
          <p>Create and manage classrooms. Students in a classroom receive lecture notes by email.</p>
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
            <h3>Subjects & teachers (max {MAX_SUBJECTS_PER_CLASSROOM})</h3>
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
                    value={row.subject}
                    onChange={(e) => updateAssignment(index, 'subject', e.target.value)}
                    placeholder="e.g. Mathematics"
                    required
                  />
                </label>
                <label>
                  Teacher Name
                  <input
                    value={row.teacherName}
                    onChange={(e) => updateAssignment(index, 'teacherName', e.target.value)}
                    placeholder="e.g. Ms. Sarah"
                  />
                </label>
                <label>
                  Teacher Email
                  <input
                    type="email"
                    value={row.teacherEmail}
                    onChange={(e) => updateAssignment(index, 'teacherEmail', e.target.value)}
                    placeholder="teacher@school.edu"
                    required
                  />
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
          <p className="classes-subject-cap-note">
            Each subject maps to one teacher. Teacher email is used for lecture tracking and notifications.
          </p>
          {error ? <p className="classes-error">{error}</p> : null}
          <label className="classes-form-full">
            Student Emails (one per line or comma-separated)
            <textarea
              value={form.studentEmailsStr}
              onChange={(e) => setForm({ ...form, studentEmailsStr: e.target.value })}
              placeholder="student1@school.edu\nstudent2@school.edu"
              rows={4}
            />
          </label>
          <div className="classes-form-actions">
            <button type="submit" className="classes-btn-primary">
              {editing ? 'Update Classroom' : 'Create Classroom'}
            </button>
            {editing && (
              <button type="button" className="classes-btn-secondary" onClick={resetForm}>
                Cancel
              </button>
            )}
          </div>
        </form>

        <div className="classes-list">
          <h2>All Classrooms</h2>
          {classrooms.length === 0 ? (
            <p className="classes-empty">No classrooms yet. Create one above.</p>
          ) : (
            <table className="classes-table">
              <thead>
                <tr>
                  <th>Class Name</th>
                  <th>Subject Mappings</th>
                  <th>Students</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {classrooms.map((c) => (
                  <tr key={c.id}>
                    <td>{c.className}</td>
                    <td>
                      {Array.isArray(c.subjectAssignments) && c.subjectAssignments.length ? (
                        <div className="classes-table-mappings">
                          {c.subjectAssignments.map((row) => (
                            <span key={`${c.id}-${row.subject}`} className="classes-mapping-pill">
                              {row.subject}: {row.teacherName || 'Teacher'} ({row.teacherEmail || '—'})
                            </span>
                          ))}
                        </div>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>{(c.studentEmails || []).length}</td>
                    <td>
                      <button type="button" className="classes-btn-sm" onClick={() => handleEdit(c)}>
                        Edit
                      </button>
                      <button type="button" className="classes-btn-sm classes-btn-danger" onClick={() => handleDelete(c.id)}>
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
};

export default ClassesPage;

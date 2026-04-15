import React, { useState, useEffect } from 'react';
import {
  getClassrooms,
  createClassroom,
  updateClassroom,
  deleteClassroom,
  MAX_SUBJECTS_PER_CLASSROOM,
} from '../utils/classroomsStorage';
import './ClassesPage.css';

const ClassesPage = () => {
  const [classrooms, setClassrooms] = useState([]);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({
    className: '',
    subjectsStr: '',
    teacher: '',
    studentEmailsStr: ''
  });

  const load = () => setClassrooms(getClassrooms());

  useEffect(() => {
    load();
  }, []);

  const resetForm = () => {
    setForm({ className: '', subjectsStr: '', teacher: '', studentEmailsStr: '' });
    setEditing(null);
  };

  const studentEmailsFromStr = (str) =>
    str
      .split(/[\n,;]+/)
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);

  const subjectsFromStr = (str) =>
    str
      .split(/[\n,;]+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .filter((s, i, arr) => arr.findIndex((x) => x.toLowerCase() === s.toLowerCase()) === i)
      .slice(0, MAX_SUBJECTS_PER_CLASSROOM);

  const handleSubmit = (e) => {
    e.preventDefault();
    const studentEmails = studentEmailsFromStr(form.studentEmailsStr);
    const subjects = subjectsFromStr(form.subjectsStr);
    if (editing) {
      updateClassroom(editing.id, {
        className: form.className.trim(),
        subjects,
        teacher: form.teacher.trim(),
        studentEmails
      });
    } else {
      createClassroom({
        className: form.className.trim(),
        subjects,
        teacher: form.teacher.trim(),
        studentEmails
      });
    }
    resetForm();
    load();
  };

  const handleEdit = (c) => {
    setEditing(c);
    setForm({
      className: c.className || '',
      subjectsStr: Array.isArray(c.subjects) ? c.subjects.join(', ') : c.subject || '',
      teacher: c.teacher || '',
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
            <label>
              Subjects (max {MAX_SUBJECTS_PER_CLASSROOM})
              <input
                value={form.subjectsStr}
                onChange={(e) => setForm({ ...form, subjectsStr: e.target.value })}
                placeholder="e.g. Mathematics, Physics, Chemistry"
              />
            </label>
            <label>
              Teacher
              <input
                value={form.teacher}
                onChange={(e) => setForm({ ...form, teacher: e.target.value })}
                placeholder="Teacher name or email"
              />
            </label>
          </div>
          <p className="classes-subject-cap-note">
            Custom subjects allowed. You can add up to {MAX_SUBJECTS_PER_CLASSROOM} subjects per classroom.
          </p>
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
                  <th>Subjects</th>
                  <th>Teacher</th>
                  <th>Students</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {classrooms.map((c) => (
                  <tr key={c.id}>
                    <td>{c.className}</td>
                    <td>{Array.isArray(c.subjects) && c.subjects.length ? c.subjects.join(', ') : '—'}</td>
                    <td>{c.teacher || '—'}</td>
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

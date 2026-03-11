import React, { useState, useEffect } from 'react';
import TopNav from './TopNav';
import { getClassrooms, createClassroom, updateClassroom, deleteClassroom } from '../utils/classroomsStorage';
import './ClassesPage.css';

const ClassesPage = () => {
  const [classrooms, setClassrooms] = useState([]);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({
    className: '',
    subject: '',
    teacher: '',
    studentEmailsStr: ''
  });

  const load = () => setClassrooms(getClassrooms());

  useEffect(() => {
    load();
  }, []);

  const resetForm = () => {
    setForm({ className: '', subject: '', teacher: '', studentEmailsStr: '' });
    setEditing(null);
  };

  const studentEmailsFromStr = (str) =>
    str
      .split(/[\n,;]+/)
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);

  const handleSubmit = (e) => {
    e.preventDefault();
    const studentEmails = studentEmailsFromStr(form.studentEmailsStr);
    if (editing) {
      updateClassroom(editing.id, {
        className: form.className.trim(),
        subject: form.subject.trim(),
        teacher: form.teacher.trim(),
        studentEmails
      });
    } else {
      createClassroom({
        className: form.className.trim(),
        subject: form.subject.trim(),
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
      subject: c.subject || '',
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
      <TopNav />
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
              Subject
              <input
                value={form.subject}
                onChange={(e) => setForm({ ...form, subject: e.target.value })}
                placeholder="e.g. Mathematics"
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
                  <th>Subject</th>
                  <th>Teacher</th>
                  <th>Students</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {classrooms.map((c) => (
                  <tr key={c.id}>
                    <td>{c.className}</td>
                    <td>{c.subject || '—'}</td>
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

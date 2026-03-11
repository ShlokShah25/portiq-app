import React, { useState, useEffect } from 'react';
import TopNav from './TopNav';
import { getTeachers, addTeacher, removeTeacher } from '../utils/teachersStorage';
import './TeachersPage.css';

const TeachersPage = () => {
  const [teachers, setTeachers] = useState([]);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');

  const load = () => setTeachers(getTeachers());

  useEffect(() => {
    load();
  }, []);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    addTeacher({ name: name.trim(), email: email.trim() });
    setName('');
    setEmail('');
    load();
  };

  const handleDelete = (id) => {
    if (window.confirm('Remove this teacher?')) {
      removeTeacher(id);
      load();
    }
  };

  return (
    <div className="teachers-page">
      <TopNav />
      <div className="teachers-wrapper">
        <div className="teachers-header">
          <h1>Teachers</h1>
          <p>Manage teacher accounts. Teachers sign in at /admin-login and can start lectures for their classrooms.</p>
        </div>

        <form className="teachers-form" onSubmit={handleSubmit}>
          <label>
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Teacher name" required />
          </label>
          <label>
            Email (login)
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="teacher@school.edu"
            />
          </label>
          <button type="submit" className="teachers-btn-primary">
            Add Teacher
          </button>
        </form>

        <div className="teachers-list">
          <h2>All Teachers</h2>
          {teachers.length === 0 ? (
            <p className="teachers-empty">No teachers yet. Add one above.</p>
          ) : (
            <ul className="teachers-ul">
              {teachers.map((t) => (
                <li key={t.id} className="teachers-li">
                  <span className="teachers-name">{t.name}</span>
                  {t.email && <span className="teachers-email">{t.email}</span>}
                  <button type="button" className="teachers-btn-sm teachers-btn-danger" onClick={() => handleDelete(t.id)}>
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
};

export default TeachersPage;

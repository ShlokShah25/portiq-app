import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { useTrialExperience } from './TrialExperienceProvider';
import './Dashboard.css';

function emptyForm() {
  return { username: '', email: '', password: '' };
}

export default function TeachersPage() {
  const trial = useTrialExperience();
  const role = String(trial?.profile?.role || '').toLowerCase();
  const [teachers, setTeachers] = useState([]);
  const [form, setForm] = useState(() => emptyForm());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const blocked = role === 'faculty';

  const fetchTeachers = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await axios.get('/admin/teachers');
      setTeachers(Array.isArray(res.data?.teachers) ? res.data.teachers : []);
    } catch (err) {
      const d = err.response?.data;
      setError([d?.error, d?.details].filter(Boolean).join(' — ') || 'Failed to load teachers.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!blocked) fetchTeachers();
  }, [blocked]);

  const canSubmit = useMemo(
    () => form.username.trim() && form.email.trim() && form.password.trim(),
    [form]
  );

  const onCreateTeacher = async (e) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      await axios.post('/admin/teachers', {
        username: form.username.trim(),
        email: form.email.trim().toLowerCase(),
        password: form.password,
      });
      setForm(emptyForm());
      setNotice('Teacher account created. They will be asked to change password at first login.');
      await fetchTeachers();
    } catch (err) {
      const d = err.response?.data;
      setError([d?.error, d?.details].filter(Boolean).join(' — ') || 'Failed to create teacher.');
    } finally {
      setSaving(false);
    }
  };

  if (blocked) {
    return (
      <div className="dashboard-screen">
        <div className="dashboard-wrapper">
          <div className="dashboard-content">
            <header className="dashboard-hero-minimal">
              <h1 className="dashboard-title">Teachers</h1>
              <p className="dashboard-subtitle">Only education admins can access teacher management.</p>
            </header>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard-screen">
      <div className="dashboard-wrapper">
        <div className="dashboard-content">
          <header className="dashboard-hero-minimal">
            <h1 className="dashboard-title">Teachers</h1>
            <p className="dashboard-subtitle">
              Create teacher users with temporary passwords. Teachers must change password on first
              login.
            </p>
          </header>

          <section className="dashboard-education-admin-card" style={{ marginBottom: 14 }}>
            <div className="dashboard-education-admin-card__head">
              <h2>Create teacher</h2>
            </div>
            <form onSubmit={onCreateTeacher} className="dashboard-education-admin-form">
              <input
                placeholder="Username"
                value={form.username}
                onChange={(e) => setForm((p) => ({ ...p, username: e.target.value }))}
              />
              <input
                type="email"
                placeholder="Teacher email"
                value={form.email}
                onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
              />
              <input
                type="text"
                placeholder="Temporary password (min 8 chars)"
                value={form.password}
                onChange={(e) => setForm((p) => ({ ...p, password: e.target.value }))}
              />
              <button
                type="submit"
                className="dashboard-btn-primary dashboard-btn-micro"
                disabled={!canSubmit || saving}
              >
                {saving ? 'Creating…' : 'Create teacher'}
              </button>
            </form>
            {error && <div className="start-meeting-error">{error}</div>}
            {notice && <p className="dashboard-education-admin-card__hint">{notice}</p>}
          </section>

          <section className="dashboard-education-admin-card">
            <div className="dashboard-education-admin-card__head">
              <h2>All teachers</h2>
            </div>
            {loading ? (
              <p className="dashboard-education-admin-card__hint">Loading teachers…</p>
            ) : teachers.length === 0 ? (
              <p className="dashboard-education-admin-card__hint">No teachers yet.</p>
            ) : (
              <ul className="dashboard-education-admin-list">
                {teachers.map((t) => (
                  <li key={String(t._id || t.id || t.email)}>
                    <span>{t.username}</span>
                    <small>{t.email}</small>
                    <small>
                      {t.mustChangePassword ? 'Password change pending' : 'Password already changed'}
                    </small>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

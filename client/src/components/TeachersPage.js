import React, { useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { UserPlus } from 'lucide-react';
import { useTrialExperience } from './TrialExperienceProvider';
import OnboardingTour, { hasSeenTour } from './OnboardingTour';
import './Dashboard.css';

/** Admin onboarding, scoped to this page — distinct key from the dashboard's own tour. */
function adminTeachersTourKey(uid) {
  return `portiq_admin_onboarding_v1_${uid}_teachers`;
}

function emptyForm() {
  return { username: '', email: '' };
}

export default function TeachersPage() {
  const trial = useTrialExperience();
  const profile = trial?.profile;
  const role = String(profile?.role || '').toLowerCase();
  const isEducationAccount =
    String(profile?.productType || '').toLowerCase() === 'education';
  const [teachers, setTeachers] = useState([]);
  const [form, setForm] = useState(() => emptyForm());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [tourOpen, setTourOpen] = useState(false);
  const [tourStep, setTourStep] = useState(0);
  const usernameFieldRef = useRef(null);
  const createButtonRef = useRef(null);

  const blocked = !isEducationAccount || role === 'faculty';

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
    if (trial?.loading) return;
    if (!blocked) fetchTeachers();
  }, [blocked, trial?.loading]);

  const adminUid = String(profile?.id || profile?._id || profile?.email || '').trim();

  useEffect(() => {
    if (blocked || !adminUid) return;
    if (!hasSeenTour(adminTeachersTourKey(adminUid))) {
      setTourOpen(true);
      setTourStep(0);
    }
  }, [blocked, adminUid]);

  const tourSteps = useMemo(
    () => [
      {
        id: 'username',
        title: 'Create a teacher account',
        body: 'Enter a name and email — PortIQ generates a temporary password automatically, so you never have to invent or share one.',
        target: usernameFieldRef,
        icon: UserPlus,
      },
      {
        id: 'create',
        title: 'One click to invite',
        body: 'The teacher is prompted to set their own password on first login. You can create as many faculty accounts as you need.',
        target: createButtonRef,
        icon: UserPlus,
      },
    ],
    []
  );

  const canSubmit = useMemo(
    () => form.username.trim() && form.email.trim(),
    [form]
  );

  const onCreateTeacher = async (e) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const res = await axios.post('/admin/teachers', {
        username: form.username.trim(),
        email: form.email.trim().toLowerCase(),
      });
      const temporaryPassword = String(res.data?.temporaryPassword || '').trim();
      const emailStatus = res.data?.emailStatus || {};
      setForm(emptyForm());
      const baseNotice = temporaryPassword
        ? `Teacher account created. Temporary password: ${temporaryPassword}.`
        : 'Teacher account created.';
      const emailNotice = emailStatus?.message
        ? ` ${emailStatus.message}`
        : ' Teacher will be prompted to change password on first login.';
      setNotice(`${baseNotice}${emailNotice}`);
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
              Create teacher users quickly. Temporary password is auto-set to
              {' '}
              <strong>{'{TeacherName}+123'}</strong>
              {' '}
              and teachers must change it on first login.
            </p>
          </header>

          <section className="dashboard-education-admin-card" style={{ marginBottom: 14 }}>
            <div className="dashboard-education-admin-card__head">
              <h2>Create teacher</h2>
              <button
                type="button"
                className="dashboard-btn-secondary dashboard-btn-micro"
                style={{ marginLeft: 'auto' }}
                onClick={() => {
                  setTourStep(0);
                  setTourOpen(true);
                }}
              >
                Quick help
              </button>
            </div>
            <form onSubmit={onCreateTeacher} className="dashboard-education-admin-form">
              <input
                ref={usernameFieldRef}
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
              <button
                ref={createButtonRef}
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

          <OnboardingTour
            steps={tourSteps}
            open={tourOpen}
            currentStep={tourStep}
            onNext={() => setTourStep((s) => Math.min(tourSteps.length - 1, s + 1))}
            onBack={() => setTourStep((s) => Math.max(0, s - 1))}
            onSkip={() => setTourOpen(false)}
            onFinish={() => setTourOpen(false)}
            storageKey={adminUid ? adminTeachersTourKey(adminUid) : undefined}
          />
        </div>
      </div>
    </div>
  );
}

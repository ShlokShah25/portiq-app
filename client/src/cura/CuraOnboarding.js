import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { markCuraOnboardingComplete } from './CuraGate';
import { saveCuraOnboarding, curaApiError } from './curaApi';
import './CuraMode.css';

const STEPS = [
  {
    id: 'role',
    title: 'Your role',
    description: 'How will you primarily use Cura in your practice?',
    fields: [
      { key: 'role', label: 'Role', placeholder: 'e.g. General physician, Specialist, Clinic admin' },
    ],
  },
  {
    id: 'clinic',
    title: 'Clinic setup',
    description: 'Basic information about your practice.',
    fields: [
      { key: 'clinicName', label: 'Clinic name', placeholder: 'City Health Clinic' },
      { key: 'clinicCity', label: 'City', placeholder: 'Mumbai' },
    ],
  },
  {
    id: 'profile',
    title: 'Doctor profile',
    description: 'This appears on consultation notes and patient messages.',
    fields: [
      { key: 'doctorName', label: 'Display name', placeholder: 'Dr. Anita Sharma' },
      { key: 'specialty', label: 'Specialty', placeholder: 'General medicine' },
    ],
  },
];

export default function CuraOnboarding() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState({
    role: '',
    clinicName: '',
    clinicCity: '',
    doctorName: '',
    specialty: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const current = STEPS[step];
  const isLast = step >= STEPS.length - 1;

  const canContinue = current.fields.every((f) => String(form[f.key] || '').trim());

  const finish = async () => {
    setSaving(true);
    setError('');
    try {
      await saveCuraOnboarding(form);
      try {
        window.localStorage.setItem('cura_onboarding_profile', JSON.stringify(form));
      } catch (_) {
        /* ignore */
      }
      markCuraOnboardingComplete();
      navigate('/cura', { replace: true });
    } catch (err) {
      setError(curaApiError(err, 'Could not save clinic profile.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="cura-page" style={{ maxWidth: 520, margin: '0 auto' }}>
      <p className="cura-page__eyebrow">
        Step {step + 1} of {STEPS.length}
      </p>
      <h1 className="cura-page__title">{current.title}</h1>
      <p className="cura-page__subtitle">{current.description}</p>

      {error ? (
        <div className="cura-login__error" role="alert" style={{ marginTop: 16 }}>
          {error}
        </div>
      ) : null}

      <div className="cura-card" style={{ marginTop: 24 }}>
        {current.fields.map((field) => (
          <label
            key={field.key}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
              marginBottom: 16,
              fontSize: 13,
              fontWeight: 500,
            }}
          >
            {field.label}
            <input
              type="text"
              value={form[field.key]}
              onChange={(e) => setForm((prev) => ({ ...prev, [field.key]: e.target.value }))}
              placeholder={field.placeholder}
              className="cura-input"
            />
          </label>
        ))}

        <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
          {step > 0 ? (
            <button type="button" className="cura-btn cura-btn--secondary" onClick={() => setStep((s) => s - 1)}>
              Back
            </button>
          ) : null}
          <button
            type="button"
            className="cura-btn cura-btn--primary"
            disabled={!canContinue || saving}
            onClick={() => (isLast ? finish() : setStep((s) => s + 1))}
            style={{ marginLeft: 'auto' }}
          >
            {isLast ? (saving ? 'Saving…' : 'Enter Cura') : 'Continue'}
          </button>
        </div>
      </div>
    </div>
  );
}

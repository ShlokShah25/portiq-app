import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Search, ChevronRight } from 'lucide-react';
import { curaPaths } from './useCuraRoutes';
import { createCuraPatient, fetchCuraPatients, curaApiError } from './curaApi';
import './CuraCore.css';
import './CuraMode.css';

export default function CuraPatientsPage() {
  const [patients, setPatients] = useState([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: '',
    phone: '',
    email: '',
    medicalRecordNumber: '',
    whatsappOptIn: true,
  });

  const load = async (q = query) => {
    setLoading(true);
    setError('');
    try {
      const list = await fetchCuraPatients(q);
      setPatients(list);
    } catch (err) {
      setError(curaApiError(err, 'Could not load patients.'));
      setPatients([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load('');
  }, []);

  const handleSearch = (e) => {
    e.preventDefault();
    load(query);
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await createCuraPatient(form);
      setShowForm(false);
      setForm({ name: '', phone: '', email: '', medicalRecordNumber: '', whatsappOptIn: true });
      await load('');
    } catch (err) {
      setError(curaApiError(err, 'Could not create patient.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="cura-home">
      <header className="cura-home-section" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20 }}>
        <div>
          <h1 className="cura-home-hero__title" style={{ fontSize: 24, marginBottom: 4 }}>
            Patients
          </h1>
          <p className="cura-muted">Your clinic panel</p>
        </div>
        <button type="button" className="cura-btn cura-btn--primary" onClick={() => setShowForm((v) => !v)}>
          <Plus size={16} aria-hidden />
          Add patient
        </button>
      </header>

      {error ? (
        <div className="cura-login__error" role="alert" style={{ marginBottom: 16 }}>
          {error}
        </div>
      ) : null}

      {showForm ? (
        <form className="cura-card" style={{ marginBottom: 20 }} onSubmit={handleCreate}>
          <h2 className="cura-card__title" style={{ marginBottom: 16 }}>
            New patient
          </h2>
          <div className="cura-form-grid">
            <label className="cura-form-label">
              Full name *
              <input
                className="cura-input"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                required
              />
            </label>
            <label className="cura-form-label">
              Phone
              <input
                className="cura-input"
                value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
              />
            </label>
            <label className="cura-form-label">
              Email
              <input
                type="email"
                className="cura-input"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              />
            </label>
            <label className="cura-form-label">
              MRN
              <input
                className="cura-input"
                value={form.medicalRecordNumber}
                onChange={(e) => setForm((f) => ({ ...f, medicalRecordNumber: e.target.value }))}
              />
            </label>
          </div>
          <label className="cura-form-label" style={{ marginTop: 12 }}>
            <input
              type="checkbox"
              checked={form.whatsappOptIn}
              onChange={(e) => setForm((f) => ({ ...f, whatsappOptIn: e.target.checked }))}
            />{' '}
            WhatsApp opt-in for follow-ups
          </label>
          <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
            <button type="submit" className="cura-btn cura-btn--primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save patient'}
            </button>
            <button type="button" className="cura-btn cura-btn--secondary" onClick={() => setShowForm(false)}>
              Cancel
            </button>
          </div>
        </form>
      ) : null}

      <form className="cura-sessions-search" onSubmit={handleSearch} style={{ marginBottom: 16 }}>
        <Search size={16} aria-hidden style={{ color: 'var(--cura-text-muted)' }} />
        <input
          type="search"
          className="cura-input"
          placeholder="Search by name, phone, MRN…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search patients"
        />
        <button type="submit" className="cura-btn cura-btn--secondary">
          Search
        </button>
      </form>

      <section className="cura-card">
        {loading ? (
          <div className="cura-loading">Loading patients…</div>
        ) : patients.length === 0 ? (
          <div className="cura-empty">
            <p className="cura-empty__title">No patients yet</p>
            <p>Add your first patient to start consultations.</p>
          </div>
        ) : (
          <ul className="cura-visit-list">
            {patients.map((p) => (
              <li key={p._id}>
                <Link to={curaPaths(p._id).patient} className="cura-visit-row">
                  <span className="cura-visit-row__body">
                    <strong>{p.name}</strong>
                    <span className="cura-muted">
                      {p.phone || p.email || 'No contact'}
                      {p.medicalRecordNumber ? ` · ${p.medicalRecordNumber}` : ''}
                    </span>
                  </span>
                  <ChevronRight size={18} className="cura-visit-row__chev" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

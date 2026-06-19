import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Search, ChevronRight, Phone, Mail, MessageCircle, UserPlus } from 'lucide-react';
import { curaPaths } from './useCuraRoutes';
import { createCuraPatient, fetchCuraPatients, curaApiError } from './curaApi';
import { patientInitials } from './curaUtils';
import './CuraCore.css';
import './CuraMode.css';

function visitLabel(count) {
  if (!count) return 'No visits yet';
  if (count === 1) return '1 visit';
  return `${count} visits`;
}

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
    <div className="cura-home cura-patients-page">
      <header className="cura-patients-header">
        <div>
          <h1 className="cura-home-hero__title">Patients</h1>
          <p className="cura-muted">
            {loading
              ? 'Loading your panel…'
              : patients.length === 1
                ? '1 person in your clinic'
                : `${patients.length} people in your clinic`}
          </p>
        </div>
        <button
          type="button"
          className="cura-btn cura-btn--primary"
          onClick={() => setShowForm((v) => !v)}
        >
          <Plus size={16} aria-hidden />
          Add patient
        </button>
      </header>

      {error ? (
        <div className="cura-login__error" role="alert">
          {error}
        </div>
      ) : null}

      {showForm ? (
        <form className="cura-patients-form" onSubmit={handleCreate}>
          <h2 className="cura-patients-form__title">New patient</h2>
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
          <label className="cura-patients-form__check">
            <input
              type="checkbox"
              checked={form.whatsappOptIn}
              onChange={(e) => setForm((f) => ({ ...f, whatsappOptIn: e.target.checked }))}
            />
            WhatsApp opt-in for follow-ups
          </label>
          <div className="cura-patients-form__actions">
            <button type="submit" className="cura-btn cura-btn--primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save patient'}
            </button>
            <button type="button" className="cura-btn cura-btn--secondary" onClick={() => setShowForm(false)}>
              Cancel
            </button>
          </div>
        </form>
      ) : null}

      <form className="cura-patients-search" onSubmit={handleSearch}>
        <Search size={18} aria-hidden className="cura-patients-search__icon" />
        <input
          type="search"
          className="cura-patients-search__input"
          placeholder="Search name, phone, or MRN…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search patients"
        />
        <button type="submit" className="cura-btn cura-btn--secondary cura-patients-search__btn">
          Search
        </button>
      </form>

      {loading ? (
        <div className="cura-loading cura-patients-loading">Loading patients…</div>
      ) : patients.length === 0 ? (
        <div className="cura-patients-empty">
          <span className="cura-patients-empty__icon" aria-hidden>
            <UserPlus size={28} />
          </span>
          <p className="cura-patients-empty__title">No patients yet</p>
          <p className="cura-muted">Add someone manually, or they&apos;ll appear here when they book on WhatsApp.</p>
          <button type="button" className="cura-btn cura-btn--primary" onClick={() => setShowForm(true)}>
            <Plus size={16} aria-hidden />
            Add your first patient
          </button>
        </div>
      ) : (
        <ul className="cura-patients-grid">
          {patients.map((p) => (
            <li key={p._id}>
              <Link to={curaPaths(p._id).patient} className="cura-patient-card">
                <span className="cura-patient-card__avatar" aria-hidden>
                  {patientInitials(p.name)}
                </span>
                <span className="cura-patient-card__body">
                  <span className="cura-patient-card__top">
                    <strong className="cura-patient-card__name">{p.name}</strong>
                    {p.medicalRecordNumber ? (
                      <span className="cura-patient-card__mrn">{p.medicalRecordNumber}</span>
                    ) : null}
                  </span>
                  <span className="cura-patient-card__meta">
                    {p.phone ? (
                      <span className="cura-patient-card__contact">
                        <Phone size={13} aria-hidden />
                        {p.phone}
                      </span>
                    ) : null}
                    {p.email ? (
                      <span className="cura-patient-card__contact">
                        <Mail size={13} aria-hidden />
                        {p.email}
                      </span>
                    ) : null}
                    {!p.phone && !p.email ? (
                      <span className="cura-muted">No contact on file</span>
                    ) : null}
                  </span>
                  <span className="cura-patient-card__footer">
                    <span className="cura-patient-card__visits">{visitLabel(p.sessionCount)}</span>
                    {p.whatsappOptIn ? (
                      <span className="cura-patient-card__wa">
                        <MessageCircle size={12} aria-hidden />
                        WhatsApp
                      </span>
                    ) : null}
                  </span>
                </span>
                <ChevronRight size={18} className="cura-patient-card__chev" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

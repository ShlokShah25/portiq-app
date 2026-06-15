import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Stethoscope } from 'lucide-react';
import { curaPaths } from './useCuraRoutes';
import { createCuraConsultation, fetchCuraPatients, curaApiError } from './curaApi';
import './CuraMode.css';

const VISIT_TYPES = [
  { value: 'general', label: 'General visit' },
  { value: 'follow_up', label: 'Follow-up' },
  { value: 'urgent', label: 'Urgent' },
];

export default function CuraConsultationNewPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const preselectedPatient = searchParams.get('patientId') || '';

  const [patients, setPatients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    patientId: preselectedPatient,
    chiefComplaint: '',
    visitType: 'general',
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await fetchCuraPatients('');
        if (!cancelled) {
          setPatients(list);
          if (preselectedPatient && list.some((p) => String(p._id) === preselectedPatient)) {
            setForm((f) => ({ ...f, patientId: preselectedPatient }));
          }
        }
      } catch (err) {
        if (!cancelled) setError(curaApiError(err, 'Could not load patients.'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [preselectedPatient]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.patientId) {
      setError('Select a patient to continue.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const consultation = await createCuraConsultation({
        patientId: form.patientId,
        chiefComplaint: form.chiefComplaint,
        visitType: form.visitType,
      });
      const sessionPath = curaPaths(consultation?._id).consultationSession;
      navigate(sessionPath, { replace: true });
    } catch (err) {
      setError(curaApiError(err, 'Could not create consultation.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="cura-page" style={{ maxWidth: 560 }}>
      <header className="cura-page__header">
        <div>
          <p className="cura-page__eyebrow">New visit</p>
          <h1 className="cura-page__title">Start consultation</h1>
          <p className="cura-page__subtitle">
            Select a patient and enter the room to begin ambient documentation.
          </p>
        </div>
      </header>

      {error ? (
        <div className="cura-login__error" role="alert" style={{ marginBottom: 16 }}>
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="cura-loading">Loading patients…</div>
      ) : patients.length === 0 ? (
        <div className="cura-card cura-empty">
          <p className="cura-empty__title">Add a patient first</p>
          <p>You need at least one patient before starting a consultation.</p>
          <Link to={curaPaths().patients} className="cura-btn cura-btn--primary">
            Go to patients
          </Link>
        </div>
      ) : (
        <form className="cura-card" onSubmit={handleSubmit}>
          <label className="cura-form-label">
            Patient *
            <select
              className="cura-input"
              value={form.patientId}
              onChange={(e) => setForm((f) => ({ ...f, patientId: e.target.value }))}
              required
            >
              <option value="">Select patient…</option>
              {patients.map((p) => (
                <option key={p._id} value={p._id}>
                  {p.name}
                  {p.medicalRecordNumber ? ` (${p.medicalRecordNumber})` : ''}
                </option>
              ))}
            </select>
          </label>

          <label className="cura-form-label">
            Visit type
            <select
              className="cura-input"
              value={form.visitType}
              onChange={(e) => setForm((f) => ({ ...f, visitType: e.target.value }))}
            >
              {VISIT_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>

          <label className="cura-form-label">
            Chief complaint
            <textarea
              className="cura-input"
              rows={3}
              value={form.chiefComplaint}
              onChange={(e) => setForm((f) => ({ ...f, chiefComplaint: e.target.value }))}
              placeholder="Patient&apos;s main concern or reason for visit"
            />
          </label>

          <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
            <button type="submit" className="cura-btn cura-btn--primary" disabled={saving}>
              <Stethoscope size={16} aria-hidden />
              {saving ? 'Opening room…' : 'Enter consultation room'}
            </button>
            <Link to={curaPaths().dashboard} className="cura-btn cura-btn--secondary">
              Cancel
            </Link>
          </div>
        </form>
      )}
    </div>
  );
}

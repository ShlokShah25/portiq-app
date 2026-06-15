import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Stethoscope } from 'lucide-react';
import { createCuraConsultation, fetchCuraPatients, curaApiError } from './curaApi';
import { curaPaths } from './useCuraRoutes';
import './CuraMode.css';

/**
 * One-step start: pick patient → go straight to the room.
 */
export default function CuraQuickStart({ compact = false }) {
  const navigate = useNavigate();
  const [patients, setPatients] = useState([]);
  const [patientId, setPatientId] = useState('');
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await fetchCuraPatients('');
        if (!cancelled) setPatients(list);
      } catch (err) {
        if (!cancelled) setError(curaApiError(err, 'Could not load patients.'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const startVisit = async () => {
    if (!patientId) {
      setError('Pick a patient first.');
      return;
    }
    setStarting(true);
    setError('');
    try {
      const consultation = await createCuraConsultation({ patientId });
      navigate(curaPaths(consultation?._id).consultationSession, { replace: true });
    } catch (err) {
      setError(curaApiError(err, 'Could not start visit.'));
      setStarting(false);
    }
  };

  if (loading) {
    return <p className="cura-loading" style={{ margin: 0 }}>Loading patients…</p>;
  }

  if (patients.length === 0) {
    return (
      <p style={{ fontSize: 13, color: 'var(--cura-text-secondary)', margin: 0 }}>
        Add a patient first, then start a visit from here.
      </p>
    );
  }

  return (
    <div className={compact ? 'cura-quick-start cura-quick-start--compact' : 'cura-quick-start'}>
      {error ? (
        <p className="cura-login__error" role="alert" style={{ marginBottom: 8 }}>
          {error}
        </p>
      ) : null}
      <div className="cura-quick-start__row">
        <select
          className="cura-input"
          value={patientId}
          onChange={(e) => setPatientId(e.target.value)}
          aria-label="Patient"
        >
          <option value="">Select patient…</option>
          {patients.map((p) => (
            <option key={p._id} value={p._id}>
              {p.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="cura-btn cura-btn--primary"
          onClick={startVisit}
          disabled={starting || !patientId}
        >
          <Stethoscope size={16} aria-hidden />
          {starting ? 'Starting…' : 'Start visit'}
        </button>
      </div>
    </div>
  );
}

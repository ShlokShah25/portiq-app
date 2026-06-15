import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { Link } from 'react-router-dom';
import { createCuraConsultation, fetchCuraPatients, curaApiError } from './curaApi';
import { curaPaths } from './useCuraRoutes';
import { patientInitials } from './curaUtils';
import './CuraCore.css';

/**
 * Tap a patient → start the visit immediately.
 */
export default function CuraQuickStart() {
  const navigate = useNavigate();
  const [patients, setPatients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [startingId, setStartingId] = useState('');
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

  const startWith = async (patientId) => {
    setStartingId(patientId);
    setError('');
    try {
      const consultation = await createCuraConsultation({ patientId });
      navigate(curaPaths(consultation?._id).consultationSession, { replace: true });
    } catch (err) {
      setError(curaApiError(err, 'Could not start visit.'));
      setStartingId('');
    }
  };

  if (loading) {
    return <p className="cura-muted">Loading your patients…</p>;
  }

  if (patients.length === 0) {
    return (
      <div className="cura-empty-card">
        <p className="cura-empty-card__title">No patients yet</p>
        <p className="cura-muted">Add someone to your panel to begin a visit.</p>
        <Link to={curaPaths().patients} className="cura-btn cura-btn--primary">
          <Plus size={16} aria-hidden />
          Add patient
        </Link>
      </div>
    );
  }

  return (
    <div className="cura-quick-start">
      {error ? (
        <p className="cura-login__error" role="alert">
          {error}
        </p>
      ) : null}
      <p className="cura-quick-start__hint">Tap a patient to begin</p>
      <div className="cura-patient-chips" role="list">
        {patients.map((p) => {
          const busy = startingId === p._id;
          return (
            <button
              key={p._id}
              type="button"
              className={`cura-patient-chip${busy ? ' is-busy' : ''}`}
              onClick={() => startWith(p._id)}
              disabled={!!startingId}
              role="listitem"
            >
              <span className="cura-patient-chip__avatar" aria-hidden>
                {patientInitials(p.name)}
              </span>
              <span className="cura-patient-chip__name">{p.name}</span>
              {busy ? <span className="cura-patient-chip__status">Opening…</span> : null}
            </button>
          );
        })}
        <Link to={curaPaths().patients} className="cura-patient-chip cura-patient-chip--add" role="listitem">
          <span className="cura-patient-chip__avatar cura-patient-chip__avatar--add" aria-hidden>
            <Plus size={18} />
          </span>
          <span className="cura-patient-chip__name">Add new</span>
        </Link>
      </div>
    </div>
  );
}

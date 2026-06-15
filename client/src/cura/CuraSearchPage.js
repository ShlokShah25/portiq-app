import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search } from 'lucide-react';
import { searchCuraConsultations, fetchCuraPatients, curaApiError } from './curaApi';
import { curaPaths } from './useCuraRoutes';
import { curaMeetingPaths } from './curaUtils';
import { useCuraProduct } from './CuraProductContext';
import { maskPatient } from './piiMask';
import './CuraMode.css';

export default function CuraSearchPage() {
  const { piiUnmasked, openCommandPalette } = useCuraProduct();
  const [query, setQuery] = useState('');
  const [consultations, setConsultations] = useState([]);
  const [patients, setPatients] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (query.trim().length < 2) {
      setConsultations([]);
      setPatients([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      setLoading(true);
      setError('');
      try {
        const q = query.trim();
        const [c, p] = await Promise.all([
          searchCuraConsultations(q),
          fetchCuraPatients(q),
        ]);
        if (!cancelled) {
          setConsultations(c);
          setPatients(p);
        }
      } catch (err) {
        if (!cancelled) setError(curaApiError(err, 'Search failed.'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query]);

  return (
    <div className="cura-page">
      <header className="cura-page__header">
        <div>
          <p className="cura-page__eyebrow">Clinical search</p>
          <h1 className="cura-page__title">Find patients &amp; encounters</h1>
          <p className="cura-page__subtitle">
            Search by symptom, medication, chief complaint, or patient name.{' '}
            <button type="button" className="cura-btn cura-btn--ghost" onClick={openCommandPalette} style={{ padding: 0 }}>
              ⌘K
            </button>
          </p>
        </div>
      </header>

      <div className="cura-card" style={{ marginBottom: 20 }}>
        <label className="cura-field__label" htmlFor="cura-search-input">
          Query
        </label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Search size={16} aria-hidden style={{ color: 'var(--cura-text-muted)' }} />
          <input
            id="cura-search-input"
            className="cura-field__input"
            placeholder="e.g. headache, metformin, follow-up"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
        </div>
      </div>

      {error ? (
        <p className="cura-login__error" role="alert">
          {error}
        </p>
      ) : null}
      {loading ? <p className="cura-loading">Searching…</p> : null}

      {consultations.length > 0 ? (
        <section className="cura-card" style={{ marginBottom: 16 }}>
          <h2 className="cura-card__title">Consultations</h2>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {consultations.map((c) => {
              const paths = curaMeetingPaths(c);
              const patient = maskPatient(c.patientId, piiUnmasked);
              return (
                <li key={c._id} style={{ padding: '10px 0', borderBottom: '1px solid var(--cura-border)' }}>
                  <Link to={paths.report} style={{ color: 'inherit', textDecoration: 'none' }}>
                    <strong>{patient?.name || 'Consultation'}</strong>
                    <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--cura-text-secondary)' }}>
                      {c.chiefComplaint || c.preVisitNotes || 'No chief complaint'}
                    </p>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {patients.length > 0 ? (
        <section className="cura-card">
          <h2 className="cura-card__title">Patients</h2>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {patients.map((p) => {
              const masked = maskPatient(p, piiUnmasked);
              return (
                <li key={p._id} style={{ padding: '10px 0', borderBottom: '1px solid var(--cura-border)' }}>
                  <Link to={curaPaths(p._id).patient} style={{ color: 'inherit', textDecoration: 'none' }}>
                    <strong>{masked.name}</strong>
                    <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--cura-text-secondary)' }}>
                      {[masked.medicalRecordNumber, masked.phone].filter(Boolean).join(' · ')}
                    </p>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {!loading && query.trim().length >= 2 && !consultations.length && !patients.length && !error ? (
        <div className="cura-empty">
          <p className="cura-empty__title">No results</p>
          <p>Try a different symptom, medication, or patient name.</p>
        </div>
      ) : null}
    </div>
  );
}

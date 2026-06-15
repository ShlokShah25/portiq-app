import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCuraProduct } from './CuraProductContext';
import { searchCuraConsultations, fetchCuraPatients, curaApiError } from './curaApi';
import { curaPaths } from './useCuraRoutes';
import { curaMeetingPaths } from './curaUtils';
import './CuraCore.css';

const QUICK_ACTIONS = [
  { id: 'today', label: 'Go to Today', path: () => curaPaths().dashboard },
  { id: 'patients', label: 'Patient registry', path: () => curaPaths().patients },
  { id: 'new', label: 'Start visit', path: () => curaPaths().dashboard },
  { id: 'search', label: 'Clinical search', path: () => `${curaPaths().dashboard}#search` },
];

export default function CuraCommandPalette() {
  const { commandPaletteOpen, closeCommandPalette } = useCuraProduct();
  const navigate = useNavigate();
  const inputRef = useRef(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (commandPaletteOpen) {
      setQuery('');
      setResults([]);
      setError('');
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [commandPaletteOpen]);

  useEffect(() => {
    if (!commandPaletteOpen || query.trim().length < 2) {
      setResults([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      setLoading(true);
      setError('');
      try {
        const q = query.trim();
        const [consultations, patients] = await Promise.all([
          searchCuraConsultations(q).catch(() => []),
          fetchCuraPatients(q).catch(() => []),
        ]);
        if (cancelled) return;
        const items = [];
        consultations.slice(0, 6).forEach((c) => {
          items.push({
            id: `c-${c._id}`,
            label: c.patientId?.name || 'Consultation',
            meta: c.chiefComplaint || c.preVisitNotes || 'Consultation',
            path: curaMeetingPaths(c).session,
          });
        });
        patients.slice(0, 4).forEach((p) => {
          items.push({
            id: `p-${p._id}`,
            label: p.name,
            meta: p.medicalRecordNumber || p.phone || 'Patient',
            path: curaPaths(p._id).patient,
          });
        });
        setResults(items);
      } catch (err) {
        if (!cancelled) setError(curaApiError(err, 'Search failed.'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 280);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, commandPaletteOpen]);

  if (!commandPaletteOpen) return null;

  const go = (path) => {
    closeCommandPalette();
    navigate(path);
  };

  const showQuick = query.trim().length < 2;

  return (
    <div
      className="cura-cmd-overlay"
      role="dialog"
      aria-label="Clinical command palette"
      onClick={closeCommandPalette}
    >
      <div className="cura-cmd" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="cura-cmd__input"
          placeholder="Search symptoms, medications, patients…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Clinical search"
        />
        <ul className="cura-cmd__list">
          {error ? (
            <li style={{ padding: 12, color: 'var(--cura-rose)', fontSize: 12 }}>{error}</li>
          ) : null}
          {loading ? (
            <li style={{ padding: 12, fontSize: 12, color: 'var(--cura-text-muted)' }}>Searching…</li>
          ) : null}
          {showQuick
            ? QUICK_ACTIONS.map((a) => (
                <li key={a.id}>
                  <button type="button" className="cura-cmd__item" onClick={() => go(a.path())}>
                    {a.label}
                  </button>
                </li>
              ))
            : results.length === 0 && !loading
              ? (
                <li style={{ padding: 12, fontSize: 12, color: 'var(--cura-text-muted)' }}>
                  No matches. Try a symptom or patient name.
                </li>
              )
              : results.map((r) => (
                  <li key={r.id}>
                    <button type="button" className="cura-cmd__item" onClick={() => go(r.path)}>
                      {r.label}
                      <span className="cura-cmd__item-meta">{r.meta}</span>
                    </button>
                  </li>
                ))}
        </ul>
      </div>
    </div>
  );
}

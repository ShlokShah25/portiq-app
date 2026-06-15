import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Stethoscope, FileCheck, ChevronRight, Sun, Search, AlertTriangle } from 'lucide-react';
import { curaPaths } from './useCuraRoutes';
import { fetchCuraDashboard, fetchCuraAlerts, searchCuraConsultations, curaApiError } from './curaApi';
import {
  consultationStatusMeta,
  curaMeetingPaths,
  patientInitials,
  clinicalPrepBadge,
} from './curaUtils';
import { triageLevelLabel } from './availabilityTime';
import CuraTriagePulse from './CuraTriagePulse';
import './CuraTriagePulse.css';
import './CuraMode.css';
import './CuraSession.css';

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function formatToday() {
  return new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

function formatTime(d) {
  if (!d) return '';
  return new Date(d).toLocaleString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
}

function roundCardPath(consultation) {
  const meta = consultationStatusMeta(consultation);
  const paths = curaMeetingPaths(consultation);
  if (meta.action === 'report') return paths.report;
  return paths.session;
}

export default function CuraDashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [alerts, setAlerts] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const [triageDismissed, setTriageDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [res, alertList] = await Promise.all([
          fetchCuraDashboard(),
          fetchCuraAlerts().catch(() => []),
        ]);
        if (!cancelled) {
          setData(res);
          setAlerts(alertList);
        }
      } catch (err) {
        if (!cancelled) setError(curaApiError(err, 'Could not load dashboard.'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSearch = async (e) => {
    e.preventDefault();
    const q = searchQuery.trim();
    if (q.length < 2) return;
    setSearching(true);
    setError('');
    try {
      const results = await searchCuraConsultations(q);
      setSearchResults(results);
    } catch (err) {
      setError(curaApiError(err, 'Search failed.'));
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  };

  const stats = data?.stats || {};
  const consultationsToday = data?.consultationsToday || [];
  const pending = data?.pendingApprovals || [];

  if (loading) {
    return (
      <div className="cura-page">
        <div className="cura-loading" role="status">
          Loading your rounds…
        </div>
      </div>
    );
  }

  return (
    <div className="cura-page">
      {!triageDismissed ? (
        <CuraTriagePulse alerts={alerts} onDismiss={() => setTriageDismissed(true)} />
      ) : null}

      <section className="cura-hero">
        <p className="cura-hero__greeting">
          <Sun size={14} style={{ verticalAlign: -2, marginRight: 6 }} aria-hidden />
          {greeting()} · {formatToday()}
        </p>
        <h1 className="cura-hero__title">Today&apos;s rounds</h1>
        <p className="cura-hero__subtitle">
          Your clinical command center — see who&apos;s on the schedule, resume active visits, and clear SOAP reviews.
        </p>
        <div className="cura-stat-rings">
          <div className="cura-stat-ring">
            <span className="cura-stat-ring__value">{stats.todayConsultations ?? 0}</span>
            <span className="cura-stat-ring__label">Consultations today</span>
          </div>
          <div className="cura-stat-ring">
            <span className="cura-stat-ring__value">{stats.pendingApprovals ?? 0}</span>
            <span className="cura-stat-ring__label">Notes to review</span>
          </div>
          <div className="cura-stat-ring">
            <span className="cura-stat-ring__value">{stats.patientCount ?? 0}</span>
            <span className="cura-stat-ring__label">Patients in panel</span>
          </div>
        </div>
        <div style={{ marginTop: 20 }}>
          <Link to={curaPaths().consultationNew} className="cura-btn cura-btn--primary">
            <Stethoscope size={16} aria-hidden />
            Start consultation
          </Link>
        </div>
      </section>

      {error ? (
        <div className="cura-login__error" role="alert" style={{ marginBottom: 20 }}>
          {error}
        </div>
      ) : null}

      {alerts.length > 0 ? (
        <div
          className="cura-card"
          style={{
            marginBottom: 20,
            borderColor: 'rgba(225, 29, 72, 0.35)',
            background: 'var(--cura-rose-dim)',
          }}
          role="alert"
        >
          <strong style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <AlertTriangle size={16} aria-hidden />
            {alerts.length} urgent WhatsApp alert{alerts.length === 1 ? '' : 's'}
          </strong>
          <p style={{ fontSize: 13, margin: '8px 0 0', color: '#9f1239' }}>
            {alerts[0].message?.slice(0, 120) || 'Patient reported a possible emergency.'}
          </p>
        </div>
      ) : null}

      <form className="cura-sessions-search" onSubmit={handleSearch} style={{ marginBottom: 20 }}>
        <Search size={16} aria-hidden style={{ color: 'var(--cura-text-muted)' }} />
        <input
          type="search"
          className="cura-input"
          placeholder="Search pre-visit notes (e.g. recurring headaches)…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          aria-label="Search clinical prelude notes"
        />
        <button type="submit" className="cura-btn cura-btn--secondary" disabled={searching}>
          {searching ? 'Searching…' : 'Search'}
        </button>
      </form>

      {searchResults ? (
        <section className="cura-card" style={{ marginBottom: 20 }}>
          <h2 className="cura-card__title" style={{ marginBottom: 12 }}>
            Search results ({searchResults.length})
          </h2>
          {searchResults.length === 0 ? (
            <p style={{ fontSize: 13, color: 'var(--cura-text-secondary)', margin: 0 }}>No matches.</p>
          ) : (
            <ul className="cura-list">
              {searchResults.map((c) => (
                <li key={c._id}>
                  <Link to={curaMeetingPaths(c).session} className="cura-list__row cura-list__row--link">
                    <div>
                      <strong>{c.patientId?.name || 'Patient'}</strong>
                      <span className="cura-list__meta">
                        {c.chiefComplaint || c.preVisitNotes?.slice(0, 80) || 'No notes'}
                      </span>
                    </div>
                    <ChevronRight size={16} aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      <section className="cura-rounds">
        <h2 className="cura-rounds__title">On your list</h2>
        {consultationsToday.length === 0 ? (
          <div className="cura-empty">
            <p className="cura-empty__title">Clear schedule</p>
            <p>No consultations booked for today yet.</p>
            <Link to={curaPaths().consultationNew} className="cura-btn cura-btn--primary">
              Start a visit
            </Link>
          </div>
        ) : (
          <div className="cura-rounds-grid">
            {consultationsToday.map((c) => {
              const meta = consultationStatusMeta(c);
              const prep = clinicalPrepBadge(c);
              const triage = String(c.triageLevel || 'NORMAL').toUpperCase();
              const isEmergency = triage === 'EMERGENCY' || c.urgentTriage;
              const name = c.patientId?.name || c.title || 'Patient';
              return (
                <Link
                  key={c._id}
                  to={roundCardPath(c)}
                  className={`cura-round-card${isEmergency ? ' cura-round-card--emergency' : ''}`}
                >
                  <div className="cura-round-card__top">
                    <div className="cura-round-card__avatar" aria-hidden>
                      {patientInitials(name)}
                    </div>
                    <div>
                      <p className="cura-round-card__name">{name}</p>
                      <p className="cura-round-card__complaint">
                        {c.preVisitNotes || c.chiefComplaint || 'General consultation'}
                      </p>
                    </div>
                  </div>
                  <div className="cura-round-card__foot">
                    <span className="cura-round-card__time">
                      {formatTime(c.scheduledTime || c.startTime)}
                    </span>
                    <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                      {isEmergency ? (
                        <span className="cura-pill cura-pill--critical">{triageLevelLabel(triage)}</span>
                      ) : null}
                      <span
                        className={`cura-pill${
                          prep.tone === 'success'
                            ? ' cura-pill--success'
                            : prep.tone === 'warning'
                              ? ' cura-pill--warning'
                              : ''
                        }`}
                        title="Clinical prep status"
                      >
                        {prep.label}
                      </span>
                      <span
                        className={`cura-pill${
                          meta.tone === 'success'
                            ? ' cura-pill--success'
                            : meta.tone === 'warning'
                              ? ' cura-pill--warning'
                              : meta.tone === 'live'
                                ? ' cura-pill--live'
                                : ''
                        }`}
                      >
                        {meta.label}
                      </span>
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      {pending.length > 0 ? (
        <section className="cura-card" style={{ marginTop: 24 }}>
          <h2 className="cura-card__title" style={{ marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
            <FileCheck size={16} aria-hidden />
            SOAP notes awaiting review
          </h2>
          <ul className="cura-list">
            {pending.map((c) => (
              <li key={c._id}>
                <Link
                  to={curaMeetingPaths(c).report}
                  className="cura-list__row cura-list__row--link"
                >
                  <div>
                    <strong>{c.patientId?.name || c.title}</strong>
                    <span className="cura-list__meta">{c.chiefComplaint || 'Review clinical note'}</span>
                  </div>
                  <ChevronRight size={16} aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

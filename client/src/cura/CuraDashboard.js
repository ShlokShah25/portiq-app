import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, AlertTriangle } from 'lucide-react';
import { curaPaths } from './useCuraRoutes';
import { fetchCuraDashboard, fetchCuraAlerts, curaApiError } from './curaApi';
import { consultationStatusMeta, curaMeetingPaths, patientInitials } from './curaUtils';
import CuraQuickStart from './CuraQuickStart';
import './CuraCore.css';
import './CuraMode.css';

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
  return new Date(d).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
}

function visitPath(consultation) {
  const meta = consultationStatusMeta(consultation);
  const paths = curaMeetingPaths(consultation);
  return meta.action === 'report' ? paths.report : paths.session;
}

export default function CuraDashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [alerts, setAlerts] = useState([]);

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
        if (!cancelled) setError(curaApiError(err, 'Could not load today.'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const consultationsToday = data?.consultationsToday || [];
  const pending = data?.pendingApprovals || [];

  if (loading) {
    return (
      <div className="cura-home">
        <div className="cura-loading">One moment…</div>
      </div>
    );
  }

  return (
    <div className="cura-home">
      <section className="cura-home-hero">
        <p className="cura-home-hero__date">{formatToday()}</p>
        <h1 className="cura-home-hero__title">{greeting()}</h1>
        <p className="cura-home-hero__lead">Who are you seeing?</p>
        <CuraQuickStart />
      </section>

      {error ? (
        <p className="cura-login__error" role="alert">
          {error}
        </p>
      ) : null}

      {alerts.length > 0 ? (
        <div className="cura-alert-banner" role="alert">
          <AlertTriangle size={16} aria-hidden />
          <span>
            {alerts.length} urgent message{alerts.length === 1 ? '' : 's'} on WhatsApp
          </span>
        </div>
      ) : null}

      <div className="cura-home-grid">
        <div className="cura-home-grid__main">
          {pending.length > 0 ? (
            <section className="cura-home-section">
              <h2 className="cura-home-section__title">Notes to finish</h2>
              <ul className="cura-visit-list">
                {pending.map((c) => {
                  const name = c.patientId?.name || 'Patient';
                  return (
                    <li key={c._id}>
                      <Link to={curaMeetingPaths(c).report} className="cura-visit-row">
                        <span className="cura-visit-row__avatar" aria-hidden>
                          {patientInitials(name)}
                        </span>
                        <span className="cura-visit-row__body">
                          <strong>{name}</strong>
                          <span className="cura-muted">Review and sign off</span>
                        </span>
                        <ChevronRight size={18} className="cura-visit-row__chev" aria-hidden />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : (
            <p className="cura-home-quiet cura-muted" style={{ textAlign: 'left', padding: '8px 0' }}>
              No notes waiting — you&apos;re caught up.
            </p>
          )}
        </div>

        <aside className="cura-home-grid__aside">
          {consultationsToday.length > 0 ? (
            <section className="cura-home-section" style={{ marginBottom: 0 }}>
              <h2 className="cura-home-section__title">Today&apos;s visits</h2>
              <ul className="cura-visit-list">
                {consultationsToday.map((c) => {
                  const meta = consultationStatusMeta(c);
                  const name = c.patientId?.name || 'Patient';
                  return (
                    <li key={c._id}>
                      <Link to={visitPath(c)} className="cura-visit-row">
                        <span className="cura-visit-row__avatar" aria-hidden>
                          {patientInitials(name)}
                        </span>
                        <span className="cura-visit-row__body">
                          <strong>{name}</strong>
                          <span className="cura-muted">
                            {formatTime(c.scheduledTime || c.startTime)}
                            {c.chiefComplaint ? ` · ${c.chiefComplaint}` : ''}
                          </span>
                        </span>
                        <span className={`cura-visit-row__badge cura-visit-row__badge--${meta.tone}`}>
                          {meta.label}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : (
            <div className="cura-empty-card">
              <p className="cura-empty-card__title">Clear schedule</p>
              <p className="cura-muted">No visits booked for today.</p>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

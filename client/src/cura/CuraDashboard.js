import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, AlertTriangle } from 'lucide-react';
import { curaPaths } from './useCuraRoutes';
import { fetchCuraDashboard, fetchCuraAlerts, curaApiError } from './curaApi';
import { curaMeetingPaths, patientInitials } from './curaUtils';
import CuraQuickStart from './CuraQuickStart';
import CuraDayBriefing from './CuraDayBriefing';
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

export default function CuraDashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [alerts, setAlerts] = useState([]);

  const load = async () => {
    try {
      const [res, alertList] = await Promise.all([
        fetchCuraDashboard(),
        fetchCuraAlerts().catch(() => []),
      ]);
      setData(res);
      setAlerts(alertList);
      setError('');
    } catch (err) {
      setError(curaApiError(err, 'Could not load today.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const interval = setInterval(load, 45000);
    return () => clearInterval(interval);
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
      <header className="cura-home-top">
        <div>
          <p className="cura-home-hero__date">{formatToday()}</p>
          <h1 className="cura-home-hero__title">{greeting()}, doctor.</h1>
        </div>
      </header>

      {error ? (
        <p className="cura-login__error" role="alert">
          {error}
        </p>
      ) : null}

      {alerts.length > 0 ? (
        <div className="cura-alert-banner" role="alert">
          <AlertTriangle size={16} aria-hidden />
          <span>
            {alerts.length} urgent message{alerts.length === 1 ? '' : 's'} on WhatsApp — check now.
          </span>
        </div>
      ) : null}

      <CuraDayBriefing appointments={consultationsToday} />

      <section className="cura-home-hero cura-home-hero--compact">
        <p className="cura-home-hero__lead">Walk-in or unscheduled? Tap a patient to start.</p>
        <CuraQuickStart />
      </section>

      <div className="cura-home-grid">
        <div className="cura-home-grid__main">
          {pending.length > 0 ? (
            <section className="cura-home-section">
              <h2 className="cura-home-section__title">Notes waiting on you</h2>
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
                          <span className="cura-muted">I&apos;ve drafted notes — take a look when you can.</span>
                        </span>
                        <ChevronRight size={18} className="cura-visit-row__chev" aria-hidden />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : (
            <p className="cura-muted" style={{ padding: '4px 0' }}>
              No notes waiting — you&apos;re caught up.
            </p>
          )}
        </div>

        <aside className="cura-home-grid__aside">
          <div className="cura-empty-card">
            <p className="cura-empty-card__title">Tip</p>
            <p className="cura-muted">
              Patients who book on WhatsApp appear above with what they told us. After the visit, I&apos;ll brief you in
              plain language — no formal SOAP forms.
            </p>
            <Link to={curaPaths().calendar} className="cura-btn cura-btn--secondary" style={{ marginTop: 12 }}>
              Open calendar
            </Link>
          </div>
        </aside>
      </div>
    </div>
  );
}

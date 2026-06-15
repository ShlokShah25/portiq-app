import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { curaPaths } from './useCuraRoutes';
import { fetchCuraPrescriptions, fetchCuraFollowUps, curaApiError } from './curaApi';
import './CuraCore.css';
import './CuraMode.css';

function CuraStubPage({ title, description, ctaLabel, ctaTo }) {
  return (
    <div className="cura-page cura-stub">
      <h1 className="cura-page__title">{title}</h1>
      <p>{description}</p>
      {ctaTo ? (
        <Link to={ctaTo} className="cura-btn cura-btn--primary">
          {ctaLabel || 'Go to dashboard'}
        </Link>
      ) : (
        <Link to={curaPaths().dashboard} className="cura-btn cura-btn--secondary">
          Back to dashboard
        </Link>
      )}
    </div>
  );
}

export function CuraSettingsPage() {
  return (
    <div className="cura-home">
      <h1 className="cura-home-hero__title" style={{ fontSize: 24, marginBottom: 8 }}>
        Settings
      </h1>
      <p className="cura-muted" style={{ marginBottom: 20 }}>
        Clinic profile, WhatsApp, and notification preferences.
      </p>
      <div className="cura-empty-card">
        <p className="cura-empty-card__title">Coming soon</p>
        <p className="cura-muted">Manage your clinic from here in the next update.</p>
        <Link to={curaPaths().dashboard} className="cura-btn cura-btn--secondary" style={{ marginTop: 12 }}>
          Back to Today
        </Link>
      </div>
    </div>
  );
}

function formatAt(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function CuraPrescriptionsPage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await fetchCuraPrescriptions();
        if (!cancelled) setItems(list);
      } catch (err) {
        if (!cancelled) setError(curaApiError(err, 'Could not load prescriptions.'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="cura-page">
      <header className="cura-page__header">
        <div>
          <p className="cura-page__eyebrow">Pharmacy</p>
          <h1 className="cura-page__title">Prescriptions</h1>
          <p className="cura-page__subtitle">Review and approve scripts before patient delivery.</p>
        </div>
      </header>

      {error ? (
        <div className="cura-login__error" role="alert" style={{ marginBottom: 16 }}>
          {error}
        </div>
      ) : null}

      <section className="cura-card">
        {loading ? (
          <div className="cura-loading">Loading prescriptions…</div>
        ) : items.length === 0 ? (
          <div className="cura-empty">
            <p className="cura-empty__title">No prescriptions yet</p>
            <p>Prescriptions created during consultations will appear here for approval.</p>
          </div>
        ) : (
          <ul className="cura-list">
            {items.map((rx) => (
              <li key={rx._id} className="cura-list__row">
                <div>
                  <strong>{rx.patientId?.name || 'Patient'}</strong>
                  <span className="cura-list__meta">
                    {formatAt(rx.createdAt)} · {Array.isArray(rx.items) ? rx.items.length : 0} item(s)
                  </span>
                </div>
                <span className={`cura-pill ${rx.status === 'approved' ? 'cura-pill--success' : 'cura-pill--warning'}`}>
                  {rx.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export function CuraFollowUpsPage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await fetchCuraFollowUps();
        if (!cancelled) setItems(list);
      } catch (err) {
        if (!cancelled) setError(curaApiError(err, 'Could not load follow-ups.'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="cura-page">
      <header className="cura-page__header">
        <div>
          <p className="cura-page__eyebrow">Outreach</p>
          <h1 className="cura-page__title">Follow-ups</h1>
          <p className="cura-page__subtitle">WhatsApp check-ins and patient response tracking.</p>
        </div>
      </header>

      {error ? (
        <div className="cura-login__error" role="alert" style={{ marginBottom: 16 }}>
          {error}
        </div>
      ) : null}

      <section className="cura-card">
        {loading ? (
          <div className="cura-loading">Loading follow-ups…</div>
        ) : items.length === 0 ? (
          <div className="cura-empty">
            <p className="cura-empty__title">No follow-ups scheduled</p>
            <p>Automated WhatsApp check-ins ship in Phase 5.</p>
          </div>
        ) : (
          <ul className="cura-list">
            {items.map((fu) => (
              <li key={fu._id} className="cura-list__row">
                <div>
                  <strong>{fu.patientId?.name || 'Patient'}</strong>
                  <span className="cura-list__meta">
                    {fu.messageType || 'check-in'} · {formatAt(fu.scheduledAt || fu.createdAt)}
                  </span>
                </div>
                <span className="cura-pill">{fu.status}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

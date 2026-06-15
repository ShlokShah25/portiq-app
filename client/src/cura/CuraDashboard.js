import React from 'react';
import { Link } from 'react-router-dom';
import { Stethoscope, Clock, FileCheck } from 'lucide-react';
import { curaPaths } from './useCuraRoutes';
import './CuraMode.css';

function formatToday() {
  return new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

export default function CuraDashboard() {
  return (
    <div className="cura-page">
      <header className="cura-page__header">
        <div>
          <p className="cura-page__eyebrow">{formatToday()}</p>
          <h1 className="cura-page__title">Good morning, Doctor</h1>
          <p className="cura-page__subtitle">
            Today&apos;s consultations and pending approvals at a glance.
          </p>
        </div>
        <Link to={curaPaths().consultationNew} className="cura-btn cura-btn--primary">
          <Stethoscope size={16} aria-hidden />
          Start consultation
        </Link>
      </header>

      <div className="cura-grid cura-grid--3" style={{ marginBottom: 20 }}>
        <div className="cura-card">
          <div className="cura-card__head">
            <h2 className="cura-card__title">Today&apos;s consultations</h2>
            <span className="cura-card__count">0</span>
          </div>
          <p style={{ fontSize: 13, color: 'var(--cura-text-secondary)', margin: 0 }}>
            Scheduled and in-progress visits for today.
          </p>
        </div>
        <div className="cura-card">
          <div className="cura-card__head">
            <h2 className="cura-card__title">Pending approvals</h2>
            <span className="cura-card__count">0</span>
          </div>
          <p style={{ fontSize: 13, color: 'var(--cura-text-secondary)', margin: 0 }}>
            Draft notes awaiting your review before send.
          </p>
        </div>
        <div className="cura-card">
          <div className="cura-card__head">
            <h2 className="cura-card__title">Follow-ups due</h2>
            <span className="cura-card__count">0</span>
          </div>
          <p style={{ fontSize: 13, color: 'var(--cura-text-secondary)', margin: 0 }}>
            Patient check-ins scheduled this week.
          </p>
        </div>
      </div>

      <div className="cura-grid cura-grid--2">
        <section className="cura-card" aria-labelledby="cura-today-list">
          <h2 id="cura-today-list" className="cura-card__title" style={{ marginBottom: 14 }}>
            Today&apos;s schedule
          </h2>
          <div className="cura-empty">
            <p className="cura-empty__title">No consultations scheduled</p>
            <p>Start a consultation to record, transcribe, and generate visit notes.</p>
            <Link to={curaPaths().consultationNew} className="cura-btn cura-btn--primary">
              Start consultation
            </Link>
          </div>
        </section>

        <section className="cura-card" aria-labelledby="cura-pending-list">
          <h2 id="cura-pending-list" className="cura-card__title" style={{ marginBottom: 14 }}>
            <FileCheck size={14} style={{ display: 'inline', verticalAlign: -2, marginRight: 6 }} />
            Pending approvals
          </h2>
          <div className="cura-empty">
            <p className="cura-empty__title">All caught up</p>
            <p>Completed consultations needing review will appear here.</p>
          </div>
        </section>
      </div>

      <p style={{ marginTop: 24, fontSize: 12, color: 'var(--cura-text-muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
        <Clock size={14} aria-hidden />
        Phase 1 foundation — consultation engine and patient CRM coming next.
      </p>
    </div>
  );
}

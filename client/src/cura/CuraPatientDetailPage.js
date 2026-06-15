import React, { useEffect, useState } from 'react';
import { Link, useParams, useLocation } from 'react-router-dom';
import { ArrowLeft, Stethoscope } from 'lucide-react';
import { curaPaths } from './useCuraRoutes';
import { fetchCuraPatient, curaApiError } from './curaApi';
import { curaMeetingPaths } from './curaUtils';
import { useCuraProduct } from './CuraProductContext';
import { maskPatient } from './piiMask';
import './CuraMode.css';

function timelineBorder(type) {
  if (type === 'prescription') return 'cura-timeline__card--rx';
  if (type === 'follow_up') return 'cura-timeline__card--follow';
  if (type === 'whatsapp') return 'cura-timeline__card--whatsapp';
  return 'cura-timeline__card--consult';
}

function formatAt(d) {
  if (!d) return '';
  return new Date(d).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

export default function CuraPatientDetailPage() {
  const { id } = useParams();
  const location = useLocation();
  const { piiUnmasked } = useCuraProduct();
  const flash = location.state?.flash;
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetchCuraPatient(id);
        if (!cancelled) setData(res);
      } catch (err) {
        if (!cancelled) setError(curaApiError(err, 'Could not load patient.'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (loading) {
    return (
      <div className="cura-page">
        <div className="cura-loading">Loading patient…</div>
      </div>
    );
  }

  if (error || !data?.patient) {
    return (
      <div className="cura-page">
        <Link to={curaPaths().patients} className="cura-btn cura-btn--ghost">
          <ArrowLeft size={16} /> Patients
        </Link>
        <p className="cura-login__error" style={{ marginTop: 16 }}>
          {error || 'Patient not found.'}
        </p>
      </div>
    );
  }

  const { patient: rawPatient, timeline } = data;
  const patient = maskPatient(rawPatient, piiUnmasked);

  return (
    <div className="cura-page">
      <div className="cura-page__nav" style={{ marginBottom: 16 }}>
        <Link to={curaPaths().patients} className="cura-btn cura-btn--ghost">
          <ArrowLeft size={16} aria-hidden />
          Patients
        </Link>
      </div>

      <header className="cura-page__header">
        <div>
          <p className="cura-page__eyebrow">{patient.medicalRecordNumber || 'Patient record'}</p>
          <h1 className="cura-page__title">{patient.name}</h1>
          <p className="cura-page__subtitle">
            {[patient.phone, patient.email].filter(Boolean).join(' · ') || 'No contact on file'}
          </p>
          {patient.conditions?.length ? (
            <p style={{ fontSize: 13, color: 'var(--cura-text-secondary)', marginTop: 8 }}>
              Conditions: {patient.conditions.join(', ')}
            </p>
          ) : null}
          {patient.allergies?.length ? (
            <p style={{ fontSize: 13, color: 'var(--cura-rose)', marginTop: 4 }}>
              Allergies: {patient.allergies.join(', ')}
            </p>
          ) : null}
        </div>
        <Link
          to={`${curaPaths().consultationNew}?patientId=${patient._id}`}
          className="cura-btn cura-btn--primary"
        >
          <Stethoscope size={16} aria-hidden />
          New visit
        </Link>
      </header>

      {flash ? (
        <div
          className="cura-card"
          style={{ marginBottom: 16, borderColor: 'rgba(5, 150, 105, 0.35)', background: 'var(--cura-emerald-dim)' }}
          role="status"
        >
          {flash}
        </div>
      ) : null}

      <section className="cura-card">
        <h2 className="cura-card__title" style={{ marginBottom: 20 }}>
          Clinical timeline
        </h2>
        {timeline.length === 0 ? (
          <div className="cura-empty">
            <p className="cura-empty__title">No events yet</p>
            <p>Consultations, prescriptions, and follow-ups appear here chronologically.</p>
          </div>
        ) : (
          <div className="cura-timeline">
            {timeline.map((ev) => {
              const consultPaths =
                ev.type === 'consultation' ? curaMeetingPaths({ _id: ev.id, patientId: patient._id }) : null;
              const reportReady = ev.summaryStatus === 'Sent' || ev.status === 'Completed';
              const CardInner = (
                <>
                  <div className="cura-timeline__card-head">
                    <strong>{ev.title}</strong>
                    <span className="cura-pill">{ev.status}</span>
                  </div>
                  <p className="cura-timeline__meta">{formatAt(ev.at)}</p>
                  {ev.chiefComplaint ? (
                    <p className="cura-timeline__body">{ev.chiefComplaint}</p>
                  ) : null}
                  {ev.type === 'whatsapp' ? (
                    <p className="cura-timeline__body" style={{ fontSize: 12 }}>
                      WhatsApp · {ev.status}
                    </p>
                  ) : null}
                  {ev.type === 'prescription' ? (
                    <p className="cura-timeline__body" style={{ fontSize: 12 }}>
                      Status: {ev.status === 'sent' ? 'Sent' : ev.status === 'approved' ? 'Approved' : 'Draft'}
                    </p>
                  ) : null}
                  {consultPaths && reportReady ? (
                    <Link to={consultPaths.report} className="cura-btn cura-btn--ghost" style={{ marginTop: 10, padding: '6px 0', fontSize: 12 }}>
                      Review notes →
                    </Link>
                  ) : consultPaths ? (
                    <Link to={consultPaths.session} className="cura-btn cura-btn--ghost" style={{ marginTop: 10, padding: '6px 0', fontSize: 12 }}>
                      Open consultation →
                    </Link>
                  ) : null}
                </>
              );
              return (
                <div key={`${ev.type}-${ev.id}`} className="cura-timeline__item">
                  <span className="cura-timeline__dot" aria-hidden />
                  <div className={`cura-timeline__card ${timelineBorder(ev.type)}`}>{CardInner}</div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

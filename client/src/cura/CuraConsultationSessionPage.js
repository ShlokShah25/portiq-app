import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import axios from 'axios';
import { ArrowLeft, Activity } from 'lucide-react';
import MeetingInProgress from '../components/MeetingInProgress';
import { curaPaths } from './useCuraRoutes';
import { fetchCuraPatient } from './curaApi';
import { isCuraConsultationMeeting, patientInitials } from './curaUtils';
import './CuraMode.css';
import './CuraSession.css';

function PatientRail({ patient, meeting }) {
  const complaint = meeting?.chiefComplaint || 'No chief complaint recorded';
  const visitType = meeting?.visitType || 'general';

  return (
    <aside className="cura-session-rail cura-session-rail--left" aria-label="Patient chart">
      <Link to={curaPaths().dashboard} className="cura-btn cura-btn--ghost" style={{ alignSelf: 'flex-start', padding: '4px 0' }}>
        <ArrowLeft size={14} aria-hidden />
        Dashboard
      </Link>

      <p className="cura-session-rail__label">Patient chart</p>
      <div className="cura-session-rail__patient-card">
        <div className="cura-session-rail__avatar" aria-hidden>
          {patientInitials(patient?.name)}
        </div>
        <h2 className="cura-session-rail__name">{patient?.name || 'Patient'}</h2>
        <p className="cura-session-rail__meta">
          {patient?.medicalRecordNumber ? `MRN ${patient.medicalRecordNumber}` : 'No MRN'}
          {patient?.phone ? ` · ${patient.phone}` : ''}
        </p>
      </div>

      {patient?.allergies?.length ? (
        <div className="cura-session-rail__alert cura-session-rail__alert--allergy" role="alert">
          <strong>Allergies</strong>
          <br />
          {patient.allergies.join(', ')}
        </div>
      ) : null}

      {patient?.conditions?.length ? (
        <div className="cura-session-rail__alert cura-session-rail__alert--condition">
          <strong>Active conditions</strong>
          <br />
          {patient.conditions.join(', ')}
        </div>
      ) : null}

      <div className="cura-session-rail__panel">
        <h3 className="cura-session-rail__panel-title">Chief complaint</h3>
        <p className="cura-session-rail__hint">
          {meeting?.preVisitNotes || meeting?.chiefComplaint || complaint}
        </p>
        {meeting?.preVisitNotes && meeting?.bookingSource === 'whatsapp' ? (
          <p className="cura-session-rail__hint" style={{ marginTop: 8, color: 'var(--cura-emerald)' }}>
            ✓ Captured via WhatsApp pre-consultation
          </p>
        ) : null}
      </div>

      <div className="cura-session-rail__panel">
        <h3 className="cura-session-rail__panel-title">Visit type</h3>
        <p className="cura-session-rail__hint" style={{ textTransform: 'capitalize' }}>
          {String(visitType).replace(/_/g, ' ')}
        </p>
      </div>
    </aside>
  );
}

function ScribeRail() {
  return (
    <aside className="cura-session-rail cura-session-rail--right" aria-label="AI scribe">
      <p className="cura-session-rail__label">AI scribe</p>
      <div className="cura-session-scribe-pulse">
        <span className="cura-session-scribe-pulse__dot" aria-hidden />
        Ambient documentation
      </div>

      <div className="cura-session-rail__panel">
        <h3 className="cura-session-rail__panel-title">
          <Activity size={14} style={{ verticalAlign: -2, marginRight: 6 }} />
          SOAP draft
        </h3>
        <p className="cura-session-rail__hint" style={{ marginBottom: 12 }}>
          After you end the consultation, Cura builds a structured SOAP note from the transcript for your review.
        </p>
        <div className="cura-session-rail__soap-preview">
          {[
            ['S', 'Subjective', 's'],
            ['O', 'Objective', 'o'],
            ['A', 'Assessment', 'a'],
            ['P', 'Plan', 'p'],
          ].map(([letter, label, mod]) => (
            <div key={letter} className="cura-session-rail__soap-row">
              <span className={`cura-session-rail__soap-letter cura-session-rail__soap-letter--${mod}`}>{letter}</span>
              {label} — generated post-visit
            </div>
          ))}
        </div>
      </div>

      <div className="cura-session-rail__panel">
        <h3 className="cura-session-rail__panel-title">Your workflow</h3>
        <p className="cura-session-rail__hint">
          1. Start recording when the patient is present
          <br />
          2. Conduct the visit naturally
          <br />
          3. End session → review SOAP → approve
        </p>
      </div>
    </aside>
  );
}

export default function CuraConsultationSessionPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [meeting, setMeeting] = useState(null);
  const [patient, setPatient] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await axios.get(`/meetings/${id}`);
        const m = res.data?.meeting;
        if (!cancelled) {
          if (!isCuraConsultationMeeting(m)) {
            navigate(`/meetings/${id}/room`, { replace: true });
            return;
          }
          setMeeting(m);
          if (m?.patientId) {
            try {
              const pdata = await fetchCuraPatient(m.patientId);
              if (!cancelled) setPatient(pdata?.patient || null);
            } catch (_) {
              /* patient optional */
            }
          }
        }
      } catch (_) {
        if (!cancelled) setMeeting(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, navigate]);

  if (loading) {
    return (
      <div className="cura-session-layout">
        <div className="cura-loading" style={{ gridColumn: '1 / -1', padding: 48 }}>
          Preparing consultation room…
        </div>
      </div>
    );
  }

  return (
    <div className="cura-session-layout">
      <PatientRail patient={patient} meeting={meeting} />
      <div className="cura-session-main">
        <MeetingInProgress />
      </div>
      <ScribeRail />
    </div>
  );
}

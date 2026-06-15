import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import axios from 'axios';
import { ArrowLeft } from 'lucide-react';
import MeetingInProgress from '../components/MeetingInProgress';
import { curaPaths } from './useCuraRoutes';
import { fetchCuraPatient } from './curaApi';
import { isCuraConsultationMeeting, patientInitials } from './curaUtils';
import './CuraMode.css';
import './CuraSession.css';

function PatientStrip({ patient, meeting }) {
  return (
    <header className="cura-session-strip" aria-label="Patient">
      <Link to={curaPaths().dashboard} className="cura-session-strip__back">
        <ArrowLeft size={14} aria-hidden />
        Back
      </Link>
      <div className="cura-session-strip__patient">
        <span className="cura-session-strip__avatar" aria-hidden>
          {patientInitials(patient?.name || meeting?.title)}
        </span>
        <span className="cura-session-strip__name">{patient?.name || 'Patient'}</span>
      </div>
      {patient?.allergies?.length ? (
        <span className="cura-session-strip__allergy" role="alert">
          Allergies: {patient.allergies.join(', ')}
        </span>
      ) : null}
    </header>
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
              /* optional */
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
    return <div className="cura-loading" style={{ padding: 48 }}>Loading…</div>;
  }

  return (
    <div className="cura-session-simple">
      <PatientStrip patient={patient} meeting={meeting} />
      <MeetingInProgress />
    </div>
  );
}

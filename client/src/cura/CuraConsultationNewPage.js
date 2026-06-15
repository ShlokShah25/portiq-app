import React, { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { createCuraConsultation, curaApiError } from './curaApi';
import { curaPaths } from './useCuraRoutes';
import CuraQuickStart from './CuraQuickStart';
import './CuraMode.css';

/** Fallback route — redirects pre-selected patient straight to session. */
export default function CuraConsultationNewPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const preselectedPatient = searchParams.get('patientId') || '';

  useEffect(() => {
    if (!preselectedPatient) return;
    let cancelled = false;
    (async () => {
      try {
        const consultation = await createCuraConsultation({ patientId: preselectedPatient });
        if (!cancelled) {
          navigate(curaPaths(consultation?._id).consultationSession, { replace: true });
        }
      } catch (err) {
        if (!cancelled) {
          console.error(curaApiError(err, 'Could not start visit.'));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [preselectedPatient, navigate]);

  if (preselectedPatient) {
    return (
      <div className="cura-page">
        <div className="cura-loading">Starting visit…</div>
      </div>
    );
  }

  return (
    <div className="cura-page" style={{ maxWidth: 480 }}>
      <header className="cura-page__header">
        <h1 className="cura-page__title">Start visit</h1>
      </header>
      <div className="cura-card">
        <CuraQuickStart />
      </div>
    </div>
  );
}

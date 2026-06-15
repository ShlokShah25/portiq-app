import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import CuraClinicalReport from './CuraClinicalReport';
import { curaPaths } from './useCuraRoutes';
import './CuraMode.css';
import './CuraSession.css';

export default function CuraConsultationReportPage() {
  const navigate = useNavigate();

  return (
    <div className="cura-page cura-report-wrap">
      <header className="cura-report-chrome">
        <button type="button" className="cura-report-chrome__back" onClick={() => navigate(curaPaths().dashboard)}>
          <ArrowLeft size={16} strokeWidth={1.75} aria-hidden />
          Back to rounds
        </button>
        <div className="cura-report-chrome__intro">
          <p className="cura-report-chrome__eyebrow">Clinical documentation</p>
          <h1 className="cura-report-chrome__title">SOAP note review</h1>
          <p className="cura-report-chrome__subtitle">
            Edit the AI-generated note section by section. Approve when accurate — you remain the author of record.
          </p>
        </div>
      </header>
      <CuraClinicalReport />
    </div>
  );
}

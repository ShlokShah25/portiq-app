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
      <header className="cura-report-chrome cura-report-chrome--simple">
        <button type="button" className="cura-report-chrome__back" onClick={() => navigate(curaPaths().dashboard)}>
          <ArrowLeft size={16} strokeWidth={1.75} aria-hidden />
          Back
        </button>
        <h1 className="cura-report-chrome__title">Visit notes</h1>
      </header>
      <CuraClinicalReport />
    </div>
  );
}

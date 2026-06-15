import React from 'react';
import { AlertTriangle, X } from 'lucide-react';
import './CuraTriagePulse.css';

export default function CuraTriagePulse({ alerts, onDismiss }) {
  if (!alerts?.length) return null;

  const emergency = alerts.filter((a) => a.triageLevel === 'EMERGENCY' || a.severity === 'emergency');
  if (!emergency.length) return null;

  return (
    <div className="cura-triage-pulse" role="alertdialog" aria-labelledby="cura-triage-title">
      <div className="cura-triage-pulse__backdrop" aria-hidden />
      <div className="cura-triage-pulse__card">
        <button type="button" className="cura-triage-pulse__close" onClick={onDismiss} aria-label="Dismiss">
          <X size={18} />
        </button>
        <div className="cura-triage-pulse__icon" aria-hidden>
          <AlertTriangle size={28} />
        </div>
        <p id="cura-triage-title" className="cura-triage-pulse__title">
          High-risk patient alert
        </p>
        <p className="cura-triage-pulse__body">
          {emergency[0].patientId?.name || 'A patient'} reported symptoms that may require immediate
          attention via WhatsApp.
        </p>
        <p className="cura-triage-pulse__quote">
          &ldquo;{emergency[0].message?.slice(0, 160) || 'Emergency keywords detected'}&rdquo;
        </p>
        <p className="cura-triage-pulse__hint">
          {emergency.length > 1
            ? `+${emergency.length - 1} more open emergency alert(s).`
            : 'Contact the patient and follow your clinic emergency protocol.'}
        </p>
      </div>
    </div>
  );
}

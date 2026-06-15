import React from 'react';
import { Link } from 'react-router-dom';
import { curaPaths } from './useCuraRoutes';
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

export function CuraPatientsPage() {
  return (
    <CuraStubPage
      title="Patients"
      description="Patient registry and chronological timeline — Phase 4 of Project Cura. Each patient will show consultations, prescriptions, and follow-ups on a vertical timeline."
      ctaLabel="Start consultation"
      ctaTo={curaPaths().consultationNew}
    />
  );
}

export function CuraCalendarPage() {
  return (
    <CuraStubPage
      title="Calendar"
      description="Schedule and view upcoming consultations. Calendar sync will be added in a later phase."
    />
  );
}

export function CuraPrescriptionsPage() {
  return (
    <CuraStubPage
      title="Prescriptions"
      description="Review and approve prescriptions before sending to patients via WhatsApp. Auto-prescribe is never enabled — every script requires doctor verification."
    />
  );
}

export function CuraFollowUpsPage() {
  return (
    <CuraStubPage
      title="Follow-ups"
      description="Track WhatsApp check-ins, patient replies, and AI-extracted status updates. Messaging automation ships in Phase 5."
    />
  );
}

export function CuraSettingsPage() {
  return (
    <CuraStubPage
      title="Settings"
      description="Clinic profile, staff roles, WhatsApp templates, and notification preferences."
    />
  );
}

export function CuraConsultationNewPage() {
  return (
    <CuraStubPage
      title="Start consultation"
      description="The consultation room (live waveform, transcription feed, structured notes, prescription builder) will be built in Phase 3."
      ctaLabel="Return to dashboard"
      ctaTo={curaPaths().dashboard}
    />
  );
}

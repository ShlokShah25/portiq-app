import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import MeetingCreateForm from '../components/MeetingCreateForm';
import { useTrialExperience } from '../components/TrialExperienceProvider';
import './InterviewMode.css';

export default function InterviewCreatePage() {
  const trial = useTrialExperience();
  const subscriptionGate = trial?.subscriptionGate;

  return (
    <div className="interview-page interview-create-wrap">
      <header className="interview-page__hero">
        <Link to="/interview" className="interview-btn interview-btn--ghost" style={{ marginBottom: 16 }}>
          <ArrowLeft size={16} aria-hidden />
          Back to dashboard
        </Link>
        <p className="interview-page__eyebrow">New session</p>
        <h1 className="interview-page__title">Start interview</h1>
        <p className="interview-page__subtitle">
          Assign the candidate, role, and interviewer. PortIQ will capture the conversation and produce a
          structured hiring evaluation.
        </p>
      </header>
      <MeetingCreateForm
        inline
        active
        interviewSurface
        subscriptionGate={subscriptionGate}
        onMeetingCreated={() => {}}
      />
    </div>
  );
}

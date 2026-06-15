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
      <header className="interview-page__hero interview-page__hero--create">
        <div className="interview-page__nav">
          <Link to="/interview" className="interview-btn interview-btn--ghost">
            <ArrowLeft size={16} aria-hidden />
            Back to interview
          </Link>
        </div>
        <p className="interview-page__eyebrow">New session</p>
        <h1 className="interview-page__title">Start interview</h1>
        <p className="interview-page__subtitle">
          Assign the candidate, role, and interviewer. PortIQ captures the conversation and produces a
          structured hiring evaluation—not meeting minutes.
        </p>
        <p className="interview-page__processing-note" role="note">
          Interviews under 10 minutes use the standard pipeline. Longer recordings use the same safe
          5-minute chunk processing as long meetings, then merge into one hiring report.
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

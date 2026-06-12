import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import MeetingSummary from '../components/MeetingSummary';
import './InterviewMode.css';

export default function InterviewReportPage() {
  const navigate = useNavigate();

  return (
    <div className="interview-report-wrap">
      <header className="interview-report-chrome">
        <button
          type="button"
          className="interview-report-chrome__back"
          onClick={() => navigate('/interview')}
        >
          <ArrowLeft size={16} strokeWidth={1.75} aria-hidden />
          Back to dashboard
        </button>
        <div className="interview-report-chrome__intro">
          <p className="interview-report-chrome__eyebrow">Evaluation report</p>
          <h1 className="interview-report-chrome__title">Candidate assessment</h1>
          <p className="interview-report-chrome__subtitle">
            Review strengths, concerns, evaluation signals, and your hiring recommendation before finalizing.
          </p>
        </div>
      </header>
      <MeetingSummary />
    </div>
  );
}

import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import MeetingSummary from '../components/MeetingSummary';
import './InterviewMode.css';

export default function InterviewReportPage() {
  const navigate = useNavigate();

  return (
    <div className="interview-report-wrap">
      <div className="interview-report-chrome">
        <button
          type="button"
          className="interview-report-chrome__back"
          onClick={() => navigate('/interview')}
        >
          <ArrowLeft size={14} aria-hidden />
          Interview dashboard
        </button>
        <p className="interview-page__eyebrow" style={{ marginBottom: 4 }}>
          Evaluation report
        </p>
        <h1 className="interview-page__title" style={{ fontSize: '1.5rem', marginBottom: 8 }}>
          Candidate assessment
        </h1>
        <p className="interview-page__subtitle" style={{ marginBottom: 16 }}>
          Review strengths, concerns, evaluation signals, and your hiring recommendation before finalizing.
        </p>
      </div>
      <MeetingSummary />
    </div>
  );
}

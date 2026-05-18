import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import axios from 'axios';
import { ArrowLeft, Mic, FileText } from 'lucide-react';
import { interviewPaths } from './useInterviewRoutes';
import {
  interviewCandidateSubtitle,
  interviewStatusLabel,
  interviewerLabel,
  interviewRosterRows,
  interviewContextText,
  hiringVerdictShort,
  hiringVerdictClass,
} from './interviewUtils';
import './InterviewMode.css';

export default function InterviewDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [meeting, setMeeting] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const res = await axios.get(`/meetings/${id}`);
        const m = res.data?.meeting;
        if (!cancelled) {
          if (m?.summaryMode !== 'interview') {
            navigate(`/meetings/${id}`, { replace: true });
            return;
          }
          setMeeting(m);
        }
      } catch (err) {
        if (!cancelled) {
          const d = err.response?.data;
          setError([d?.error, d?.details].filter(Boolean).join(' — ') || 'Could not load interview.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, navigate]);

  const paths = interviewPaths(id);
  const roster = meeting ? interviewRosterRows(meeting) : [];
  const primary = roster[0];
  const status = meeting ? interviewStatusLabel(meeting) : '';
  const verdict = meeting ? hiringVerdictShort(meeting) : '';

  if (loading) {
    return (
      <div className="interview-page">
        <div className="interview-loading">Loading interview…</div>
      </div>
    );
  }

  if (error || !meeting) {
    return (
      <div className="interview-page">
        <p role="alert">{error || 'Interview not found.'}</p>
        <Link to="/interview" className="interview-btn interview-btn--secondary">
          Back to dashboard
        </Link>
      </div>
    );
  }

  const isLive = status === 'Live';
  const canReport =
    status === 'Needs decision' || status === 'Draft ready' || status === 'Finalized' || status === 'Processing';

  return (
    <div className="interview-page">
      <button
        type="button"
        className="interview-btn interview-btn--ghost"
        style={{ marginBottom: 16 }}
        onClick={() => navigate('/interview')}
      >
        <ArrowLeft size={16} aria-hidden />
        Dashboard
      </button>

      <header className="interview-detail-hero">
        <p className="interview-page__eyebrow">Interview session</p>
        <h1 className="interview-page__title">{meeting.title || 'Interview'}</h1>
        <p className="interview-page__subtitle">{interviewCandidateSubtitle(meeting)}</p>
        <span
          className={`interview-status-pill${
            isLive ? ' interview-status-pill--live' : status === 'Needs decision' ? ' interview-status-pill--pending' : ''
          }`}
          style={{ marginTop: 12, display: 'inline-block' }}
        >
          {status}
        </span>
        {verdict ? (
          <span className={`interview-verdict ${hiringVerdictClass(meeting)}`} style={{ marginLeft: 8 }}>
            {verdict}
          </span>
        ) : null}
      </header>

      <div className="interview-detail-meta">
        {primary ? (
          <>
            <div className="interview-detail-meta__chip">
              <strong>Candidate</strong>
              {primary.name}
            </div>
            <div className="interview-detail-meta__chip">
              <strong>Role</strong>
              {primary.role || '—'}
            </div>
          </>
        ) : null}
        {interviewerLabel(meeting) ? (
          <div className="interview-detail-meta__chip">
            <strong>Interviewer</strong>
            {interviewerLabel(meeting)}
          </div>
        ) : null}
      </div>

      {interviewContextText(meeting) ? (
        <section className="interview-card" style={{ marginBottom: 20 }}>
          <h2 className="interview-card__title" style={{ marginBottom: 8 }}>
            Interview context
          </h2>
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55, color: 'var(--interview-text)' }}>
            {interviewContextText(meeting)}
          </p>
        </section>
      ) : null}

      <div className="interview-page__actions">
        {isLive ? (
          <Link to={paths.session} className="interview-btn interview-btn--primary">
            <Mic size={16} aria-hidden />
            Resume live interview
          </Link>
        ) : (
          <Link to={paths.session} className="interview-btn interview-btn--primary">
            <Mic size={16} aria-hidden />
            {status === 'Scheduled' ? 'Start interview' : 'Open session'}
          </Link>
        )}
        {canReport ? (
          <Link to={paths.report} className="interview-btn interview-btn--secondary">
            <FileText size={16} aria-hidden />
            {status === 'Finalized' ? 'Reopen interview report' : 'Review candidate'}
          </Link>
        ) : null}
      </div>
    </div>
  );
}

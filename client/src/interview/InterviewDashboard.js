import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, Briefcase, UserCheck, FileWarning, CheckCircle2 } from 'lucide-react';
import { interviewPaths } from './useInterviewRoutes';
import {
  interviewCandidateSubtitle,
  interviewStatusLabel,
  hiringVerdictShort,
  hiringVerdictClass,
  isInterviewDecisionPending,
  interviewRosterRows,
  meetingIdStr,
  fetchInterviewMeetings,
  sortInterviewsByRecent,
} from './interviewUtils';
import InterviewSessionList from './InterviewSessionList';
import './InterviewMode.css';

function isLiveInterview(m) {
  return (
    m.summaryMode === 'interview' &&
    (m.status === 'In Progress' || m.transcriptionStatus === 'Recording')
  );
}

export default function InterviewDashboard() {
  const [meetings, setMeetings] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const list = await fetchInterviewMeetings();
      if (!cancelled) {
        setMeetings(list);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const live = useMemo(() => meetings.filter(isLiveInterview), [meetings]);
  const pendingDecision = useMemo(
    () => meetings.filter(isInterviewDecisionPending).sort(byRecent),
    [meetings]
  );
  const finalized = useMemo(
    () =>
      meetings
        .filter((m) => m.summaryStatus === 'Sent')
        .sort((a, b) => {
          const ta = new Date(a.interviewDecisionAt || a.updatedAt || 0).getTime();
          const tb = new Date(b.interviewDecisionAt || b.updatedAt || 0).getTime();
          return tb - ta;
        })
        .slice(0, 8),
    [meetings]
  );
  const recent = useMemo(() => meetings.slice(0, 8), [meetings]);
  const recentPreview = recent;
  const candidates = useMemo(() => {
    const map = new Map();
    meetings.forEach((m) => {
      interviewRosterRows(m).forEach((row) => {
        const key = `${row.name}::${row.role}`;
        if (!map.has(key)) {
          map.set(key, { name: row.name, role: row.role, sessions: 0 });
        }
        map.get(key).sessions += 1;
      });
    });
    return Array.from(map.values()).sort((a, b) => b.sessions - a.sessions).slice(0, 8);
  }, [meetings]);

  const draftCount = pendingDecision.length;
  const completedCount = finalized.length;

  if (loading) {
    return (
      <div className="interview-page">
        <div className="interview-loading" role="status">
          Loading interview workspace…
        </div>
      </div>
    );
  }

  return (
    <div className="interview-page">
      <header className="interview-page__hero">
        <p className="interview-page__eyebrow">
          <Briefcase size={14} strokeWidth={1.5} aria-hidden />
          Hiring & evaluation
        </p>
        <h1 className="interview-page__title">Interview dashboard</h1>
        <p className="interview-page__subtitle">
          Run structured interviews, capture live transcripts, and finalize hiring recommendations in one
          dedicated workspace.
        </p>
        <div className="interview-page__actions">
          <Link to="/interview/new" className="interview-btn interview-btn--primary">
            Start interview
          </Link>
          <Link to="/interview/new" className="interview-btn interview-btn--secondary">
            Review candidate
          </Link>
        </div>
      </header>

      <div className="interview-grid interview-grid--2" style={{ marginBottom: 28 }}>
        <div className="interview-card">
          <div className="interview-card__head">
            <h2 className="interview-card__title">Pending decisions</h2>
            <span className="interview-card__count">{draftCount}</span>
          </div>
          <p style={{ fontSize: 13, color: 'var(--interview-text-muted)', margin: 0 }}>
            Draft summaries and AI hiring signals awaiting your review.
          </p>
        </div>
        <div className="interview-card">
          <div className="interview-card__head">
            <h2 className="interview-card__title">Finalized</h2>
            <span className="interview-card__count">{completedCount}</span>
          </div>
          <p style={{ fontSize: 13, color: 'var(--interview-text-muted)', margin: 0 }}>
            Completed interview reports with hiring recommendations on record.
          </p>
        </div>
      </div>

      {live.length > 0 ? (
        <section className="interview-card" style={{ marginBottom: 20 }} aria-labelledby="iv-live">
          <h2 id="iv-live" className="interview-card__title" style={{ marginBottom: 12 }}>
            Live now
          </h2>
          <ul className="interview-list">
            {live.map((m) => {
              const id = meetingIdStr(m);
              const paths = interviewPaths(id);
              return (
                <li key={id}>
                  <Link to={paths.session} className="interview-list__row">
                    <span className="interview-list__row-main">
                      <span className="interview-list__row-title">{m.title || 'Interview'}</span>
                      <span className="interview-list__row-meta">{interviewCandidateSubtitle(m)}</span>
                    </span>
                    <span className="interview-status-pill interview-status-pill--live">Live</span>
                    <span className="interview-list__cta">Resume</span>
                    <ChevronRight size={16} aria-hidden />
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {pendingDecision.length > 0 ? (
        <section className="interview-card" style={{ marginBottom: 20 }} aria-labelledby="iv-pending">
          <h2 id="iv-pending" className="interview-card__title" style={{ marginBottom: 12 }}>
            <FileWarning size={14} style={{ display: 'inline', verticalAlign: -2, marginRight: 6 }} />
            Feedback pending · finalize recommendation
          </h2>
          <ul className="interview-list">
            {pendingDecision.map((m) => {
              const id = meetingIdStr(m);
              const paths = interviewPaths(id);
              const verdict = hiringVerdictShort(m);
              return (
                <li key={id}>
                  <Link to={paths.report} className="interview-list__row">
                    <span className="interview-list__row-main">
                      <span className="interview-list__row-title">{m.title || 'Interview'}</span>
                      <span className="interview-list__row-meta">{interviewCandidateSubtitle(m)}</span>
                    </span>
                    {verdict ? (
                      <span className={`interview-verdict ${hiringVerdictClass(m)}`}>{verdict}</span>
                    ) : (
                      <span className="interview-list__cta">Finalize</span>
                    )}
                    <ChevronRight size={16} aria-hidden />
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <div className="interview-grid interview-grid--2" id="sessions">
        <section className="interview-card" aria-labelledby="iv-recent">
          <h2 id="iv-recent" className="interview-card__title" style={{ marginBottom: 12 }}>
            Recent interviews
          </h2>
          {recentPreview.length === 0 ? (
            <div className="interview-empty">
              <p className="interview-empty__title">No interviews yet</p>
              <p>Start your first structured interview to build candidate evaluations.</p>
              <Link to="/interview/new" className="interview-btn interview-btn--primary">
                Start interview
              </Link>
            </div>
          ) : (
            <>
              <InterviewSessionList meetings={recentPreview} />
              {meetings.length > recentPreview.length ? (
                <p className="interview-sessions-view-all">
                  <Link to="/interview/sessions" className="interview-btn interview-btn--ghost">
                    View all {meetings.length} sessions
                  </Link>
                </p>
              ) : null}
            </>
          )}
        </section>

        <section className="interview-card" aria-labelledby="iv-candidates">
          <h2 id="iv-candidates" className="interview-card__title" style={{ marginBottom: 12 }}>
            <UserCheck size={14} style={{ display: 'inline', verticalAlign: -2, marginRight: 6 }} />
            Candidates
          </h2>
          {candidates.length === 0 ? (
            <p style={{ fontSize: 13, color: 'var(--interview-text-muted)', margin: 0 }}>
              Candidates appear here after you schedule interviews with named applicants.
            </p>
          ) : (
            <ul className="interview-list">
              {candidates.map((c) => (
                <li key={`${c.name}-${c.role}`}>
                  <div className="interview-list__row" style={{ cursor: 'default' }}>
                    <span className="interview-list__row-main">
                      <span className="interview-list__row-title">{c.name}</span>
                      <span className="interview-list__row-meta">
                        {c.role || 'Role not set'} · {c.sessions} session{c.sessions === 1 ? '' : 's'}
                      </span>
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {finalized.length > 0 ? (
        <section className="interview-card" style={{ marginTop: 20 }} aria-labelledby="iv-done">
          <h2 id="iv-done" className="interview-card__title" style={{ marginBottom: 12 }}>
            <CheckCircle2 size={14} style={{ display: 'inline', verticalAlign: -2, marginRight: 6 }} />
            Completed · reopen reports
          </h2>
          <ul className="interview-list">
            {finalized.map((m) => {
              const id = meetingIdStr(m);
              const paths = interviewPaths(id);
              const verdict = hiringVerdictShort(m);
              return (
                <li key={id}>
                  <Link to={paths.report} className="interview-list__row">
                    <span className="interview-list__row-main">
                      <span className="interview-list__row-title">{m.title || 'Interview'}</span>
                      <span className="interview-list__row-meta">{interviewCandidateSubtitle(m)}</span>
                    </span>
                    {verdict ? (
                      <span className={`interview-verdict ${hiringVerdictClass(m)}`}>{verdict}</span>
                    ) : null}
                    <span className="interview-list__cta">Export report</span>
                    <ChevronRight size={16} aria-hidden />
                  </Link>
                </li>
              );
            })}
          </ul>
          {meetings.filter((m) => m.summaryStatus === 'Sent').length > finalized.length ? (
            <p className="interview-sessions-view-all">
              <Link to="/interview/sessions" className="interview-btn interview-btn--ghost">
                View all finalized sessions
              </Link>
            </p>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

function byRecent(a, b) {
  return sortInterviewsByRecent(a, b);
}

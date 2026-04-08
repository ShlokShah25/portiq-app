import React, { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import {
  Calendar,
  AlertTriangle,
  CheckSquare,
  ChevronRight,
  Lightbulb,
  FileText,
  Users,
} from 'lucide-react';
import './Dashboard.css';

function buildRecentTasks(stats) {
  if (!stats) return [];
  const overdue = Array.isArray(stats.taskListOverdue) ? stats.taskListOverdue : [];
  const dueTom = Array.isArray(stats.taskListDueTomorrow) ? stats.taskListDueTomorrow : [];
  const upcoming = Array.isArray(stats.upcomingActions) ? stats.upcomingActions : [];
  const seen = new Set();
  const out = [];
  const add = (r) => {
    if (!r || !r.meetingId) return;
    const k = `${r.meetingId}:${String(r.task || '').slice(0, 80)}:${r.dueDate || ''}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push({
      task: r.task || 'Action item',
      meetingTitle: r.meetingTitle || 'Meeting',
      meetingId: r.meetingId,
      dueDate: r.dueDate,
      status: r.status || 'not_started',
      assignee: r.assignee != null ? String(r.assignee).trim() : '',
    });
  };
  overdue.forEach(add);
  dueTom.forEach(add);
  upcoming.forEach(add);
  return out.slice(0, 7);
}

function formatDue(d) {
  if (!d) return 'No due date';
  const x = new Date(d);
  if (Number.isNaN(x.getTime())) return 'No due date';
  return x.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatStartTime(d) {
  if (!d) return 'Live';
  const x = new Date(d);
  if (Number.isNaN(x.getTime())) return 'Live';
  return x.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function statusLabel(s) {
  if (s === 'done') return 'Done';
  if (s === 'in_progress') return 'In progress';
  return 'Not started';
}

const DASHBOARD_TIPS = [
  'Tip: Add participants from Settings → Workspace or directly while creating a meeting.',
  'Tip: Use optional details to adjust date, time, and location before you start.',
  'Tip: Review action items regularly so nothing slips through.',
  'Tip: Pending summaries need a quick review before they go out.',
  'Tip: Interview meetings leave your decision queue after you approve and send the summary.',
];

function interviewCandidateSubtitle(m) {
  const arr = Array.isArray(m.interviewCandidates) ? m.interviewCandidates : [];
  const named = arr.filter((c) => c && String(c.name || '').trim());
  if (named.length === 0) {
    const leg = String(m.interviewCandidateName || '').trim();
    return leg || 'Interview';
  }
  if (named.length === 1) return named[0].name;
  return `${named.length} candidates`;
}

function hiringVerdictChipClass(m) {
  const h = String(m.hiringRecommendation || '').trim().toLowerCase();
  if (h.includes('strong')) return 'dashboard-interview-verdict--strong';
  if (h.includes('lean')) return 'dashboard-interview-verdict--lean';
  if (h.includes('no hire')) return 'dashboard-interview-verdict--nohire';
  return 'dashboard-interview-verdict--neutral';
}

function hiringVerdictShort(m) {
  const h = String(m.hiringRecommendation || '').trim();
  if (!h) return 'Recorded';
  if (h.includes('Strong')) return 'Strong hire';
  if (h.includes('Lean')) return 'Lean hire';
  if (h.includes('No')) return 'No hire';
  return h;
}

function isInterviewDecisionPending(m) {
  if (m.summaryMode !== 'interview') return false;
  if (m.transcriptionStatus === 'Failed') return false;
  if (m.transcriptionStatus !== 'Completed') return false;
  if (m.summaryStatus === 'Sent') return false;
  const hasSummary = String(m.pendingSummary || m.summary || '').trim().length > 0;
  const hasHiringDraft =
    String(
      m.pendingHiringRecommendation ||
        m.hiringRecommendation ||
        m.pendingHiringRecommendationReason ||
        m.hiringRecommendationReason ||
        ''
    ).trim().length > 0;
  const hasEval =
    (m.pendingEvaluationSignals &&
      typeof m.pendingEvaluationSignals === 'object' &&
      Object.keys(m.pendingEvaluationSignals).length > 0) ||
    (m.evaluationSignals &&
      typeof m.evaluationSignals === 'object' &&
      Object.keys(m.evaluationSignals).length > 0);
  return hasSummary || hasHiringDraft || hasEval;
}

function pickDashboardTipIndex() {
  try {
    const k = 'portiq_dashboard_tip_idx';
    const raw = sessionStorage.getItem(k);
    if (raw != null) {
      const n = parseInt(raw, 10);
      if (!Number.isNaN(n)) return n % DASHBOARD_TIPS.length;
    }
    const idx = Math.floor(Math.random() * DASHBOARD_TIPS.length);
    sessionStorage.setItem(k, String(idx));
    return idx;
  } catch {
    return 0;
  }
}

const Dashboard = () => {
  const [stats, setStats] = useState(null);
  const [meetings, setMeetings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tipIndex, setTipIndex] = useState(() => pickDashboardTipIndex());

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => {
      setTipIndex((i) => (i + 1) % DASHBOARD_TIPS.length);
    }, 6500);
    return () => window.clearInterval(id);
  }, []);

  const fetchData = async () => {
    try {
      const [statsRes, meetingsRes] = await Promise.all([
        axios.get('/admin/stats').catch(() => ({ data: {} })),
        axios.get('/meetings').catch(() => ({ data: { meetings: [] } })),
      ]);
      setStats(statsRes.data || {});
      setMeetings(Array.isArray(meetingsRes.data?.meetings) ? meetingsRes.data.meetings : []);
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };

  const recentTasks = useMemo(() => buildRecentTasks(stats), [stats]);

  const inProgressMeetings = useMemo(() => {
    return meetings
      .filter((m) => {
        const statusOk = m.status === 'In Progress';
        const recordingOk = m.transcriptionStatus === 'Recording';
        return statusOk || recordingOk;
      })
      .slice(0, 3);
  }, [meetings]);

  const pendingSummaryMeetings = useMemo(() => {
    return meetings
      .filter((m) => String(m.pendingSummary || '').trim().length > 0)
      .filter((m) => m.summaryMode !== 'interview')
      .sort((a, b) => {
        const ta = new Date(a.updatedAt || a.endTime || a.startTime || 0).getTime();
        const tb = new Date(b.updatedAt || b.endTime || b.startTime || 0).getTime();
        return tb - ta;
      })
      .slice(0, 6);
  }, [meetings]);

  const interviewQueuePending = useMemo(() => {
    return meetings
      .filter(isInterviewDecisionPending)
      .sort((a, b) => {
        const ta = new Date(a.updatedAt || a.endTime || a.startTime || 0).getTime();
        const tb = new Date(b.updatedAt || b.endTime || b.startTime || 0).getTime();
        return tb - ta;
      })
      .slice(0, 8);
  }, [meetings]);

  const interviewQueueResolved = useMemo(() => {
    return meetings
      .filter((m) => m.summaryMode === 'interview' && m.summaryStatus === 'Sent')
      .sort((a, b) => {
        const ta = new Date(a.interviewDecisionAt || a.updatedAt || 0).getTime();
        const tb = new Date(b.interviewDecisionAt || b.updatedAt || 0).getTime();
        return tb - ta;
      })
      .slice(0, 6);
  }, [meetings]);

  if (loading) {
    return (
      <div className="dashboard-screen">
        <div className="dashboard-wrapper">
          <div className="dashboard-content">
            <div className="dashboard-loading" role="status">
              <p className="dashboard-thinking">
                Loading dashboard
                <span className="dashboard-thinking-dots" aria-hidden>
                  <span className="dashboard-thinking-dot" />
                  <span className="dashboard-thinking-dot" />
                  <span className="dashboard-thinking-dot" />
                </span>
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const nDueTom = stats?.tasksDueTomorrow ?? 0;
  const nOverdue = stats?.overdueTasks ?? 0;
  const nMeetWeek = stats?.meetingsThisWeek ?? 0;

  return (
    <div className="dashboard-screen">
      <div className="dashboard-wrapper">
        <div className="dashboard-content">
          <header
            className="dashboard-hero-minimal ux-dashboard-stagger"
            style={{ animationDelay: '0ms' }}
            aria-label="Dashboard overview"
          >
            <h1 className="dashboard-title">Dashboard</h1>
            <p className="dashboard-subtitle">
              Run meetings. Capture outcomes. Stay aligned.
            </p>
          </header>

          <div
            className="dashboard-start-meeting dashboard-start-meeting--minimal ux-dashboard-stagger"
            style={{ animationDelay: '45ms' }}
            id="dashboard-meetings"
          >
            <h2 className="dashboard-start-meeting__title">Start a meeting</h2>
            <div className="dashboard-start-meeting__actions">
              <Link
                to="/meetings"
                state={{ openStartModal: true }}
                className="dashboard-btn-primary dashboard-btn-primary--hero dashboard-btn-micro"
              >
                New Meeting
              </Link>
              <Link
                to="/meetings"
                state={{ showAllMeetings: true }}
                className="dashboard-btn-secondary dashboard-btn-micro"
              >
                View Meetings
              </Link>
            </div>
          </div>

          <div className="dashboard-tip-strip" role="status" aria-live="polite">
            <Lightbulb className="dashboard-tip-strip__ic" strokeWidth={1.5} aria-hidden />
            <span key={tipIndex} className="dashboard-tip-strip__text ux-dashboard-tip-fade">
              {DASHBOARD_TIPS[tipIndex]}
            </span>
          </div>

          {pendingSummaryMeetings.length > 0 ? (
            <section
              className="dashboard-pending-summaries ux-dashboard-stagger"
              style={{ animationDelay: '80ms' }}
              aria-labelledby="dash-pending-summaries"
            >
              <div className="dashboard-pending-summaries__head">
                <div className="dashboard-pending-summaries__title-row">
                  <span className="dashboard-pending-summaries__icon" aria-hidden>
                    <FileText className="dashboard-stat-chip__lucide" strokeWidth={1.5} />
                  </span>
                  <div>
                    <h2 id="dash-pending-summaries" className="dashboard-pending-summaries__title">
                      Pending summaries
                    </h2>
                    <p className="dashboard-pending-summaries__sub">
                      Review and approve before they go to participants.
                    </p>
                  </div>
                </div>
                <Link to="/meetings" state={{ showAllMeetings: true }} className="dashboard-section__link">
                  Meetings
                </Link>
              </div>
              <ul className="dashboard-pending-summaries__list">
                {pendingSummaryMeetings.map((m) => {
                  const id = m._id != null ? String(m._id) : '';
                  return (
                    <li key={id}>
                      <Link to={`/meetings/${id}/summary`} className="dashboard-pending-summaries__row">
                        <span className="dashboard-pending-summaries__meeting-title">
                          {m.title || 'Untitled meeting'}
                        </span>
                        <span className="dashboard-pending-summaries__cta">Review</span>
                        <ChevronRight className="dashboard-pending-summaries__chev" strokeWidth={2} aria-hidden />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}

          {interviewQueuePending.length > 0 || interviewQueueResolved.length > 0 ? (
            <section
              className="dashboard-interview-pipeline ux-dashboard-stagger"
              style={{ animationDelay: '95ms' }}
              aria-labelledby="dash-interview-pipeline"
            >
              <div className="dashboard-interview-pipeline__head">
                <span className="dashboard-interview-pipeline__icon" aria-hidden>
                  <Users className="dashboard-stat-chip__lucide" strokeWidth={1.5} />
                </span>
                <div className="dashboard-interview-pipeline__head-copy">
                  <h2 id="dash-interview-pipeline" className="dashboard-interview-pipeline__title">
                    Interview pipeline
                  </h2>
                  <p className="dashboard-interview-pipeline__sub">
                    Approve your hiring recommendation and send the summary — interviews drop off this list once
                    they&apos;re sent. Recent decisions stay below for a quick audit trail.
                  </p>
                </div>
                <Link to="/meetings" state={{ showAllMeetings: true }} className="dashboard-section__link">
                  Meetings
                </Link>
              </div>

              {interviewQueuePending.length > 0 ? (
                <div className="dashboard-interview-pipeline__block">
                  <h3 className="dashboard-interview-pipeline__block-title">Needs your decision</h3>
                  <ul className="dashboard-interview-pipeline__list">
                    {interviewQueuePending.map((m) => {
                      const id = m._id != null ? String(m._id) : '';
                      const draft = String(
                        m.pendingHiringRecommendation || m.hiringRecommendation || ''
                      ).trim();
                      return (
                        <li key={id}>
                          <Link
                            to={`/meetings/${id}/summary`}
                            className="dashboard-interview-pipeline__row dashboard-interview-pipeline__row--pending"
                          >
                            <span className="dashboard-interview-pipeline__row-main">
                              <span className="dashboard-interview-pipeline__meeting-title">
                                {m.title || 'Interview'}
                              </span>
                              <span className="dashboard-interview-pipeline__meta">
                                {interviewCandidateSubtitle(m)}
                              </span>
                            </span>
                            {draft ? (
                              <span
                                className={`dashboard-interview-verdict dashboard-interview-verdict--draft ${hiringVerdictChipClass(
                                  { hiringRecommendation: draft }
                                )}`}
                              >
                                AI: {hiringVerdictShort({ hiringRecommendation: draft })}
                              </span>
                            ) : (
                              <span className="dashboard-interview-pipeline__cta">Review</span>
                            )}
                            <ChevronRight
                              className="dashboard-interview-pipeline__chev"
                              strokeWidth={2}
                              aria-hidden
                            />
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ) : (
                <p className="dashboard-interview-pipeline__caught-up">
                  You&apos;re all caught up — nothing waiting on a hiring decision.
                </p>
              )}

              {interviewQueueResolved.length > 0 ? (
                <div className="dashboard-interview-pipeline__block dashboard-interview-pipeline__block--resolved">
                  <h3 className="dashboard-interview-pipeline__block-title">Recent decisions</h3>
                  <ul className="dashboard-interview-pipeline__list dashboard-interview-pipeline__list--resolved">
                    {interviewQueueResolved.map((m) => {
                      const id = m._id != null ? String(m._id) : '';
                      return (
                        <li key={id}>
                          <Link
                            to={`/meetings/${id}/summary`}
                            className="dashboard-interview-pipeline__row dashboard-interview-pipeline__row--resolved"
                          >
                            <span className="dashboard-interview-pipeline__row-main">
                              <span className="dashboard-interview-pipeline__meeting-title">
                                {m.title || 'Interview'}
                              </span>
                              <span className="dashboard-interview-pipeline__meta">
                                {interviewCandidateSubtitle(m)}
                              </span>
                            </span>
                            <span
                              className={`dashboard-interview-verdict ${hiringVerdictChipClass(m)}`}
                            >
                              {hiringVerdictShort(m)}
                            </span>
                            <ChevronRight
                              className="dashboard-interview-pipeline__chev"
                              strokeWidth={2}
                              aria-hidden
                            />
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ) : null}
            </section>
          ) : null}

          <section
            className="dashboard-section dashboard-section--minimal ux-dashboard-stagger dashboard-section--reveal"
            style={{ animationDelay: '115ms' }}
            aria-labelledby="dash-in-progress"
          >
            <div className="dashboard-section__head">
              <h2 id="dash-in-progress" className="dashboard-section__title">
                In progress
              </h2>
              <Link to="/meetings" state={{ showAllMeetings: true }} className="dashboard-section__link">
                View all
              </Link>
            </div>
            {inProgressMeetings.length === 0 ? (
              <p className="dashboard-section__empty">No live sessions right now.</p>
            ) : (
              <ul className="dashboard-task-list">
                {inProgressMeetings.map((m, idx) => {
                  const id = m._id != null ? String(m._id) : '';
                  return (
                    <li
                      key={id || idx}
                      className="dashboard-task-row ux-dashboard-list-item"
                      style={{ animationDelay: `${Math.min(idx, 2) * 45}ms` }}
                    >
                      <Link to={`/meetings/${id}/room`} className="dashboard-task-row__link">
                        <span className="dashboard-task-row__task">{m.title || 'Untitled meeting'}</span>
                        <span className="dashboard-task-row__meta">
                          <span className="dashboard-task-row__pill dashboard-task-row__pill--live">
                            <span className="dashboard-live-dot" aria-hidden />
                            Live
                          </span>
                          <span className="dashboard-task-row__due">
                            {m.transcriptionStatus === 'Recording' ? 'Recording' : 'In progress'}
                          </span>
                        </span>
                        <span className="dashboard-task-row__meeting">{formatStartTime(m.startTime)}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <div
            className="dashboard-compact-stats ux-dashboard-stagger"
            style={{ animationDelay: '90ms' }}
            aria-label="Meeting and task summary"
          >
            <Link
              to="/dashboard/tasks/meetings-week"
              className="dashboard-stat-chip dashboard-stat-chip--tile"
            >
              <div className="dashboard-stat-chip__icon" aria-hidden>
                <Calendar className="dashboard-stat-chip__lucide" strokeWidth={1.5} />
              </div>
              <div className="dashboard-stat-chip__body">
                <span className="dashboard-stat-chip__label">Meetings this week</span>
                <span className="dashboard-stat-chip__value">{nMeetWeek}</span>
              </div>
              <ChevronRight className="dashboard-stat-chip__chev" strokeWidth={2} aria-hidden />
            </Link>

            <Link
              to="/dashboard/tasks/due-tomorrow"
              className="dashboard-stat-chip dashboard-stat-chip--tile"
            >
              <div className="dashboard-stat-chip__icon" aria-hidden>
                <CheckSquare className="dashboard-stat-chip__lucide" strokeWidth={1.5} />
              </div>
              <div className="dashboard-stat-chip__body">
                <span className="dashboard-stat-chip__label">Tasks due</span>
                <span className="dashboard-stat-chip__value">{nDueTom}</span>
              </div>
              <ChevronRight className="dashboard-stat-chip__chev" strokeWidth={2} aria-hidden />
            </Link>

            <Link
              to="/dashboard/tasks/overdue"
              className="dashboard-stat-chip dashboard-stat-chip--tile dashboard-stat-chip--warn"
            >
              <div className="dashboard-stat-chip__icon dashboard-stat-chip__icon--warn" aria-hidden>
                <AlertTriangle className="dashboard-stat-chip__lucide" strokeWidth={1.5} />
              </div>
              <div className="dashboard-stat-chip__body">
                <span className="dashboard-stat-chip__label">Overdue tasks</span>
                <span className="dashboard-stat-chip__value">{nOverdue}</span>
              </div>
              <ChevronRight className="dashboard-stat-chip__chev" strokeWidth={2} aria-hidden />
            </Link>
          </div>

          <section
            className="dashboard-section dashboard-section--minimal ux-dashboard-stagger dashboard-section--reveal"
            style={{ animationDelay: '130ms' }}
            aria-labelledby="dash-recent-tasks"
          >
            <div className="dashboard-section__head">
              <h2 id="dash-recent-tasks" className="dashboard-section__title">
                Recent action items
              </h2>
              <Link to="/insights" className="dashboard-section__link">
                View all
              </Link>
            </div>
            {recentTasks.length === 0 ? (
              <p className="dashboard-section__empty">
                Action items will appear here after meetings
              </p>
            ) : (
              <ul className="dashboard-task-list">
                {recentTasks.map((row, idx) => (
                  <li
                    key={`${row.meetingId}-${idx}`}
                    className="dashboard-task-row ux-dashboard-list-item"
                    style={{ animationDelay: `${Math.min(idx, 6) * 35}ms` }}
                  >
                    <Link to={`/meetings/${row.meetingId}/summary`} className="dashboard-task-row__link">
                      <span className="dashboard-task-row__task">{row.task}</span>
                      <span className="dashboard-task-row__meta">
                        <span className="dashboard-task-row__pill">{statusLabel(row.status)}</span>
                        <span className="dashboard-task-row__due">{formatDue(row.dueDate)}</span>
                        {row.assignee ? (
                          <span className="dashboard-task-row__assignee">{row.assignee}</span>
                        ) : null}
                      </span>
                      <span className="dashboard-task-row__meeting">{row.meetingTitle}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;

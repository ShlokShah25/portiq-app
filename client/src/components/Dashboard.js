import React, { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import {
  Calendar,
  AlertTriangle,
  CheckSquare,
  FileText,
  ChevronRight,
  Lightbulb,
} from 'lucide-react';
import TopNav from './TopNav';
import { T } from '../config/terminology';
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
  'Tip: Add participants directly while creating a meeting.',
  'Tip: Use optional details to adjust date, time, and location before you start.',
  'Tip: Approve pending summaries so participants receive recaps on time.',
  'Tip: Action items from meetings surface here — check due dates regularly.',
];

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
  const [tipIndex] = useState(() => pickDashboardTipIndex());

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
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

  const pendingSummaries = useMemo(() => {
    return meetings
      .filter(
        (m) =>
          m.summaryStatus === 'Pending Approval' &&
          m.transcriptionStatus === 'Completed'
      )
      .slice(0, 7);
  }, [meetings]);

  const inProgressMeetings = useMemo(() => {
    return meetings
      .filter((m) => {
        const statusOk = m.status === 'In Progress';
        const recordingOk = m.transcriptionStatus === 'Recording';
        return statusOk || recordingOk;
      })
      .slice(0, 3);
  }, [meetings]);

  if (loading) {
    return (
      <div className="dashboard-screen">
        <TopNav />
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
      <TopNav />
      <div className="dashboard-wrapper">
        <div className="dashboard-content">
          <div className="dashboard-header ux-dashboard-stagger" style={{ animationDelay: '0ms' }}>
            <h1 className="dashboard-title">Dashboard</h1>
            <p className="dashboard-subtitle">
              Meeting execution and task intelligence across your workspace
            </p>
          </div>

          <div
            className="dashboard-start-meeting card ux-dashboard-stagger"
            style={{ animationDelay: '45ms' }}
            id="dashboard-meetings"
          >
            <h2 className="dashboard-start-meeting__title">Start a meeting</h2>
            <div className="dashboard-start-meeting__actions">
              <Link
                to="/meetings"
                state={{ openStartModal: true }}
                className="dashboard-btn-primary dashboard-btn-micro"
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

          <div
            className="dashboard-tip-strip ux-dashboard-tip-fade"
            role="status"
            aria-live="polite"
          >
            <Lightbulb className="dashboard-tip-strip__ic" strokeWidth={1.5} aria-hidden />
            <span>{DASHBOARD_TIPS[tipIndex]}</span>
          </div>

          <section
            className="dashboard-section card ux-dashboard-stagger dashboard-section--reveal"
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
                          <span className="dashboard-task-row__pill">Live</span>
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
                <span className="dashboard-stat-chip__label">Tasks due tomorrow</span>
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
            className="dashboard-section card ux-dashboard-stagger dashboard-section--reveal"
            style={{ animationDelay: '130ms' }}
            aria-labelledby="dash-recent-tasks"
          >
            <div className="dashboard-section__head">
              <h2 id="dash-recent-tasks" className="dashboard-section__title">
                Recent action items
              </h2>
              <Link to="/dashboard/tasks/due-tomorrow" className="dashboard-section__link">
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

          <section
            className="dashboard-section card ux-dashboard-stagger dashboard-section--reveal"
            style={{ animationDelay: '165ms' }}
            aria-labelledby="dash-pending-summaries"
          >
            <div className="dashboard-section__head">
              <h2 id="dash-pending-summaries" className="dashboard-section__title">
                Pending summaries
              </h2>
              <Link to="/meetings" state={{ showAllMeetings: true }} className="dashboard-section__link">
                {T.meetings()}
              </Link>
            </div>
            {pendingSummaries.length === 0 ? (
              <p className="dashboard-section__empty">No summaries waiting for review.</p>
            ) : (
              <ul className="dashboard-pending-list">
                {pendingSummaries.map((m, idx) => {
                  const id = m._id != null ? String(m._id) : '';
                  return (
                    <li
                      key={id || idx}
                      className="dashboard-pending-row dashboard-pending-row--card ux-dashboard-list-item"
                      style={{ animationDelay: `${Math.min(idx, 6) * 35}ms` }}
                    >
                      <Link to={`/meetings/${id}/summary`} className="dashboard-pending-row__link">
                        <FileText className="dashboard-pending-row__ic" strokeWidth={1.5} aria-hidden />
                        <span className="dashboard-pending-row__title">{m.title || 'Untitled meeting'}</span>
                        <span className="dashboard-pending-row__hint">Review &amp; send</span>
                        <ChevronRight className="dashboard-pending-row__chev" strokeWidth={2} aria-hidden />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;

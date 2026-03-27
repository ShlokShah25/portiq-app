import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import axios from 'axios';
import {
  Calendar,
  AlertTriangle,
  CheckCircle2,
  BarChart3,
  CheckSquare,
  Mic,
  Upload,
} from 'lucide-react';
import TopNav from './TopNav';
import './Dashboard.css';

const Dashboard = ({ config }) => {
  const navigate = useNavigate();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, []);

  const fetchData = async () => {
    try {
      const statsRes = await axios.get('/admin/stats').catch(() => ({ data: {} }));
      setStats(statsRes.data || {});
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };

  const upcoming = Array.isArray(stats?.upcomingActions) ? stats.upcomingActions : [];

  const statusClass = (row) => {
    const st = row.status || 'not_started';
    if (st === 'done') return 'dashboard-action-status dashboard-action-status--done';
    if (st === 'in_progress') return 'dashboard-action-status dashboard-action-status--progress';
    return 'dashboard-action-status dashboard-action-status--pending';
  };

  const statusLabel = (row) => {
    const st = row.status || 'not_started';
    if (st === 'done') return 'Done';
    if (st === 'in_progress') return 'In progress';
    return 'Pending';
  };

  const rowAccent = (row) => {
    if (!row.dueDate) return '';
    const due = new Date(row.dueDate);
    if (Number.isNaN(due.getTime())) return '';
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    if (due < start) return 'dashboard-action-row dashboard-action-row--overdue';
    const tmr = new Date(start);
    tmr.setDate(tmr.getDate() + 1);
    const dayAfter = new Date(tmr);
    dayAfter.setDate(dayAfter.getDate() + 1);
    if (due >= tmr && due < dayAfter) return 'dashboard-action-row dashboard-action-row--due-soon';
    return 'dashboard-action-row';
  };

  if (loading) {
    return (
      <div className="dashboard-screen">
        <TopNav />
        <div className="dashboard-wrapper">
          <div className="dashboard-content">
            <div className="dashboard-loading">Loading...</div>
          </div>
        </div>
      </div>
    );
  }

  const nDueTom = stats?.tasksDueTomorrow ?? 0;
  const nOverdue = stats?.overdueTasks ?? 0;
  const nDoneWeek = stats?.completedThisWeek ?? 0;
  const nMeetWeek = stats?.meetingsThisWeek ?? 0;

  return (
    <div className="dashboard-screen">
      <TopNav />
      <div className="dashboard-wrapper">
        <div className="dashboard-content">
          <div className="dashboard-header">
            <h1 className="dashboard-title">Dashboard</h1>
            <p className="dashboard-subtitle">
              Meeting execution and task intelligence across your workspace
            </p>
          </div>

          <div className="dashboard-actions">
            <div className="dashboard-actions-row">
              <Link
                to="/meetings"
                className="dashboard-btn-primary"
                style={{ textDecoration: 'none' }}
              >
                <Mic className="dashboard-lucide" strokeWidth={1.5} aria-hidden />
                Start Meeting
              </Link>
              <button
                type="button"
                className="dashboard-btn-secondary"
                onClick={() =>
                  navigate('/meetings', { state: { focusRecordingUpload: true } })
                }
              >
                <Upload className="dashboard-lucide" strokeWidth={1.5} aria-hidden />
                Upload Recording
              </button>
            </div>
          </div>

          <div className="dashboard-metrics">
            <div className="metric-card">
              <div className="metric-header">
                <div className="metric-icon">
                  <CheckSquare className="metric-lucide" strokeWidth={1.5} aria-hidden />
                </div>
                <span className="metric-label">Tasks Due Tomorrow</span>
              </div>
              <div className="metric-value">{nDueTom}</div>
              <p className="metric-desc">
                {nDueTom === 1 ? '1 task needs attention' : `${nDueTom} tasks need attention`}
              </p>
            </div>

            <div className="metric-card">
              <div className="metric-header">
                <div className="metric-icon metric-icon--warn">
                  <AlertTriangle className="metric-lucide" strokeWidth={1.5} aria-hidden />
                </div>
                <span className="metric-label">Overdue Tasks</span>
              </div>
              <div className="metric-value">{nOverdue}</div>
              <p className="metric-desc">Requires follow-up</p>
            </div>

            <div className="metric-card">
              <div className="metric-header">
                <div className="metric-icon metric-icon--ok">
                  <CheckCircle2 className="metric-lucide" strokeWidth={1.5} aria-hidden />
                </div>
                <span className="metric-label">Completed This Week</span>
              </div>
              <div className="metric-value">{nDoneWeek}</div>
              <p className="metric-desc">Tasks marked done this week</p>
            </div>

            <div className="metric-card">
              <div className="metric-header">
                <div className="metric-icon">
                  <Calendar className="metric-lucide" strokeWidth={1.5} aria-hidden />
                </div>
                <span className="metric-label">Meetings This Week</span>
              </div>
              <div className="metric-value">{nMeetWeek}</div>
              <p className="metric-desc">Scheduled or held sessions</p>
            </div>
          </div>

          <section className="dashboard-upcoming" aria-labelledby="dashboard-upcoming-heading">
            <div className="dashboard-upcoming-head">
              <BarChart3 className="dashboard-section-icon" strokeWidth={1.5} aria-hidden />
              <h2 id="dashboard-upcoming-heading" className="dashboard-section-title">
                Upcoming Actions
              </h2>
            </div>
            {upcoming.length === 0 ? (
              <div className="dashboard-upcoming-empty">
                <p>No open tasks with upcoming deadlines.</p>
                <p className="dashboard-upcoming-empty-sub">
                  Start a meeting to begin tracking insights.
                </p>
              </div>
            ) : (
              <ul className="dashboard-action-list">
                {upcoming.map((row, idx) => (
                  <li key={`${row.meetingId}-${idx}`}>
                    <button
                      type="button"
                      className={rowAccent(row)}
                      onClick={() => navigate(`/meetings/${row.meetingId}`)}
                    >
                      <div className="dashboard-action-main">
                        <span className="dashboard-action-task">{row.task}</span>
                        <span className="dashboard-action-meeting">{row.meetingTitle}</span>
                      </div>
                      <div className="dashboard-action-meta">
                        <span className="dashboard-action-due">
                          {row.dueDate
                            ? new Date(row.dueDate).toLocaleDateString(undefined, {
                                month: 'short',
                                day: 'numeric',
                                year: 'numeric',
                              })
                            : 'No due date'}
                        </span>
                        <span className={statusClass(row)}>{statusLabel(row)}</span>
                      </div>
                    </button>
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

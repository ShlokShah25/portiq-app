import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import axios from 'axios';
import {
  Calendar,
  CheckSquare,
  Square,
  ArrowLeft,
} from 'lucide-react';
import TopNav from './TopNav';
import './Dashboard.css';

const BUCKET_MAP = {
  'due-tomorrow': 'due_tomorrow',
  overdue: 'overdue',
  'completed-week': 'completed_week',
  'meetings-week': 'meetings_week',
};

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function fallbackTaskLists(stats) {
  const upcoming = Array.isArray(stats?.upcomingActions) ? stats.upcomingActions : [];
  const today = startOfDay(new Date());
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const dayAfter = new Date(tomorrow);
  dayAfter.setDate(dayAfter.getDate() + 1);

  const open = upcoming.filter((r) => (r.status || 'not_started') !== 'done');
  const dueTomorrow = open.filter((r) => {
    if (!r.dueDate) return false;
    const due = new Date(r.dueDate);
    return !Number.isNaN(due.getTime()) && due >= tomorrow && due < dayAfter;
  });
  const overdue = open.filter((r) => {
    if (!r.dueDate) return false;
    const due = new Date(r.dueDate);
    return !Number.isNaN(due.getTime()) && due < today;
  });
  return { dueTomorrow, overdue, completed: [], meetings: [] };
}

export default function DashboardTasksPage() {
  const { bucket: bucketParam } = useParams();
  const navigate = useNavigate();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  const internalBucket = BUCKET_MAP[bucketParam];

  useEffect(() => {
    if (!internalBucket) {
      navigate('/dashboard', { replace: true });
    }
  }, [internalBucket, navigate]);

  useEffect(() => {
    const run = async () => {
      try {
        const statsRes = await axios.get('/admin/stats').catch(() => ({ data: {} }));
        setStats(statsRes.data || {});
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    };
    run();
  }, []);

  const lists = useMemo(() => {
    if (!stats) {
      return { dueTomorrow: [], overdue: [], completed: [], meetings: [] };
    }
    const fb = fallbackTaskLists(stats);
    return {
      dueTomorrow: Array.isArray(stats.taskListDueTomorrow)
        ? stats.taskListDueTomorrow
        : fb.dueTomorrow,
      overdue: Array.isArray(stats.taskListOverdue) ? stats.taskListOverdue : fb.overdue,
      completed: Array.isArray(stats.taskListCompletedThisWeek)
        ? stats.taskListCompletedThisWeek
        : fb.completed,
      meetings: Array.isArray(stats.meetingsWeekList) ? stats.meetingsWeekList : fb.meetings,
    };
  }, [stats]);

  const sectionCopy = useMemo(() => {
    switch (internalBucket) {
      case 'overdue':
        return {
          title: 'Overdue tasks',
          empty: 'No overdue tasks.',
          sub: 'Tasks past their due date appear here.',
        };
      case 'completed_week':
        return {
          title: 'Completed this week',
          empty: 'No tasks completed this week.',
          sub: 'Tasks marked done from meetings that ended or were updated this week.',
        };
      case 'meetings_week':
        return {
          title: 'Meetings this week',
          empty: 'No meetings this week.',
          sub: 'Meetings scheduled or started during the current week (Mon–Sun).',
        };
      default:
        return {
          title: 'Tasks due tomorrow',
          empty: 'No tasks due tomorrow.',
          sub: 'Open tasks with a due date of tomorrow.',
        };
    }
  }, [internalBucket]);

  const currentRows = useMemo(() => {
    switch (internalBucket) {
      case 'overdue':
        return lists.overdue;
      case 'completed_week':
        return lists.completed;
      case 'meetings_week':
        return lists.meetings;
      default:
        return lists.dueTomorrow;
    }
  }, [internalBucket, lists]);

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

  const rowAccentClass = (row) => {
    if (internalBucket === 'meetings_week') return 'dashboard-task-row';
    if (internalBucket === 'completed_week') return 'dashboard-task-row';
    const st = row.status || 'not_started';
    if (st === 'done') return 'dashboard-task-row';
    if (!row.dueDate) return 'dashboard-task-row';
    const due = new Date(row.dueDate);
    if (Number.isNaN(due.getTime())) return 'dashboard-task-row';
    const start = startOfDay(new Date());
    const dueDay = startOfDay(due);
    if (dueDay.getTime() < start.getTime()) return 'dashboard-task-row dashboard-task-row--overdue';
    const tmr = new Date(start);
    tmr.setDate(tmr.getDate() + 1);
    const dayAfter = new Date(tmr);
    dayAfter.setDate(dayAfter.getDate() + 1);
    if (due >= tmr && due < dayAfter) return 'dashboard-task-row dashboard-task-row--due-soon';
    return 'dashboard-task-row';
  };

  if (!internalBucket) return null;

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

  const isMeetings = internalBucket === 'meetings_week';

  return (
    <div className="dashboard-screen">
      <TopNav />
      <div className="dashboard-wrapper">
        <div className="dashboard-content">
          <div className="dashboard-tasks-back">
            <Link to="/dashboard" className="dashboard-tasks-back-link">
              <ArrowLeft className="dashboard-tasks-back-icon" strokeWidth={1.75} aria-hidden />
              Back to dashboard
            </Link>
          </div>
          <div className="dashboard-header">
            <h1 className="dashboard-title">{sectionCopy.title}</h1>
            <p className="dashboard-subtitle">{sectionCopy.sub}</p>
          </div>

          {currentRows.length === 0 ? (
            <div className="dashboard-upcoming-empty dashboard-upcoming-empty--page">
              <p>{sectionCopy.empty}</p>
            </div>
          ) : isMeetings ? (
            <ul className="dashboard-action-list">
              {currentRows.map((row) => (
                <li key={row.meetingId}>
                  <button
                    type="button"
                    className="dashboard-task-row"
                    onClick={() => navigate(`/meetings/${row.meetingId}`)}
                  >
                    <div className="dashboard-task-row__icon" aria-hidden>
                      <Calendar className="dashboard-task-row__lucide" strokeWidth={1.5} />
                    </div>
                    <div className="dashboard-task-main">
                      <span className="dashboard-action-task">{row.title}</span>
                      <span className="dashboard-action-meeting">
                        {row.status}
                        {row.at
                          ? ` · ${new Date(row.at).toLocaleString(undefined, {
                              month: 'short',
                              day: 'numeric',
                              hour: 'numeric',
                              minute: '2-digit',
                            })}`
                          : ''}
                      </span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <ul className="dashboard-action-list">
              {currentRows.map((row, idx) => (
                <li key={`${row.meetingId}-${idx}-${row.task?.slice(0, 20)}`}>
                  <button
                    type="button"
                    className={rowAccentClass(row)}
                    onClick={() => navigate(`/meetings/${row.meetingId}`)}
                  >
                    <div className="dashboard-task-row__icon" aria-hidden>
                      {(row.status || 'not_started') === 'done' ? (
                        <CheckSquare
                          className="dashboard-task-row__lucide dashboard-task-row__lucide--done"
                          strokeWidth={1.75}
                        />
                      ) : (
                        <Square className="dashboard-task-row__lucide" strokeWidth={1.75} />
                      )}
                    </div>
                    <div className="dashboard-task-main">
                      <span className="dashboard-action-task">{row.task}</span>
                      <span className="dashboard-action-meeting">{row.meetingTitle}</span>
                      {row.assignee ? (
                        <span className="dashboard-task-assignee">{row.assignee}</span>
                      ) : null}
                    </div>
                    <div className="dashboard-action-meta">
                      <span className="dashboard-action-due">
                        {row.dueDate
                          ? `Due ${new Date(row.dueDate).toLocaleDateString(undefined, {
                              month: 'short',
                              day: 'numeric',
                              year: 'numeric',
                            })}`
                          : 'No due date'}
                      </span>
                      <span className={statusClass(row)}>{statusLabel(row)}</span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

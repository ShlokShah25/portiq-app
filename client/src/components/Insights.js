import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { Calendar, CheckSquare, AlertTriangle, ListTodo, FolderX } from 'lucide-react';
import { isEducation } from '../config/product';
import './Insights.css';

function itemsFromMeeting(meeting) {
  let actionItems = Array.isArray(meeting?.actionItems) ? meeting.actionItems : [];
  if (
    (!actionItems || actionItems.length === 0) &&
    Array.isArray(meeting?.summary?.actionItems)
  ) {
    actionItems = meeting.summary.actionItems;
  }
  if (
    (!actionItems || actionItems.length === 0) &&
    Array.isArray(meeting?.pendingActionItems)
  ) {
    actionItems = meeting.pendingActionItems;
  }
  return actionItems;
}

function meetingHasActionItems(meeting) {
  const raw = itemsFromMeeting(meeting);
  if (!raw.length) return false;
  return raw.some((item) => {
    if (typeof item === 'string') return item.trim().length > 0;
    const t = item?.task || item?.title;
    return t && String(t).trim().length > 0;
  });
}

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

const Insights = () => {
  const navigate = useNavigate();
  const [stats, setStats] = useState(null);
  const [allMeetings, setAllMeetings] = useState([]);
  const [allActionItems, setAllActionItems] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [statsRes, meetingsRes] = await Promise.all([
        axios.get('/admin/stats').catch(() => ({ data: {} })),
        axios.get('/meetings').catch(() => ({ data: { meetings: [] } }) ),
      ]);

      setStats(statsRes.data || {});
      const meetings = meetingsRes.data.meetings || [];
      setAllMeetings(meetings);

      const extracted = [];
      meetings.forEach((meeting) => {
        const actionItems = itemsFromMeeting(meeting);

        actionItems.forEach((item) => {
          let normalized = item;
          if (typeof item === 'string') {
            normalized = { task: item };
          }
          extracted.push({
            ...normalized,
            meetingTitle: meeting.title,
            meetingId: meeting._id,
            date: meeting.createdAt || meeting.startTime || meeting.endTime || null,
          });
        });
      });

      setAllActionItems(extracted);
    } catch (error) {
      console.error('Error fetching insights:', error);
    } finally {
      setLoading(false);
    }
  };

  const today = useMemo(() => startOfDay(new Date()), []);
  const weekAhead = useMemo(() => {
    const x = new Date(today);
    x.setDate(x.getDate() + 7);
    return x;
  }, [today]);

  const actionOverview = useMemo(() => {
    const openItems = allActionItems.filter((i) => (i.status || 'not_started') !== 'done');

    const isOverdue = (item) => {
      if (!item.dueDate) return false;
      const d = new Date(item.dueDate);
      return !Number.isNaN(d.getTime()) && d < today;
    };

    const topPending = [...openItems]
      .sort((a, b) => {
        const ao = isOverdue(a) ? 0 : 1;
        const bo = isOverdue(b) ? 0 : 1;
        if (ao !== bo) return ao - bo;
        const ad = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
        const bd = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
        return ad - bd;
      })
      .slice(0, 5);

    const dueSoon = openItems
      .filter((i) => {
        if (!i.dueDate) return false;
        const d = new Date(i.dueDate);
        if (Number.isNaN(d.getTime()) || d < today) return false;
        return d <= weekAhead;
      })
      .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate))
      .slice(0, 5);

    const without = allMeetings.filter((m) => !meetingHasActionItems(m));

    return { topPending, dueSoon, meetingsWithoutActions: without };
  }, [allActionItems, allMeetings, today, weekAhead]);

  if (loading) {
    return (
      <div className="insights-screen">
        <div className="insights-wrapper">
          <div className="insights-content">
            <div className="loading">Loading...</div>
          </div>
        </div>
      </div>
    );
  }

  const meetingsNoActionCount =
    stats?.meetingsWithoutActionItems != null
      ? stats.meetingsWithoutActionItems
      : actionOverview.meetingsWithoutActions.length;
  const topTitle = isEducation ? 'Lecture Insights' : 'Insights';
  const topSubtitle = isEducation
    ? 'Track assignment signals, due dates, and lecture follow-through across classrooms.'
    : 'Task intelligence and meeting execution signals across your workspace.';
  const meetingsLabel = isEducation ? 'Lectures This Week' : 'Meetings This Week';
  const dueLabel = isEducation ? 'Assignments Due Soon' : 'Tasks Due Tomorrow';
  const overdueLabel = isEducation ? 'Overdue Assignments' : 'Overdue Tasks';
  const actionOverviewLabel = isEducation ? 'Classroom Action Overview' : 'Action Overview';
  const topPendingLabel = isEducation ? 'Top Pending Assignments' : 'Top Pending Tasks';
  const topPendingEmptyLabel = isEducation ? 'No pending assignments.' : 'No pending tasks.';
  const dueSoonLabel = isEducation ? 'Assignments Due Soon' : 'Tasks Due Soon';
  const noActionsLabel = isEducation
    ? 'Lectures Without Assignment Signals'
    : 'Meetings Without Action Items';
  const noActionsCountLabel =
    meetingsNoActionCount === 1
      ? isEducation
        ? 'lecture has no extracted assignment signals'
        : 'meeting has no extracted tasks'
      : isEducation
        ? 'lectures have no extracted assignment signals'
        : 'meetings have no extracted tasks';
  const noActionsEmptyLabel = isEducation
    ? 'All lectures include at least one assignment signal.'
    : 'All meetings include at least one task.';

  return (
    <div className="insights-screen">
      <div className="insights-wrapper">
        <div className="insights-top-bar">
          <div>
            <h1 className="insights-title">{topTitle}</h1>
            <p className="insights-subtitle">
              {topSubtitle}
            </p>
          </div>
        </div>

        <div className="insights-content">
          <div className="insights-stats">
            <div className="insight-stat-card" onClick={() => navigate('/meetings')}>
              <div className="insight-stat-icon">
                <Calendar className="insight-lucide" strokeWidth={1.5} aria-hidden />
              </div>
              <div className="insight-stat-value">{stats?.meetingsThisWeek ?? 0}</div>
              <div className="insight-stat-label">{meetingsLabel}</div>
            </div>

            <div className="insight-stat-card" onClick={() => navigate('/dashboard')}>
              <div className="insight-stat-icon">
                <CheckSquare className="insight-lucide" strokeWidth={1.5} aria-hidden />
              </div>
              <div className="insight-stat-value">{stats?.tasksDueTomorrow ?? 0}</div>
              <div className="insight-stat-label">{dueLabel}</div>
            </div>

            <div className="insight-stat-card" onClick={() => navigate('/dashboard')}>
              <div className="insight-stat-icon insight-stat-icon--warn">
                <AlertTriangle className="insight-lucide" strokeWidth={1.5} aria-hidden />
              </div>
              <div className="insight-stat-value">{stats?.overdueTasks ?? 0}</div>
              <div className="insight-stat-label">{overdueLabel}</div>
            </div>
          </div>

          <div className="insights-section insights-action-overview">
            <h2 className="insights-section-title-row">
              <span className="insights-section-title-icon" aria-hidden>
                <ListTodo className="insight-lucide" strokeWidth={1.5} />
              </span>
              {actionOverviewLabel}
            </h2>
            <div className="insights-action-overview-grid">
              <div className="insights-overview-card insights-overview-card--pending">
                <h3 className="insights-overview-card-title">{topPendingLabel}</h3>
                {actionOverview.topPending.length === 0 ? (
                  <p className="insights-overview-empty">{topPendingEmptyLabel}</p>
                ) : (
                  <ul className="insights-overview-list">
                    {actionOverview.topPending.map((item, idx) => (
                      <li key={item._id || `${item.meetingId}-tp-${idx}`}>
                        <button
                          type="button"
                          className="insights-overview-row"
                          onClick={() => navigate(`/meetings/${item.meetingId}`)}
                        >
                          <span className="insights-overview-task">
                            {typeof item === 'string'
                              ? item
                              : item.task || item.title || 'Action item'}
                          </span>
                          <span className="insights-overview-meta">{item.meetingTitle}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="insights-overview-card insights-overview-card--due">
                <h3 className="insights-overview-card-title">{dueSoonLabel}</h3>
                {actionOverview.dueSoon.length === 0 ? (
                  <p className="insights-overview-empty">Nothing due in the next 7 days.</p>
                ) : (
                  <ul className="insights-overview-list">
                    {actionOverview.dueSoon.map((item, idx) => (
                      <li key={item._id || `${item.meetingId}-ds-${idx}`}>
                        <button
                          type="button"
                          className="insights-overview-row"
                          onClick={() => navigate(`/meetings/${item.meetingId}`)}
                        >
                          <span className="insights-overview-task">
                            {item.task || item.title || 'Action item'}
                          </span>
                          <span className="insights-overview-meta">
                            {item.dueDate
                              ? new Date(item.dueDate).toLocaleDateString(undefined, {
                                  month: 'short',
                                  day: 'numeric',
                                })
                              : '—'}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="insights-overview-card insights-overview-card--no-actions">
                <h3 className="insights-overview-card-title">{noActionsLabel}</h3>
                <p className="insights-overview-count">{meetingsNoActionCount}</p>
                <p className="insights-overview-count-label">{noActionsCountLabel}</p>
                {actionOverview.meetingsWithoutActions.length === 0 ? (
                  <p className="insights-overview-empty subtle">{noActionsEmptyLabel}</p>
                ) : (
                  <ul className="insights-overview-list insights-overview-list--titles">
                    {actionOverview.meetingsWithoutActions.slice(0, 5).map((m) => (
                      <li key={m._id}>
                        <button
                          type="button"
                          className="insights-overview-row"
                          onClick={() => navigate(`/meetings/${m._id}`)}
                        >
                          <span className="insights-overview-task">{m.title || 'Untitled'}</span>
                          <span className="insights-overview-meta">
                            <FolderX className="insights-overview-inline-icon" strokeWidth={1.5} aria-hidden />
                            Review
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Insights;

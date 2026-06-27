import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import {
  Bell,
  Video,
  ClipboardList,
  Clock,
  Sparkles,
  MoreVertical,
  ChevronRight,
  TrendingUp,
} from 'lucide-react';
import { FEATURE_INTERVIEW_UI } from '../config/featureFlags';
import { useTrialExperience } from './TrialExperienceProvider';
import './DashboardV2.css';

function greetingName(username) {
  const h = new Date().getHours();
  const g = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  const name = String(username || '').trim();
  const display = name ? name.charAt(0).toUpperCase() + name.slice(1) : 'there';
  return `${g}, ${display}`;
}

function formatMeetingWhen(m) {
  const d = m.endTime || m.startTime || m.scheduledTime || m.updatedAt;
  if (!d) return 'Recently';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return 'Recently';
  const now = new Date();
  const sameDay =
    dt.getFullYear() === now.getFullYear() &&
    dt.getMonth() === now.getMonth() &&
    dt.getDate() === now.getDate();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday =
    dt.getFullYear() === yesterday.getFullYear() &&
    dt.getMonth() === yesterday.getMonth() &&
    dt.getDate() === yesterday.getDate();
  const time = dt.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (sameDay) return `Today, ${time}`;
  if (isYesterday) return `Yesterday, ${time}`;
  return `${dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, ${time}`;
}

function formatDuration(m) {
  const start = m.startTime ? new Date(m.startTime) : null;
  const end = m.endTime ? new Date(m.endTime) : null;
  if (!start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    return '—';
  }
  const sec = Math.floor((end - start) / 1000);
  const mm = Math.floor(sec / 60);
  const ss = sec % 60;
  return `${mm}:${String(ss).padStart(2, '0')}`;
}

function meetingStatus(m) {
  if (m.status === 'In Progress' || m.transcriptionStatus === 'Recording') {
    return { label: 'Live', tone: 'live' };
  }
  if (m.transcriptionStatus === 'Processing') {
    return { label: 'Processing', tone: 'muted' };
  }
  if (String(m.pendingSummary || m.summary || '').trim()) {
    return { label: 'Summary Ready', tone: 'ready' };
  }
  if (m.summaryStatus === 'Sent') {
    return { label: 'Finalized', tone: 'ready' };
  }
  if (m.transcriptionStatus === 'Failed') {
    return { label: 'Needs retry', tone: 'warn' };
  }
  return { label: m.status || 'Scheduled', tone: 'muted' };
}

function countTasksFromMeetings(meetings) {
  let completed = 0;
  let inProgress = 0;
  let pending = 0;
  for (const m of meetings) {
    const items = [
      ...(Array.isArray(m.actionItems) ? m.actionItems : []),
      ...(Array.isArray(m.pendingActionItems) ? m.pendingActionItems : []),
    ];
    for (const item of items) {
      const s = String(item?.status || 'not_started').toLowerCase();
      if (s === 'done') completed += 1;
      else if (s === 'in_progress') inProgress += 1;
      else pending += 1;
    }
  }
  const total = completed + inProgress + pending;
  return { completed, inProgress, pending, total };
}

function aiAccuracyFromMeetings(meetings) {
  const finished = meetings.filter(
    (m) => m.status === 'Completed' || m.transcriptionStatus === 'Completed' || m.transcriptionStatus === 'Failed'
  );
  if (!finished.length) return null;
  const ok = finished.filter((m) => m.transcriptionStatus === 'Completed').length;
  return Math.round((ok / finished.length) * 100);
}

function summaryPreviewText(m) {
  const raw = String(m?.pendingSummary || m?.summary || '').trim();
  if (!raw) return '';
  return raw.length > 280 ? `${raw.slice(0, 277)}…` : raw;
}

export default function WorkplaceDashboard() {
  const trial = useTrialExperience();
  const [stats, setStats] = useState(null);
  const [meetings, setMeetings] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      const [statsRes, meetingsRes] = await Promise.all([
        axios.get('/admin/stats').catch(() => ({ data: {} })),
        axios.get('/meetings').catch(() => ({ data: { meetings: [] } })),
      ]);
      setStats(statsRes.data || {});
      setMeetings(Array.isArray(meetingsRes.data?.meetings) ? meetingsRes.data.meetings : []);
    } catch (err) {
      console.error('Error fetching dashboard:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    trial?.refreshProfile?.();
  }, [trial?.refreshProfile]);

  const recentMeetings = useMemo(() => {
    return [...meetings]
      .sort((a, b) => {
        const ta = new Date(b.endTime || b.startTime || b.scheduledTime || b.updatedAt || 0).getTime();
        const tb = new Date(a.endTime || a.startTime || a.scheduledTime || a.updatedAt || 0).getTime();
        return ta - tb;
      })
      .slice(0, 6);
  }, [meetings]);

  const previewMeeting = useMemo(() => {
    return (
      recentMeetings.find((m) => summaryPreviewText(m)) ||
      recentMeetings.find((m) => m.transcriptionStatus === 'Completed') ||
      recentMeetings[0] ||
      null
    );
  }, [recentMeetings]);

  const pendingReview = useMemo(() => {
    return meetings.filter((m) => {
      const hasPending = String(m.pendingSummary || '').trim().length > 0;
      const status = String(m.summaryStatus || '').trim();
      return hasPending && (status === '' || status === 'Pending Approval');
    });
  }, [meetings]);

  const taskCounts = useMemo(() => countTasksFromMeetings(meetings), [meetings]);
  const aiAccuracy = useMemo(() => aiAccuracyFromMeetings(meetings), [meetings]);

  const hoursSaved = useMemo(() => {
    const mins = trial?.profile?.totalMinutesSaved;
    if (typeof mins !== 'number') return '0';
    return (mins / 60).toFixed(1);
  }, [trial?.profile?.totalMinutesSaved]);

  const donutStyle = useMemo(() => {
    const { completed, inProgress, pending, total } = taskCounts;
    if (!total) {
      return { background: 'conic-gradient(#e5e7eb 0deg 360deg)' };
    }
    const c1 = (completed / total) * 360;
    const c2 = c1 + (inProgress / total) * 360;
    return {
      background: `conic-gradient(
        #22c55e 0deg ${c1}deg,
        #6366f1 ${c1}deg ${c2}deg,
        #f59e0b ${c2}deg 360deg
      )`,
    };
  }, [taskCounts]);

  if (loading) {
    return (
      <div className="dash-v2">
        <div className="dash-v2__loading">Loading your workspace…</div>
      </div>
    );
  }

  const nMeetWeek = stats?.meetingsThisWeek ?? 0;
  const nTasks = taskCounts.total;
  const pendingCount = pendingReview.length;

  return (
    <div className="dash-v2">
      <header className="dash-v2__hero">
        <div>
          <h1 className="dash-v2__title">{greetingName(trial?.profile?.username)} 👋</h1>
          <p className="dash-v2__subtitle">Here&apos;s what&apos;s happening in your workspace today.</p>
        </div>
        <div className="dash-v2__hero-actions">
          <Link to="/meetings" state={{ openStartModal: true }} className="dash-v2__btn-primary">
            + New Meeting
          </Link>
          <button type="button" className="dash-v2__icon-btn" aria-label="Notifications">
            <Bell size={18} />
            {pendingCount > 0 ? <span className="dash-v2__notif-dot" aria-hidden /> : null}
          </button>
        </div>
      </header>

      {trial?.profile?.isTrialing && typeof trial.profile.trialMeetingsRemaining === 'number' ? (
        <div className="dash-v2__trial" role="status">
          Free trial — {trial.profile.trialMeetingsRemaining} meeting
          {trial.profile.trialMeetingsRemaining === 1 ? '' : 's'} left
        </div>
      ) : null}

      <div className="dash-v2__metrics">
        <Link to="/meetings" className="dash-v2-metric dash-v2-metric--purple">
          <span className="dash-v2-metric__icon" aria-hidden>
            <Video size={18} />
          </span>
          <span className="dash-v2-metric__label">Meetings This Week</span>
          <strong className="dash-v2-metric__value">{nMeetWeek}</strong>
          <span className="dash-v2-metric__trend">
            <TrendingUp size={12} aria-hidden /> This week
          </span>
        </Link>
        <Link to="/insights" className="dash-v2-metric dash-v2-metric--green">
          <span className="dash-v2-metric__icon" aria-hidden>
            <ClipboardList size={18} />
          </span>
          <span className="dash-v2-metric__label">Tasks Created</span>
          <strong className="dash-v2-metric__value">{nTasks}</strong>
          <span className="dash-v2-metric__trend">
            <TrendingUp size={12} aria-hidden /> From your meetings
          </span>
        </Link>
        <div className="dash-v2-metric dash-v2-metric--blue">
          <span className="dash-v2-metric__icon" aria-hidden>
            <Clock size={18} />
          </span>
          <span className="dash-v2-metric__label">Hours Saved</span>
          <strong className="dash-v2-metric__value">{hoursSaved}</strong>
          <span className="dash-v2-metric__trend">
            <TrendingUp size={12} aria-hidden /> AI-assisted notes
          </span>
        </div>
        <div className="dash-v2-metric dash-v2-metric--amber">
          <span className="dash-v2-metric__icon" aria-hidden>
            <Sparkles size={18} />
          </span>
          <span className="dash-v2-metric__label">AI Accuracy</span>
          <strong className="dash-v2-metric__value">{aiAccuracy != null ? `${aiAccuracy}%` : '—'}</strong>
          <span className="dash-v2-metric__trend">
            <TrendingUp size={12} aria-hidden /> Transcription success
          </span>
        </div>
      </div>

      <div className="dash-v2__grid">
        <section className="dash-v2-card dash-v2-card--meetings">
          <div className="dash-v2-card__head">
            <h2 className="dash-v2-card__title">Recent Meetings</h2>
            <Link to="/meetings" state={{ showAllMeetings: true }} className="dash-v2-card__link">
              View all
            </Link>
          </div>
          {recentMeetings.length === 0 ? (
            <p className="dash-v2-empty">No meetings yet — start your first one above.</p>
          ) : (
            <ul className="dash-v2-meetings">
              {recentMeetings.map((m) => {
                const id = m._id != null ? String(m._id) : '';
                const st = meetingStatus(m);
                const participants = Array.isArray(m.participants) ? m.participants.length : 0;
                const href =
                  st.label === 'Live' || m.status === 'In Progress'
                    ? `/meetings/${id}/room`
                    : summaryPreviewText(m)
                      ? `/meetings/${id}/summary`
                      : `/meetings/${id}`;
                return (
                  <li key={id}>
                    <Link to={href} className="dash-v2-meeting-row">
                      <span className="dash-v2-meeting-row__icon" aria-hidden>
                        <Video size={16} />
                      </span>
                      <span className="dash-v2-meeting-row__body">
                        <strong>{m.title || 'Untitled meeting'}</strong>
                        <span className="dash-v2-meeting-row__meta">
                          {formatMeetingWhen(m)}
                          {participants ? ` · ${participants} participant${participants === 1 ? '' : 's'}` : ''}
                        </span>
                      </span>
                      <span className={`dash-v2-badge dash-v2-badge--${st.tone}`}>{st.label}</span>
                      <span className="dash-v2-meeting-row__dur">{formatDuration(m)}</span>
                      <MoreVertical size={16} className="dash-v2-meeting-row__menu" aria-hidden />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}

          {pendingReview.length > 0 ? (
            <div className="dash-v2-inline-alert">
              <p>
                {pendingReview.length} summar{pendingReview.length === 1 ? 'y' : 'ies'} waiting for your review.
              </p>
              <Link to={`/meetings/${pendingReview[0]._id}/summary`}>Review now →</Link>
            </div>
          ) : null}
        </section>

        <aside className="dash-v2__aside">
          <section className="dash-v2-card dash-v2-card--preview">
            <div className="dash-v2-card__head">
              <h2 className="dash-v2-card__title">AI Summary Preview</h2>
              {previewMeeting ? (
                <Link to={`/meetings/${previewMeeting._id}/summary`} className="dash-v2-card__link">
                  View full
                </Link>
              ) : null}
            </div>
            {previewMeeting && summaryPreviewText(previewMeeting) ? (
              <blockquote className="dash-v2-preview">
                <span className="dash-v2-preview__quote" aria-hidden>
                  “
                </span>
                <p>{summaryPreviewText(previewMeeting)}</p>
                <footer>
                  — {previewMeeting.title || 'Meeting'} · {formatMeetingWhen(previewMeeting)}
                </footer>
              </blockquote>
            ) : (
              <p className="dash-v2-empty">Your latest AI summary will show up here after a meeting.</p>
            )}
          </section>

          <section className="dash-v2-card dash-v2-card--tasks">
            <div className="dash-v2-card__head">
              <h2 className="dash-v2-card__title">Tasks Overview</h2>
              <Link to="/insights" className="dash-v2-card__link">
                View all
              </Link>
            </div>
            <div className="dash-v2-donut-wrap">
              <div className="dash-v2-donut" style={donutStyle} aria-hidden>
                <span className="dash-v2-donut__hole">{taskCounts.total}</span>
              </div>
              <ul className="dash-v2-legend">
                <li>
                  <span className="dash-v2-legend__dot dash-v2-legend__dot--done" />
                  Completed · {taskCounts.completed}
                  {taskCounts.total
                    ? ` (${Math.round((taskCounts.completed / taskCounts.total) * 100)}%)`
                    : ''}
                </li>
                <li>
                  <span className="dash-v2-legend__dot dash-v2-legend__dot--progress" />
                  In Progress · {taskCounts.inProgress}
                  {taskCounts.total
                    ? ` (${Math.round((taskCounts.inProgress / taskCounts.total) * 100)}%)`
                    : ''}
                </li>
                <li>
                  <span className="dash-v2-legend__dot dash-v2-legend__dot--pending" />
                  Pending · {taskCounts.pending}
                  {taskCounts.total
                    ? ` (${Math.round((taskCounts.pending / taskCounts.total) * 100)}%)`
                    : ''}
                </li>
              </ul>
            </div>
          </section>

          {FEATURE_INTERVIEW_UI ? (
            <Link to="/interview" className="dash-v2-interview-card">
              <strong>Interview Mode</strong>
              <p>Structured hiring evaluations from interview recordings.</p>
              <span>
                Explore <ChevronRight size={14} aria-hidden />
              </span>
            </Link>
          ) : null}
        </aside>
      </div>

      <footer className="dash-v2-status">
        <Sparkles size={16} aria-hidden />
        <div>
          <strong>PortIQ is working for you</strong>
          <p>
            {nMeetWeek} meetings processed · {nTasks} tasks extracted · {hoursSaved} hours saved
          </p>
        </div>
        <Link to="/insights" className="dash-v2-status__link">
          View Insights <ChevronRight size={14} aria-hidden />
        </Link>
      </footer>
    </div>
  );
}

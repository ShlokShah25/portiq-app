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
  GraduationCap,
} from 'lucide-react';
import './Dashboard.css';
import { FEATURE_INTERVIEW_UI } from '../config/featureFlags';
import { interviewPaths } from '../interview/useInterviewRoutes';
import { useTrialExperience } from './TrialExperienceProvider';
import TeacherDashboard from './TeacherDashboard';
import EducationAdminDashboard from './EducationAdminDashboard';
import { isEducation } from '../config/product';
import {
  WORKSPACE_TIPS,
  EDUCATION_ADMIN_TIPS,
  pickTipIndex,
  TIP_ROTATION_MS,
} from '../config/dashboardTips';
import { getClassrooms } from '../utils/classroomsStorage';

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

const DASHBOARD_SECTION_KEYS = {
  pendingSummaries: 'pendingSummaries',
  interviewPipeline: 'interviewPipeline',
  compactStats: 'compactStats',
  recentTasks: 'recentTasks',
};

function readHiddenSections() {
  try {
    const raw = localStorage.getItem('portiq_dashboard_hidden_sections');
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const out = { ...parsed };
    delete out.tipStrip;
    delete out.inProgress;
    return out;
  } catch {
    return {};
  }
}

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

const Dashboard = () => {
  const trial = useTrialExperience();
  const [stats, setStats] = useState(null);
  const [meetings, setMeetings] = useState([]);
  const [loading, setLoading] = useState(true);
  const mainDashboardTips = isEducation ? EDUCATION_ADMIN_TIPS : WORKSPACE_TIPS;
  const [tipIndex, setTipIndex] = useState(() =>
    pickTipIndex('portiq_dashboard_tip_idx', mainDashboardTips.length)
  );
  const [hiddenSections, setHiddenSections] = useState(() => readHiddenSections());

  useEffect(() => {
    try {
      localStorage.setItem('portiq_dashboard_hidden_sections', JSON.stringify(hiddenSections));
    } catch {}
  }, [hiddenSections]);

  const hideSection = (key) =>
    setHiddenSections((prev) => ({
      ...prev,
      [key]: true,
    }));
  const showAllSections = () => setHiddenSections({});
  const isHidden = (key) => !!hiddenSections[key];
  const hiddenCount = Object.values(hiddenSections).filter(Boolean).length;

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    trial?.refreshProfile?.();
  }, [trial?.refreshProfile]);

  useEffect(() => {
    const tips = isEducation ? EDUCATION_ADMIN_TIPS : WORKSPACE_TIPS;
    const id = window.setInterval(() => {
      setTipIndex((i) => (i + 1) % tips.length);
    }, TIP_ROTATION_MS);
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
  const educationClassrooms = useMemo(() => (isEducation ? getClassrooms() : []), []);
  const educationStudentCount = useMemo(
    () =>
      educationClassrooms.reduce(
        (sum, c) => sum + (Array.isArray(c.studentEmails) ? c.studentEmails.length : 0),
        0
      ),
    [educationClassrooms]
  );
  const educationSubjectsCount = useMemo(
    () =>
      educationClassrooms.reduce(
        (sum, c) =>
          sum +
          (Array.isArray(c.subjects) && c.subjects.length > 0
            ? c.subjects.length
            : String(c.subject || '').trim()
              ? 1
              : 0),
        0
      ),
    [educationClassrooms]
  );

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
      .filter((m) => {
        const hasPendingText = String(m.pendingSummary || '').trim().length > 0;
        if (!hasPendingText) return false;
        const status = String(m.summaryStatus || '').trim();
        // Only show summaries that still need review.
        // Legacy rows can have pendingSummary text but no summaryStatus yet.
        return status === '' || status === 'Pending Approval';
      })
      .filter((m) => !FEATURE_INTERVIEW_UI || m.summaryMode !== 'interview')
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

  if (isEducation && trial?.profile?.role === 'faculty') {
    return <TeacherDashboard />;
  }
  if (isEducation && trial?.profile?.role !== 'faculty') {
    return <EducationAdminDashboard />;
  }

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

  const trialProfile = trial?.profile;
  const showTrialBanner =
    trialProfile?.isTrialing &&
    typeof trialProfile.trialMeetingsRemaining === 'number' &&
    trialProfile.trialMeetingsRemaining > 0;
  const lastFreeMeeting =
    showTrialBanner && trialProfile.trialMeetingsRemaining === 1;
  const minutesSaved =
    trialProfile != null
      ? typeof trialProfile.totalMinutesSaved === 'number'
        ? trialProfile.totalMinutesSaved
        : 0
      : null;

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
              {isEducation
                ? 'Run lessons. Capture outcomes. Help students revise clearly.'
                : 'Run meetings. Capture outcomes. Stay aligned.'}
            </p>
          </header>

          {trialProfile && minutesSaved != null && (
            <p
              className="dashboard-value-metric ux-dashboard-stagger"
              style={{ animationDelay: '18ms' }}
            >
              You’ve saved {minutesSaved} minute{minutesSaved === 1 ? '' : 's'} of manual work
            </p>
          )}

          {showTrialBanner && (
            <div
              className="dashboard-trial-banner ux-dashboard-stagger"
              style={{ animationDelay: '24ms' }}
              role="status"
            >
              <p className="dashboard-trial-banner__line">
                Free Trial: {trialProfile.trialMeetingsRemaining} meeting
                {trialProfile.trialMeetingsRemaining === 1 ? '' : 's'} remaining
              </p>
              {lastFreeMeeting && (
                <p className="dashboard-trial-banner__hint">This is your last free meeting</p>
              )}
          </div>
          )}

          <div
            className="dashboard-start-meeting dashboard-start-meeting--minimal ux-dashboard-stagger"
            style={{ animationDelay: '45ms' }}
            id="dashboard-meetings"
          >
            <h2 className="dashboard-start-meeting__title">{isEducation ? 'Start a lesson' : 'Start a meeting'}</h2>
            <div className="dashboard-start-meeting__actions">
              <Link
                to="/meetings"
                state={{ openStartModal: true }}
                className="dashboard-btn-primary dashboard-btn-primary--hero dashboard-btn-micro"
              >
                {isEducation ? 'New lesson' : 'New Meeting'}
              </Link>
            <Link 
              to="/meetings"
                state={{ showAllMeetings: true }}
                className="dashboard-btn-secondary dashboard-btn-micro"
              >
                {isEducation ? 'View Lessons' : 'View Meetings'}
            </Link>
            </div>
          </div>

          {isEducation ? (
            <section className="dashboard-education-strip ux-dashboard-stagger" style={{ animationDelay: '56ms' }}>
              <div className="dashboard-education-strip__title-row">
                <GraduationCap className="dashboard-stat-chip__lucide" strokeWidth={1.5} />
                <h2>Education workspace</h2>
              </div>
              <div className="dashboard-education-strip__grid">
                <div className="dashboard-education-pill">
                  <span className="dashboard-education-pill__k">Classrooms</span>
                  <span className="dashboard-education-pill__v">{educationClassrooms.length}</span>
                </div>
                <div className="dashboard-education-pill">
                  <span className="dashboard-education-pill__k">Students</span>
                  <span className="dashboard-education-pill__v">{educationStudentCount}</span>
                </div>
                <div className="dashboard-education-pill">
                  <span className="dashboard-education-pill__k">Subjects</span>
                  <span className="dashboard-education-pill__v">{educationSubjectsCount}</span>
                </div>
              </div>
              <p className="dashboard-education-strip__hint">
                Students are managed inside classrooms. Limits: 7 classrooms, 40 students/classroom,
                and 9 subjects/classroom. Teachers are unlimited.
              </p>
            </section>
          ) : null}

          {hiddenCount > 0 ? (
            <div className="dashboard-section-tools">
              <button
                type="button"
                className="dashboard-section-tools__btn"
                onClick={showAllSections}
              >
                Show hidden sections ({hiddenCount})
              </button>
            </div>
          ) : null}

          <div className="dashboard-tip-strip" role="status" aria-live="polite">
            <Lightbulb className="dashboard-tip-strip__ic" strokeWidth={1.5} aria-hidden />
            <span key={tipIndex} className="dashboard-tip-strip__text ux-dashboard-tip-fade">
              {(isEducation ? EDUCATION_ADMIN_TIPS : WORKSPACE_TIPS)[tipIndex]}
            </span>
            </div>

          {pendingSummaryMeetings.length > 0 && !isHidden(DASHBOARD_SECTION_KEYS.pendingSummaries) ? (
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
                      {isEducation ? 'Pending lesson notes' : 'Pending summaries'}
                    </h2>
                    <p className="dashboard-pending-summaries__sub">
                      {isEducation
                        ? 'Review and approve before they go to students.'
                        : 'Review and approve before they go to participants.'}
                    </p>
                  </div>
                </div>
                <div className="dashboard-head-actions">
                  <button
                    type="button"
                    className="dashboard-section-hide"
                    onClick={() => hideSection(DASHBOARD_SECTION_KEYS.pendingSummaries)}
                    aria-label="Hide pending summaries section"
                  >
                    Hide
                  </button>
                </div>
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

          {FEATURE_INTERVIEW_UI &&
          (interviewQueuePending.length > 0 || interviewQueueResolved.length > 0) &&
          !isHidden(DASHBOARD_SECTION_KEYS.interviewPipeline) ? (
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
                    Finalize hiring decisions and keep recent outcomes visible.{' '}
                    <Link to="/interview">Open Interview workspace →</Link>
                  </p>
            </div>
                <div className="dashboard-head-actions">
                  <button
                    type="button"
                    className="dashboard-section-hide"
                    onClick={() => hideSection(DASHBOARD_SECTION_KEYS.interviewPipeline)}
                    aria-label="Hide interview pipeline section"
                  >
                    Hide
                  </button>
                </div>
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
                            to={interviewPaths(id).report}
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
                  No pending hiring decisions.
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
                            to={interviewPaths(id).report}
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

          {inProgressMeetings.length > 0 ? (
            <section
              className="dashboard-section dashboard-section--minimal ux-dashboard-stagger dashboard-section--reveal"
              style={{ animationDelay: '115ms' }}
              aria-labelledby="dash-in-progress"
            >
              <div className="dashboard-section__head">
                <h2 id="dash-in-progress" className="dashboard-section__title">
                  In progress
                </h2>
                <div className="dashboard-head-actions">
                  <Link to="/meetings" state={{ showAllMeetings: true }} className="dashboard-section__link">
                    View all
                  </Link>
                </div>
              </div>
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
            </section>
          ) : null}

          {!isHidden(DASHBOARD_SECTION_KEYS.compactStats) ? (
          <div className="dashboard-head-actions dashboard-head-actions--inline-tools">
            <button
              type="button"
              className="dashboard-section-hide"
              onClick={() => hideSection(DASHBOARD_SECTION_KEYS.compactStats)}
              aria-label="Hide compact stats section"
            >
              Hide stats
            </button>
          </div>
          ) : null}

          {!isHidden(DASHBOARD_SECTION_KEYS.compactStats) ? (
          <div
            className="dashboard-compact-stats ux-dashboard-stagger"
            style={{ animationDelay: '90ms' }}
            aria-label="Meeting and task summary"
          >
            <Link
              to={isEducation ? '/meetings' : '/insights'}
              className="dashboard-stat-chip dashboard-stat-chip--tile"
            >
              <div className="dashboard-stat-chip__icon" aria-hidden>
                <Calendar className="dashboard-stat-chip__lucide" strokeWidth={1.5} />
              </div>
              <div className="dashboard-stat-chip__body">
                <span className="dashboard-stat-chip__label">{isEducation ? 'Lessons this week' : 'Meetings this week'}</span>
                <span className="dashboard-stat-chip__value">{nMeetWeek}</span>
              </div>
              <ChevronRight className="dashboard-stat-chip__chev" strokeWidth={2} aria-hidden />
            </Link>

            <Link
              to="/insights"
              className="dashboard-stat-chip dashboard-stat-chip--tile"
            >
              <div className="dashboard-stat-chip__icon" aria-hidden>
                <CheckSquare className="dashboard-stat-chip__lucide" strokeWidth={1.5} />
              </div>
              <div className="dashboard-stat-chip__body">
                <span className="dashboard-stat-chip__label">{isEducation ? 'Assignments due' : 'Tasks due'}</span>
                <span className="dashboard-stat-chip__value">{nDueTom}</span>
              </div>
              <ChevronRight className="dashboard-stat-chip__chev" strokeWidth={2} aria-hidden />
            </Link>

            <Link
              to="/insights"
              className="dashboard-stat-chip dashboard-stat-chip--tile dashboard-stat-chip--warn"
            >
              <div className="dashboard-stat-chip__icon dashboard-stat-chip__icon--warn" aria-hidden>
                <AlertTriangle className="dashboard-stat-chip__lucide" strokeWidth={1.5} />
              </div>
              <div className="dashboard-stat-chip__body">
                <span className="dashboard-stat-chip__label">{isEducation ? 'Overdue assignments' : 'Overdue tasks'}</span>
                <span className="dashboard-stat-chip__value">{nOverdue}</span>
            </div>
              <ChevronRight className="dashboard-stat-chip__chev" strokeWidth={2} aria-hidden />
            </Link>
          </div>
          ) : null}

          {!isEducation && !isHidden(DASHBOARD_SECTION_KEYS.recentTasks) ? (
          <section
            className="dashboard-section dashboard-section--minimal ux-dashboard-stagger dashboard-section--reveal"
            style={{ animationDelay: '130ms' }}
            aria-labelledby="dash-recent-tasks"
          >
            <div className="dashboard-section__head">
              <h2 id="dash-recent-tasks" className="dashboard-section__title">
                Recent action items
              </h2>
              <div className="dashboard-head-actions">
                <Link to="/insights" className="dashboard-section__link">
                  View all
                </Link>
                <button
                  type="button"
                  className="dashboard-section-hide"
                  onClick={() => hideSection(DASHBOARD_SECTION_KEYS.recentTasks)}
                  aria-label="Hide recent tasks section"
                >
                  Hide
                </button>
              </div>
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
          ) : null}
        </div>
      </div>
    </div>
  );
};

export default Dashboard;

import React, { useState, useEffect, useCallback } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import axios from 'axios';
import {
  Calendar,
  AlertTriangle,
  CheckCircle2,
  CheckSquare,
  Plug,
} from 'lucide-react';
import TopNav from './TopNav';
import MeetingPlatformsModal from './MeetingPlatformsModal';
import MeetingCreateForm from './MeetingCreateForm';
import { T } from '../config/terminology';
import { PORTIQ_PRICE_ROW } from '../config/productPitch';
import './Dashboard.css';
import './DashboardIntegrations.css';
import './MeetingsScreen.css';

const MARKETING_URL =
  process.env.REACT_APP_MARKETING_URL ||
  process.env.REACT_APP_WEBSITE_URL ||
  'https://www.portiqtechnologies.com';

const Dashboard = ({ config }) => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [connectModalOpen, setConnectModalOpen] = useState(false);
  const [meetingPlatforms, setMeetingPlatforms] = useState({ zoom: false, teams: false });
  const [subscriptionGate, setSubscriptionGate] = useState(null);
  const [maxParticipantsPerMeeting, setMaxParticipantsPerMeeting] = useState(null);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, []);

  const loadProfile = useCallback(async () => {
    try {
      const res = await axios.get('/admin/profile');
      const admin = res.data?.admin;
      const mp = admin?.meetingPlatforms;
      setMeetingPlatforms({
        zoom: !!(mp && mp.zoom),
        teams: !!(mp && mp.teams),
      });
      if (!admin) {
        setSubscriptionGate('ok');
        setMaxParticipantsPerMeeting(null);
        return;
      }
      const u = String(admin.username || '').toLowerCase();
      if (u === 'admin' || admin.hasActiveSubscription || admin.complimentaryAccess) {
        setSubscriptionGate('ok');
      } else if (admin.subscriptionPaymentPending) {
        setSubscriptionGate('payment_pending');
      } else {
        setSubscriptionGate('inactive');
      }
      const plan = (admin.plan || 'starter').toLowerCase();
      const maxByPlan = { starter: 10, professional: 20, business: 30 };
      setMaxParticipantsPerMeeting(maxByPlan[plan] ?? null);
    } catch {
      setMeetingPlatforms({ zoom: false, teams: false });
      setSubscriptionGate('ok');
      setMaxParticipantsPerMeeting(null);
    }
  }, []);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  useEffect(() => {
    const z = searchParams.get('zoom');
    const t = searchParams.get('teams');
    if (!z && !t) return;
    (async () => {
      if (z === 'connected' || t === 'connected') {
        await loadProfile();
      }
      setSearchParams({}, { replace: true });
    })();
  }, [searchParams, setSearchParams, loadProfile]);

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
  const hasConnectedPlatform = meetingPlatforms.zoom || meetingPlatforms.teams;

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

          {!hasConnectedPlatform && (
            <div className="dashboard-setup-card">
              <div className="dashboard-setup-card__text">
                <p className="dashboard-setup-card__title">
                  <Plug size={18} strokeWidth={1.75} aria-hidden />
                  Connect your meeting platforms
                </p>
                <p className="dashboard-setup-card__desc">
                  Connect Zoom or Teams to automatically join your meetings
                </p>
              </div>
              <button
                type="button"
                className="dashboard-setup-card__cta"
                onClick={() => setConnectModalOpen(true)}
              >
                Connect Zoom / Teams
              </button>
            </div>
          )}

          <div className="dashboard-new-meeting" id="dashboard-new-meeting">
            <div className="card">
              <div className="card-header">
                <h2>{T.newMeeting()}</h2>
              </div>
              {subscriptionGate === 'inactive' && (
                <div className="meetings-subscription-banner meetings-subscription-banner--inactive" role="alert">
                  <div className="meetings-subscription-banner-text">
                    <p>No active plan—you need one to start a meeting.</p>
                    <p className="meetings-subscription-banner-prices">{PORTIQ_PRICE_ROW}</p>
                  </div>
                  <a className="meetings-subscription-banner-link" href={`${MARKETING_URL}#pricing`}>
                    See plans
                  </a>
                </div>
              )}
              {subscriptionGate === 'payment_pending' && (
                <div className="meetings-subscription-banner meetings-subscription-banner--payment" role="alert">
                  <div className="meetings-subscription-banner-text">
                    <p>{'Almost there—finish checkout and you\'re in.'}</p>
                  </div>
                  <a className="meetings-subscription-banner-link" href={`${MARKETING_URL}#pricing`}>
                    Finish payment
                  </a>
                </div>
              )}
              <div className="meetings-new-meeting-form-wrap">
                <MeetingCreateForm
                  inline
                  active
                  companyName={config?.companyName || 'Your Company'}
                  subscriptionGate={subscriptionGate}
                  maxParticipantsPerMeeting={maxParticipantsPerMeeting}
                  onMeetingCreated={fetchData}
                />
              </div>
            </div>
          </div>

          <div className="dashboard-metrics" aria-label="Task and meeting shortcuts">
            <Link
              to="/dashboard/tasks/due-tomorrow"
              className="metric-card metric-card--tile"
            >
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
              <span className="metric-tile-hint">View list</span>
            </Link>

            <Link to="/dashboard/tasks/overdue" className="metric-card metric-card--tile">
              <div className="metric-header">
                <div className="metric-icon metric-icon--warn">
                  <AlertTriangle className="metric-lucide" strokeWidth={1.5} aria-hidden />
                </div>
                <span className="metric-label">Overdue Tasks</span>
              </div>
              <div className="metric-value">{nOverdue}</div>
              <p className="metric-desc">Requires follow-up</p>
              <span className="metric-tile-hint">View list</span>
            </Link>

            <Link
              to="/dashboard/tasks/completed-week"
              className="metric-card metric-card--tile"
            >
              <div className="metric-header">
                <div className="metric-icon metric-icon--ok">
                  <CheckCircle2 className="metric-lucide" strokeWidth={1.5} aria-hidden />
                </div>
                <span className="metric-label">Completed This Week</span>
              </div>
              <div className="metric-value">{nDoneWeek}</div>
              <p className="metric-desc">Tasks marked done this week</p>
              <span className="metric-tile-hint">View list</span>
            </Link>

            <Link
              to="/dashboard/tasks/meetings-week"
              className="metric-card metric-card--tile"
            >
              <div className="metric-header">
                <div className="metric-icon">
                  <Calendar className="metric-lucide" strokeWidth={1.5} aria-hidden />
                </div>
                <span className="metric-label">Meetings This Week</span>
              </div>
              <div className="metric-value">{nMeetWeek}</div>
              <p className="metric-desc">Scheduled or held sessions</p>
              <span className="metric-tile-hint">View list</span>
            </Link>
          </div>
        </div>
      </div>

      <MeetingPlatformsModal
        open={connectModalOpen}
        onClose={() => setConnectModalOpen(false)}
        onSaved={(mp) => {
          if (mp) {
            setMeetingPlatforms({
              zoom: !!mp.zoom,
              teams: !!mp.teams,
            });
          }
        }}
      />
    </div>
  );
};

export default Dashboard;

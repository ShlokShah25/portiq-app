import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import axios from 'axios';
import {
  Calendar,
  AlertTriangle,
  CheckCircle2,
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
    </div>
  );
};

export default Dashboard;

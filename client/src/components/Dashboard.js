import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import axios from 'axios';
import TopNav from './TopNav';
import { isEducation } from '../config/product';
import { T } from '../config/terminology';
import { getClassrooms } from '../utils/classroomsStorage';
import { getTeachers } from '../utils/teachersStorage';
import './Dashboard.css';

const Dashboard = ({ config }) => {
  const navigate = useNavigate();
  const [stats, setStats] = useState(null);
  const [recentMeetings, setRecentMeetings] = useState([]);
  const [classroomsCount, setClassroomsCount] = useState(0);
  const [teachersCount, setTeachersCount] = useState(0);
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
      setClassroomsCount(getClassrooms().length);
      setTeachersCount(getTeachers().length);
      if (isEducation) {
        const meetingsRes = await axios.get('/admin/meetings', { params: { limit: 5 } }).catch(() => ({ data: {} }));
        setRecentMeetings(meetingsRes.data?.meetings || []);
      }
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

  return (
    <div className="dashboard-screen">
      <TopNav />
      <div className="dashboard-wrapper">
        <div className="dashboard-content">
          <div className="dashboard-header">
            <h1 className="dashboard-title">{isEducation ? T.welcomeTitle() : 'Dashboard'}</h1>
            <p className="dashboard-subtitle">
              {isEducation ? 'Overview of lectures, classes, and teachers' : 'Overview of your meeting activity'}
            </p>
          </div>

          <div className="dashboard-actions">
            <Link 
              to="/meetings"
              className="dashboard-btn-primary"
              style={{ textDecoration: 'none' }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
                <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
                <line x1="12" y1="19" x2="12" y2="23"></line>
                <line x1="8" y1="23" x2="16" y2="23"></line>
              </svg>
              {T.startMeeting()}
            </Link>
          </div>

          <div className="dashboard-metrics">
            {isEducation ? (
              <>
                <div className="metric-card">
                  <div className="metric-header">
                    <div className="metric-icon">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                        <line x1="16" y1="2" x2="16" y2="6"></line>
                        <line x1="8" y1="2" x2="8" y2="6"></line>
                        <line x1="3" y1="10" x2="21" y2="10"></line>
                      </svg>
                    </div>
                    <span className="metric-label">Total {T.meetings()}</span>
                  </div>
                  <div className="metric-value">{stats?.totalMeetings ?? recentMeetings.length}</div>
                </div>
                <div className="metric-card">
                  <div className="metric-header">
                    <div className="metric-icon">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                        <circle cx="9" cy="7" r="4"></circle>
                        <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                        <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
                      </svg>
                    </div>
                    <span className="metric-label">Total Classes</span>
                  </div>
                  <div className="metric-value">{classroomsCount}</div>
                </div>
                <div className="metric-card">
                  <div className="metric-header">
                    <div className="metric-icon">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                        <circle cx="12" cy="7" r="4"></circle>
                      </svg>
                    </div>
                    <span className="metric-label">Total {T.team()}</span>
                  </div>
                  <div className="metric-value">{teachersCount}</div>
                </div>
                <div className="metric-card">
                  <div className="metric-header">
                    <div className="metric-icon">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <circle cx="12" cy="12" r="10"></circle>
                        <polyline points="12 6 12 12 16 14"></polyline>
                      </svg>
                    </div>
                    <span className="metric-label">Recent {T.meetings()}</span>
                  </div>
                  <div className="metric-value">{recentMeetings.length}</div>
                </div>
              </>
            ) : (
              <>
                <div className="metric-card">
                  <div className="metric-header">
                    <div className="metric-icon">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                        <line x1="16" y1="2" x2="16" y2="6"></line>
                        <line x1="8" y1="2" x2="8" y2="6"></line>
                        <line x1="3" y1="10" x2="21" y2="10"></line>
                      </svg>
                    </div>
                    <span className="metric-label">Total {T.meetings()}</span>
                  </div>
                  <div className="metric-value">{stats?.totalMeetings || 0}</div>
                </div>
                <div className="metric-card">
                  <div className="metric-header">
                    <div className="metric-icon">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                        <line x1="16" y1="2" x2="16" y2="6"></line>
                        <line x1="8" y1="2" x2="8" y2="6"></line>
                        <line x1="3" y1="10" x2="21" y2="10"></line>
                      </svg>
                    </div>
                    <span className="metric-label">Scheduled</span>
                  </div>
                  <div className="metric-value">{stats?.scheduledMeetings || 0}</div>
                </div>
                <div className="metric-card">
                  <div className="metric-header">
                    <div className="metric-icon">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <circle cx="12" cy="12" r="10"></circle>
                        <polyline points="12 6 12 12 16 14"></polyline>
                      </svg>
                    </div>
                    <span className="metric-label">Today</span>
                  </div>
                  <div className="metric-value">{stats?.todayMeetings || 0}</div>
                </div>
                <div className="metric-card">
                  <div className="metric-header">
                    <div className="metric-icon">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                        <circle cx="9" cy="7" r="4"></circle>
                        <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                        <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
                      </svg>
                    </div>
                    <span className="metric-label">{T.participants()}</span>
                  </div>
                  <div className="metric-value">{stats?.totalParticipants || 0}</div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;

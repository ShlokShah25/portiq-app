import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import TopNav from './TopNav';
import './Insights.css';

const Insights = () => {
  const navigate = useNavigate();
  const [stats, setStats] = useState(null);
  const [recentMeetings, setRecentMeetings] = useState([]);
  const [actionItems, setActionItems] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [statsRes, meetingsRes] = await Promise.all([
        axios.get('/admin/stats').catch(() => ({ data: {} })),
        axios.get('/meetings?limit=10').catch(() => ({ data: { meetings: [] } }))
      ]);
      
      setStats(statsRes.data || {});
      const meetings = meetingsRes.data.meetings || [];
      setRecentMeetings(meetings.slice(0, 5));
      
      // Extract action items from all meetings
      const allActionItems = [];
      meetings.forEach(meeting => {
        if (meeting.summary?.actionItems && Array.isArray(meeting.summary.actionItems)) {
          meeting.summary.actionItems.forEach(item => {
            allActionItems.push({
              ...item,
              meetingTitle: meeting.title,
              meetingId: meeting._id,
              date: meeting.createdAt
            });
          });
        }
      });
      setActionItems(allActionItems.slice(0, 10));
    } catch (error) {
      console.error('Error fetching insights:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="insights-screen">
        <TopNav />
        <div className="insights-wrapper">
          <div className="insights-content">
            <div className="loading">Loading...</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="insights-screen">
      <TopNav />
      <div className="insights-wrapper">
        <div className="insights-top-bar">
          <h1 className="insights-title">Insights</h1>
        </div>
        
        <div className="insights-content">
          <div className="insights-stats">
            <div className="insight-stat-card" onClick={() => navigate('/meetings')}>
              <div className="insight-stat-icon">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                  <line x1="16" y1="2" x2="16" y2="6"></line>
                  <line x1="8" y1="2" x2="8" y2="6"></line>
                  <line x1="3" y1="10" x2="21" y2="10"></line>
                </svg>
              </div>
              <div className="insight-stat-value">{stats?.totalMeetings || 0}</div>
              <div className="insight-stat-label">Total Meetings</div>
            </div>
            
            <div className="insight-stat-card" onClick={() => navigate('/meetings')}>
              <div className="insight-stat-icon">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <circle cx="12" cy="12" r="10"></circle>
                  <polyline points="12 6 12 12 16 14"></polyline>
                </svg>
              </div>
              <div className="insight-stat-value">{stats?.todayMeetings || 0}</div>
              <div className="insight-stat-label">Today</div>
            </div>
            
            <div className="insight-stat-card" onClick={() => navigate('/participants')}>
              <div className="insight-stat-icon">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                  <circle cx="9" cy="7" r="4"></circle>
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                  <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
                </svg>
              </div>
              <div className="insight-stat-value">{actionItems.length}</div>
              <div className="insight-stat-label">Action Items</div>
            </div>
          </div>

          {actionItems.length > 0 && (
            <div className="insights-section">
              <h2>Recent Action Items</h2>
              <div className="action-items-list">
                {actionItems.map((item, idx) => (
                  <div key={idx} className="action-item-card" onClick={() => navigate('/meetings')}>
                    <div className="action-item-content">
                      <div className="action-item-text">{item}</div>
                      <div className="action-item-meta">
                        <span className="action-item-meeting">{item.meetingTitle}</span>
                        <span className="action-item-date">
                          {new Date(item.date).toLocaleDateString()}
                        </span>
                      </div>
                    </div>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <polyline points="9 18 15 12 9 6"></polyline>
                    </svg>
                  </div>
                ))}
              </div>
            </div>
          )}

          {recentMeetings.length > 0 && (
            <div className="insights-section">
              <h2>Recent Meetings</h2>
              <div className="recent-meetings-list">
                {recentMeetings.map(meeting => (
                  <div 
                    key={meeting._id} 
                    className="recent-meeting-card"
                    onClick={() => navigate('/meetings')}
                  >
                    <div className="recent-meeting-title">{meeting.title || 'Untitled Meeting'}</div>
                    <div className="recent-meeting-meta">
                      <span>{meeting.meetingRoom || 'No room'}</span>
                      <span>{new Date(meeting.createdAt).toLocaleDateString()}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Insights;

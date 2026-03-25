import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import TopNav from './TopNav';
import './Insights.css';

const Insights = () => {
  const navigate = useNavigate();
  const [stats, setStats] = useState(null);
  const [recentMeetings, setRecentMeetings] = useState([]);
  const [allActionItems, setAllActionItems] = useState([]);
  const [showAllTasks, setShowAllTasks] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [statsRes, meetingsRes] = await Promise.all([
        axios.get('/admin/stats').catch(() => ({ data: {} })),
        axios.get('/meetings').catch(() => ({ data: { meetings: [] } }))
      ]);
      
      setStats(statsRes.data || {});
      const meetings = meetingsRes.data.meetings || [];
      setRecentMeetings(meetings.slice(0, 5));
      
      // Extract action items from all meetings.
      // Prefer `meeting.actionItems` (our schema). Fall back to `meeting.summary.actionItems`
      // in case older data / transformations exist.
      var extracted = [];
      meetings.forEach(meeting => {
        var actionItems =
          Array.isArray(meeting?.actionItems) ? meeting.actionItems : [];
        if ((!actionItems || actionItems.length === 0) && Array.isArray(meeting?.summary?.actionItems)) {
          actionItems = meeting.summary.actionItems;
        }

        actionItems.forEach(item => {
          var normalized = item;
          if (typeof item === 'string') {
            normalized = { task: item };
          }
          extracted.push({
            ...normalized,
            meetingTitle: meeting.title,
            meetingId: meeting._id,
            // Meeting createdAt is the best "context date" if present.
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
          <div>
            <h1 className="insights-title">Insights</h1>
            <p className="insights-subtitle">
              Fast view of your meetings and the tasks we pulled out for you.
            </p>
          </div>
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
            
            <div
              className="insight-stat-card"
              onClick={() => {
                setShowAllTasks(true);
                var el = document.getElementById('insights-tasks-section');
                if (el) el.scrollIntoView({ behavior: 'smooth' });
              }}
            >
              <div className="insight-stat-icon">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                  <circle cx="9" cy="7" r="4"></circle>
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                  <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
                </svg>
              </div>
              <div className="insight-stat-value">{allActionItems.length}</div>
              <div className="insight-stat-label">Tasks</div>
            </div>
          </div>

          {allActionItems.length > 0 && (
            <div className="insights-section">
              <h2 id="insights-tasks-section">{showAllTasks ? 'All tasks' : 'Recent tasks'}</h2>
              <div className="action-items-list">
                {showAllTasks ? (
                  (() => {
                    // Group tasks by meeting
                    var byMeeting = {};
                    allActionItems.forEach(item => {
                      var key = item.meetingId || item.meetingTitle || '—';
                      if (!byMeeting[key]) {
                        byMeeting[key] = { meetingTitle: item.meetingTitle || 'Untitled Meeting', date: item.date, items: [] };
                      }
                      byMeeting[key].items.push(item);
                    });

                    var groups = Object.keys(byMeeting).map(k => byMeeting[k]);
                    groups.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

                    return groups.map((g, gi) => (
                      <div key={gi} className="tasks-meeting-group">
                        <div className="tasks-meeting-header">
                          <div className="tasks-meeting-title">{g.meetingTitle}</div>
                          {g.date ? (
                            <div className="tasks-meeting-date">{new Date(g.date).toLocaleDateString()}</div>
                          ) : null}
                        </div>

                        <div className="tasks-meeting-items">
                          {g.items.map((item, idx) => (
                            <div
                              key={item._id || `${item.meetingId}-${idx}`}
                              className="action-item-card"
                              onClick={() => navigate(`/meetings/${item.meetingId}`)}
                            >
                              <div className="action-item-content">
                                <div className="action-item-text">
                                  {typeof item === 'string' ? item : (item.task || item.title || 'Action item')}
                                </div>
                                <div className="action-item-meta">
                                  {item.assignee ? <span className="action-item-meeting">{item.assignee}</span> : null}
                                  {item.dueDate ? (
                                    <span className="action-item-date">
                                      Due {new Date(item.dueDate).toLocaleDateString()}
                                    </span>
                                  ) : null}
                                </div>
                              </div>
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                                <polyline points="9 18 15 12 9 6"></polyline>
                              </svg>
                            </div>
                          ))}
                        </div>
                      </div>
                    ));
                  })()
                ) : (
                  allActionItems.slice(0, 10).map((item, idx) => (
                    <div
                      key={item._id || idx}
                      className="action-item-card"
                      onClick={() => navigate(`/meetings/${item.meetingId}`)}
                    >
                      <div className="action-item-content">
                        <div className="action-item-text">
                          {typeof item === 'string' ? item : (item.task || item.title || 'Action item')}
                        </div>
                        <div className="action-item-meta">
                          <span className="action-item-meeting">{item.meetingTitle}</span>
                          {item.date ? (
                            <span className="action-item-date">{new Date(item.date).toLocaleDateString()}</span>
                          ) : null}
                        </div>
                      </div>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <polyline points="9 18 15 12 9 6"></polyline>
                      </svg>
                    </div>
                  ))
                )}
              </div>

              {!showAllTasks ? (
                <button
                  type="button"
                  className="btn btn--ghost"
                  style={{ marginTop: 18, width: '100%' }}
                  onClick={() => {
                    setShowAllTasks(true);
                    var el = document.getElementById('insights-tasks-section');
                    if (el) el.scrollIntoView({ behavior: 'smooth' });
                  }}
                >
                  View all tasks
                </button>
              ) : null}
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

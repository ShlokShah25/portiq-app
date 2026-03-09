import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import './ClientAdmin.css';

const ClientAdmin = () => {
  const navigate = useNavigate();
  const [meetings, setMeetings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedMeeting, setSelectedMeeting] = useState(null);
  const [expandedParticipants, setExpandedParticipants] = useState({});
  const [filters, setFilters] = useState({
    status: '',
    meetingRoom: '',
    date: ''
  });
  const [openActionMenuId, setOpenActionMenuId] = useState(null);
  const [rescheduleMeeting, setRescheduleMeeting] = useState(null);
  const [rescheduleDate, setRescheduleDate] = useState('');
  const [rescheduleTime, setRescheduleTime] = useState('');

  useEffect(() => {
    // Require admin token to view this screen
    const token = localStorage.getItem('clientAdminToken');
    if (!token) {
      navigate('/admin-login');
      return;
    }
    axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
    fetchMeetings();
  }, [filters, navigate]);

  const fetchMeetings = async () => {
    setLoading(true);
    try {
      const params = {};
      if (filters.status) params.status = filters.status;
      if (filters.meetingRoom) params.meetingRoom = filters.meetingRoom;
      if (filters.date) params.date = filters.date;

      const response = await axios.get('/admin/meetings', { params });
      setMeetings(response.data.meetings || []);
    } catch (error) {
      console.error('Error fetching meetings:', error);
      // If unauthorized, force re-login via client admin login screen
      if (error.response?.status === 401) {
        handleLogout();
      }
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('clientAdminToken');
    delete axios.defaults.headers.common['Authorization'];
    navigate('/');
  };

  const handleBackToHome = () => {
    handleLogout();
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    return date.toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getStatusBadge = (status) => {
    const colors = {
      'Scheduled': '#3B82F6',
      'In Progress': '#F59E0B',
      'Completed': '#22C55E',
      'Cancelled': '#EF4444'
    };
    return {
      backgroundColor: colors[status] || '#A1A1A6',
      color: '#F5F5F7',
      padding: '4px 10px',
      borderRadius: '6px',
      fontSize: '11px',
      fontWeight: '600',
      display: 'inline-block'
    };
  };

  const handleDownloadSummary = async (meeting) => {
    try {
      const response = await axios.get(`/admin/meetings/${meeting._id}/summary-pdf`, {
        responseType: 'blob'
      });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      const safeTitle = meeting.title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
      link.setAttribute('download', `meeting-summary-${safeTitle}-${meeting._id.slice(-6)}.pdf`);
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (error) {
      console.error('Error downloading summary:', error);
      alert('Failed to download edited summary.');
    }
  };

  const handleDownloadOriginal = async (meeting) => {
    try {
      const response = await axios.get(`/admin/meetings/${meeting._id}/original-summary`, {
        responseType: 'blob'
      });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      const safeTitle = meeting.title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
      link.setAttribute('download', `original-summary-${safeTitle}-${meeting._id.slice(-6)}.pdf`);
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (error) {
      console.error('Error downloading original summary:', error);
      alert('Failed to download original summary.');
    }
  };

  const handleDownloadAudio = async (meeting) => {
    try {
      const response = await axios.get(`/admin/meetings/${meeting._id}/audio`, {
        responseType: 'blob'
      });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      const safeTitle = meeting.title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
      link.setAttribute('download', `audio-${safeTitle}-${meeting._id.slice(-6)}`);
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (error) {
      console.error('Error downloading audio:', error);
      alert('Failed to download audio recording.');
    }
  };

  const handleRetryTranscription = async (meeting) => {
    if (!confirm('Retry transcription for this meeting?')) return;
    try {
      await axios.post(`/admin/meetings/${meeting._id}/retry-transcription`);
      alert('Transcription retry initiated. Please refresh to see updates.');
      fetchMeetings();
    } catch (error) {
      console.error('Error retrying transcription:', error);
      alert('Failed to retry transcription.');
    }
  };

  const handleReschedule = (meeting) => {
    if (meeting.scheduledTime) {
      const scheduled = new Date(meeting.scheduledTime);
      setRescheduleDate(scheduled.toISOString().split('T')[0]);
      setRescheduleTime(scheduled.toTimeString().slice(0, 5));
    } else {
      setRescheduleDate('');
      setRescheduleTime('');
    }
    setRescheduleMeeting(meeting);
  };

  const handleRescheduleSubmit = async (e) => {
    e.preventDefault();
    if (!rescheduleDate || !rescheduleTime) {
      alert('Please select both date and time.');
      return;
    }

    try {
      const scheduledTime = new Date(`${rescheduleDate}T${rescheduleTime}`);
      await axios.put(`/admin/meetings/${rescheduleMeeting._id}`, {
        scheduledTime: scheduledTime.toISOString()
      });
      alert('Meeting rescheduled successfully.');
      setRescheduleMeeting(null);
      setRescheduleDate('');
      setRescheduleTime('');
      fetchMeetings();
    } catch (error) {
      console.error('Error rescheduling meeting:', error);
      alert('Failed to reschedule meeting.');
    }
  };

  return (
    <div className="client-admin">
      <div className="client-admin-header">
        <div className="admin-header-content">
          <h1>Meeting Records</h1>
          <button className="logout-btn" onClick={handleLogout}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>
            </svg>
            Logout
          </button>
        </div>
      </div>

      <div className="client-admin-content">
        {/* Filters */}
        <div className="admin-filters">
          <select
            value={filters.status}
            onChange={(e) => setFilters({ ...filters, status: e.target.value })}
            className="filter-select"
          >
            <option value="">All Status</option>
            <option value="Scheduled">Scheduled</option>
            <option value="In Progress">In Progress</option>
            <option value="Completed">Completed</option>
            <option value="Cancelled">Cancelled</option>
          </select>

          <input
            type="text"
            placeholder="Filter by room..."
            value={filters.meetingRoom}
            onChange={(e) => setFilters({ ...filters, meetingRoom: e.target.value })}
            className="filter-input"
          />

          <input
            type="date"
            value={filters.date}
            onChange={(e) => setFilters({ ...filters, date: e.target.value })}
            className="filter-input"
          />
        </div>

        {/* Meetings Table */}
        {loading ? (
          <div className="loading-state">Loading meetings...</div>
        ) : meetings.length === 0 ? (
          <div className="empty-state">No meetings found.</div>
        ) : (
          <div className="meetings-table-container">
            <table className="meetings-table">
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Room</th>
                  <th>Organizer</th>
                  <th>Date</th>
                  <th>Status</th>
                  <th>Participants</th>
                  <th>Authorized Editor</th>
                  <th>Summary</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {meetings.map((meeting) => (
                  <tr key={meeting._id}>
                    <td>{meeting.title}</td>
                    <td>{meeting.meetingRoom || 'N/A'}</td>
                    <td>{meeting.organizer || 'N/A'}</td>
                    <td>{formatDate(meeting.startTime || meeting.scheduledTime)}</td>
                    <td>
                      <span style={getStatusBadge(meeting.status)}>
                        {meeting.status}
                      </span>
                    </td>
                    <td>
                      {meeting.participants && meeting.participants.length > 0 ? (
                        <div className="participants-cell">
                          <button
                            className="participants-toggle"
                            onClick={() => setExpandedParticipants({
                              ...expandedParticipants,
                              [meeting._id]: !expandedParticipants[meeting._id]
                            })}
                          >
                            {meeting.participants.length} participant{meeting.participants.length !== 1 ? 's' : ''}
                            <svg 
                              width="14" 
                              height="14" 
                              viewBox="0 0 24 24" 
                              fill="none" 
                              stroke="currentColor" 
                              strokeWidth="2"
                              style={{
                                transform: expandedParticipants[meeting._id] ? 'rotate(180deg)' : 'rotate(0deg)',
                                transition: 'transform 0.2s',
                                marginLeft: '6px'
                              }}
                            >
                              <polyline points="6 9 12 15 18 9"></polyline>
                            </svg>
                          </button>
                          {expandedParticipants[meeting._id] && (
                            <div className="participants-dropdown">
                              {meeting.participants.map((p, idx) => (
                                <div key={idx} className="participant-item">
                                  <div className="participant-name">{p.name || 'N/A'}</div>
                                  <div className="participant-email">{p.email || 'N/A'}</div>
                                  {p.role && <div className="participant-role">{p.role}</div>}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="no-data">None</span>
                      )}
                    </td>
                    <td>
                      {meeting.authorizedEditorEmail ? (
                        <div className="editor-info">
                          <div className="editor-email">{meeting.authorizedEditorEmail}</div>
                          {meeting.summaryStatus && (
                            <div className="editor-status">
                              Status: <span className={`status-${meeting.summaryStatus.toLowerCase().replace(' ', '-')}`}>
                                {meeting.summaryStatus}
                              </span>
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="no-data">Not set</span>
                      )}
                    </td>
                    <td>
                      {meeting.summary ? (
                        <span className="summary-badge">Available</span>
                      ) : (
                        <span className="no-summary">None</span>
                      )}
                    </td>
                    <td>
                      <div className="action-menu-container">
                        <button
                          className="action-menu-btn"
                          onClick={() => setOpenActionMenuId(
                            openActionMenuId === meeting._id ? null : meeting._id
                          )}
                        >
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <circle cx="12" cy="12" r="1"/>
                            <circle cx="12" cy="5" r="1"/>
                            <circle cx="12" cy="19" r="1"/>
                          </svg>
                        </button>
                        {openActionMenuId === meeting._id && (
                          <div className="action-menu">
                            {meeting.summary && (
                              <button onClick={() => {
                                handleDownloadSummary(meeting);
                                setOpenActionMenuId(null);
                              }}>
                                Download Summary
                              </button>
                            )}
                            {meeting.originalSummary && (
                              <button onClick={() => {
                                handleDownloadOriginal(meeting);
                                setOpenActionMenuId(null);
                              }}>
                                Download Original Summary
                              </button>
                            )}
                            {meeting.audioFile && (
                              <button onClick={() => {
                                handleDownloadAudio(meeting);
                                setOpenActionMenuId(null);
                              }}>
                                Download Audio
                              </button>
                            )}
                            {meeting.status === 'Completed' && (
                              <button onClick={() => {
                                handleRetryTranscription(meeting);
                                setOpenActionMenuId(null);
                              }}>
                                Retry Transcription
                              </button>
                            )}
                            {(meeting.status === 'Scheduled' || meeting.status === 'In Progress') && (
                              <button onClick={() => {
                                handleReschedule(meeting);
                                setOpenActionMenuId(null);
                              }}>
                                Reschedule Meeting
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Reschedule Modal */}
      {rescheduleMeeting && (
        <div className="reschedule-modal-overlay" onClick={() => setRescheduleMeeting(null)}>
          <div className="reschedule-modal" onClick={(e) => e.stopPropagation()}>
            <h2>Reschedule Meeting</h2>
            <p>{rescheduleMeeting.title}</p>
            <form onSubmit={handleRescheduleSubmit}>
              <div className="reschedule-form-group">
                <label>Date</label>
                <div className="reschedule-form-group-wrapper">
                  <svg className="reschedule-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                    <line x1="16" y1="2" x2="16" y2="6"></line>
                    <line x1="8" y1="2" x2="8" y2="6"></line>
                    <line x1="3" y1="10" x2="21" y2="10"></line>
                  </svg>
                  <input
                    type="date"
                    value={rescheduleDate}
                    onChange={(e) => setRescheduleDate(e.target.value)}
                    required
                    className="reschedule-input"
                  />
                </div>
              </div>
              <div className="reschedule-form-group">
                <label>Time</label>
                <div className="reschedule-form-group-wrapper">
                  <svg className="reschedule-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10"></circle>
                    <polyline points="12 6 12 12 16 14"></polyline>
                  </svg>
                  <input
                    type="time"
                    value={rescheduleTime}
                    onChange={(e) => setRescheduleTime(e.target.value)}
                    required
                    className="reschedule-input"
                  />
                </div>
              </div>
              <div className="reschedule-actions">
                <button type="submit" className="reschedule-submit">Reschedule</button>
                <button type="button" className="reschedule-cancel" onClick={() => {
                  setRescheduleMeeting(null);
                  setRescheduleDate('');
                  setRescheduleTime('');
                }}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default ClientAdmin;

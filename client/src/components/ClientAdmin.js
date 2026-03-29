import React, { useState, useEffect, Fragment } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import './ClientAdmin.css';

/** Stable row id for keys and toggles (handles string/ObjectId-shaped ids from JSON). */
function stableMeetingRowId(meeting, rowIndex) {
  const raw = meeting && meeting._id;
  if (raw == null || raw === '') return `meeting-row-${rowIndex}`;
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'object' && typeof raw.toString === 'function') {
    const s = raw.toString();
    if (s && s !== '[object Object]') return s;
  }
  return `meeting-row-${rowIndex}`;
}

/** Drop null/empty slots so count and popover stay in sync. */
function getParticipantRows(participants) {
  if (!Array.isArray(participants)) return [];
  return participants.filter((p) => p != null && p !== '');
}

/** Support legacy shapes: plain email string, alternate keys, empty subdocs. */
function normalizeParticipantForDisplay(p, index) {
  if (p == null) {
    return { title: `Participant ${index + 1}`, subtitle: 'No details on file', role: '' };
  }
  if (typeof p === 'string') {
    const s = p.trim();
    if (!s) return { title: `Participant ${index + 1}`, subtitle: 'No details on file', role: '' };
    if (s.includes('@')) {
      return { title: s.split('@')[0] || s, subtitle: s, role: '' };
    }
    return { title: s, subtitle: '', role: '' };
  }
  if (typeof p !== 'object') {
    return { title: `Participant ${index + 1}`, subtitle: String(p), role: '' };
  }
  const email = (p.email && String(p.email).trim()) || '';
  const name =
    (p.name && String(p.name).trim()) ||
    (p.displayName && String(p.displayName).trim()) ||
    (p.fullName && String(p.fullName).trim()) ||
    '';
  const role = (p.role && String(p.role).trim()) || '';
  const title =
    name || (email ? email.split('@')[0] : '') || `Participant ${index + 1}`;
  let subtitle = '';
  if (email) subtitle = email;
  else if (!name) subtitle = 'No email on file';
  return { title, subtitle, role };
}

/** Rough count for positioning the ⋮ menu so it can flip above the anchor when needed. */
function countActionMenuItems(meeting) {
  if (!meeting) return 2;
  let n = 2; // View meeting + Open summary (always)
  if (meeting.status === 'In Progress') n += 1; // Open meeting room
  if (meeting.summary || meeting.pendingSummary) n += 1;
  if (meeting.originalSummary) n += 1;
  if (meeting.audioFile) n += 1;
  if (meeting.status === 'Completed') n += 1;
  if (meeting.status === 'Scheduled' || meeting.status === 'In Progress') n += 1;
  return n;
}

function computeActionMenuPosition(anchorRect, itemCount) {
  const gap = 8;
  const vh = window.innerHeight;
  const perItem = 48;
  const chrome = 20;
  const estHeight = Math.min(chrome + itemCount * perItem, Math.floor(vh * 0.55));
  let top = anchorRect.bottom + gap;
  if (top + estHeight > vh - gap) {
    top = anchorRect.top - estHeight - gap;
  }
  top = Math.max(gap, Math.min(top, vh - Math.min(estHeight, vh - 2 * gap) - gap));
  const right = window.innerWidth - anchorRect.right;
  return { top, right, maxHeight: Math.min(420, vh - 2 * gap) };
}

const ClientAdmin = () => {
  const navigate = useNavigate();
  const [meetings, setMeetings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedMeeting, setSelectedMeeting] = useState(null);
  /** Inline expand row under the meeting (avoids broken fixed popovers in scroll/layout contexts). */
  const [participantsExpandedMeetingId, setParticipantsExpandedMeetingId] = useState(null);
  const [filters, setFilters] = useState({
    status: '',
    meetingRoom: '',
    date: ''
  });
  /** Full meeting doc + anchor — avoids find() missing rows when _id shapes differ */
  const [actionMenu, setActionMenu] = useState(null);
  const [rescheduleMeeting, setRescheduleMeeting] = useState(null);
  const [rescheduleDate, setRescheduleDate] = useState('');
  const [rescheduleTime, setRescheduleTime] = useState('');

  useEffect(() => {
    const token = localStorage.getItem('clientAdminToken');
    if (!token) {
      navigate('/');
      return;
    }
    axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
    fetchMeetings();
    // Primitives only — avoid re-fetching on every render if `filters` object identity churns.
  }, [filters.status, filters.meetingRoom, filters.date, navigate]);

  useEffect(() => {
    if (!actionMenu) return undefined;
    const close = () => setActionMenu(null);
    /** Bubble-phase click after mount — avoids capture mousedown firing before the ⋮ click handler runs (Safari / touch). */
    const onDocClick = (e) => {
      const el = e.target;
      if (!(el instanceof Element)) return;
      if (el.closest('.client-admin-action-menu') || el.closest('.action-menu-btn')) return;
      close();
    };
    const attachTimer = window.setTimeout(() => {
      document.addEventListener('click', onDocClick, false);
    }, 0);
    const onResize = () => close();
    window.addEventListener('resize', onResize);
    return () => {
      window.clearTimeout(attachTimer);
      document.removeEventListener('click', onDocClick, false);
      window.removeEventListener('resize', onResize);
    };
  }, [actionMenu]);

  const fetchMeetings = async () => {
    setLoading(true);
    setParticipantsExpandedMeetingId(null);
    try {
      const params = {};
      if (filters.status) params.status = filters.status;
      if (filters.meetingRoom) params.meetingRoom = filters.meetingRoom;
      if (filters.date) params.date = filters.date;

      const response = await axios.get('/admin/meetings', { params });
      setMeetings(response.data.meetings || []);
    } catch (error) {
      console.error('Error fetching meetings:', error);
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
    navigate('/dashboard');
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
      const url = window.URL.createObjectURL(new Blob([response.data], { type: 'application/pdf' }));
      const link = document.createElement('a');
      link.href = url;
      const safeTitle = meeting.title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
      link.setAttribute('download', `meeting-summary-${safeTitle}-${meeting._id.slice(-6)}.pdf`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error downloading summary:', error);
      alert('Failed to download summary PDF.');
    }
  };

  const handleDownloadOriginal = async (meeting) => {
    try {
      const response = await axios.get(`/admin/meetings/${meeting._id}/original-summary`, {
        responseType: 'blob'
      });
      const pdfBlob = new Blob([response.data], { type: 'application/pdf' });
      const url = window.URL.createObjectURL(pdfBlob);
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
      const msg =
        error.response?.data?.error ||
        error.response?.data?.message ||
        error.message ||
        'Failed to retry transcription.';
      alert(msg);
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

  const closeActionMenu = () => setActionMenu(null);

  return (
    <div className="client-admin">
      <div className="client-admin-header">
        <div className="admin-header-content">
          <h1>Meeting Records</h1>
          <div className="admin-header-actions">
            <button className="back-btn" onClick={handleBackToHome}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="15 18 9 12 15 6" />
                <line x1="9" y1="12" x2="21" y2="12" />
              </svg>
              Back to dashboard
            </button>
            <button className="logout-btn" onClick={handleLogout}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>
              </svg>
              Logout
            </button>
          </div>
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
                {meetings.map((meeting, rowIndex) => {
                  const rowId = stableMeetingRowId(meeting, rowIndex);
                  const participantRows = getParticipantRows(meeting.participants);
                  const participantsExpanded = participantsExpandedMeetingId === rowId;
                  return (
                    <Fragment key={rowId}>
                      <tr>
                        <td>{meeting.title}</td>
                        <td>{meeting.meetingRoom || 'N/A'}</td>
                        <td>{meeting.organizer || 'N/A'}</td>
                        <td>{formatDate(meeting.startTime || meeting.scheduledTime)}</td>
                        <td>
                          <span style={getStatusBadge(meeting.status)}>{meeting.status}</span>
                        </td>
                        <td>
                          {participantRows.length > 0 ? (
                            <div className="participants-cell">
                              <button
                                type="button"
                                className="participants-toggle"
                                aria-expanded={participantsExpanded}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (participantsExpanded) {
                                    setParticipantsExpandedMeetingId(null);
                                  } else {
                                    closeActionMenu();
                                    setParticipantsExpandedMeetingId(rowId);
                                  }
                                }}
                              >
                                {participantRows.length} participant
                                {participantRows.length !== 1 ? 's' : ''}
                                <svg
                                  width="14"
                                  height="14"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                  style={{
                                    transform: participantsExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                                    transition: 'transform 0.2s',
                                    marginLeft: '6px',
                                  }}
                                >
                                  <polyline points="6 9 12 15 18 9" />
                                </svg>
                              </button>
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
                                  Status:{' '}
                                  <span
                                    className={`status-${meeting.summaryStatus
                                      .toLowerCase()
                                      .replace(' ', '-')}`}
                                  >
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
                          {meeting.summary || meeting.pendingSummary ? (
                            <span className="summary-badge">Summary Ready</span>
                          ) : (
                            <span className="no-summary">None</span>
                          )}
                        </td>
                        <td>
                          <div className="action-menu-container">
                            <button
                              type="button"
                              className="action-menu-btn"
                              aria-expanded={!!actionMenu && actionMenu.rowId === rowId}
                              aria-haspopup="menu"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (actionMenu && actionMenu.rowId === rowId) {
                                  setActionMenu(null);
                                } else {
                                  setParticipantsExpandedMeetingId(null);
                                  const r = e.currentTarget.getBoundingClientRect();
                                  setActionMenu({
                                    rowId,
                                    meeting,
                                    ...computeActionMenuPosition(r, countActionMenuItems(meeting)),
                                  });
                                }
                              }}
                            >
                              <svg
                                width="20"
                                height="20"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                              >
                                <circle cx="12" cy="12" r="1" />
                                <circle cx="12" cy="5" r="1" />
                                <circle cx="12" cy="19" r="1" />
                              </svg>
                            </button>
                          </div>
                        </td>
                      </tr>
                      {participantRows.length > 0 && participantsExpanded && (
                        <tr className="participants-inline-row" aria-live="polite">
                          <td colSpan={9}>
                            <div
                              className="participants-inline-panel"
                              role="region"
                              aria-label={`Participants for ${meeting.title || 'meeting'}`}
                            >
                              {participantRows.map((p, idx) => {
                                const row = normalizeParticipantForDisplay(p, idx);
                                return (
                                  <div key={idx} className="participant-item participant-item--inline">
                                    <div className="participant-name">{row.title}</div>
                                    {row.subtitle ? (
                                      <div className="participant-email">{row.subtitle}</div>
                                    ) : null}
                                    {row.role ? (
                                      <div className="participant-role">{row.role}</div>
                                    ) : null}
                                  </div>
                                );
                              })}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {actionMenu &&
        createPortal(
          <div
            className="action-menu client-admin-action-menu"
            role="menu"
            onMouseDown={(e) => e.stopPropagation()}
            style={{
              position: 'fixed',
              top: actionMenu.top,
              right: actionMenu.right,
              maxHeight: actionMenu.maxHeight,
              overflowY: 'auto',
              zIndex: 50000,
              marginTop: 0,
            }}
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                navigate(`/meetings/${actionMenu.meeting._id}`);
                closeActionMenu();
              }}
            >
              View meeting
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                navigate(`/meetings/${actionMenu.meeting._id}/summary`);
                closeActionMenu();
              }}
            >
              Open summary page
            </button>
            {actionMenu.meeting.status === 'In Progress' && (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  navigate(`/meetings/${actionMenu.meeting._id}/room`);
                  closeActionMenu();
                }}
              >
                Open meeting room
              </button>
            )}
            {(actionMenu.meeting.summary || actionMenu.meeting.pendingSummary) && (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  handleDownloadSummary(actionMenu.meeting);
                  closeActionMenu();
                }}
              >
                Download Summary (PDF)
              </button>
            )}
            {actionMenu.meeting.originalSummary && (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  handleDownloadOriginal(actionMenu.meeting);
                  closeActionMenu();
                }}
              >
                Download Original Summary
              </button>
            )}
            {actionMenu.meeting.audioFile && (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  handleDownloadAudio(actionMenu.meeting);
                  closeActionMenu();
                }}
              >
                Download Audio
              </button>
            )}
            {actionMenu.meeting.status === 'Completed' && (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  handleRetryTranscription(actionMenu.meeting);
                  closeActionMenu();
                }}
              >
                Retry Transcription
              </button>
            )}
            {(actionMenu.meeting.status === 'Scheduled' || actionMenu.meeting.status === 'In Progress') && (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  handleReschedule(actionMenu.meeting);
                  closeActionMenu();
                }}
              >
                Reschedule Meeting
              </button>
            )}
          </div>,
          document.body
        )}

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

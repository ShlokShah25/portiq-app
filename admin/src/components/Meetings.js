import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import axios from 'axios';
import './Meetings.css';

function countAdminActionMenuItems(m) {
  if (!m) return 1;
  let n = 1; // Edit details
  if (m.summary || m.pendingSummary) {
    n += 1;
    if (m.summary && m.originalSummary) n += 1;
  }
  if (m.audioFile) n += 1;
  if (m.audioFile && (m.transcriptionStatus === 'Failed' || m.status === 'Completed')) n += 1;
  return n;
}

function computeAdminActionMenuPosition(anchorRect, itemCount) {
  const gap = 8;
  const vh = window.innerHeight;
  const perItem = 48;
  const chrome = 16;
  const estHeight = Math.min(chrome + itemCount * perItem, Math.floor(vh * 0.55));
  let top = anchorRect.bottom + gap;
  if (top + estHeight > vh - gap) {
    top = anchorRect.top - estHeight - gap;
  }
  top = Math.max(gap, Math.min(top, vh - Math.min(estHeight, vh - 2 * gap) - gap));
  const right = window.innerWidth - anchorRect.right;
  return { top, right, maxHeight: Math.min(420, vh - 2 * gap) };
}

const Meetings = () => {
  const [meetings, setMeetings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedMeeting, setSelectedMeeting] = useState(null);
  const [editingMeeting, setEditingMeeting] = useState(null);
  const [editForm, setEditForm] = useState({ title: '', meetingRoom: '', organizer: '' });
  const [filters, setFilters] = useState({
    status: '',
    meetingRoom: '',
    date: ''
  });
  /** Snapshot meeting + geometry so the menu never disappears when find() fails on _id shape. */
  const [actionMenuAnchor, setActionMenuAnchor] = useState(null);

  useEffect(() => {
    fetchMeetings();
  }, [filters]);

  useEffect(() => {
    if (!actionMenuAnchor) return undefined;
    const close = () => setActionMenuAnchor(null);
    const onPointerDown = (e) => {
      if (e.target.closest?.('.admin-meetings-action-menu') || e.target.closest?.('.admin-meetings-action-trigger')) {
        return;
      }
      close();
    };
    const attachTimer = window.setTimeout(() => {
      window.addEventListener('resize', close);
      document.addEventListener('pointerdown', onPointerDown, true);
    }, 150);
    return () => {
      window.clearTimeout(attachTimer);
      window.removeEventListener('resize', close);
      document.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [actionMenuAnchor]);

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
    } finally {
      setLoading(false);
    }
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
      'Scheduled': '#3498db',
      'In Progress': '#f39c12',
      'Completed': '#27ae60',
      'Cancelled': '#e74c3c'
    };
    return {
      backgroundColor: colors[status] || '#95a5a6',
      color: 'white',
      padding: '4px 12px',
      borderRadius: '12px',
      fontSize: '12px',
      fontWeight: '600'
    };
  };

  const handleDownloadAllSummaries = () => {
    const meetingsWithSummaries = meetings.filter(m => m.summary);
    if (meetingsWithSummaries.length === 0) {
      alert('No meeting summaries available to download.');
      return;
    }

    let content = 'MEETING SUMMARIES REPORT\n';
    content += '='.repeat(80) + '\n\n';
    content += `Generated: ${new Date().toLocaleString()}\n`;
    content += `Total Summaries: ${meetingsWithSummaries.length}\n\n`;
    content += '='.repeat(80) + '\n\n';

    meetingsWithSummaries.forEach((meeting, index) => {
      content += formatMeetingSummary(meeting, index + 1);
    });

    downloadFile(content, `meeting-summaries-${new Date().toISOString().split('T')[0]}.txt`);
  };

  const handleDownloadIndividualSummary = (meeting) => {
    const body = meeting.summary || meeting.pendingSummary;
    if (!body) {
      alert('This meeting has no summary available.');
      return;
    }
    const content = formatMeetingSummary({ ...meeting, summary: body }, 1);
    const safeTitle = meeting.title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const idTail = String(meeting._id || '').slice(-6);
    downloadFile(content, `meeting-summary-${safeTitle}-${idTail}.txt`);
  };

  const formatMeetingSummary = (meeting, index) => {
    let content = '';
    if (index > 0) {
      content += `MEETING ${index}\n`;
      content += '-'.repeat(80) + '\n';
    }
    content += `Title: ${meeting.title}\n`;
    content += `Room: ${meeting.meetingRoom}\n`;
    content += `Organizer: ${meeting.organizer}\n`;
    content += `Start Time: ${formatDate(meeting.startTime)}\n`;
    content += `End Time: ${formatDate(meeting.endTime)}\n`;
    content += `Status: ${meeting.status}\n`;
    if (meeting.participants && meeting.participants.length > 0) {
      content += `Participants:\n`;
      meeting.participants.forEach(p => {
        content += `  - ${p.name || 'N/A'} (${p.email || 'No email'})\n`;
      });
    }
    content += '\n';
    content += 'SUMMARY\n';
    content += '-'.repeat(80) + '\n';
    content += `${meeting.summary}\n\n`;
    
    if (meeting.keyPoints && meeting.keyPoints.length > 0) {
      content += 'KEY POINTS:\n';
      meeting.keyPoints.forEach(point => {
        content += `  • ${point}\n`;
      });
      content += '\n';
    }
    
    if (meeting.actionItems && meeting.actionItems.length > 0) {
      content += 'ACTION ITEMS:\n';
      meeting.actionItems.forEach(item => {
        content += `  • ${item.task || item}`;
        if (item.assignee) content += ` (Assigned to: ${item.assignee})`;
        if (item.dueDate) content += ` (Due: ${new Date(item.dueDate).toLocaleDateString()})`;
        content += '\n';
      });
      content += '\n';
    }
    
    if (meeting.decisions && meeting.decisions.length > 0) {
      content += 'DECISIONS:\n';
      meeting.decisions.forEach(decision => {
        content += `  • ${decision}\n`;
      });
      content += '\n';
    }
    
    if (meeting.nextSteps && meeting.nextSteps.length > 0) {
      content += 'NEXT STEPS:\n';
      meeting.nextSteps.forEach(step => {
        content += `  • ${step}\n`;
      });
      content += '\n';
    }
    
    if (index > 0) {
      content += '\n' + '='.repeat(80) + '\n\n';
    }
    return content;
  };

  const downloadFile = (content, filename) => {
    const blob = new Blob([content], { type: 'text/plain' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  };

  const handleEditMeeting = (meeting) => {
    setEditingMeeting(meeting._id);
    setEditForm({
      title: meeting.title,
      meetingRoom: meeting.meetingRoom,
      organizer: meeting.organizer
    });
  };

  const handleSaveEdit = async () => {
    if (!editingMeeting) return;
    
    try {
      const response = await axios.put(`/admin/meetings/${editingMeeting}`, editForm);
      setMeetings(prev => prev.map(m => 
        m._id === editingMeeting ? response.data.meeting : m
      ));
      setEditingMeeting(null);
      setEditForm({ title: '', meetingRoom: '', organizer: '' });
      alert('Meeting updated successfully!');
    } catch (error) {
      alert('Error updating meeting: ' + (error.response?.data?.error || error.message));
    }
  };

  const handleCancelEdit = () => {
    setEditingMeeting(null);
    setEditForm({ title: '', meetingRoom: '', organizer: '' });
  };

  const closeAdminActionMenu = () => setActionMenuAnchor(null);

  return (
    <div className="admin-container">
      <div className="sidebar">
        <h2>Admin Panel</h2>
        <nav>
          <ul>
            <li><Link to="/dashboard">Dashboard</Link></li>
            <li><Link to="/meetings" className="active">Meetings</Link></li>
            <li><Link to="/visitors">Visitors</Link></li>
            <li><Link to="/config">Configuration</Link></li>
          </ul>
        </nav>
      </div>
      <div className="main-content">
        <div className="content-header">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h1>All Meetings</h1>
              <p style={{ color: '#666', marginTop: '10px' }}>
                View and manage all meeting records (including completed meetings beyond display window)
              </p>
            </div>
            <button 
              className="btn btn-primary" 
              onClick={handleDownloadAllSummaries}
              disabled={meetings.filter(m => m.summary).length === 0}
            >
              Download All Summaries
            </button>
          </div>
        </div>

        <div className="card">
          <h2>Filters</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '15px' }}>
            <div className="form-group">
              <label>Status</label>
              <select
                value={filters.status}
                onChange={(e) => setFilters({ ...filters, status: e.target.value })}
              >
                <option value="">All Statuses</option>
                <option value="Scheduled">Scheduled</option>
                <option value="In Progress">In Progress</option>
                <option value="Completed">Completed</option>
                <option value="Cancelled">Cancelled</option>
              </select>
            </div>
            <div className="form-group">
              <label>Meeting Room</label>
              <input
                type="text"
                value={filters.meetingRoom}
                onChange={(e) => setFilters({ ...filters, meetingRoom: e.target.value })}
                placeholder="Filter by room"
              />
            </div>
            <div className="form-group">
              <label>Date</label>
              <input
                type="date"
                value={filters.date}
                onChange={(e) => setFilters({ ...filters, date: e.target.value })}
              />
            </div>
          </div>
        </div>

        {loading ? (
          <div className="card">
            <div style={{ textAlign: 'center', padding: '40px' }}>Loading meetings...</div>
          </div>
        ) : (
          <div className="card">
            <h2>Meetings ({meetings.length})</h2>
            {meetings.length === 0 ? (
              <p style={{ color: '#666', padding: '20px' }}>No meetings found.</p>
            ) : (
              <div className="table-container">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Title</th>
                      <th>Room</th>
                      <th>Organizer</th>
                      <th>Start Time</th>
                      <th>End Time</th>
                      <th>Status</th>
                      <th>Participants</th>
                      <th>Summary</th>
                      <th>Kiosk</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {meetings.map(meeting => (
                      <tr key={meeting._id}>
                        {editingMeeting === meeting._id ? (
                          <>
                            <td>
                              <input
                                type="text"
                                value={editForm.title}
                                onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
                                style={{ width: '100%', padding: '6px', border: '1px solid #ddd', borderRadius: '4px' }}
                                onClick={(e) => e.stopPropagation()}
                              />
                            </td>
                            <td>
                              <input
                                type="text"
                                value={editForm.meetingRoom}
                                onChange={(e) => setEditForm({ ...editForm, meetingRoom: e.target.value })}
                                style={{ width: '100%', padding: '6px', border: '1px solid #ddd', borderRadius: '4px' }}
                                onClick={(e) => e.stopPropagation()}
                              />
                            </td>
                            <td>
                              <input
                                type="text"
                                value={editForm.organizer}
                                onChange={(e) => setEditForm({ ...editForm, organizer: e.target.value })}
                                style={{ width: '100%', padding: '6px', border: '1px solid #ddd', borderRadius: '4px' }}
                                onClick={(e) => e.stopPropagation()}
                              />
                            </td>
                            <td>{formatDate(meeting.startTime)}</td>
                            <td>{formatDate(meeting.endTime)}</td>
                            <td>
                              <span style={getStatusBadge(meeting.status)}>
                                {meeting.status}
                              </span>
                            </td>
                            <td>{meeting.participants?.length || 0}</td>
                            <td>
                              {meeting.summary ? (
                                <span style={{ color: '#27ae60' }}>✓ Available</span>
                              ) : (
                                <span style={{ color: '#999' }}>—</span>
                              )}
                            </td>
                            <td>
                              <span>{meeting.showOnKiosk === false ? 'Hidden' : 'Shown'}</span>
                            </td>
                            <td>
                              <button
                                className="btn btn-primary"
                                style={{ padding: '6px 12px', fontSize: '12px', marginRight: '5px' }}
                                onClick={(e) => { e.stopPropagation(); handleSaveEdit(); }}
                              >
                                Save
                              </button>
                              <button
                                className="btn btn-secondary"
                                style={{ padding: '6px 12px', fontSize: '12px' }}
                                onClick={(e) => { e.stopPropagation(); handleCancelEdit(); }}
                              >
                                Cancel
                              </button>
                            </td>
                          </>
                        ) : (
                          <>
                            <td onClick={() => setSelectedMeeting(meeting)} style={{ cursor: 'pointer' }}>
                              <strong>{meeting.title}</strong>
                            </td>
                            <td onClick={() => setSelectedMeeting(meeting)} style={{ cursor: 'pointer' }}>
                              {meeting.meetingRoom}
                            </td>
                            <td onClick={() => setSelectedMeeting(meeting)} style={{ cursor: 'pointer' }}>
                              {meeting.organizer}
                            </td>
                            <td onClick={() => setSelectedMeeting(meeting)} style={{ cursor: 'pointer' }}>
                              {formatDate(meeting.startTime)}
                            </td>
                            <td onClick={() => setSelectedMeeting(meeting)} style={{ cursor: 'pointer' }}>
                              {formatDate(meeting.endTime)}
                            </td>
                            <td onClick={() => setSelectedMeeting(meeting)} style={{ cursor: 'pointer' }}>
                              <span style={getStatusBadge(meeting.status)}>
                                {meeting.status}
                              </span>
                            </td>
                            <td onClick={() => setSelectedMeeting(meeting)} style={{ cursor: 'pointer' }}>
                              {meeting.participants?.length || 0}
                            </td>
                            <td onClick={() => setSelectedMeeting(meeting)} style={{ cursor: 'pointer' }}>
                              {meeting.summary ? (
                                <span style={{ color: '#27ae60' }}>✓ Available</span>
                              ) : (
                                <span style={{ color: '#999' }}>—</span>
                              )}
                            </td>
                            <td onClick={e => e.stopPropagation()}>
                              <label style={{ fontSize: '12px', display: 'inline-flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}>
                                <input
                                  type="checkbox"
                                  checked={meeting.showOnKiosk !== false}
                                  onChange={async (e) => {
                                    const value = e.target.checked;
                                    try {
                                      const response = await axios.put(`/admin/meetings/${meeting._id}`, {
                                        showOnKiosk: value
                                      });
                                      const updated = response.data.meeting;
                                      setMeetings(prev => prev.map(m => m._id === updated._id ? updated : m));
                                    } catch (error) {
                                      alert('Error updating kiosk visibility: ' + (error.response?.data?.error || error.message));
                                    }
                                  }}
                                />
                                <span>{meeting.showOnKiosk === false ? 'Hidden' : 'Shown'}</span>
                              </label>
                            </td>
                            <td>
                              <button
                                type="button"
                                className="btn btn-secondary admin-meetings-action-trigger"
                                style={{ padding: '4px 8px', fontSize: '16px', lineHeight: '1' }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const id = String(meeting._id);
                                  if (
                                    actionMenuAnchor &&
                                    String(actionMenuAnchor.meeting._id) === id
                                  ) {
                                    setActionMenuAnchor(null);
                                  } else {
                                    const r = e.currentTarget.getBoundingClientRect();
                                    setActionMenuAnchor({
                                      meeting,
                                      ...computeAdminActionMenuPosition(
                                        r,
                                        countAdminActionMenuItems(meeting)
                                      ),
                                    });
                                  }
                                }}
                                title="Actions"
                                aria-expanded={
                                  !!actionMenuAnchor &&
                                  String(actionMenuAnchor.meeting._id) === String(meeting._id)
                                }
                              >
                                ⋮
                              </button>
                            </td>
                          </>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {selectedMeeting && (
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h2>Meeting Details</h2>
              <button className="btn btn-secondary" onClick={() => setSelectedMeeting(null)}>Close</button>
            </div>
            <div style={{ lineHeight: '2' }}>
              <p><strong>Title:</strong> {selectedMeeting.title}</p>
              <p><strong>Room:</strong> {selectedMeeting.meetingRoom}</p>
              <p><strong>Organizer:</strong> {selectedMeeting.organizer}</p>
              <p><strong>Start:</strong> {formatDate(selectedMeeting.startTime)}</p>
              <p><strong>End:</strong> {formatDate(selectedMeeting.endTime)}</p>
              <p><strong>Status:</strong> <span style={getStatusBadge(selectedMeeting.status)}>{selectedMeeting.status}</span></p>
              <p><strong>Participants:</strong></p>
              <ul style={{ marginLeft: '20px', marginTop: '10px' }}>
                {selectedMeeting.participants?.map((p, idx) => (
                  <li key={idx}>{p.name || 'N/A'} ({p.email || 'No email'})</li>
                ))}
              </ul>
              {selectedMeeting.summary && (
                <>
                  <p><strong>Summary:</strong></p>
                  <div style={{ background: '#f8f9fa', padding: '15px', borderRadius: '8px', marginTop: '10px' }}>
                    <p>{selectedMeeting.summary}</p>
                    {selectedMeeting.keyPoints && selectedMeeting.keyPoints.length > 0 && (
                      <>
                        <p style={{ marginTop: '15px', fontWeight: '600' }}>Key Points:</p>
                        <ul style={{ marginLeft: '20px' }}>
                          {selectedMeeting.keyPoints.map((point, idx) => (
                            <li key={idx}>{point}</li>
                          ))}
                        </ul>
                      </>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {actionMenuAnchor &&
        createPortal(
          <div
            className="admin-meetings-action-menu"
            role="menu"
            onMouseDown={(e) => e.stopPropagation()}
            style={{
              position: 'fixed',
              top: actionMenuAnchor.top,
              right: actionMenuAnchor.right,
              maxHeight: actionMenuAnchor.maxHeight,
              overflowY: 'auto',
              zIndex: 10050,
              minWidth: '200px',
              background: '#ffffff',
              border: '1px solid #e5e7eb',
              borderRadius: '8px',
              boxShadow: '0 12px 28px rgba(0,0,0,0.12)',
              padding: '6px 0',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              style={{
                width: '100%',
                padding: '10px 14px',
                border: 'none',
                background: 'transparent',
                textAlign: 'left',
                fontSize: '13px',
                cursor: 'pointer',
              }}
              onClick={() => {
                closeAdminActionMenu();
                handleEditMeeting(actionMenuAnchor.meeting);
              }}
            >
              Edit details
            </button>
            {(actionMenuAnchor.meeting.summary || actionMenuAnchor.meeting.pendingSummary) && (
              <>
                <button
                  type="button"
                  style={{
                    width: '100%',
                    padding: '10px 14px',
                    border: 'none',
                    borderTop: '1px solid #f3f4f6',
                    background: 'transparent',
                    textAlign: 'left',
                    fontSize: '13px',
                    cursor: 'pointer',
                  }}
                  onClick={() => {
                    closeAdminActionMenu();
                    handleDownloadIndividualSummary(actionMenuAnchor.meeting);
                  }}
                >
                  {actionMenuAnchor.meeting.summary
                    ? 'Download summary (final)'
                    : 'Download summary (pending)'}
                </button>
                {actionMenuAnchor.meeting.summary && actionMenuAnchor.meeting.originalSummary && (
                  <button
                    type="button"
                    style={{
                      width: '100%',
                      padding: '10px 14px',
                      border: 'none',
                      borderTop: '1px solid #f3f4f6',
                      background: 'transparent',
                      textAlign: 'left',
                      fontSize: '13px',
                      cursor: 'pointer',
                      color: '#dc2626',
                    }}
                    onClick={() => {
                      closeAdminActionMenu();
                      window.open(
                        `/admin/meetings/${actionMenuAnchor.meeting._id}/original-summary`,
                        '_blank'
                      );
                    }}
                  >
                    Download original summary
                  </button>
                )}
              </>
            )}
            {actionMenuAnchor.meeting.audioFile && (
              <button
                type="button"
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  border: 'none',
                  borderTop: '1px solid #f3f4f6',
                  background: 'transparent',
                  textAlign: 'left',
                  fontSize: '13px',
                  cursor: 'pointer',
                  color: '#2563eb',
                }}
                onClick={() => {
                  closeAdminActionMenu();
                  window.open(`/admin/meetings/${actionMenuAnchor.meeting._id}/audio`, '_blank');
                }}
              >
                Download audio recording
              </button>
            )}
            {actionMenuAnchor.meeting.audioFile &&
              (actionMenuAnchor.meeting.transcriptionStatus === 'Failed' ||
                actionMenuAnchor.meeting.status === 'Completed') && (
                <button
                  type="button"
                  style={{
                    width: '100%',
                    padding: '10px 14px',
                    border: 'none',
                    borderTop: '1px solid #f3f4f6',
                    background: 'transparent',
                    textAlign: 'left',
                    fontSize: '13px',
                    cursor: 'pointer',
                    color: '#2563eb',
                  }}
                  onClick={async () => {
                    closeAdminActionMenu();
                    if (window.confirm('Retry transcription for this meeting?')) {
                      try {
                        await axios.post(
                          `/admin/meetings/${actionMenuAnchor.meeting._id}/retry-transcription`
                        );
                        alert('Transcription retry started. Please refresh the page in a few moments.');
                        fetchMeetings();
                      } catch (error) {
                        alert('Error: ' + (error.response?.data?.error || error.message));
                      }
                    }
                  }}
                >
                  Retry transcription
                </button>
              )}
          </div>,
          document.body
        )}
    </div>
  );
};

export default Meetings;

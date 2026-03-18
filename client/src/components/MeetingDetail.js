import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import axios from 'axios';
import TopNav from './TopNav';
import { T } from '../config/terminology';
import './MeetingDetail.css';

function toGoogleDateTimeUtc(d) {
  // YYYYMMDDTHHMMSSZ
  const iso = new Date(d).toISOString(); // always UTC
  return iso.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function buildGoogleCalendarUrlTimed({ title, details, location, startDate, endDate }) {
  if (!startDate || !endDate) return null;
  const start = toGoogleDateTimeUtc(startDate);
  const end = toGoogleDateTimeUtc(endDate);
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: title || 'Meeting',
    details: details || '',
    location: location || '',
    dates: `${start}/${end}`,
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

function buildOutlookCalendarUrlTimed({ title, details, location, startDate, endDate }) {
  if (!startDate || !endDate) return null;
  const startdt = new Date(startDate).toISOString();
  const enddt = new Date(endDate).toISOString();
  const params = new URLSearchParams({
    path: '/calendar/action/compose',
    subject: title || 'Meeting',
    body: details || '',
    location: location || '',
    startdt,
    enddt,
  });
  return `https://outlook.office.com/calendar/0/deeplink/compose?${params.toString()}`;
}

function buildMeetingIcs({ title, description, location, startDate, endDate }) {
  if (!startDate || !endDate) return null;
  const uid = `${Date.now()}-${Math.random().toString(16).slice(2)}@portiq`;
  const dtStamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const toUtc = (d) => new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');

  const esc = (s) =>
    String(s || '')
      .replace(/\\/g, '\\\\')
      .replace(/\n/g, '\\n')
      .replace(/,/g, '\\,')
      .replace(/;/g, '\\;');

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//PortIQ//Meeting Assistant//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${dtStamp}`,
    `DTSTART:${toUtc(startDate)}`,
    `DTEND:${toUtc(endDate)}`,
    `SUMMARY:${esc(title || 'Meeting')}`,
    location ? `LOCATION:${esc(location)}` : null,
    description ? `DESCRIPTION:${esc(description)}` : null,
    'END:VEVENT',
    'END:VCALENDAR',
  ]
    .filter(Boolean)
    .join('\r\n');
}

const MeetingDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [meeting, setMeeting] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchMeeting = async () => {
    if (!id) return;
    try {
      const res = await axios.get(`/meetings/${id}`);
      setMeeting(res.data.meeting);
      setError('');
    } catch (err) {
      setError(err.response?.data?.error || 'Meeting not found');
      setMeeting(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMeeting();
    const interval = setInterval(fetchMeeting, 10000);
    return () => clearInterval(interval);
  }, [id]);

  const formatDate = (dateString) => {
    if (!dateString) return '—';
    return new Date(dateString).toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  };

  const formatTime = (dateString) => {
    if (!dateString) return '—';
    return new Date(dateString).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });
  };

  const handleStartMeeting = () => {
    // Meeting only "starts" when user clicks Start recording in the room
    navigate(`/meetings/${id}/room`);
  };

  if (loading) {
    return (
      <div className="meeting-detail-screen">
        <TopNav />
        <div className="meeting-detail-loading">
          <div className="loading-spinner" />
          <p>Loading meeting...</p>
        </div>
      </div>
    );
  }

  if (error && !meeting) {
    return (
      <div className="meeting-detail-screen">
        <TopNav />
        <div className="meeting-detail-container">
          <div className="meeting-detail-error">{error}</div>
        </div>
      </div>
    );
  }

  if (!meeting) {
    return null;
  }

  const isScheduled = meeting.status === 'Scheduled';
  const isInProgress = meeting.status === 'In Progress';
  const isCompleted = meeting.status === 'Completed';
  const hasSummary = meeting.transcriptionStatus === 'Completed' && (meeting.summary || meeting.pendingSummary);
  const pendingApproval = meeting.summaryStatus === 'Pending Approval' && hasSummary;

  const meetingStart = meeting.scheduledTime || meeting.startTime;
  const scheduledStartDate = meetingStart ? new Date(meetingStart) : null;
  const scheduledEndDate =
    scheduledStartDate && !Number.isNaN(scheduledStartDate.getTime())
      ? new Date(scheduledStartDate.getTime() + 60 * 60 * 1000) // default 60min calendar block
      : null;

  const participantLines = (meeting.participants || [])
    .map((p) => (p?.email ? `${p.name || p.email} (${p.email})` : (p?.name || '')))
    .filter(Boolean);

  const calendarDetails = [
    meeting.organizer ? `Organizer: ${meeting.organizer}` : null,
    participantLines.length ? `Participants:\n${participantLines.map((x) => `- ${x}`).join('\n')}` : null,
    'Created via PortIQ Meeting Assistant.',
  ]
    .filter(Boolean)
    .join('\n\n');

  const calendarTitle = meeting.title || 'Meeting';
  const calendarLocation = meeting.meetingRoom || '';

  const gcalUrl =
    scheduledStartDate && scheduledEndDate
      ? buildGoogleCalendarUrlTimed({
          title: calendarTitle,
          details: calendarDetails,
          location: calendarLocation,
          startDate: scheduledStartDate,
          endDate: scheduledEndDate,
        })
      : null;

  const outlookUrl =
    scheduledStartDate && scheduledEndDate
      ? buildOutlookCalendarUrlTimed({
          title: calendarTitle,
          details: calendarDetails,
          location: calendarLocation,
          startDate: scheduledStartDate,
          endDate: scheduledEndDate,
        })
      : null;

  const meetingIcs =
    scheduledStartDate && scheduledEndDate
      ? buildMeetingIcs({
          title: calendarTitle,
          description: calendarDetails,
          location: calendarLocation,
          startDate: scheduledStartDate,
          endDate: scheduledEndDate,
        })
      : null;

  return (
    <div className="meeting-detail-screen">
      <TopNav />
      <div className="meeting-detail-container">
        <div className="meeting-detail-card">
          <div className="meeting-detail-header">
            <span className={`meeting-detail-status meeting-detail-status--${(meeting.status || '').toLowerCase().replace(' ', '-')}`}>
              {meeting.status || 'Scheduled'}
            </span>
            <h1 className="meeting-detail-title">{meeting.title || 'Untitled meeting'}</h1>
            {meeting.meetingRoom && (
              <p className="meeting-detail-room">{meeting.meetingRoom}</p>
            )}
          </div>

          <div className="meeting-detail-meta">
            <div className="meeting-detail-meta-item">
              <span className="meeting-detail-meta-label">Date</span>
              <span className="meeting-detail-meta-value">{formatDate(meeting.scheduledTime || meeting.startTime)}</span>
            </div>
            <div className="meeting-detail-meta-item">
              <span className="meeting-detail-meta-label">Time</span>
              <span className="meeting-detail-meta-value">{formatTime(meeting.scheduledTime || meeting.startTime)}</span>
            </div>
            {meeting.participants && meeting.participants.length > 0 && (
              <div className="meeting-detail-meta-item">
                <span className="meeting-detail-meta-label">Participants</span>
                <span className="meeting-detail-meta-value">{meeting.participants.length}</span>
              </div>
            )}
          </div>

          <div className="meeting-detail-actions">
            {isScheduled && (
              <button type="button" className="meeting-detail-btn meeting-detail-btn--primary" onClick={handleStartMeeting}>
                {T.startMeeting()}
              </button>
            )}
            {isScheduled && meeting.scheduledTime && (
              <div className="meeting-detail-calendar-actions">
                {gcalUrl && (
                  <a
                    className="meeting-detail-btn meeting-detail-btn--secondary"
                    href={gcalUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Add to Google Calendar"
                  >
                    Add to Google Calendar
                  </a>
                )}
                {outlookUrl && (
                  <a
                    className="meeting-detail-btn meeting-detail-btn--secondary"
                    href={outlookUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Add to Outlook Calendar"
                  >
                    Add to Outlook
                  </a>
                )}
                {meetingIcs && (
                  <button
                    type="button"
                    className="meeting-detail-btn meeting-detail-btn--secondary"
                    onClick={() => {
                      const blob = new Blob([meetingIcs], { type: 'text/calendar;charset=utf-8' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = `meeting-${(calendarTitle || 'meeting')
                        .slice(0, 40)
                        .replace(/[^a-z0-9]+/gi, '-')
                        .toLowerCase()}.ics`;
                      document.body.appendChild(a);
                      a.click();
                      a.remove();
                      URL.revokeObjectURL(url);
                    }}
                    title="Download .ics"
                  >
                    Download .ics
                  </button>
                )}
              </div>
            )}
            {isInProgress && (
              <button
                type="button"
                className="meeting-detail-btn meeting-detail-btn--primary"
                onClick={() => navigate(`/meetings/${id}/room`)}
              >
                Open meeting
              </button>
            )}
            {isCompleted && hasSummary && !pendingApproval && (
              <button
                type="button"
                className="meeting-detail-btn meeting-detail-btn--primary"
                onClick={() => navigate(`/meetings/${id}/summary`)}
              >
                View {T.meetingSummary()}
              </button>
            )}
            {isCompleted && pendingApproval && (
              <button
                type="button"
                className="meeting-detail-btn meeting-detail-btn--primary"
                onClick={() => navigate(`/meetings/${id}/summary`, { state: { approve: true } })}
              >
                Review & send summary
              </button>
            )}
            {isCompleted && meeting.transcriptionEnabled && meeting.transcriptionStatus === 'Processing' && (
              <p className="meeting-detail-hint">Summary is being generated. Check back in a moment.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default MeetingDetail;

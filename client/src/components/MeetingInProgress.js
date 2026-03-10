import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import axios from 'axios';
import './MeetingInProgress.css';

const MeetingInProgress = () => {
  const { meetingId } = useParams();
  const navigate = useNavigate();
  const [meeting, setMeeting] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [elapsedTime, setElapsedTime] = useState(0);
  const [recording, setRecording] = useState(false);
  const [paused, setPaused] = useState(false);
  const [uploading, setUploading] = useState(false);
  const mediaRecorderRef = React.useRef(null);
  const streamRef = React.useRef(null);

  useEffect(() => {
    if (meetingId) {
      fetchMeeting();
      const interval = setInterval(fetchMeeting, 5000); // Poll every 5 seconds
      return () => clearInterval(interval);
    }
  }, [meetingId]);

  useEffect(() => {
    if (meeting?.startTime) {
      const interval = setInterval(() => {
        const start = new Date(meeting.startTime);
        const now = new Date();
        setElapsedTime(Math.floor((now - start) / 1000));
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [meeting?.startTime]);

  const fetchMeeting = async () => {
    try {
      const res = await axios.get(`/meetings/${meetingId}`);
      setMeeting(res.data.meeting);
      setLoading(false);
    } catch (err) {
      console.error('Error fetching meeting:', err);
      setError('Failed to load meeting details');
      setLoading(false);
    }
  };

  const startRecording = async () => {
    try {
      // Call API to set start time
      await axios.post(`/meetings/${meetingId}/start-recording`);
      await fetchMeeting(); // Refresh meeting data
      
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mediaRecorder = new MediaRecorder(stream);
      const chunks = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunks.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const blob = new Blob(chunks, { type: 'audio/webm' });
        if (streamRef.current) {
          streamRef.current.getTracks().forEach(t => t.stop());
        }
        await uploadAudio(blob);
      };

      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.start();
      setRecording(true);
      setPaused(false);
      setError('');
    } catch (err) {
      console.error('Error starting recording:', err);
      setError('Unable to access microphone. Please check browser permissions.');
    }
  };

  const pauseRecording = () => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state === 'recording') {
      recorder.pause();
      setPaused(true);
    }
  };

  const resumeRecording = () => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state === 'paused') {
      recorder.resume();
      setPaused(false);
    }
  };

  const stopRecording = () => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop();
      setRecording(false);
      setPaused(false);
    }
  };

  const uploadAudio = async (blob) => {
    if (!meeting) return;
    setUploading(true);
    try {
      const fileToSend = new File([blob], 'meeting-audio.webm', { type: 'audio/webm' });
      const data = new FormData();
      data.append('audio', fileToSend);
      const res = await axios.post(`/meetings/${meeting._id}/end`, data, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      setMeeting(res.data.meeting);
      setUploading(false);
    } catch (err) {
      console.error('Error uploading audio:', err);
      setError('Failed to upload audio');
      setUploading(false);
    }
  };

  const handleEndMeeting = async () => {
    if (!meeting) return;
    try {
      // Stop recording if active
      if (recording) {
        stopRecording();
      }
      const res = await axios.post(`/meetings/${meeting._id}/end`);
      // Redirect to home after meeting ends
      navigate('/');
    } catch (err) {
      console.error('Error ending meeting:', err);
      setError('Failed to end meeting');
    }
  };

  const formatTime = (seconds) => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    if (hrs > 0) {
      return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'Not scheduled';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { 
      weekday: 'long', 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    });
  };

  const formatTimeOnly = (dateString) => {
    if (!dateString) return 'Not scheduled';
    const date = new Date(dateString);
    return date.toLocaleTimeString('en-US', { 
      hour: '2-digit', 
      minute: '2-digit',
      hour12: true 
    });
  };

  if (loading) {
    return (
      <div className="meeting-in-progress-loading">
        <div className="loading-spinner"></div>
        <p>Loading meeting details...</p>
      </div>
    );
  }

  if (error && !meeting) {
    return (
      <div className="meeting-in-progress-error">
        <p>{error}</p>
        <button onClick={() => navigate('/meetings')}>Back to Meetings</button>
      </div>
    );
  }

  if (!meeting) {
    return (
      <div className="meeting-in-progress-error">
        <p>Meeting not found</p>
        <button onClick={() => navigate('/meetings')}>Back to Meetings</button>
      </div>
    );
  }

  return (
    <div className="meeting-in-progress">
      <div className="meeting-in-progress-header">
        <div className="meeting-in-progress-logo">
          <img src="/assets/portiq-logo.png" alt="PortIQ" />
        </div>
        <button
          className="meeting-in-progress-close"
          onClick={() => navigate('/meetings')}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>

      <div className="meeting-in-progress-content">
        <div className="meeting-status-badge">
          <div className="status-indicator"></div>
          <span>Meeting in Progress</span>
        </div>

        <h1 className="meeting-title">{meeting.title || 'Untitled Meeting'}</h1>

        <div className="meeting-details-grid">
          <div className="meeting-detail-card">
            <div className="detail-icon">📅</div>
            <div className="detail-content">
              <div className="detail-label">Date</div>
              <div className="detail-value">{formatDate(meeting.scheduledTime || meeting.startTime)}</div>
            </div>
          </div>

          <div className="meeting-detail-card">
            <div className="detail-icon">🕐</div>
            <div className="detail-content">
              <div className="detail-label">Scheduled Time</div>
              <div className="detail-value">{formatTimeOnly(meeting.scheduledTime)}</div>
            </div>
          </div>

          <div className="meeting-detail-card">
            <div className="detail-icon">⏱️</div>
            <div className="detail-content">
              <div className="detail-label">Duration</div>
              <div className="detail-value duration-value">{formatTime(elapsedTime)}</div>
            </div>
          </div>

          <div className="meeting-detail-card">
            <div className="detail-icon">🏢</div>
            <div className="detail-content">
              <div className="detail-label">Room</div>
              <div className="detail-value">{meeting.meetingRoom || 'Not specified'}</div>
            </div>
          </div>

          <div className="meeting-detail-card">
            <div className="detail-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                <circle cx="12" cy="7" r="4"></circle>
              </svg>
            </div>
            <div className="detail-content">
              <div className="detail-label">Organizer</div>
              <div className="detail-value">{meeting.organizer || 'Not specified'}</div>
            </div>
          </div>

          <div className="meeting-detail-card">
            <div className="detail-icon">👥</div>
            <div className="detail-content">
              <div className="detail-label">Participants</div>
              <div className="detail-value">{meeting.participants?.length || 0} people</div>
            </div>
          </div>
        </div>

        {meeting.participants && meeting.participants.length > 0 && (
          <div className="participants-list">
            <h3>Participants</h3>
            <div className="participants-grid">
              {meeting.participants.map((p, idx) => (
                <div key={idx} className="participant-chip">
                  <div className="participant-name">{p.name || 'Unnamed'}</div>
                  {p.email && <div className="participant-email">{p.email}</div>}
                </div>
              ))}
            </div>
          </div>
        )}

        {meeting.transcriptionEnabled && (
          <div className="recording-controls">
            {!recording && !uploading && (
              <button
                className="btn-record"
                onClick={startRecording}
              >
                <span className="record-icon">●</span>
                Start Recording
              </button>
            )}
            {recording && (
              <>
                {!paused ? (
                  <button
                    className="btn-pause"
                    onClick={pauseRecording}
                  >
                    <span className="pause-icon">⏸</span>
                    Pause
                  </button>
                ) : (
                  <button
                    className="btn-record"
                    onClick={resumeRecording}
                  >
                    <span className="record-icon">●</span>
                    Resume
                  </button>
                )}
                <button
                  className="btn-stop"
                  onClick={stopRecording}
                >
                  <span className="stop-icon">■</span>
                  Stop & Upload
                </button>
              </>
            )}
            {uploading && (
              <div className="uploading-status">
                <div className="upload-spinner"></div>
                <span>Uploading audio...</span>
              </div>
            )}
          </div>
        )}

        {error && <div className="error-message">{error}</div>}

        <div className="meeting-actions">
          <button
            className="btn-end-meeting"
            onClick={handleEndMeeting}
            disabled={uploading}
          >
            End Meeting
          </button>
        </div>
      </div>
    </div>
  );
};

export default MeetingInProgress;

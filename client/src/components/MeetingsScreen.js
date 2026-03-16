import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import axios from 'axios';
import TopNav from './TopNav';
import { isEducation } from '../config/product';
import { T } from '../config/terminology';
import { getClassrooms } from '../utils/classroomsStorage';
import './MeetingsScreen.css';

const MeetingsScreen = ({ config }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [meetings, setMeetings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedMeeting, setSelectedMeeting] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [polling, setPolling] = useState(false);
  const [recording, setRecording] = useState(false);

  const mediaRecorderRef = useRef(null);

  const [form, setForm] = useState({
    meetingRoom: '',
    title: '',
    organizer: '',
    scheduledDate: '',
    scheduledTime: '',
    sendNotification: true,
    transcriptionEnabled: true,
    authorizedEditorEmail: '',
    authorizedEditorSource: 'participant'
  });
  
  // Approval workflow state
  const [verificationEmail, setVerificationEmail] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [verificationStep, setVerificationStep] = useState(''); // 'request', 'verify', 'edit', 'approved'
  const [editableSummary, setEditableSummary] = useState(null);
  const [editingSummary, setEditingSummary] = useState(false);
  const [additionalParticipants, setAdditionalParticipants] = useState([
    { name: '', email: '' }
  ]);

  const [participants, setParticipants] = useState([
    { name: '', email: '', remember: false }
  ]);
  const [rememberedParticipants, setRememberedParticipants] = useState([]);
  const [savedSearch, setSavedSearch] = useState('');
  const [showSavedDropdown, setShowSavedDropdown] = useState(false);
  const [editorSearch, setEditorSearch] = useState('');
  const [showEditorDropdown, setShowEditorDropdown] = useState(false);
  const [enableVoiceConfig, setEnableVoiceConfig] = useState(false);
  const [voiceProfiles, setVoiceProfiles] = useState({}); // { email: { hasProfile: bool, recording: bool } }
  const [selectedClassroomId, setSelectedClassroomId] = useState('');
  const [recordingParticipant, setRecordingParticipant] = useState(null);
  const [voiceMediaRecorder, setVoiceMediaRecorder] = useState(null);
  const [savedParticipantsVoiceProfiles, setSavedParticipantsVoiceProfiles] = useState({}); // Voice profiles for saved participants
  const [maxParticipantsPerMeeting, setMaxParticipantsPerMeeting] = useState(null); // 10/30/60 by plan, null = no limit

  useEffect(() => {
    fetchMeetings();
    // Load participant book from server (persisted per account)
    const loadParticipantBook = async () => {
      try {
        const res = await axios.get('/admin/participant-book');
        const list = res.data?.participants;
        if (Array.isArray(list)) {
          setRememberedParticipants(list);
          const savedEmails = list
            .filter(p => p.email && p.email.trim())
            .map(p => p.email.trim());
          if (savedEmails.length > 0) {
            checkVoiceProfilesForSaved(savedEmails);
          }
        }
      } catch (e) {
        if (e.response?.status !== 403) {
          try {
            const stored = localStorage.getItem('workplace_meeting_participants');
            if (stored) {
              const parsed = JSON.parse(stored);
              if (Array.isArray(parsed) && parsed.length > 0) {
                setRememberedParticipants(parsed);
                const savedEmails = parsed.filter(p => p.email && p.email.trim()).map(p => p.email.trim());
                if (savedEmails.length > 0) checkVoiceProfilesForSaved(savedEmails);
              }
            }
          } catch (_) {}
        }
      }
    };
    loadParticipantBook();
  }, []);

  // Fetch plan limit for participants per meeting (workplace: 10/30/60)
  useEffect(() => {
    if (isEducation) return;
    const fetchPlan = async () => {
      try {
        const res = await axios.get('/admin/profile');
        const product = (res.data?.admin?.productType || 'workplace').toLowerCase();
        const plan = (res.data?.admin?.plan || 'starter').toLowerCase();
        if (product === 'workplace') {
          const maxByPlan = { starter: 10, professional: 30, business: 60 };
          setMaxParticipantsPerMeeting(maxByPlan[plan] ?? null);
        } else {
          setMaxParticipantsPerMeeting(null);
        }
      } catch (e) {
        setMaxParticipantsPerMeeting(null);
      }
    };
    fetchPlan();
  }, [isEducation]);

  const checkVoiceProfilesForSaved = async (emails) => {
    try {
      const res = await axios.get(`/meetings/voice/profiles?emails=${emails.join(',')}`);
      const profilesMap = {};
      emails.forEach(email => {
        const profile = res.data.profiles.find(p => p.email.toLowerCase() === email.toLowerCase());
        profilesMap[email] = {
          hasProfile: !!profile,
          name: profile?.name || ''
        };
      });
      setSavedParticipantsVoiceProfiles(profilesMap);
    } catch (err) {
      console.error('Error checking voice profiles for saved participants:', err);
    }
  };

  // Refresh meetings periodically and on window focus
  useEffect(() => {
    const interval = setInterval(() => {
      fetchMeetings();
    }, 10000); // Refresh every 10 seconds

    const handleFocus = () => {
      fetchMeetings();
    };
    window.addEventListener('focus', handleFocus);

    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', handleFocus);
    };
  }, []);

  // Auto-select meeting: from location state (e.g. "Review & send" from quick card) or first needing approval
  useEffect(() => {
    if (meetings.length === 0) return;
    const focusId = location.state?.focusMeetingId;
    if (focusId) {
      const found = meetings.find(m => m._id === focusId);
      if (found) setSelectedMeeting(found);
      navigate(location.pathname, { replace: true, state: {} });
      return;
    }
    if (!selectedMeeting) {
      const pendingApproval = meetings.find(m =>
        m.summaryStatus === 'Pending Approval' &&
        m.transcriptionStatus === 'Completed'
      );
      if (pendingApproval) setSelectedMeeting(pendingApproval);
    }
  }, [meetings, location.state?.focusMeetingId]);

  // Update editorSearch when authorizedEditorEmail changes
  useEffect(() => {
    if (form.authorizedEditorSource === 'participant' && form.authorizedEditorEmail) {
      const participant = participants.find(p => p.email && p.email.trim() === form.authorizedEditorEmail.trim());
      if (participant) {
        setEditorSearch(`${participant.name?.trim() || 'Unnamed'} (${participant.email.trim()})`);
      }
    } else if (form.authorizedEditorSource === 'participant' && !form.authorizedEditorEmail) {
      setEditorSearch('');
    }
  }, [form.authorizedEditorEmail, form.authorizedEditorSource, participants]);

  // Automatically check voice profiles when participants change (always check, not just when voice config is enabled)
  useEffect(() => {
    if (participants.length > 0) {
      const participantEmails = participants
        .filter(p => p.email && p.email.trim())
        .map(p => p.email.trim());
      
      if (participantEmails.length > 0) {
        checkVoiceProfiles(participantEmails);
      }
    }
  }, [participants]);

  const fetchMeetings = async () => {
    try {
      const res = await axios.get('/meetings?limit=20');
      setMeetings(res.data.meetings || []);
    } catch (err) {
      console.error('Error fetching meetings:', err);
    }
  };

  const checkVoiceProfiles = async (emails) => {
    try {
      const res = await axios.get(`/meetings/voice/profiles?emails=${emails.join(',')}`);
      const profilesMap = {};
      emails.forEach(email => {
        const profile = res.data.profiles.find(p => p.email.toLowerCase() === email.toLowerCase());
        profilesMap[email] = {
          hasProfile: !!profile,
          name: profile?.name || ''
        };
      });
      setVoiceProfiles(profilesMap);
    } catch (err) {
      console.error('Error checking voice profiles:', err);
    }
  };

  const startVoiceRecording = async (participant) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      const audioChunks = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunks.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
        // The system will auto-detect the name from audio and match to participant
        await uploadVoiceSample(audioBlob);
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start();
      setVoiceMediaRecorder(mediaRecorder);
      setRecordingParticipant(participant.email);
    } catch (err) {
      console.error('Error starting voice recording:', err);
      setError('Unable to access microphone. Please check browser permissions.');
    }
  };

  const stopVoiceRecording = () => {
    if (voiceMediaRecorder && voiceMediaRecorder.state !== 'inactive') {
      voiceMediaRecorder.stop();
      setVoiceMediaRecorder(null);
    }
  };

  const uploadVoiceSample = async (audioBlob) => {
    try {
      setUploading(true);
      setError('');
      
      // Send participants list for auto-matching
      const participantList = participants
        .filter(p => p.email && p.email.trim())
        .map(p => ({
          name: p.name || '',
          email: p.email.trim()
        }));
      
      const formData = new FormData();
      const audioFile = new File([audioBlob], `voice-sample-${Date.now()}.webm`, { type: 'audio/webm' });
      formData.append('audio', audioFile);
      formData.append('participants', JSON.stringify(participantList));
      formData.append('standardSentence', 'Hello, my name is [Your Name] and I am ready for the meeting.');

      const res = await axios.post('/meetings/voice/register', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });

      // Get the matched participant from response
      const matchedEmail = res.data.voiceProfile?.email;
      const matchedName = res.data.voiceProfile?.name;
      const wasAutoMatched = res.data.autoMatched;
      
      if (matchedEmail) {
        // Update voice profiles
        setVoiceProfiles(prev => ({
          ...prev,
          [matchedEmail]: { hasProfile: true, name: matchedName }
        }));

        setRecordingParticipant(null);
        setUploading(false);
        
        // Show personalized thank you message
        const message = wasAutoMatched 
          ? `Thank you ${matchedName}! Your voice has been automatically configured and assigned to your participant profile.`
          : `Thank you ${matchedName}! Your voice has been configured successfully.`;
        alert(message);
        
        // Refresh voice profiles check
        const participantEmails = participantList.map(p => p.email);
        if (participantEmails.length > 0) {
          checkVoiceProfiles(participantEmails);
        }
      } else {
        throw new Error('Could not determine which participant this voice belongs to');
      }
    } catch (err) {
      console.error('Error uploading voice sample:', err);
      const errorMsg = err.response?.data?.error || err.message || 'Failed to register voice profile. Please try again.';
      setError(errorMsg);
      setRecordingParticipant(null);
      setUploading(false);
    }
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    setError('');
    if (isEducation && !selectedClassroomId) {
      setError('Please select a classroom.');
      return;
    }
    setLoading(true);
    try {
      let payloadParticipants;
      if (isEducation && selectedClassroomId) {
        const classrooms = getClassrooms();
        const classroom = classrooms.find((c) => c.id === selectedClassroomId);
        payloadParticipants = (classroom?.studentEmails || []).map((email) => ({
          name: email.split('@')[0],
          email,
          role: 'participant'
        }));
      } else {
        payloadParticipants = participants
          .filter(p => p.email && p.email.trim())
          .map(p => ({
            name: p.name?.trim() || '',
            email: p.email.trim(),
            role: 'participant'
          }));
      }

      // Combine date and time for scheduledTime
      let scheduledTimeValue = undefined;
      if (form.scheduledDate && form.scheduledTime) {
        scheduledTimeValue = new Date(`${form.scheduledDate}T${form.scheduledTime}`).toISOString();
      }

      const res = await axios.post(
        '/meetings',
        {
          meetingRoom: form.meetingRoom.trim(),
          title: form.title.trim(),
          organizer: form.organizer.trim(),
          participants: payloadParticipants,
          scheduledTime: scheduledTimeValue,
          sendNotification: form.sendNotification,
          transcriptionEnabled: form.transcriptionEnabled,
          authorizedEditorEmail: form.authorizedEditorEmail.trim() || undefined
        },
        {
          // Prevent the "Creating..." state from hanging forever if the
          // backend is slow or unreachable.
          timeout: 30000
        }
      );

      const newMeetingId = res.data.meeting._id;
      setParticipants([{ name: '', email: '', remember: false }]);
      setForm(prev => ({
        ...prev,
        meetingRoom: '',
        title: '',
        organizer: '',
        scheduledDate: '',
        scheduledTime: '',
        authorizedEditorEmail: ''
      }));
      setEditorSearch('');
      setShowEditorDropdown(false);
      setLoading(false);
      navigate(`/meetings/${newMeetingId}`);

      // Persist participant book in background (no state updates after navigate)
      const toRemember = participants
        .filter(p => p.remember && p.email && p.email.trim())
        .map(p => ({ name: p.name?.trim() || '', email: p.email.trim() }));
      if (toRemember.length > 0) {
        const existing = [...rememberedParticipants];
        toRemember.forEach(p => {
          if (!existing.find(ep => ep.email && ep.email.toLowerCase() === p.email.toLowerCase())) {
            existing.push(p);
          }
        });
        axios.put('/admin/participant-book', { participants: existing }).catch(err => {
          console.error('Error saving participant book:', err);
        });
      }
    } catch (err) {
      console.error('Error creating meeting:', err);
      const rawError = err.response?.data?.error || err.response?.data?.details || err.message;
      const isLimitError = typeof rawError === 'string' && (
        /plan allows up to|participants per meeting|participant book|max participants/i.test(rawError)
      );
      let serverError = rawError;
      if (err.message === 'Network Error') {
        serverError = 'Cannot reach workplace server. Please ensure the backend is running on port 5001.';
      } else if (isLimitError) {
        serverError = "You've reached your plan limit. Please upgrade to add more participants.";
      } else if (rawError) {
        serverError = rawError;
      } else {
        serverError = 'Failed to create meeting';
      }
      setError(serverError);
    } finally {
      setLoading(false);
    }
  };

  const handleAudioUpload = async (e) => {
    if (!selectedMeeting) return;
    const file = e.target.files[0];
    if (!file) return;
    await uploadAudio(file);
  };

  const pollForSummary = async (id) => {
    let attempts = 0;
    const maxAttempts = 40; // Increased to wait longer for transcription
    const interval = 5000;

    const poll = async () => {
      try {
        const res = await axios.get(`/meetings/${id}`);
        const m = res.data.meeting;
        setSelectedMeeting(m);
        
        // If summary is sent, stop polling and redirect to home
        if (m.summaryStatus === 'Sent') {
          setPolling(false);
          setTimeout(() => navigate('/'), 2000);
          return;
        }
        
        // If transcription completed or failed, stop polling
        if (m.transcriptionStatus === 'Completed' || m.transcriptionStatus === 'Failed' || attempts >= maxAttempts) {
          setPolling(false);
          // If summary is ready for approval, ensure meeting is selected
          if (m.summaryStatus === 'Pending Approval' && m.transcriptionStatus === 'Completed') {
            setSelectedMeeting(m);
            // Auto-fill authorized editor email if available (but don't auto-show code entry)
            if (m.authorizedEditorEmail && !verificationEmail) {
              setVerificationEmail(m.authorizedEditorEmail);
            }
            // Stay on page to show code entry prompt
            return;
          }
          // If no authorized editor or summary failed, redirect to home after delay
          if (!m.authorizedEditorEmail || m.transcriptionStatus === 'Failed') {
            setTimeout(() => navigate('/'), 3000);
          }
          return;
        }
        attempts += 1;
        setTimeout(poll, interval);
      } catch (err) {
        console.error('Error polling meeting summary:', err);
        setPolling(false);
      }
    };

    poll();
  };

  const companyName = config?.companyName || 'Your Company';

  const getMeetingDurationLabel = (meeting) => {
    if (!meeting || !meeting.startTime || !meeting.endTime) return '';
    const start = new Date(meeting.startTime);
    const end = new Date(meeting.endTime);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) return '';
    const minutes = Math.max(1, Math.round((end.getTime() - start.getTime()) / 60000));
    return `Meeting duration: ${minutes} minutes`;
  };

  const uploadAudio = async (fileOrBlob) => {
    if (!selectedMeeting) return;
    setUploading(true);
    setError('');

    try {
      const data = new FormData();
      // If we received a raw Blob (from MediaRecorder), wrap it in a File with a proper extension
      let fileToSend = fileOrBlob;
      if (fileOrBlob instanceof Blob && !(fileOrBlob instanceof File)) {
        fileToSend = new File([fileOrBlob], 'meeting-audio.webm', { type: 'audio/webm' });
      }

      data.append('audio', fileToSend);
      const res = await axios.post(`/meetings/${selectedMeeting._id}/end`, data, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      setSelectedMeeting(res.data.meeting);
      setUploading(false);
      setPolling(true);
      pollForSummary(res.data.meeting._id);
    } catch (err) {
      console.error('Error uploading audio:', err);
      let serverError =
        err.response?.data?.error ||
        err.response?.data?.details ||
        err.message;
      if (err.message === 'Network Error') {
        serverError = 'Cannot reach workplace server. Please ensure the backend is running on port 5001.';
      }
      setError(serverError || 'Failed to upload audio');
      setUploading(false);
    }
  };

  const startRecording = async () => {
    if (!selectedMeeting) {
      setError('Please select or create a meeting first.');
      return;
    }
    try {
      // Call API to set start time when recording begins
      await axios.post(`/meetings/${selectedMeeting._id}/start-recording`);
      await fetchMeetings(); // Refresh to get updated start time
      
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      const chunks = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunks.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const blob = new Blob(chunks, { type: 'audio/webm' });
        stream.getTracks().forEach(t => t.stop());
        await uploadAudio(blob);
      };

      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.start();
      setRecording(true);
      setError('');
    } catch (err) {
      console.error('Error starting recording:', err);
      setError('Unable to access microphone. Please check browser permissions.');
    }
  };

  const stopRecording = () => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop();
      setRecording(false);
    }
  };

  const meetingParticipantCount = participants.filter(p => p.email && p.email.trim()).length;
  const atMeetingParticipantLimit = maxParticipantsPerMeeting != null && meetingParticipantCount >= maxParticipantsPerMeeting;

  const handleAddParticipantRow = () => {
    if (atMeetingParticipantLimit) return;
    setParticipants(prev => [...prev, { name: '', email: '', remember: false }]);
  };

  const handleRemoveParticipantRow = (idx) => {
    setParticipants(prev => prev.length === 1 ? prev : prev.filter((_, i) => i !== idx));
  };

  const handleAddSavedParticipant = (saved) => {
    if (atMeetingParticipantLimit) return;
    setParticipants(prev => {
      if (prev.find(p => p.email && p.email.toLowerCase() === saved.email.toLowerCase())) {
        return prev;
      }
      return [...prev, { name: saved.name, email: saved.email, remember: false }];
    });
  };

  return (
    <div className="meetings-screen">
      <TopNav />
      <div className="meetings-wrapper">
        <div className="meetings-top-bar">
          <h1 className="meetings-top-bar-title">{T.meetings()}</h1>
          <div className="meetings-top-bar-actions">
            {selectedMeeting && (
              <button
                className="btn btn-secondary"
                onClick={() => setSelectedMeeting(null)}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
                Close
              </button>
            )}
          </div>
        </div>
        
        <div className="meetings-content">

        {error && <div className="error-message">{error}</div>}

        {(() => {
          const needsApproval = (meetings || []).filter(
            m => m.summaryStatus === 'Pending Approval' && m.transcriptionStatus === 'Completed'
          );
          if (needsApproval.length === 0) return null;
          return (
            <div className="summaries-quick-card">
              <h2 className="summaries-quick-title">Summaries & approval</h2>
              <p className="summaries-quick-desc">
                Quick access to {T.meetingSummary().toLowerCase()}s that are waiting for your approval.
              </p>
              <div className="summaries-quick-grid">
                <div className="summaries-quick-block">
                  <h3 className="summaries-quick-block-title">Your summary is ready</h3>
                  <p className="summaries-quick-block-desc">Review it and send to participants.</p>
                  <ul className="summaries-quick-list">
                    {needsApproval.slice(0, 5).map(m => (
                      <li key={m._id}>
                        <span className="summaries-quick-name">{m.title}</span>
                        <button
                          type="button"
                          className="summaries-quick-btn summaries-quick-btn--primary summaries-quick-btn--link"
                          onClick={() => navigate(`/meetings/${m._id}/summary`)}
                        >
                          Click here to review your summary
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          );
        })()}

        <div className="meetings-layout">
          <div className="meetings-left">
            <div className="card">
              <div className="card-header">
                <h2>{T.newMeeting()}</h2>
              </div>
              <form onSubmit={handleCreate} className="meetings-form">
                {isEducation && (
                  <div className="form-group">
                    <label>Classroom</label>
                    <select
                      className="premium-input"
                      value={selectedClassroomId}
                      onChange={(e) => setSelectedClassroomId(e.target.value)}
                    >
                      <option value="">Select a classroom</option>
                      {getClassrooms().map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.className} {c.subject ? `(${c.subject})` : ''} – {(c.studentEmails || []).length} students
                        </option>
                      ))}
                    </select>
                    <small>Students in this classroom will receive lecture notes by email.</small>
                  </div>
                )}
                <div className="form-group">
                  <label>{isEducation ? 'Lecture Title' : 'Meeting title/agenda'}</label>
                  <input
                    type="text"
                    className="premium-input"
                    value={form.title}
                    onChange={e => setForm({ ...form, title: e.target.value })}
                    placeholder={`Project review - ${companyName}`}
                    required
                  />
                </div>
                <div className="form-group">
                  <label>Location</label>
                  <input
                    type="text"
                    className="premium-input"
                    value={form.meetingRoom}
                    onChange={e => setForm({ ...form, meetingRoom: e.target.value })}
                    placeholder="e.g., Conference Room A"
                    required
                  />
                </div>
                <div className="form-group">
                  <label>Meeting Date & Time (optional)</label>
                  <div className="datetime-picker-group">
                    <div className="datetime-picker-wrapper">
                      <input
                        type="date"
                        className={`premium-date-input ${!form.scheduledDate ? 'empty' : ''}`}
                        value={form.scheduledDate}
                        onChange={e => setForm({ ...form, scheduledDate: e.target.value })}
                      />
                    </div>
                    <div className="datetime-picker-wrapper">
                      <input
                        type="time"
                        className={`premium-time-input ${!form.scheduledTime ? 'empty' : ''}`}
                        value={form.scheduledTime}
                        onChange={e => setForm({ ...form, scheduledTime: e.target.value })}
                      />
                    </div>
                  </div>
                  <small>If set, this date & time will appear in the email notification.</small>
                </div>
                <div className="form-group">
                  <label>{isEducation ? 'Teacher' : 'Organizer'}</label>
                  <input
                    type="text"
                    className="premium-input"
                    value={form.organizer}
                    onChange={e => setForm({ ...form, organizer: e.target.value })}
                    placeholder={isEducation ? 'Teacher name or email' : 'Organizer name or email'}
                    required
                  />
                </div>
                {!isEducation && (
                <div className="form-group">
                  <div className="meeting-participants-label-row">
                    <label>Participants</label>
                    {maxParticipantsPerMeeting != null && (
                      <span className="meeting-participants-limit-hint">
                        {meetingParticipantCount} / {maxParticipantsPerMeeting} participants
                      </span>
                    )}
                  </div>
                  {rememberedParticipants.length > 0 && (
                    <div className="saved-participants" style={{ position: 'relative' }}>
                      <div className="saved-participants-label">Add from participant book</div>
                      <input
                        type="text"
                        className="saved-participants-search premium-input"
                        placeholder="Search by name or email"
                        value={savedSearch}
                        onChange={e => setSavedSearch(e.target.value)}
                        onFocus={() => setShowSavedDropdown(true)}
                        onBlur={() => setTimeout(() => setShowSavedDropdown(false), 200)}
                      />
                      {showSavedDropdown && (
                        <div className="saved-participants-dropdown">
                          {rememberedParticipants
                            .filter(sp => {
                              if (!savedSearch.trim()) return true;
                              const q = savedSearch.toLowerCase();
                              return (
                                (sp.name || '').toLowerCase().includes(q) ||
                                (sp.email || '').toLowerCase().includes(q)
                              );
                            })
                            .map((sp, i) => {
                              const hasVoiceProfile = sp.email && savedParticipantsVoiceProfiles[sp.email]?.hasProfile;
                              return (
                                <div
                                  key={sp.email + i}
                                  className="saved-participant-item"
                                  onClick={() => {
                                    handleAddSavedParticipant(sp);
                                    setSavedSearch('');
                                    setShowSavedDropdown(false);
                                  }}
                                >
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1 }}>
                                    <div>
                                      <div className="saved-participant-name">{sp.name || sp.email}</div>
                                      {sp.email && <div className="saved-participant-email">{sp.email}</div>}
                                    </div>
                                    {hasVoiceProfile && (
                                      <span 
                                        style={{
                                          color: '#22c55e',
                                          fontSize: '11px',
                                          fontWeight: '600',
                                          display: 'flex',
                                          alignItems: 'center',
                                          gap: '4px'
                                        }}
                                        title="Voice profile configured"
                                      >
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                          <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
                                          <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
                                          <line x1="12" y1="19" x2="12" y2="23"></line>
                                          <line x1="8" y1="23" x2="16" y2="23"></line>
                                        </svg>
                                      </span>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          {rememberedParticipants.filter(sp => {
                            if (!savedSearch.trim()) return false;
                            const q = savedSearch.toLowerCase();
                            return (
                              (sp.name || '').toLowerCase().includes(q) ||
                              (sp.email || '').toLowerCase().includes(q)
                            );
                          }).length === 0 && savedSearch.trim() && (
                            <div className="saved-participant-item" style={{ color: '#6b7280', fontStyle: 'italic' }}>
                              No matching participants found
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                  {participants.map((p, idx) => {
                    const hasVoiceProfile = p.email && voiceProfiles[p.email]?.hasProfile;
                    return (
                      <div key={idx} className="participant-row">
                        <input
                          type="text"
                          className="premium-input"
                          placeholder="Name"
                          value={p.name}
                          onChange={e => {
                            const next = [...participants];
                            next[idx] = { ...next[idx], name: e.target.value };
                            setParticipants(next);
                          }}
                        />
                        <input
                          type="email"
                          className="premium-input"
                          placeholder="email@example.com"
                          value={p.email}
                          onChange={e => {
                            const next = [...participants];
                            next[idx] = { ...next[idx], email: e.target.value };
                            setParticipants(next);
                          }}
                        />
                        <label className="premium-checkbox-container">
                          <input
                            type="checkbox"
                            checked={!!p.remember}
                            onChange={e => {
                              const next = [...participants];
                              next[idx] = { ...next[idx], remember: e.target.checked };
                              setParticipants(next);
                            }}
                          />
                          <span>Remember</span>
                        </label>
                        {hasVoiceProfile && (
                          <span 
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '6px',
                              color: '#22c55e',
                              fontSize: '12px',
                              fontWeight: '600',
                              marginLeft: '8px'
                            }}
                            title="Voice profile configured from previous meetings"
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
                              <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
                              <line x1="12" y1="19" x2="12" y2="23"></line>
                              <line x1="8" y1="23" x2="16" y2="23"></line>
                            </svg>
                            Voice
                          </span>
                        )}
                        {participants.length > 1 && (
                          <button
                            type="button"
                            className="participant-remove"
                            onClick={() => handleRemoveParticipantRow(idx)}
                          >
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <line x1="18" y1="6" x2="6" y2="18"></line>
                              <line x1="6" y1="6" x2="18" y2="18"></line>
                            </svg>
                          </button>
                        )}
                      </div>
                    );
                  })}
                  <button
                    type="button"
                    className="btn btn-primary"
                    style={{ marginTop: '8px' }}
                    onClick={handleAddParticipantRow}
                    disabled={atMeetingParticipantLimit}
                    title={atMeetingParticipantLimit ? 'Please upgrade to add more.' : undefined}
                  >
                    Add Participant
                  </button>
                  {atMeetingParticipantLimit && (
                    <p className="meeting-limit-upgrade-msg">You've reached your plan limit. Please upgrade to add more participants.</p>
                  )}
                  <small>AI summaries will be emailed to these participants when ready (if email is configured).</small>
                </div>
                )}
                <div className="form-group-inline">
                  <label className="premium-checkbox-container">
                    <input
                      type="checkbox"
                      checked={form.sendNotification}
                      onChange={e => setForm({ ...form, sendNotification: e.target.checked })}
                    />
                    <span>{isEducation ? 'Send email notification to students on create' : 'Send email notification to participants on create'}</span>
                  </label>
                </div>
                <div className="form-group">
                  <label>Authorized Editor (optional)</label>
                  <div className="editor-selection-group">
                    <div style={{ position: 'relative' }}>
                      <div style={{ position: 'relative' }}>
                        <input
                          type="text"
                          className="premium-email-input"
                          placeholder="Select a participant..."
                          value={editorSearch}
                          onChange={e => {
                            setEditorSearch(e.target.value);
                            setShowEditorDropdown(true);
                          }}
                          onFocus={() => setShowEditorDropdown(true)}
                          onBlur={() => setTimeout(() => setShowEditorDropdown(false), 200)}
                          style={{
                            color: form.authorizedEditorEmail
                              ? 'white'
                              : editorSearch
                                ? 'white'
                                : 'rgba(255, 255, 255, 0.7)',
                            paddingRight: '40px'
                          }}
                        />
                        <svg
                          style={{
                            position: 'absolute',
                            right: '12px',
                            top: '50%',
                            transform: 'translateY(-50%)',
                            width: '14px',
                            height: '14px',
                            pointerEvents: 'none',
                            color: 'white',
                            opacity: 0.8
                          }}
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.5"
                        >
                          <polyline points="6 9 12 15 18 9"></polyline>
                        </svg>
                      </div>
                      {showEditorDropdown && (
                        <div className="saved-participants-dropdown" style={{
                          position: 'absolute',
                          top: '100%',
                          left: 0,
                          right: 0,
                          marginTop: '4px',
                          zIndex: 1000
                        }}>
                          {participants
                            .filter(p => {
                              if (!p.email || !p.email.trim()) return false;
                              if (!editorSearch.trim()) return true;
                              const searchLower = editorSearch.toLowerCase();
                              const name = (p.name?.trim() || '').toLowerCase();
                              const email = p.email.trim().toLowerCase();
                              return name.includes(searchLower) || email.includes(searchLower);
                            })
                            .map((p, idx) => (
                              <div
                                key={idx}
                                className="saved-participant-item"
                                onClick={() => {
                                  setForm({ ...form, authorizedEditorEmail: p.email.trim() });
                                  setEditorSearch(`${p.name?.trim() || 'Unnamed'} (${p.email.trim()})`);
                                  setShowEditorDropdown(false);
                                }}
                                style={{ cursor: 'pointer' }}
                              >
                                <div className="saved-participant-name">{p.name?.trim() || 'Unnamed'}</div>
                                <div className="saved-participant-email">{p.email.trim()}</div>
                              </div>
                            ))}
                          {participants.filter(p => {
                            if (!p.email || !p.email.trim()) return false;
                            if (!editorSearch.trim()) return true;
                            const searchLower = editorSearch.toLowerCase();
                            const name = (p.name?.trim() || '').toLowerCase();
                            const email = p.email.trim().toLowerCase();
                            return name.includes(searchLower) || email.includes(searchLower);
                          }).length === 0 && (
                            <div className="saved-participant-item" style={{ color: 'rgba(255, 255, 255, 0.5)', cursor: 'default' }}>
                              No participants found
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                  <small>This person will be able to review and edit the summary before it's sent to participants.</small>
                </div>
                <div className="form-group-inline">
                  <label className="premium-checkbox-container">
                    <input
                      type="checkbox"
                      checked={form.transcriptionEnabled}
                      onChange={e => setForm({ ...form, transcriptionEnabled: e.target.checked })}
                    />
                    <span>Enable AI meeting summary</span>
                  </label>
                  {form.transcriptionEnabled && (
                    <label className="premium-checkbox-container">
                      <input
                        type="checkbox"
                        checked={enableVoiceConfig}
                        onChange={e => setEnableVoiceConfig(e.target.checked)}
                      />
                      <span>Enable voice recognition (speaker identification)</span>
                    </label>
                  )}
                </div>

                {/* Voice Configuration Section */}
                {enableVoiceConfig && form.transcriptionEnabled && participants.filter(p => p.email && p.email.trim()).length > 0 && (
                  <div className="form-group" style={{
                    background: 'rgba(255, 255, 255, 0.1)',
                    border: '2px solid rgba(255, 255, 255, 0.2)',
                    borderRadius: '12px',
                    padding: '24px',
                    marginTop: '20px'
                  }}>
                    <label style={{ color: 'white', fontSize: '18px', fontWeight: '600', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
                        <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
                        <line x1="12" y1="19" x2="12" y2="23"></line>
                        <line x1="8" y1="23" x2="16" y2="23"></line>
                      </svg>
                      Voice Configuration
                    </label>
                    <p style={{ color: 'rgba(255, 255, 255, 0.9)', fontSize: '14px', marginBottom: '20px' }}>
                      Record a voice sample for each participant so the system can identify who is speaking during the meeting.
                    </p>
                    
                    {/* Guide Box */}
                    <div style={{
                      background: 'rgba(37, 99, 235, 0.15)',
                      border: '2px solid rgba(37, 99, 235, 0.4)',
                      borderRadius: '12px',
                      padding: '20px',
                      marginBottom: '20px'
                    }}>
                      <div style={{ color: 'white', fontSize: '15px', fontWeight: '600', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                          <polyline points="14 2 14 8 20 8"></polyline>
                          <line x1="16" y1="13" x2="8" y2="13"></line>
                          <line x1="16" y1="17" x2="8" y2="17"></line>
                          <polyline points="10 9 9 9 8 9"></polyline>
                        </svg>
                        <span>What to Say:</span>
                      </div>
                      <div style={{
                        background: 'rgba(255, 255, 255, 0.1)',
                        border: '1px solid rgba(255, 255, 255, 0.2)',
                        borderRadius: '8px',
                        padding: '16px',
                        marginBottom: '12px'
                      }}>
                        <p style={{
                          color: 'white',
                          fontSize: '16px',
                          fontWeight: '500',
                          margin: 0,
                          fontStyle: 'italic',
                          textAlign: 'center',
                          letterSpacing: '0.3px'
                        }}>
                          "Hello, my name is [Your Name] and I am ready for the meeting."
                        </p>
                      </div>
                      <p style={{ color: 'rgba(255, 255, 255, 0.8)', fontSize: '13px', margin: 0, lineHeight: '1.6' }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', marginRight: '4px' }}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <circle cx="12" cy="12" r="10"></circle>
                            <line x1="12" y1="16" x2="12" y2="12"></line>
                            <line x1="12" y1="8" x2="12.01" y2="8"></line>
                          </svg>
                        </span>
                        <strong>Instructions:</strong> Click "Record Voice" next to your name and clearly say the sentence above, replacing "[Your Name]" with your actual name. The system will automatically detect your name from the audio and assign your voice profile to the correct participant from the list. Speak naturally and clearly.
                      </p>
                      <p style={{ color: 'rgba(255, 255, 255, 0.7)', fontSize: '12px', margin: '8px 0 0 0', fontStyle: 'italic' }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', marginRight: '4px' }}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83"></path>
                          </svg>
                        </span>
                        <strong>Smart Detection:</strong> After you say your name, the system will automatically match it to your participant profile and configure your voice.
                      </p>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      {participants.filter(p => p.email && p.email.trim()).map((p, idx) => {
                        const hasProfile = voiceProfiles[p.email]?.hasProfile || false;
                        const isRecording = recordingParticipant === p.email;
                        const participantName = p.name || p.email;
                        const standardSentence = `Hello, my name is ${participantName} and I am ready for the meeting.`;
                        
                        return (
                          <div key={idx} style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '16px',
                            background: hasProfile ? 'rgba(34, 197, 94, 0.15)' : 'rgba(255, 255, 255, 0.05)',
                            border: `2px solid ${hasProfile ? 'rgba(34, 197, 94, 0.3)' : 'rgba(255, 255, 255, 0.2)'}`,
                            borderRadius: '10px'
                          }}>
                            <div style={{ flex: 1 }}>
                              <div style={{ color: 'white', fontWeight: '600', marginBottom: '6px', fontSize: '15px' }}>
                                {participantName}
                              </div>
                              <div style={{ color: 'rgba(255, 255, 255, 0.7)', fontSize: '13px', marginBottom: '8px' }}>
                                {hasProfile ? (
                                  <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                      <polyline points="20 6 9 17 4 12"></polyline>
                                    </svg>
                                    Voice profile configured
                                    <span style={{ fontSize: '11px', marginLeft: '4px', fontStyle: 'italic', color: 'rgba(255, 255, 255, 0.6)' }}>
                                      (Remembered from previous meetings)
                                    </span>
                                  </span>
                                ) : (
                                  <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                      <circle cx="12" cy="12" r="10"></circle>
                                      <line x1="12" y1="8" x2="12" y2="12"></line>
                                      <line x1="12" y1="16" x2="12.01" y2="16"></line>
                                    </svg>
                                    Voice profile not configured
                                  </span>
                                )}
                              </div>
                              {isRecording && (
                                <div style={{
                                  color: '#ef4444',
                                  fontSize: '13px',
                                  fontWeight: '600',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '6px',
                                  marginTop: '8px'
                                }}>
                                  <span style={{
                                    display: 'inline-block',
                                    width: '10px',
                                    height: '10px',
                                    borderRadius: '50%',
                                    background: '#ef4444',
                                    animation: 'pulse 1.5s ease-in-out infinite'
                                  }}></span>
                                  Recording... Say: "{standardSentence}"
                                </div>
                              )}
                              {uploading && recordingParticipant === p.email && (
                                <div style={{
                                  color: '#60a5fa',
                                  fontSize: '13px',
                                  fontWeight: '600',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '6px',
                                  marginTop: '8px'
                                }}>
                                  <span className="loading-spinner" style={{ width: '12px', height: '12px', borderWidth: '2px' }}></span>
                                  Processing... Detecting your name and assigning voice profile...
                                </div>
                              )}
                            </div>
                            <button
                              type="button"
                              className="btn btn-secondary"
                              onClick={() => {
                                if (isRecording) {
                                  stopVoiceRecording();
                                } else {
                                  startVoiceRecording(p);
                                }
                              }}
                              disabled={recordingParticipant && recordingParticipant !== p.email}
                              style={{
                                padding: '10px 18px',
                                fontSize: '14px',
                                minWidth: '140px',
                                fontWeight: '600'
                              }}
                            >
                              {isRecording ? (
                                <>
                                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <rect x="6" y="4" width="4" height="16"></rect>
                                    <rect x="14" y="4" width="4" height="16"></rect>
                                  </svg>
                                  Stop Recording
                                </>
                              ) : (hasProfile ? (
                                <>
                                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <polyline points="1 4 1 10 7 10"></polyline>
                                    <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path>
                                  </svg>
                                  Re-record
                                </>
                              ) : (
                                <>
                                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
                                    <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
                                    <line x1="12" y1="19" x2="12" y2="23"></line>
                                    <line x1="8" y1="23" x2="16" y2="23"></line>
                                  </svg>
                                  Record Voice
                                </>
                              ))}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                <button type="submit" className="btn btn-primary" disabled={loading}>
                  {loading ? 'Creating...' : 'Create Meeting'}
                </button>
              </form>
            </div>

            {selectedMeeting && (
              <div className="card">
                <div className="card-header">
                  <h2>Current Meeting</h2>
                </div>
                <div className="meeting-details">
                  {getMeetingDurationLabel(selectedMeeting) && (
                    <p><strong>{getMeetingDurationLabel(selectedMeeting)}</strong></p>
                  )}
                  <p><strong>Title:</strong> {selectedMeeting.title}</p>
                  <p><strong>Location:</strong> {selectedMeeting.meetingRoom}</p>
                  {selectedMeeting.scheduledTime && (
                    <p>
                      <strong>Scheduled:</strong>{' '}
                      {new Date(selectedMeeting.scheduledTime).toLocaleString()}
                    </p>
                  )}
                  {(selectedMeeting.startTime || selectedMeeting.scheduledTime) && (
                    <p>
                      <strong>Start Time:</strong>{' '}
                      {selectedMeeting.status === 'Scheduled' && selectedMeeting.scheduledTime
                        ? new Date(selectedMeeting.scheduledTime).toLocaleString()
                        : selectedMeeting.startTime
                        ? new Date(selectedMeeting.startTime).toLocaleString()
                        : ''}
                    </p>
                  )}
                  {selectedMeeting.endTime && (
                    <p>
                      <strong>End Time:</strong>{' '}
                      {new Date(selectedMeeting.endTime).toLocaleString()}
                    </p>
                  )}
                  <p><strong>Status:</strong> {selectedMeeting.status}</p>
                  {selectedMeeting.transcriptionEnabled && (
                    <p>
                      <strong>Transcription:</strong>{' '}
                      {selectedMeeting.transcriptionStatus || 'Not Started'}
                    </p>
                  )}
                </div>

                <div className="form-group-inline">
                  {selectedMeeting.status === 'Scheduled' && (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => navigate(`/meetings/${selectedMeeting._id}/room`)}
                    >
                      {T.startMeeting()}
                    </button>
                  )}
                </div>

                {selectedMeeting.status !== 'Completed' && (
                  <div className="form-group-inline" style={{ marginTop: '8px' }}>
                    <button
                      type="button"
                      className="btn btn-danger"
                      onClick={async () => {
                        try {
                          const res = await axios.post(`/meetings/${selectedMeeting._id}/end`);
                          setSelectedMeeting(res.data.meeting);
                          fetchMeetings();
                          
                          // If transcription is enabled, start polling for summary completion
                          if (res.data.meeting.transcriptionEnabled) {
                            setPolling(true);
                            pollForSummary(res.data.meeting._id);
                          } else {
                            // No transcription, redirect to home immediately
                            setTimeout(() => navigate('/'), 2000);
                          }
                        } catch (err) {
                          console.error('Error ending meeting:', err);
                          let serverError =
                            err.response?.data?.error ||
                            err.response?.data?.details ||
                            err.message;
                          setError(serverError || 'Failed to end meeting');
                        }
                      }}
                    >
                      {T.endMeeting()}
                    </button>
                  </div>
                )}

                {selectedMeeting.transcriptionEnabled && (
                  <div className="form-group">
                    <label style={{ color: 'white', fontSize: '15px', fontWeight: '600', marginBottom: '10px', display: 'block' }}>Or upload existing audio file</label>
                    <input
                      type="file"
                      accept="audio/*"
                      onChange={handleAudioUpload}
                      disabled={uploading}
                      style={{
                        width: '100%',
                        padding: '12px',
                        background: 'rgba(255, 255, 255, 0.15)',
                        border: '2px solid rgba(255, 255, 255, 0.3)',
                        borderRadius: '12px',
                        color: 'white',
                        fontSize: '15px',
                        cursor: uploading ? 'not-allowed' : 'pointer'
                      }}
                    />
                    <small style={{ display: 'block', marginTop: '8px', color: 'rgba(255, 255, 255, 0.8)', fontSize: '13px' }}>Use this if you already have a recording.</small>
                  </div>
                )}

                {/* Show "Process Transcription" button if audio exists but transcription hasn't started */}
                {selectedMeeting.audioFile && 
                 selectedMeeting.transcriptionEnabled && 
                 (selectedMeeting.transcriptionStatus === 'Not Started' || selectedMeeting.transcriptionStatus === 'Failed') && (
                  <div className="form-group-inline" style={{ marginTop: '8px' }}>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={async () => {
                        if (!selectedMeeting.audioFile) {
                          setError('No audio file found. Please upload an audio file first.');
                          return;
                        }
                        setUploading(true);
                        setError('');
                        try {
                          // End the meeting (which will trigger transcription if audioFile exists)
                          const res = await axios.post(`/meetings/${selectedMeeting._id}/end`);
                          setSelectedMeeting(res.data.meeting);
                          setPolling(true);
                          pollForSummary(selectedMeeting._id);
                        } catch (err) {
                          console.error('Error processing transcription:', err);
                          let serverError =
                            err.response?.data?.error ||
                            err.response?.data?.details ||
                            err.message;
                          setError(serverError || 'Failed to process transcription');
                        } finally {
                          setUploading(false);
                        }
                      }}
                      disabled={uploading || polling}
                    >
                      {uploading ? 'Processing...' : 'Process Transcription'}
                    </button>
                  </div>
                )}

                {(polling || (selectedMeeting && selectedMeeting.transcriptionEnabled && selectedMeeting.transcriptionStatus === 'Processing')) && (
                  <div style={{ 
                    background: 'rgba(255, 255, 255, 0.1)', 
                    backdropFilter: 'blur(10px)',
                    border: '2px solid rgba(255, 255, 255, 0.2)', 
                    borderRadius: '16px', 
                    padding: '32px', 
                    textAlign: 'center',
                    marginTop: '20px'
                  }}>
                    <div style={{ fontSize: '48px', marginBottom: '16px' }}>⏳</div>
                    <h3 style={{ color: 'white', marginBottom: '8px', fontSize: '20px', fontWeight: '600' }}>Please wait while we generate the summary</h3>
                    <p style={{ color: 'rgba(255, 255, 255, 0.9)', fontSize: '15px' }}>
                      This may take a few minutes. The summary will appear here once ready.
                    </p>
                  </div>
                )}
                
                {/* Success message when summary is sent */}
                {selectedMeeting.summaryStatus === 'Sent' && (
                  <div style={{ 
                    background: 'rgba(34, 197, 94, 0.15)', 
                    backdropFilter: 'blur(10px)',
                    border: '2px solid rgba(34, 197, 94, 0.4)', 
                    borderRadius: '16px', 
                    padding: '32px', 
                    textAlign: 'center',
                    marginTop: '20px'
                  }}>
                    <div style={{ marginBottom: '16px', display: 'flex', justifyContent: 'center' }}>
                      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: '#22c55e' }}>
                        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                        <polyline points="22 4 12 14.01 9 11.01"></polyline>
                      </svg>
                    </div>
                    <h3 style={{ color: 'white', marginBottom: '8px', fontSize: '20px', fontWeight: '600' }}>Summary Sent Successfully!</h3>
                    <p style={{ color: 'rgba(255, 255, 255, 0.9)', fontSize: '15px' }}>
                      The meeting summary has been approved and sent to all participants.
                    </p>
                  </div>
                )}

                {/* Summary ready - no verification step, just open for review/edit */}
                {selectedMeeting.summaryStatus === 'Pending Approval' &&
                  selectedMeeting.transcriptionStatus === 'Completed' &&
                  !editableSummary && selectedMeeting.summary && (
                    <div
                      className="summary-section"
                      style={{
                        border: '2px solid #2563eb',
                        borderRadius: '12px',
                        padding: '24px',
                        marginTop: '20px',
                        background: 'rgba(37, 99, 235, 0.05)',
                      }}
                    >
                      <h3
                        style={{
                          color: 'white',
                          marginBottom: '12px',
                          fontSize: '20px',
                          fontWeight: '600',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '10px',
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
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                          <polyline points="14 2 14 8 20 8"></polyline>
                          <line x1="16" y1="13" x2="8" y2="13"></line>
                          <line x1="16" y1="17" x2="8" y2="17"></line>
                          <polyline points="10 9 9 9 8 9"></polyline>
                        </svg>
                        Summary Ready
                      </h3>
                      <p
                        style={{
                          marginBottom: '16px',
                          color: 'white',
                          fontSize: '15px',
                        }}
                      >
                        The meeting summary has been generated and will be emailed
                        to participants automatically.
                      </p>
                      <p
                        style={{
                          marginBottom: '20px',
                          color: '#9ca3af',
                          fontSize: '13px',
                        }}
                      >
                        You can optionally review and edit the summary before it
                        is sent. Click below to open it.
                      </p>

                      <button
                        className="btn btn-primary"
                        onClick={() => {
                          // Seed editableSummary from pending fields if present, otherwise from final fields.
                          const base = {
                            summary:
                              selectedMeeting.pendingSummary ||
                              selectedMeeting.summary ||
                              '',
                            keyPoints:
                              selectedMeeting.pendingKeyPoints?.length
                                ? selectedMeeting.pendingKeyPoints
                                : selectedMeeting.keyPoints || [],
                            actionItems:
                              selectedMeeting.pendingActionItems?.length
                                ? selectedMeeting.pendingActionItems
                                : selectedMeeting.actionItems || [],
                            decisions:
                              selectedMeeting.pendingDecisions?.length
                                ? selectedMeeting.pendingDecisions
                                : selectedMeeting.decisions || [],
                            nextSteps:
                              selectedMeeting.pendingNextSteps?.length
                                ? selectedMeeting.pendingNextSteps
                                : selectedMeeting.nextSteps || [],
                            importantNotes:
                              selectedMeeting.pendingImportantNotes?.length
                                ? selectedMeeting.pendingImportantNotes
                                : selectedMeeting.importantNotes || []
                          };

                          setEditableSummary(base);
                          setVerificationStep('edit');
                          setError('');
                          setAdditionalParticipants([{ name: '', email: '' }]);
                        }}
                        style={{
                          width: '100%',
                          padding: '16px',
                          fontSize: '16px',
                          fontWeight: '600',
                          marginTop: '8px',
                        }}
                      >
                        View & Edit Summary
                      </button>
                    </div>
                  )}

                {/* Summary View & Edit (ONLY after code is verified) */}
                {verificationStep === 'edit' && editableSummary && (
                  <div className="summary-section" style={{ border: '2px solid #2563eb', borderRadius: '12px', padding: '24px', marginTop: '20px', background: 'rgba(37, 99, 235, 0.05)' }}>
                    <h3 style={{ color: '#2563eb', marginBottom: '20px', fontSize: '20px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                        <polyline points="14 2 14 8 20 8"></polyline>
                        <line x1="16" y1="13" x2="8" y2="13"></line>
                        <line x1="16" y1="17" x2="8" y2="17"></line>
                        <polyline points="10 9 9 9 8 9"></polyline>
                      </svg>
                      {T.meetingSummary()}
                    </h3>
                    
                    <div style={{ display: 'flex', gap: '10px', marginBottom: '20px' }}>
                          <button
                            className="btn btn-secondary"
                            onClick={() => setEditingSummary(!editingSummary)}
                          >
                            {editingSummary ? 'Cancel Edit' : 'Edit Summary'}
                          </button>
                          <button
                            className="btn btn-primary"
                            onClick={async () => {
                              try {
                                const emailToUse = verificationEmail || selectedMeeting.authorizedEditorEmail;
                                
                                // Filter out empty participants
                                const validAdditionalParticipants = additionalParticipants
                                  .filter(p => p.email && p.email.trim())
                                  .map(p => ({
                                    name: p.name.trim() || '',
                                    email: p.email.trim(),
                                    role: 'participant'
                                  }));
                                
                                // Save any edits first
                                if (editingSummary) {
                                  await axios.put(`/meetings/${selectedMeeting._id}/pending-summary`, {
                                    email: emailToUse,
                                    code: verificationCode,
                                    summary: editableSummary.summary,
                                    keyPoints: editableSummary.keyPoints,
                                    actionItems: editableSummary.actionItems,
                                    decisions: editableSummary.decisions,
                                    nextSteps: editableSummary.nextSteps,
                                    importantNotes: editableSummary.importantNotes
                                  });
                                }
                                
                                // Approve and send with additional participants
                                const res = await axios.post(`/meetings/${selectedMeeting._id}/approve-and-send`, {
                                  email: emailToUse,
                                  code: verificationCode,
                                  additionalParticipants: validAdditionalParticipants
                                });
                                setSelectedMeeting(res.data.meeting);
                                setVerificationStep('approved');
                                setError('');
                                const msg = res.data.message || (res.data.emailSent ? 'Summary approved and sent to all participants!' : 'Summary approved and saved. Emails could not be sent (check mail configuration).');
                                alert(msg);
                                setTimeout(() => navigate('/meetings'), 2000);
                              } catch (err) {
                                setError(err.response?.data?.error || 'Failed to save summary');
                              }
                            }}
                          >
                            {editingSummary ? 'Save & Send' : (isEducation ? 'Approve & Send Lecture Notes' : 'Approve & Send')}
                          </button>
                        </div>
                        
                        {editingSummary ? (
                          <div style={{ marginTop: '20px' }}>
                            <div className="form-group">
                              <label style={{ color: 'white', fontSize: '15px', fontWeight: '600', marginBottom: '8px', display: 'block' }}>Minutes of the meeting</label>
                              <textarea
                                value={editableSummary.summary}
                                onChange={e => setEditableSummary({ ...editableSummary, summary: e.target.value })}
                                rows="5"
                                style={{ 
                                  width: '100%', 
                                  padding: '14px', 
                                  background: 'rgba(255, 255, 255, 0.15)',
                                  border: '2px solid rgba(255, 255, 255, 0.3)',
                                  borderRadius: '12px',
                                  color: 'white',
                                  fontSize: '15px',
                                  fontFamily: 'inherit'
                                }}
                              />
                            </div>
                            <div className="form-group">
                              <label style={{ color: 'white', fontSize: '15px', fontWeight: '600', marginBottom: '8px', display: 'block' }}>Key Points (one per line)</label>
                              <textarea
                                value={(editableSummary.keyPoints || []).join('\n')}
                                onChange={e => setEditableSummary({ ...editableSummary, keyPoints: e.target.value.split('\n').filter(l => l.trim()) })}
                                rows="6"
                                style={{ 
                                  width: '100%', 
                                  padding: '14px', 
                                  background: 'rgba(255, 255, 255, 0.15)',
                                  border: '2px solid rgba(255, 255, 255, 0.3)',
                                  borderRadius: '12px',
                                  color: 'white',
                                  fontSize: '15px',
                                  fontFamily: 'inherit'
                                }}
                              />
                            </div>
                            <div className="form-group">
                              <label style={{ color: 'white', fontSize: '15px', fontWeight: '600', marginBottom: '8px', display: 'block' }}>Decisions (one per line)</label>
                              <textarea
                                value={(editableSummary.decisions || []).join('\n')}
                                onChange={e => setEditableSummary({ ...editableSummary, decisions: e.target.value.split('\n').filter(l => l.trim()) })}
                                rows="4"
                                style={{ 
                                  width: '100%', 
                                  padding: '14px', 
                                  background: 'rgba(255, 255, 255, 0.15)',
                                  border: '2px solid rgba(255, 255, 255, 0.3)',
                                  borderRadius: '12px',
                                  color: 'white',
                                  fontSize: '15px',
                                  fontFamily: 'inherit'
                                }}
                              />
                            </div>
                            <div className="form-group">
                              <label style={{ color: 'white', fontSize: '15px', fontWeight: '600', marginBottom: '8px', display: 'block' }}>Next Steps (one per line)</label>
                              <textarea
                                value={(editableSummary.nextSteps || []).join('\n')}
                                onChange={e => setEditableSummary({ ...editableSummary, nextSteps: e.target.value.split('\n').filter(l => l.trim()) })}
                                rows="4"
                                style={{ 
                                  width: '100%', 
                                  padding: '14px', 
                                  background: 'rgba(255, 255, 255, 0.15)',
                                  border: '2px solid rgba(255, 255, 255, 0.3)',
                                  borderRadius: '12px',
                                  color: 'white',
                                  fontSize: '15px',
                                  fontFamily: 'inherit'
                                }}
                              />
                            </div>
                            <div className="form-group">
                              <label style={{ color: 'white', fontSize: '15px', fontWeight: '600', marginBottom: '8px', display: 'block' }}>
                                {isEducation ? 'Important Concepts (one per line)' : 'Important Notes (one per line)'}
                              </label>
                              <textarea
                                value={(editableSummary.importantNotes || []).join('\n')}
                                onChange={e => setEditableSummary({ ...editableSummary, importantNotes: e.target.value.split('\n').filter(l => l.trim()) })}
                                rows="4"
                                style={{ 
                                  width: '100%', 
                                  padding: '14px', 
                                  background: 'rgba(255, 255, 255, 0.15)',
                                  border: '2px solid rgba(255, 255, 255, 0.3)',
                                  borderRadius: '12px',
                                  color: 'white',
                                  fontSize: '15px',
                                  fontFamily: 'inherit'
                                }}
                              />
                            </div>
                            <div className="form-group">
                              <label style={{ color: 'white', fontSize: '15px', fontWeight: '600', marginBottom: '8px', display: 'block' }}>Action Items</label>
                              <small style={{ display: 'block', marginBottom: '10px', color: 'rgba(255, 255, 255, 0.8)', fontSize: '13px' }}>
                                Format: Task | Assignee | Due Date (optional)
                              </small>
                              <textarea
                                value={(editableSummary.actionItems || []).map(item => 
                                  `${item.task || ''} | ${item.assignee || ''} | ${item.dueDate ? new Date(item.dueDate).toLocaleDateString() : ''}`
                                ).join('\n')}
                                onChange={e => {
                                  const lines = e.target.value.split('\n').filter(l => l.trim());
                                  const items = lines.map(line => {
                                    const parts = line.split('|').map(p => p.trim());
                                    return {
                                      task: parts[0] || '',
                                      assignee: parts[1] || '',
                                      dueDate: parts[2] ? new Date(parts[2]) : null
                                    };
                                  });
                                  setEditableSummary({ ...editableSummary, actionItems: items });
                                }}
                                rows="6"
                                style={{ 
                                  width: '100%', 
                                  padding: '14px', 
                                  background: 'rgba(255, 255, 255, 0.15)',
                                  border: '2px solid rgba(255, 255, 255, 0.3)',
                                  borderRadius: '12px',
                                  color: 'white',
                                  fontSize: '15px',
                                  fontFamily: 'monospace'
                                }}
                                placeholder="Complete project documentation | John Doe | 2024-03-15"
                              />
                            </div>
                          </div>
                        ) : (
                          <div style={{ marginTop: '20px' }}>
                            <h4 style={{ color: 'white', fontSize: '18px', fontWeight: '600', marginBottom: '12px' }}>Executive Summary</h4>
                            <p style={{ color: 'rgba(255, 255, 255, 0.95)', fontSize: '15px', lineHeight: '1.7', marginBottom: '20px' }}>{editableSummary.summary}</p>
                            {editableSummary.keyPoints && editableSummary.keyPoints.length > 0 && (
                              <>
                                <h4>Key Points</h4>
                                <ul>
                                  {editableSummary.keyPoints.map((p, idx) => <li key={idx}>{p}</li>)}
                                </ul>
                              </>
                            )}
                            {editableSummary.actionItems && editableSummary.actionItems.length > 0 && (
                              <>
                                <h4>Action Items</h4>
                                <ul>
                                  {editableSummary.actionItems.map((item, idx) => (
                                    <li key={idx}>
                                      <strong>{item.task}</strong>
                                      {item.assignee && ` - ${item.assignee}`}
                                      {item.dueDate && ` (Due: ${new Date(item.dueDate).toLocaleDateString()})`}
                                    </li>
                                  ))}
                                </ul>
                              </>
                            )}
                            
                            {/* Add Additional Participants Section - Only after summary is visible */}
                            <div style={{ 
                              background: 'rgba(255, 255, 255, 0.05)', 
                              border: '1px solid rgba(255, 255, 255, 0.2)', 
                              borderRadius: '12px', 
                              padding: '20px', 
                              marginTop: '24px' 
                            }}>
                              <h4 style={{ color: 'white', marginBottom: '12px', fontSize: '16px' }}>
                                Add Participants Called In During Meeting
                              </h4>
                              <p style={{ color: 'rgba(255, 255, 255, 0.7)', fontSize: '13px', marginBottom: '16px' }}>
                                Add anyone who joined the meeting after it started. They will also receive the summary.
                              </p>
                              {additionalParticipants.map((p, idx) => (
                                <div key={idx} style={{ display: 'flex', gap: '8px', marginBottom: '12px', alignItems: 'center' }}>
                                  <input
                                    type="text"
                                    placeholder="Name"
                                    value={p.name}
                                    onChange={e => {
                                      const updated = [...additionalParticipants];
                                      updated[idx].name = e.target.value;
                                      setAdditionalParticipants(updated);
                                    }}
                                    style={{ 
                                      flex: 1, 
                                      padding: '10px', 
                                      background: 'rgba(255, 255, 255, 0.15)',
                                      border: '2px solid rgba(255, 255, 255, 0.3)',
                                      borderRadius: '8px',
                                      color: 'white',
                                      fontSize: '14px'
                                    }}
                                  />
                                  <input
                                    type="email"
                                    placeholder="Email"
                                    value={p.email}
                                    onChange={e => {
                                      const updated = [...additionalParticipants];
                                      updated[idx].email = e.target.value;
                                      setAdditionalParticipants(updated);
                                    }}
                                    style={{ 
                                      flex: 2, 
                                      padding: '10px', 
                                      background: 'rgba(255, 255, 255, 0.15)',
                                      border: '2px solid rgba(255, 255, 255, 0.3)',
                                      borderRadius: '8px',
                                      color: 'white',
                                      fontSize: '14px'
                                    }}
                                  />
                                  {additionalParticipants.length > 1 && (
                                    <button
                                      type="button"
                                      onClick={() => setAdditionalParticipants(additionalParticipants.filter((_, i) => i !== idx))}
                                      style={{
                                        padding: '10px 16px',
                                        background: 'rgba(239, 68, 68, 0.2)',
                                        border: '1px solid rgba(239, 68, 68, 0.4)',
                                        borderRadius: '8px',
                                        color: '#ef4444',
                                        cursor: 'pointer',
                                        fontSize: '14px',
                                        fontWeight: '600'
                                      }}
                                    >
                                      Remove
                                    </button>
                                  )}
                                </div>
                              ))}
                              <button
                                type="button"
                                onClick={() => setAdditionalParticipants([...additionalParticipants, { name: '', email: '' }])}
                                style={{
                                  padding: '10px 16px',
                                  background: 'rgba(37, 99, 235, 0.2)',
                                  border: '1px solid rgba(37, 99, 235, 0.4)',
                                  borderRadius: '8px',
                                  color: '#60a5fa',
                                  cursor: 'pointer',
                                  fontSize: '14px',
                                  fontWeight: '600'
                                }}
                              >
                                + Add Another Participant
                              </button>
                            </div>
                          </div>
                        )}
                  </div>
                )}
                
                {/* Regular summary display (if already sent) */}
                {selectedMeeting.summary && selectedMeeting.summaryStatus !== 'Pending Approval' && selectedMeeting.summaryStatus !== 'Pending Approval' && (
                  <div className="summary-section" style={{ border: '2px solid rgba(255, 255, 255, 0.2)', borderRadius: '12px', padding: '24px', marginTop: '20px', background: 'rgba(255, 255, 255, 0.1)' }}>
                    <h3 style={{ color: 'white', fontSize: '20px', fontWeight: '600', marginBottom: '16px' }}>
                      {isEducation ? 'AI Generated Lecture Notes' : 'AI Meeting Summary'}
                    </h3>
                    <p style={{ color: 'rgba(255, 255, 255, 0.95)', fontSize: '15px', lineHeight: '1.7', marginBottom: '20px' }}>{selectedMeeting.summary}</p>
                    {!!(selectedMeeting.keyPoints || []).length && (
                      <>
                        <h4 style={{ color: 'white', fontSize: '18px', fontWeight: '600', marginTop: '24px', marginBottom: '12px' }}>Key Points</h4>
                        <ul style={{ color: 'rgba(255, 255, 255, 0.95)', fontSize: '15px', lineHeight: '1.8', paddingLeft: '24px' }}>
                          {selectedMeeting.keyPoints.map((p, idx) => <li key={idx} style={{ marginBottom: '8px' }}>{p}</li>)}
                        </ul>
                      </>
                    )}
                    {selectedMeeting.actionItems && selectedMeeting.actionItems.length > 0 && (
                      <>
                        <h4 style={{ color: 'white', fontSize: '18px', fontWeight: '600', marginTop: '24px', marginBottom: '12px' }}>Action Items</h4>
                        <ul style={{ color: 'rgba(255, 255, 255, 0.95)', fontSize: '15px', lineHeight: '1.8', paddingLeft: '24px' }}>
                          {selectedMeeting.actionItems.map((item, idx) => (
                            <li key={idx} style={{ marginBottom: '8px' }}>
                              <strong style={{ color: 'white' }}>{item.task}</strong>
                              {item.assignee && <span style={{ color: 'rgba(255, 255, 255, 0.8)' }}> - {item.assignee}</span>}
                              {item.dueDate && <span style={{ color: 'rgba(255, 255, 255, 0.7)' }}> (Due: {new Date(item.dueDate).toLocaleDateString()})</span>}
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                    {selectedMeeting.decisions && selectedMeeting.decisions.length > 0 && (
                      <>
                        <h4 style={{ color: 'white', fontSize: '18px', fontWeight: '600', marginTop: '24px', marginBottom: '12px' }}>Decisions Made</h4>
                        <ul style={{ color: 'rgba(255, 255, 255, 0.95)', fontSize: '15px', lineHeight: '1.8', paddingLeft: '24px' }}>
                          {selectedMeeting.decisions.map((d, idx) => <li key={idx} style={{ marginBottom: '8px' }}>{d}</li>)}
                        </ul>
                      </>
                    )}
                    {selectedMeeting.nextSteps && selectedMeeting.nextSteps.length > 0 && (
                      <>
                        <h4 style={{ color: 'white', fontSize: '18px', fontWeight: '600', marginTop: '24px', marginBottom: '12px' }}>Next Steps</h4>
                        <ul style={{ color: 'rgba(255, 255, 255, 0.95)', fontSize: '15px', lineHeight: '1.8', paddingLeft: '24px' }}>
                          {selectedMeeting.nextSteps.map((s, idx) => <li key={idx} style={{ marginBottom: '8px' }}>{s}</li>)}
                        </ul>
                      </>
                    )}
                    {selectedMeeting.importantNotes && selectedMeeting.importantNotes.length > 0 && (
                      <>
                        <h4 style={{ color: 'white', fontSize: '18px', fontWeight: '600', marginTop: '24px', marginBottom: '12px' }}>
                          {isEducation ? 'Important Concepts' : 'Important Notes'}
                        </h4>
                        <ul style={{ color: 'rgba(255, 255, 255, 0.95)', fontSize: '15px', lineHeight: '1.8', paddingLeft: '24px' }}>
                          {selectedMeeting.importantNotes.map((n, idx) => <li key={idx} style={{ marginBottom: '8px' }}>{n}</li>)}
                        </ul>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="meetings-right">
            <div className="card">
                  <div className="card-header">
                    <h2>Recent {T.meetings()}</h2>
              </div>
              <div className="meetings-list">
                {(meetings || []).length === 0 && (
                  <p className="info-text">No meetings created yet.</p>
                )}
                {(meetings || []).map(m => (
                  <div
                    key={m._id}
                    className={`meeting-item ${selectedMeeting && selectedMeeting._id === m._id ? 'active' : ''} ${m.summaryStatus === 'Pending Approval' && m.transcriptionStatus === 'Completed' ? 'needs-approval' : ''}`}
                    onClick={() => navigate(`/meetings/${m._id}`)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(`/meetings/${m._id}`); } }}
                  >
                    <div className="meeting-title">
                      {m.title}
                      {m.summaryStatus === 'Pending Approval' && m.transcriptionStatus === 'Completed' && (
                        <span className="approval-badge" style={{
                          display: 'inline-block',
                          marginLeft: '8px',
                          padding: '2px 8px',
                          background: '#2563eb',
                          color: 'white',
                          borderRadius: '12px',
                          fontSize: '11px',
                          fontWeight: '600'
                        }}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: '4px' }}>
                            <circle cx="12" cy="12" r="10"></circle>
                            <line x1="12" y1="8" x2="12" y2="12"></line>
                            <line x1="12" y1="16" x2="12.01" y2="16"></line>
                          </svg>
                          Needs Approval
                        </span>
                      )}
                    </div>
                    <div className="meeting-meta">
                      <span>{m.meetingRoom || 'No location'}</span>
                      <span>{m.status}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
        </div>
      </div>
    </div>
  );
};

export default MeetingsScreen;


import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Calendar, CheckSquare } from 'lucide-react';
import TopNav from './TopNav';
import { T } from '../config/terminology';
import {
  VOICE_ENROLLMENT_API_TEMPLATE,
  VOICE_ENROLLMENT_BOOK_PHRASE,
  voiceEnrollmentSentenceForParticipant,
} from '../utils/voiceEnrollment';
import './Participants.css';

// Max participants in the book by subscription plan (workplace and education share until edu tiers exist).
const MAX_IN_BOOK_BY_PLAN = {
  starter: 30,
  professional: 60,
  business: 100,
  institutional: 500,
};

const Participants = () => {
  const [participants, setParticipants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newParticipant, setNewParticipant] = useState({ name: '', email: '' });
  const [maxInBook, setMaxInBook] = useState(null); // null = unlimited or unknown

  // Voice configuration state
  const [voiceProfiles, setVoiceProfiles] = useState({}); // { email: { hasProfile, name } }
  const [recordingEmail, setRecordingEmail] = useState(null);
  const [voiceMediaRecorder, setVoiceMediaRecorder] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [noiseLevel, setNoiseLevel] = useState(null); // 0..1
  const [noiseLabel, setNoiseLabel] = useState(''); // Too quiet / Good / Too noisy
  const audioCtxRef = React.useRef(null);
  const analyserRef = React.useRef(null);
  const rafRef = React.useRef(null);
  const streamForMeterRef = React.useRef(null);
  const noiseEmaRef = React.useRef(0);
  const noiseLabelTickRef = React.useRef(0);
  const noiseLabelBufferRef = React.useRef([]);

  useEffect(() => {
    loadParticipants();
  }, []);

  const saveParticipantsToServer = async (list) => {
    const slim = list.map((p) => ({
      name: (p.name && String(p.name).trim()) || '',
      email: (p.email && String(p.email).trim().toLowerCase()) || '',
    })).filter((p) => p.name || p.email);
    try {
      await axios.put('/admin/participant-book', { participants: slim });
    } catch (err) {
      console.error('Error saving participant book:', err);
      throw err;
    }
  };

  useEffect(() => {
    const fetchPlan = async () => {
      try {
        const res = await axios.get('/admin/profile');
        const plan = (res.data?.admin?.plan || 'starter').toLowerCase();
        if (MAX_IN_BOOK_BY_PLAN[plan] != null) {
          setMaxInBook(MAX_IN_BOOK_BY_PLAN[plan]);
        } else {
          setMaxInBook(null);
        }
      } catch (e) {
        setMaxInBook(null);
      }
    };
    fetchPlan();
  }, []);

  useEffect(() => {
    // Whenever participants list changes, refresh voice profiles for their emails
    const emails = participants
      .filter(p => p.email && p.email.trim())
      .map(p => p.email.trim());

    if (emails.length > 0) {
      fetchVoiceProfiles(emails);
    }
  }, [participants]);

  const loadParticipants = async () => {
    try {
      const res = await axios.get('/admin/participant-book');
      const list = res.data?.participants;
      if (Array.isArray(list)) {
        setParticipants(list);
      }
    } catch (e) {
      // If 403 NO_SUBSCRIPTION, interceptor redirects. Otherwise fallback to localStorage for migration.
      try {
        const stored = localStorage.getItem('workplace_meeting_participants');
        if (stored) {
          const parsed = JSON.parse(stored);
          if (Array.isArray(parsed) && parsed.length > 0) {
            setParticipants(parsed);
            await axios.put('/admin/participant-book', { participants: parsed });
          }
        }
      } catch (_) {}
      if (e.response?.status !== 403) console.error('Error loading participant book:', e);
    } finally {
      setLoading(false);
    }
  };

  const fetchVoiceProfiles = async (emails) => {
    try {
      const res = await axios.get(`/meetings/voice/profiles?emails=${emails.join(',')}`);
      const profilesMap = {};
      emails.forEach(email => {
        const profile = res.data.profiles.find(
          p => p.email.toLowerCase() === email.toLowerCase()
        );
        profilesMap[email] = {
          hasProfile: !!profile,
          name: profile?.name || ''
        };
      });
      setVoiceProfiles(profilesMap);
    } catch (err) {
      console.error('Error fetching voice profiles for participants:', err);
    }
  };

  const handleAddParticipant = async (e) => {
    e.preventDefault();
    if (!newParticipant.name.trim() || !newParticipant.email.trim()) {
      alert('Please fill in both name and email');
      return;
    }
    if (maxInBook != null && participants.length >= maxInBook) {
      alert("You've reached your plan limit. Please upgrade to add more.");
      return;
    }

    const updated = [
      ...participants,
      {
        name: newParticipant.name.trim(),
        email: newParticipant.email.trim().toLowerCase(),
      },
    ];

    setParticipants(updated);
    try {
      await saveParticipantsToServer(updated);
    } catch (err) {
      const msg = err.response?.data?.error || '';
      const isLimitError = /plan allows|participant book|max participants/i.test(msg);
      alert(isLimitError ? "You've reached your plan limit. Please upgrade to add more." : (msg || 'Failed to save. Try again.'));
      return;
    }
    setNewParticipant({ name: '', email: '' });
    setShowAddForm(false);
  };

  const handleDeleteParticipant = async (index) => {
    if (!window.confirm('Remove this participant?')) return;
    const updated = participants.filter((_, i) => i !== index);
    setParticipants(updated);
    try {
      await saveParticipantsToServer(updated);
    } catch (err) {
      setParticipants(participants);
      alert(err.response?.data?.error || 'Failed to save. Try again.');
    }
  };

  const startVoiceRecording = async (participant) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamForMeterRef.current = stream;

      // Live noise/volume indicator using Web Audio API
      try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (AudioContext) {
          const ctx = new AudioContext();
          const source = ctx.createMediaStreamSource(stream);
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 2048;
          source.connect(analyser);
          audioCtxRef.current = ctx;
          analyserRef.current = analyser;

          const data = new Uint8Array(analyser.fftSize);
          noiseEmaRef.current = 0;
          noiseLabelTickRef.current = performance.now();
          noiseLabelBufferRef.current = [];
          const tick = () => {
            if (!analyserRef.current) return;
            analyserRef.current.getByteTimeDomainData(data);
            let sum = 0;
            for (let i = 0; i < data.length; i++) {
              const v = (data[i] - 128) / 128; // -1..1
              sum += v * v;
            }
            const rms = Math.sqrt(sum / data.length); // 0..~1
            const level = Math.min(1, Math.max(0, rms * 2.2));
            // EMA so the bar does not jitter frame-to-frame
            noiseEmaRef.current = noiseEmaRef.current * 0.82 + level * 0.18;
            const smooth = noiseEmaRef.current;
            setNoiseLevel(smooth);

            const buf = noiseLabelBufferRef.current;
            buf.push(level);
            if (buf.length > 22) buf.shift();

            const now = performance.now();
            if (now - noiseLabelTickRef.current >= 220) {
              noiseLabelTickRef.current = now;
              const avg = buf.length ? buf.reduce((a, b) => a + b, 0) / buf.length : smooth;
              let next = 'Good';
              if (avg < 0.085) next = 'Too quiet';
              else if (avg > 0.62) next = 'Too noisy';
              setNoiseLabel(next);
            }
            rafRef.current = requestAnimationFrame(tick);
          };
          rafRef.current = requestAnimationFrame(tick);
        }
      } catch (meterErr) {
        // If meter fails, recording still works
        setNoiseLevel(null);
        setNoiseLabel('');
      }

      const mediaRecorder = new MediaRecorder(stream);
      const audioChunks = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunks.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
        await uploadVoiceSample(audioBlob, participant);
        stream.getTracks().forEach(track => track.stop());

        // Cleanup noise meter
        try {
          if (rafRef.current) cancelAnimationFrame(rafRef.current);
        } catch (_) {}
        rafRef.current = null;
        analyserRef.current = null;
        try {
          if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
            await audioCtxRef.current.close();
          }
        } catch (_) {}
        audioCtxRef.current = null;
        setNoiseLevel(null);
        setNoiseLabel('');
        noiseEmaRef.current = 0;
        noiseLabelBufferRef.current = [];
      };

      mediaRecorder.start();
      setVoiceMediaRecorder(mediaRecorder);
      setRecordingEmail(participant.email);
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

  const uploadVoiceSample = async (audioBlob, targetParticipant) => {
    try {
      setUploading(true);
      setError('');

      const participantList = participants
        .filter(p => p.email && p.email.trim())
        .map(p => ({
          name: p.name || '',
          email: p.email.trim()
        }));

      const formData = new FormData();
      const audioFile = new File(
        [audioBlob],
        `voice-sample-${Date.now()}.webm`,
        { type: 'audio/webm' }
      );
      formData.append('audio', audioFile);
      formData.append('participants', JSON.stringify(participantList));
      formData.append(
        'standardSentence',
        VOICE_ENROLLMENT_API_TEMPLATE
      );

      if (targetParticipant && targetParticipant.email) {
        formData.append('email', targetParticipant.email.trim());
        if (targetParticipant.name) {
          formData.append('name', targetParticipant.name);
        }
      }

      const res = await axios.post('/meetings/voice/register', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });

      const matchedEmail = res.data.voiceProfile?.email;
      const matchedName = res.data.voiceProfile?.name;
      const wasAutoMatched = res.data.autoMatched;

      if (matchedEmail) {
        setVoiceProfiles(prev => ({
          ...prev,
          [matchedEmail]: { hasProfile: true, name: matchedName }
        }));

        setRecordingEmail(null);
        setUploading(false);

        const message = wasAutoMatched
          ? `Thank you ${matchedName}! Your voice has been automatically configured and assigned to your participant profile.`
          : `Thank you ${matchedName}! Your voice has been configured successfully.`;
        alert(message);

        const emails = participantList.map(p => p.email);
        if (emails.length > 0) {
          fetchVoiceProfiles(emails);
        }
      } else {
        throw new Error('Could not determine which participant this voice belongs to');
      }
    } catch (err) {
      console.error('Error uploading voice sample:', err);
      const d = err.response?.data;
      const errorMsg =
        [d?.error, d?.details].filter(Boolean).join(' — ') ||
        err.message ||
        'Failed to register voice profile. Please try again.';
      setError(errorMsg);
      setRecordingEmail(null);
      setUploading(false);
    }
  };

  if (loading) {
    return (
      <div className="participants-screen">
        <TopNav />
        <div className="participants-wrapper">
          <div className="participants-content">
            <div className="loading">Loading...</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="participants-screen">
      <TopNav />
      <div className="participants-wrapper">
        <div className="participants-top-bar">
          <div>
            <h1 className="participants-title">Team Intelligence</h1>
            <p className="participants-intel-lead">
              {T.participantBook()} — execution context for voice, meetings, and assignments.
            </p>
            {maxInBook != null && (
              <p className="participants-limit-hint">{participants.length} / {maxInBook} participants</p>
            )}
          </div>
          <button 
            className="btn btn-primary"
            onClick={() => setShowAddForm(!showAddForm)}
            type="button"
          >
            {!showAddForm && (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                <line x1="12" y1="5" x2="12" y2="19"></line>
                <line x1="5" y1="12" x2="19" y2="12"></line>
              </svg>
            )}
            {showAddForm ? 'Cancel' : 'Add Participant'}
          </button>
        </div>
        
        <div className="participants-content">
          {showAddForm && (
            <div className="add-participant-form">
              <h2>Add New to {T.participantBook()}</h2>
              <form onSubmit={handleAddParticipant}>
                <div className="form-group">
                  <label>Name</label>
                  <input
                    type="text"
                    value={newParticipant.name}
                    onChange={(e) => setNewParticipant({ ...newParticipant, name: e.target.value })}
                    placeholder="Enter name"
                    className="form-input"
                    required
                  />
                </div>
                <div className="form-group">
                  <label>Email</label>
                  <input
                    type="email"
                    value={newParticipant.email}
                    onChange={(e) => setNewParticipant({ ...newParticipant, email: e.target.value })}
                    placeholder="Enter email"
                    className="form-input"
                    required
                  />
                </div>
                <div className="form-actions">
                  <button type="submit" className="btn btn-primary">Add Participant</button>
                  <button type="button" className="btn btn-secondary" onClick={() => setShowAddForm(false)}>Cancel</button>
                </div>
              </form>
            </div>
          )}

          {/* Voice configuration guide */}
          <div className="voice-guide-card">
            <h2>Voice configuration guide</h2>
            <p>
              Configure a clear voice sample for each participant so the AI can
              attribute speech correctly during the meeting.
            </p>
            <p className="voice-guide-accuracy-note">
              This improves speaker identification accuracy in future meetings.
            </p>
            <ol>
              <li>Click <strong>Configure Voice</strong> on a participant card.</li>
              <li>
                Ask them to clearly say: <em>“{VOICE_ENROLLMENT_BOOK_PHRASE}”</em>
              </li>
              <li>Wait for the upload to finish. The status will change to “Voice configured”.</li>
            </ol>
            <p
              style={{
                marginTop: '8px',
                fontSize: '12px',
                color: 'rgba(148, 163, 184, 0.95)',
                fontStyle: 'italic',
              }}
            >
              Voice recognition is AI-assisted and may not be 100% accurate at all times.
              Please review meeting summaries and speaker attributions before sharing.
            </p>
          </div>

          {participants.length === 0 ? (
            <div className="empty-state">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ color: 'var(--text-secondary)', marginBottom: '16px' }}>
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                <circle cx="9" cy="7" r="4"></circle>
                <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
              </svg>
              <p>No team members saved yet</p>
              <p className="empty-state-sub">Start a meeting to begin tracking insights.</p>
              <button className="btn btn-primary" onClick={() => setShowAddForm(true)}>
                Add First Participant
              </button>
            </div>
          ) : (
            <>
            <h2 className="participants-section-heading">Team Members</h2>
            <div className="participants-grid">
              {participants.map((p, idx) => {
                const participantName = p.name || p.email || 'This participant';
                const standardSentence = voiceEnrollmentSentenceForParticipant(participantName);
                return (
                <div key={idx} className="participant-card">
                  <div className="participant-list-initials" aria-hidden>
                    {(p.name || p.email || '?').trim().charAt(0).toUpperCase()}
                  </div>
                  <div className="participant-info">
                    <div className="participant-name">{p.name || 'Unnamed'}</div>
                    <div className="participant-email">{p.email || 'No email'}</div>
                    <div className="participant-intel-stats" aria-label="Meetings and tasks">
                      <span className="participant-intel-stat">
                        <Calendar className="participant-intel-icon" strokeWidth={1.5} aria-hidden />
                        <span className="participant-intel-stat-num">{p.meetingsAttended ?? 0}</span>
                        <span className="participant-intel-stat-label">meetings</span>
                      </span>
                      <span className="participant-intel-stat">
                        <CheckSquare className="participant-intel-icon" strokeWidth={1.5} aria-hidden />
                        <span className="participant-intel-stat-num">{p.tasksAssigned ?? 0}</span>
                        <span className="participant-intel-stat-label">tasks</span>
                      </span>
                    </div>
                    {p.email && p.email.trim() && (
                      <div className="participant-voice-block">
                        <div className="participant-voice-row__top">
                          <span className="participant-voice-status">
                            {voiceProfiles[p.email]?.hasProfile
                              ? 'Voice configured'
                              : 'Voice not configured'}
                          </span>
                          <button
                            type="button"
                            className="participant-voice-btn"
                            disabled={uploading && recordingEmail === p.email}
                            onClick={() => {
                              if (recordingEmail === p.email) {
                                stopVoiceRecording();
                              } else {
                                startVoiceRecording(p);
                              }
                            }}
                          >
                            {recordingEmail === p.email
                              ? 'Stop & Save'
                              : voiceProfiles[p.email]?.hasProfile
                                ? 'Re-record'
                                : 'Configure Voice'}
                          </button>
                        </div>
                        {recordingEmail === p.email && (
                          <>
                            <div className="participant-voice-meter" aria-live="polite">
                              <div
                                className="participant-voice-meter__bar-wrap"
                                aria-label="Microphone level"
                              >
                                <div className="participant-voice-meter__bar">
                                  <div
                                    className="participant-voice-meter__bar-fill"
                                    data-level-state={
                                      !noiseLabel
                                        ? 'idle'
                                        : noiseLabel === 'Good'
                                          ? 'good'
                                          : noiseLabel === 'Too noisy'
                                            ? 'noisy'
                                            : 'quiet'
                                    }
                                    style={{
                                      width:
                                        noiseLevel == null
                                          ? '0%'
                                          : `${Math.round(Math.min(1, noiseLevel) * 100)}%`,
                                    }}
                                  />
                                </div>
                              </div>
                              <span
                                className="participant-voice-meter__label"
                                data-level-state={
                                  !noiseLabel
                                    ? 'idle'
                                    : noiseLabel === 'Good'
                                      ? 'good'
                                      : noiseLabel === 'Too noisy'
                                        ? 'noisy'
                                        : 'quiet'
                                }
                              >
                                {noiseLabel || 'Listening…'}
                              </span>
                            </div>
                            <p className="participant-voice-tip">
                              Tip: speak clearly ~15–25cm from the mic in a quiet room.
                            </p>
                            <p className="participant-voice-hint">
                              <span className="participant-voice-hint__lead">
                                Ask {participantName} to say:
                              </span>
                              <span className="participant-voice-hint__quote">
                                &ldquo;{standardSentence}&rdquo;
                              </span>
                            </p>
                          </>
                        )}
                      </div>
                    )}
                    {uploading && recordingEmail === p.email && (
                      <div className="participant-voice-uploading">Uploading voice sample...</div>
                    )}
                  </div>
                  <button 
                    className="participant-delete"
                    onClick={() => handleDeleteParticipant(idx)}
                    title="Remove participant"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <line x1="18" y1="6" x2="6" y2="18"></line>
                      <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                  </button>
                </div>
              )})}
            </div>
            </>
          )}
        </div>
      </div>

    </div>
  );
};

export default Participants;

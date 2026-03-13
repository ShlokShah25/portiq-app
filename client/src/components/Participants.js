import React, { useState, useEffect } from 'react';
import axios from 'axios';
import TopNav from './TopNav';
import { T } from '../config/terminology';
import './Participants.css';

const Participants = () => {
  const [participants, setParticipants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newParticipant, setNewParticipant] = useState({ name: '', email: '', remember: true });

  // Voice configuration state
  const [voiceProfiles, setVoiceProfiles] = useState({}); // { email: { hasProfile, name } }
  const [recordingEmail, setRecordingEmail] = useState(null);
  const [voiceMediaRecorder, setVoiceMediaRecorder] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    loadParticipants();
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

  const loadParticipants = () => {
    try {
      const stored = localStorage.getItem('workplace_meeting_participants');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          setParticipants(parsed);
        }
      }
    } catch (e) {
      console.error('Error loading participants:', e);
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

  const handleAddParticipant = (e) => {
    e.preventDefault();
    if (!newParticipant.name.trim() || !newParticipant.email.trim()) {
      alert('Please fill in both name and email');
      return;
    }

    const updated = [...participants, { 
      name: newParticipant.name.trim(), 
      email: newParticipant.email.trim().toLowerCase(),
      remember: newParticipant.remember
    }];
    
    setParticipants(updated);
    localStorage.setItem('workplace_meeting_participants', JSON.stringify(updated));
    setNewParticipant({ name: '', email: '', remember: true });
    setShowAddForm(false);
  };

  const handleDeleteParticipant = (index) => {
    if (window.confirm('Remove this participant?')) {
      const updated = participants.filter((_, i) => i !== index);
      setParticipants(updated);
      localStorage.setItem('workplace_meeting_participants', JSON.stringify(updated));
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
        await uploadVoiceSample(audioBlob);
        stream.getTracks().forEach(track => track.stop());
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

  const uploadVoiceSample = async (audioBlob) => {
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
        'Hello, my name is [Your Name] and I am ready for the meeting.'
      );

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
      const errorMsg =
        err.response?.data?.error ||
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
          <h1 className="participants-title">{T.participants()}</h1>
          <button 
            className="btn btn-primary"
            onClick={() => setShowAddForm(!showAddForm)}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
            {showAddForm ? 'Cancel' : 'Add Participant'}
          </button>
        </div>
        
        <div className="participants-content">
          {showAddForm && (
            <div className="add-participant-form">
              <h2>Add New {T.participants()}</h2>
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
                <div className="form-group">
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={newParticipant.remember}
                      onChange={(e) => setNewParticipant({ ...newParticipant, remember: e.target.checked })}
                    />
                    <span>Remember for future meetings</span>
                  </label>
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
              Configure a short voice sample for each participant so the AI can
              attribute speech correctly during the meeting.
            </p>
            <ol>
              <li>Click <strong>Configure Voice</strong> on a participant card.</li>
              <li>
                Ask them to clearly say:{' '}
                <em>
                  “Hello, my name is{' '}
                  {participants[0]?.name || 'your name'} and I am ready for the
                  meeting.”
                </em>
              </li>
              <li>Wait for the upload to finish. The status will change to “Voice configured”.</li>
            </ol>
          </div>

          {participants.length === 0 ? (
            <div className="empty-state">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ color: 'var(--text-secondary)', marginBottom: '16px' }}>
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                <circle cx="9" cy="7" r="4"></circle>
                <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
              </svg>
              <p>No saved participants</p>
              <button className="btn btn-primary" onClick={() => setShowAddForm(true)}>
                Add First Participant
              </button>
            </div>
          ) : (
            <div className="participants-grid">
              {participants.map((p, idx) => {
                const participantName = p.name || p.email || 'This participant';
                const standardSentence = `Hello, my name is ${participantName} and I am ready for the meeting.`;
                return (
                <div key={idx} className="participant-card">
                  <div className="participant-avatar">
                    {(p.name || p.email || '?').charAt(0).toUpperCase()}
                  </div>
                  <div className="participant-info">
                    <div className="participant-name">{p.name || 'Unnamed'}</div>
                    <div className="participant-email">{p.email || 'No email'}</div>
                    {p.email && p.email.trim() && (
                      <div className="participant-voice-row">
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
                          {recordingEmail === p.email ? 'Stop & Save' : (voiceProfiles[p.email]?.hasProfile ? 'Re-record' : 'Configure Voice')}
                        </button>
                        {recordingEmail === p.email && (
                          <div
                            className="participant-voice-hint"
                            style={{
                              marginTop: '6px',
                              fontSize: '11px',
                              color: 'rgba(148, 163, 184, 0.9)',
                              fontStyle: 'italic',
                            }}
                          >
                            Ask {participantName} to say: “{standardSentence}”
                          </div>
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
          )}
        </div>
      </div>
    </div>
  );
};

export default Participants;

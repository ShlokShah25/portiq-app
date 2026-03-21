import React, { useState, useEffect } from 'react';
import axios from 'axios';
import TopNav from './TopNav';
import { T } from '../config/terminology';
import CameraIcon from './icons/CameraIcon';
import './Participants.css';

// Max participants allowed in the participant book by plan (workplace). null = no limit.
const MAX_IN_BOOK_BY_PLAN = { starter: 30, professional: 60, business: 100 };

const Participants = () => {
  const [participants, setParticipants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newParticipant, setNewParticipant] = useState({ name: '', email: '', photo: '', remember: true });
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
  const photoEditInputRef = React.useRef(null);
  const newPhotoLibraryRef = React.useRef(null);
  const photoEditIndexRef = React.useRef(null);
  const [photoSourceMenuIndex, setPhotoSourceMenuIndex] = useState(null);
  const [photoLightboxUrl, setPhotoLightboxUrl] = useState(null);

  /** Live camera (getUserMedia) — file input + capture= often opens gallery on desktop */
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraTarget, setCameraTarget] = useState(null); // { type: 'new' } | { type: 'edit', index }
  const videoRef = React.useRef(null);
  const cameraStreamRef = React.useRef(null);

  useEffect(() => {
    loadParticipants();
  }, []);

  useEffect(() => {
    if (!photoLightboxUrl) return;
    const onKey = (e) => {
      if (e.key === 'Escape') setPhotoLightboxUrl(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [photoLightboxUrl]);

  useEffect(() => {
    if (photoSourceMenuIndex == null) return;
    const onDoc = (e) => {
      const el = e.target.closest('[data-photo-menu]');
      if (el && el.getAttribute('data-photo-menu') === String(photoSourceMenuIndex)) return;
      setPhotoSourceMenuIndex(null);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [photoSourceMenuIndex]);

  const saveParticipantsToServer = async (list) => {
    try {
      await axios.put('/admin/participant-book', { participants: list });
    } catch (err) {
      console.error('Error saving participant book:', err);
      throw err;
    }
  };

  const stopCameraStream = () => {
    const s = cameraStreamRef.current;
    if (s) {
      s.getTracks().forEach((t) => t.stop());
      cameraStreamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  };

  useEffect(() => {
    if (!cameraOpen) return;
    let cancelled = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        cameraStreamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
      } catch (err) {
        const msg =
          err?.name === 'NotAllowedError'
            ? 'Camera permission denied. Allow camera access or use Choose file.'
            : err?.message || 'Could not open camera.';
        alert(msg);
        setCameraOpen(false);
        setCameraTarget(null);
      }
    })();
    return () => {
      cancelled = true;
      stopCameraStream();
    };
  }, [cameraOpen]);

  const closeCameraModal = () => {
    stopCameraStream();
    setCameraOpen(false);
    setCameraTarget(null);
  };

  const openCameraModal = (target) => {
    setPhotoSourceMenuIndex(null);
    setCameraTarget(target);
    setCameraOpen(true);
  };

  const applyPhotoDataUrlToParticipantIndex = async (idx, dataUrl) => {
    const prev = participants;
    const updated = prev.map((p, i) => (i === idx ? { ...p, photo: dataUrl } : p));
    setParticipants(updated);
    try {
      await saveParticipantsToServer(updated);
    } catch (saveErr) {
      setParticipants(prev);
      alert(saveErr.response?.data?.error || 'Failed to save photo.');
    }
  };

  const captureFromCamera = () => {
    const video = videoRef.current;
    const target = cameraTarget;
    if (!video || !video.videoWidth || !target) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0);
    let dataUrl;
    try {
      dataUrl = canvas.toDataURL('image/jpeg', 0.92);
    } catch (e) {
      alert('Could not capture image.');
      return;
    }
    closeCameraModal();
    if (target.type === 'new') {
      setNewParticipant((p) => ({ ...p, photo: dataUrl }));
    } else if (target.type === 'edit' && typeof target.index === 'number') {
      applyPhotoDataUrlToParticipantIndex(target.index, dataUrl);
    }
  };

  useEffect(() => {
    const fetchPlan = async () => {
      try {
        const res = await axios.get('/admin/profile');
        const product = (res.data?.admin?.productType || 'workplace').toLowerCase();
        const plan = (res.data?.admin?.plan || 'starter').toLowerCase();
        if (product === 'workplace' && MAX_IN_BOOK_BY_PLAN[plan] != null) {
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

    const updated = [...participants, { 
      name: newParticipant.name.trim(), 
      email: newParticipant.email.trim().toLowerCase(),
      photo: newParticipant.photo || '',
      remember: newParticipant.remember
    }];
    
    setParticipants(updated);
    try {
      await saveParticipantsToServer(updated);
    } catch (err) {
      const msg = err.response?.data?.error || '';
      const isLimitError = /plan allows|participant book|max participants/i.test(msg);
      alert(isLimitError ? "You've reached your plan limit. Please upgrade to add more." : (msg || 'Failed to save. Try again.'));
      return;
    }
    setNewParticipant({ name: '', email: '', photo: '', remember: true });
    setShowAddForm(false);
  };

  const validateImageFile = (file) => {
    if (!file) return { ok: false, error: null };
    if (!file.type.startsWith('image/')) {
      return { ok: false, error: 'Please select an image file.' };
    }
    if (file.size > 2 * 1024 * 1024) {
      return { ok: false, error: 'Image size must be under 2MB.' };
    }
    return { ok: true, error: null };
  };

  const readImageFileAsDataUrl = (file) =>
    new Promise((resolve, reject) => {
      const v = validateImageFile(file);
      if (!v.ok) {
        if (v.error) reject(new Error(v.error));
        else resolve('');
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const result = typeof reader.result === 'string' ? reader.result : '';
        resolve(result);
      };
      reader.onerror = () => reject(new Error('Could not read file.'));
      reader.readAsDataURL(file);
    });

  const handlePhotoChange = (file) => {
    if (!file) {
      setNewParticipant((prev) => ({ ...prev, photo: '' }));
      return;
    }
    readImageFileAsDataUrl(file)
      .then((dataUrl) => setNewParticipant((prev) => ({ ...prev, photo: dataUrl })))
      .catch((err) => alert(err.message || 'Invalid image.'));
  };

  const togglePhotoSourceMenu = (index) => {
    setPhotoSourceMenuIndex((prev) => (prev === index ? null : index));
  };

  const openPhotoLibraryForIndex = (index) => {
    photoEditIndexRef.current = index;
    setPhotoSourceMenuIndex(null);
    requestAnimationFrame(() => {
      if (photoEditInputRef.current) {
        photoEditInputRef.current.value = '';
        photoEditInputRef.current.click();
      }
    });
  };

  const openPhotoCameraForIndex = (index) => {
    photoEditIndexRef.current = index;
    openCameraModal({ type: 'edit', index });
  };

  const handleExistingPhotoFile = async (e) => {
    const file = e.target.files && e.target.files[0];
    const idx = photoEditIndexRef.current;
    photoEditIndexRef.current = null;
    if (e.target) e.target.value = '';
    if (idx == null || idx === undefined || !file) return;

    try {
      const dataUrl = await readImageFileAsDataUrl(file);
      const prev = participants;
      const updated = prev.map((p, i) =>
        i === idx ? { ...p, photo: dataUrl } : p
      );
      setParticipants(updated);
      try {
        await saveParticipantsToServer(updated);
      } catch (saveErr) {
        setParticipants(prev);
        alert(saveErr.response?.data?.error || 'Failed to save photo.');
      }
    } catch (err) {
      alert(err.message || 'Failed to update photo.');
    }
  };

  const handleRemoveParticipantPhoto = async (index) => {
    const prev = participants;
    const updated = prev.map((p, i) =>
      i === index ? { ...p, photo: '' } : p
    );
    setParticipants(updated);
    try {
      await saveParticipantsToServer(updated);
    } catch (err) {
      setParticipants(prev);
      alert(err.response?.data?.error || 'Failed to remove photo.');
    }
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
          const tick = () => {
            if (!analyserRef.current) return;
            analyserRef.current.getByteTimeDomainData(data);
            let sum = 0;
            for (let i = 0; i < data.length; i++) {
              const v = (data[i] - 128) / 128; // -1..1
              sum += v * v;
            }
            const rms = Math.sqrt(sum / data.length); // 0..~1
            // Smooth a bit by clamping
            const level = Math.min(1, Math.max(0, rms * 2.2));
            setNoiseLevel(level);
            let label = '';
            if (level < 0.12) label = 'Too quiet';
            else if (level > 0.75) label = 'Too noisy';
            else label = 'Good';
            setNoiseLabel(label);
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
        'Hello, my name is [Your Name]. This is my sample voice for PortIQ so the system can recognize me clearly in future meetings.'
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
      <input
        ref={photoEditInputRef}
        type="file"
        accept="image/*"
        className="participant-photo-file-hidden"
        aria-hidden="true"
        tabIndex={-1}
        onChange={handleExistingPhotoFile}
      />
      <div className="participants-wrapper">
        <div className="participants-top-bar">
          <div>
            <h1 className="participants-title">{T.participantBook()}</h1>
            {maxInBook != null && (
              <p className="participants-limit-hint">{participants.length} / {maxInBook} participants</p>
            )}
          </div>
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
                <div className="form-group">
                  <label>Photograph (optional)</label>
                  <input
                    ref={newPhotoLibraryRef}
                    type="file"
                    accept="image/*"
                    className="participant-photo-file-hidden"
                    aria-hidden="true"
                    tabIndex={-1}
                    onChange={(e) => {
                      handlePhotoChange(e.target.files && e.target.files[0]);
                      if (e.target) e.target.value = '';
                    }}
                  />
                  <div className="participant-add-photo-row">
                    <button
                      type="button"
                      className="participant-add-photo-btn"
                      onClick={() => newPhotoLibraryRef.current && newPhotoLibraryRef.current.click()}
                    >
                      Choose file
                    </button>
                    <button
                      type="button"
                      className="participant-add-photo-btn"
                      onClick={() => openCameraModal({ type: 'new' })}
                    >
                      Take photo
                    </button>
                  </div>
                  {newParticipant.photo && (
                    <div className="participant-photo-preview-wrap">
                      <img src={newParticipant.photo} alt="Preview" className="participant-photo-preview" />
                    </div>
                  )}
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
              Configure a clear voice sample for each participant so the AI can
              attribute speech correctly during the meeting.
            </p>
            <ol>
              <li>Click <strong>Configure Voice</strong> on a participant card.</li>
              <li>
                Ask them to clearly say:{' '}
                <em>
                  “Hello, my name is {'{Your name}'}. This is my sample voice for
                  PortIQ so the system can recognize me clearly in future meetings.”
                </em>
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
              <p>No saved participants</p>
              <button className="btn btn-primary" onClick={() => setShowAddForm(true)}>
                Add First Participant
              </button>
            </div>
          ) : (
            <div className="participants-grid">
              {participants.map((p, idx) => {
                const participantName = p.name || p.email || 'This participant';
                const standardSentence = `Hello, my name is ${participantName}. This is my sample voice for PortIQ so the system can recognize me clearly in future meetings.`;
                return (
                <div key={idx} className="participant-card">
                  <div
                    className="participant-avatar-wrap"
                    data-photo-menu={idx}
                  >
                    {p.photo ? (
                      <div
                        role="button"
                        tabIndex={0}
                        className="participant-avatar-face"
                        onClick={() => setPhotoLightboxUrl(p.photo)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setPhotoLightboxUrl(p.photo);
                          }
                        }}
                        title="View full photo"
                        aria-label="View full photo"
                      >
                        <div className="participant-avatar-clip">
                          <img src={p.photo} alt="" />
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="participant-avatar-btn"
                        onClick={() => togglePhotoSourceMenu(idx)}
                        title="Add photo"
                        aria-label="Add photo"
                        aria-expanded={photoSourceMenuIndex === idx}
                      >
                        <CameraIcon className="participant-avatar-camera-icon" size={22} />
                      </button>
                    )}
                    {photoSourceMenuIndex === idx && (
                      <div className="participant-photo-source-popover" role="menu">
                        <button
                          type="button"
                          role="menuitem"
                          className="participant-photo-source-item"
                          onClick={() => openPhotoLibraryForIndex(idx)}
                        >
                          Choose from library
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          className="participant-photo-source-item"
                          onClick={() => openPhotoCameraForIndex(idx)}
                        >
                          Take photo
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="participant-info">
                    <div className="participant-name">{p.name || 'Unnamed'}</div>
                    <div className="participant-email">{p.email || 'No email'}</div>
                    {p.photo ? (
                      <div className="participant-photo-actions">
                        <button
                          type="button"
                          className="participant-photo-link"
                          onClick={() => setPhotoLightboxUrl(p.photo)}
                        >
                          View photo
                        </button>
                        <button
                          type="button"
                          className="participant-photo-link"
                          aria-expanded={photoSourceMenuIndex === idx}
                          onClick={() => togglePhotoSourceMenu(idx)}
                        >
                          Change photo
                        </button>
                        <button
                          type="button"
                          className="participant-photo-link participant-photo-link--danger"
                          onClick={() => handleRemoveParticipantPhoto(idx)}
                        >
                          Remove photo
                        </button>
                      </div>
                    ) : null}
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
                            style={{
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '6px',
                              marginTop: '8px',
                              width: '100%',
                              maxWidth: '340px',
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                              <div
                                style={{
                                  flex: 1,
                                  height: '8px',
                                  background: 'rgba(148, 163, 184, 0.18)',
                                  borderRadius: '999px',
                                  overflow: 'hidden',
                                }}
                                aria-label="Mic level"
                              >
                                <div
                                  style={{
                                    width:
                                      noiseLevel == null
                                        ? '0%'
                                        : `${Math.round(noiseLevel * 100)}%`,
                                    height: '100%',
                                    background:
                                      noiseLabel === 'Good'
                                        ? 'rgba(34, 197, 94, 0.9)'
                                        : noiseLabel === 'Too noisy'
                                          ? 'rgba(239, 68, 68, 0.9)'
                                          : 'rgba(245, 158, 11, 0.9)',
                                    transition: 'width 80ms linear',
                                  }}
                                />
                              </div>
                              <span
                                style={{
                                  fontSize: '11px',
                                  fontWeight: 700,
                                  letterSpacing: '0.02em',
                                  color:
                                    noiseLabel === 'Good'
                                      ? 'rgba(34, 197, 94, 0.95)'
                                      : noiseLabel === 'Too noisy'
                                        ? 'rgba(239, 68, 68, 0.95)'
                                        : 'rgba(245, 158, 11, 0.95)',
                                  minWidth: '78px',
                                  textAlign: 'right',
                                }}
                              >
                                {noiseLabel || 'Listening…'}
                              </span>
                            </div>
                            <div
                              style={{
                                fontSize: '11px',
                                color: 'rgba(148, 163, 184, 0.9)',
                              }}
                            >
                              Tip: speak clearly ~15–25cm from the mic in a quiet room.
                            </div>
                          </div>
                        )}
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

      {photoLightboxUrl && (
        <div
          className="participant-photo-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label="Photo preview"
          onClick={() => setPhotoLightboxUrl(null)}
        >
          <button
            type="button"
            className="participant-photo-lightbox-close"
            aria-label="Close"
            onClick={() => setPhotoLightboxUrl(null)}
          >
            ×
          </button>
          <img
            src={photoLightboxUrl}
            alt="Participant"
            className="participant-photo-lightbox-img"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}

      {cameraOpen && (
        <div className="participant-camera-modal" role="dialog" aria-modal="true" aria-label="Take photo">
          <div className="participant-camera-modal-backdrop" role="presentation" onClick={closeCameraModal} />
          <div className="participant-camera-modal-panel">
            <p className="participant-camera-modal-hint">Position in frame, then capture</p>
            <video
              ref={videoRef}
              className="participant-camera-video"
              playsInline
              muted
              autoPlay
            />
            <div className="participant-camera-modal-actions">
              <button type="button" className="participant-camera-btn participant-camera-btn--secondary" onClick={closeCameraModal}>
                Cancel
              </button>
              <button type="button" className="participant-camera-btn participant-camera-btn--primary" onClick={captureFromCamera}>
                Capture
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Participants;

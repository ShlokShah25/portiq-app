import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import axios from 'axios';
import { T } from '../config/terminology';
import { FEATURE_INTERVIEW_UI, FEATURE_CURA_UI } from '../config/featureFlags';
import useInterviewRoutes, { meetingPaths } from '../interview/useInterviewRoutes';
import useCuraRoutes from '../cura/useCuraRoutes';
import { formatApiError } from '../utils/apiErrorMessage';
import { isLikelyLiveWhisperHallucination } from '../utils/whisperLiveFilter';
import { isEducation } from '../config/product';
import './MeetingSummary.css';
import './MeetingInProgress.css';
import './MeetingDetail.css';

function meetingHasEducationContext(m) {
  if (!m || typeof m !== 'object') return false;
  if (String(m.accountProductType || '').trim().toLowerCase() === 'education') return true;
  if (String(m.educationClassroomId || '').trim()) return true;
  if (String(m.educationClassroomName || '').trim()) return true;
  if (String(m.educationSubject || '').trim()) return true;
  if (String(m.educationTeacherName || '').trim()) return true;
  if (String(m.educationTeacherEmail || '').trim()) return true;
  return false;
}

// Keep the MediaRecorder + mic stream alive even if the user navigates away from this route.
// Without this, some browsers will stop recording when the owning React component unmounts.
let globalActiveMeetingId = null;
let globalMediaRecorder = null;
let globalStream = null;

/** Set when End Meeting must await POST /end with audio (avoid double /end). */
let pendingEndUpload = null;

/** Pause-based live segmentation (Web Audio RMS + accumulated MediaRecorder slices). */
let globalLiveVad = null;

/**
 * Small MediaRecorder timeslices + accumulate until silence or max length, then enqueue one blob.
 */
function startLiveUtteranceSegmentation(stream, enqueueBlob) {
  const MEDIA_SLICE_MS = 400;
  const MIN_LIVE_CHUNK_BYTES = 1200;
  const PAUSE_SILENCE_MS = 650;
  const MAX_LIVE_SEGMENT_MS = 12000;
  const MIN_UTTERANCE_MS = 520;
  const SILENCE_RMS = 0.019;

  const state = {
    pendingChunks: [],
    pendingStartedAt: null,
    silenceMs: 0,
    lastTick: performance.now(),
    rafId: 0,
    audioCtx: null,
    stopped: false,
    data: null,
  };

  function flushPending() {
    if (state.pendingChunks.length === 0) return;
    const blob = new Blob(state.pendingChunks, { type: 'audio/webm' });
    state.pendingChunks = [];
    state.pendingStartedAt = null;
    state.silenceMs = 0;
    if (blob.size >= MIN_LIVE_CHUNK_BYTES) {
      enqueueBlob(blob);
    }
  }

  let audioCtx;
  try {
    audioCtx = new AudioContext();
  } catch (e) {
    console.warn('Live VAD: AudioContext not available', e);
    return null;
  }
  state.audioCtx = audioCtx;
  audioCtx.resume().catch(() => {});

  const source = audioCtx.createMediaStreamSource(stream);
  const analyser = audioCtx.createAnalyser();
  analyser.fftSize = 2048;
  source.connect(analyser);
  state.data = new Float32Array(analyser.fftSize);

  function tick() {
    if (state.stopped) return;
    const rec = globalMediaRecorder;
    if (!rec || rec.state !== 'recording') {
      state.rafId = requestAnimationFrame(tick);
      return;
    }

    analyser.getFloatTimeDomainData(state.data);
    let sum = 0;
    for (let i = 0; i < state.data.length; i += 1) {
      sum += state.data[i] * state.data[i];
    }
    const rms = Math.sqrt(sum / state.data.length);
    const now = performance.now();
    const dt = Math.min(now - state.lastTick, 120);
    state.lastTick = now;

    if (rms < SILENCE_RMS) {
      state.silenceMs += dt;
    } else {
      state.silenceMs = 0;
    }

    const pendingDur =
      state.pendingStartedAt != null ? now - state.pendingStartedAt : 0;
    const pauseAfterSpeech =
      state.pendingChunks.length > 0 &&
      state.silenceMs >= PAUSE_SILENCE_MS &&
      pendingDur >= MIN_UTTERANCE_MS;
    const maxLen = state.pendingChunks.length > 0 && pendingDur >= MAX_LIVE_SEGMENT_MS;

    if (pauseAfterSpeech || maxLen) {
      flushPending();
    }

    state.rafId = requestAnimationFrame(tick);
  }

  state.rafId = requestAnimationFrame(tick);
  state.flushPending = flushPending;
  state.dispose = () => {
    state.stopped = true;
    try {
      cancelAnimationFrame(state.rafId);
    } catch (_) {
      /* ignore */
    }
    if (state.audioCtx && state.audioCtx.state !== 'closed') {
      state.audioCtx.close().catch(() => {});
    }
  };
  state.onRecorderData = (data) => {
    if (state.stopped) return;
    state.pendingChunks.push(data);
    if (state.pendingStartedAt == null) {
      state.pendingStartedAt = performance.now();
    }
  };
  state.resetAfterResume = () => {
    state.silenceMs = 0;
    state.lastTick = performance.now();
  };

  state.sliceMs = MEDIA_SLICE_MS;
  return state;
}

function disposeGlobalLiveVad() {
  if (!globalLiveVad) return;
  try {
    globalLiveVad.flushPending();
  } catch (_) {
    /* ignore */
  }
  try {
    globalLiveVad.dispose();
  } catch (_) {
    /* ignore */
  }
  globalLiveVad = null;
}

function isGlobalRecordingActive() {
  const rec = globalMediaRecorder;
  return !!(rec && rec.state !== 'inactive');
}

function getLiveTranscriptUiError(err) {
  const status = Number(err?.response?.status || 0);
  if (status === 429 || status === 503 || status === 504) {
    return 'Live transcription is temporarily busy. We will keep trying in the background.';
  }
  if (status >= 500) {
    return 'Live transcription is temporarily unavailable. Recording continues and final transcript is unaffected.';
  }
  return formatApiError(err, 'Live segment could not be transcribed');
}

const MeetingInProgress = () => {
  const { id: meetingId } = useParams();
  const navigate = useNavigate();
  const { isInterviewSurface } = useInterviewRoutes();
  const { isCuraSurface } = useCuraRoutes();
  const [meetingEnded, setMeetingEnded] = useState(false);
  const [meeting, setMeeting] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [elapsedTime, setElapsedTime] = useState(0);
  const [recording, setRecording] = useState(false);
  const [paused, setPaused] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [maxDurationMinutes, setMaxDurationMinutes] = useState(null);
  const [autoEnded, setAutoEnded] = useState(false);
  const [sessionDetailsOpen, setSessionDetailsOpen] = useState(false);
  const [firstMeetingToast, setFirstMeetingToast] = useState(false);
  const [uploadNotice, setUploadNotice] = useState('');
  const [voiceProfiles, setVoiceProfiles] = useState({});
  const [liveTranscript, setLiveTranscript] = useState('');
  const [liveTranscriptEntries, setLiveTranscriptEntries] = useState([]);
  const [liveTranscriptError, setLiveTranscriptError] = useState('');
  const mediaRecorderRef = React.useRef(null);
  const streamRef = React.useRef(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!firstMeetingToast) return undefined;
    const id = window.setTimeout(() => {
      if (isMountedRef.current) setFirstMeetingToast(false);
    }, 6500);
    return () => window.clearTimeout(id);
  }, [firstMeetingToast]);

  // Warn only on tab close / refresh while a recorder is active (SPA navigation stays allowed).
  useEffect(() => {
    const onBeforeUnload = (e) => {
      if (isGlobalRecordingActive()) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  useEffect(() => {
    const fromParticipants = (meeting?.participants || [])
      .map((p) => (p.email && String(p.email).trim()) || '')
      .filter(Boolean);
    const fromInterview =
      meeting?.summaryMode === 'interview' && Array.isArray(meeting?.interviewCandidates)
        ? meeting.interviewCandidates
            .map((c) => (c && c.voiceEmail && String(c.voiceEmail).trim()) || '')
            .filter(Boolean)
        : [];
    const emails = [...new Set([...fromParticipants, ...fromInterview])];
    if (emails.length === 0) {
      setVoiceProfiles({});
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await axios.get(
          `/meetings/voice/profiles?emails=${encodeURIComponent(emails.join(','))}`
        );
        const profiles = res.data?.profiles || [];
        const next = {};
        emails.forEach((email) => {
          const profile = profiles.find(
            (pr) =>
              pr.email && pr.email.toLowerCase() === email.toLowerCase()
          );
          next[email.toLowerCase()] = { hasProfile: !!profile };
        });
        if (!cancelled) setVoiceProfiles(next);
      } catch (_) {
        if (!cancelled) setVoiceProfiles({});
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [meeting?.participants, meeting?.summaryMode, meeting?.interviewCandidates]);

  // New route id: reset UI so we never reuse another meeting's state.
  useEffect(() => {
    if (!meetingId) return;
    setMeeting(null);
    setLoading(true);
    setError('');
    setRecording(false);
    setPaused(false);
    setMeetingEnded(false);
    setUploading(false);
    setElapsedTime(0);
    setLiveTranscript('');
    setLiveTranscriptEntries([]);
    setLiveTranscriptError('');

    // If the user switches to a different meeting while a global recorder is active,
    // stop it so we don't cross-contaminate audio between meetings.
    if (globalActiveMeetingId && globalActiveMeetingId !== String(meetingId)) {
      const rec = globalMediaRecorder;
      if (rec && rec.state !== 'inactive') {
        try {
          rec.stop();
        } catch (_) {}
      }
      if (globalStream) {
        globalStream.getTracks().forEach((t) => t.stop());
      }
      globalMediaRecorder = null;
      globalStream = null;
      globalActiveMeetingId = null;
    }
  }, [meetingId]);

  useEffect(() => {
    if (meetingId) {
      fetchMeeting();
      const interval = setInterval(fetchMeeting, 5000); // Poll every 5 seconds
      return () => clearInterval(interval);
    }
  }, [meetingId]);

  // When returning to this route, re-bind local refs/state to any already-active global recorder.
  useEffect(() => {
    if (!meetingId) return;
    const activeForThisMeeting = globalActiveMeetingId === String(meetingId);
    if (activeForThisMeeting && globalMediaRecorder && globalStream) {
      mediaRecorderRef.current = globalMediaRecorder;
      streamRef.current = globalStream;
      setRecording(globalMediaRecorder.state === 'recording');
      setPaused(globalMediaRecorder.state === 'paused');
    }
  }, [meetingId]);

  useEffect(() => {
    if (!meeting?.startTime || !recording || paused) return;
    const interval = setInterval(() => {
      const start = new Date(meeting.startTime);
      const now = new Date();
      setElapsedTime(Math.floor((now - start) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [meeting?.startTime, recording, paused]);

  // Fetch plan limits to optionally auto-end long recordings on starter / other plans
  useEffect(() => {
    const fetchPlan = async () => {
      try {
        const res = await axios.get('/admin/profile');
        const productType = res.data?.admin?.productType || 'workplace';
        const plan = (res.data?.admin?.plan || 'starter').toLowerCase();

        // Mirror planConstraints.js (workplace + education use the same tier caps for now).
        if (productType === 'workplace' || productType === 'education') {
          if (plan === 'starter') setMaxDurationMinutes(60);
          else if (plan === 'professional') setMaxDurationMinutes(180);
          else if (plan === 'business') setMaxDurationMinutes(480);
          else if (plan === 'institutional') setMaxDurationMinutes(1440);
          else setMaxDurationMinutes(null);
        } else {
          setMaxDurationMinutes(null);
        }
      } catch (e) {
        // If this fails, we just won't auto-end on the client
        console.warn('Unable to fetch admin profile for plan limits', e);
      }
    };
    fetchPlan();
  }, []);

  // Watch elapsed time while recording and auto-end if we exceed plan limit
  useEffect(() => {
    if (!recording || !maxDurationMinutes || autoEnded) return;
    const limitSeconds = maxDurationMinutes * 60;
    if (elapsedTime >= limitSeconds) {
      setAutoEnded(true);
      setError(
        `Your plan allows meetings up to ${maxDurationMinutes} minutes. This meeting has been ended automatically.`
      );
      handleEndMeeting();
    }
  }, [elapsedTime, recording, maxDurationMinutes, autoEnded]);

  const fetchMeeting = async () => {
    try {
      const res = await axios.get(`/meetings/${meetingId}`);
      setMeeting(res.data.meeting);
      setError('');
      setLoading(false);
    } catch (err) {
      console.error('Error fetching meeting:', err);
      setError(formatApiError(err, 'Failed to load meeting details'));
      setMeeting(null);
      setLoading(false);
    }
  };

  const startRecording = async () => {
    try {
      await axios.post(`/meetings/${meetingId}/start-recording`);
      await fetchMeeting();

      // Ensure we don't start a duplicate recorder for the same meeting.
      if (
        globalActiveMeetingId === String(meetingId) &&
        globalMediaRecorder &&
        globalMediaRecorder.state !== 'inactive'
      ) {
        if (isMountedRef.current) {
          setRecording(globalMediaRecorder.state === 'recording');
          setPaused(globalMediaRecorder.state === 'paused');
        }
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      globalStream = stream;
      streamRef.current = stream;
      const mediaRecorder = new MediaRecorder(stream);
      globalMediaRecorder = mediaRecorder;
      globalActiveMeetingId = String(meetingId);
      const chunks = [];
      /** Aligned with server live chunk minimum; utterance segments can be shorter than old 5s blobs. */
      const MIN_LIVE_CHUNK_BYTES = 1200;
      const FALLBACK_LIVE_SLICE_MS = 2500;

      let liveFlushBusy = false;
      const liveQueue = [];
      let liveFailStreak = 0;
      let liveRetryAfterMs = 0;

      async function flushLiveTranscriptQueue() {
        if (liveFlushBusy) return;
        liveFlushBusy = true;
        try {
          while (liveQueue.length > 0) {
            if (liveRetryAfterMs > Date.now()) {
              await new Promise((r) => setTimeout(r, liveRetryAfterMs - Date.now()));
            }
            const blob = liveQueue.shift();
            if (!blob || blob.size < MIN_LIVE_CHUNK_BYTES) continue;
            try {
              const fd = new FormData();
              fd.append(
                'audio',
                new File([blob], 'chunk.webm', { type: blob.type || 'audio/webm' })
              );
              const res = await axios.post(`/meetings/${String(meetingId)}/live-transcribe-chunk`, fd, {
                headers: { 'Content-Type': 'multipart/form-data' },
              });
              const piece = String(res.data?.text || '').trim();
              if (piece && !isLikelyLiveWhisperHallucination(piece) && isMountedRef.current) {
                setLiveTranscriptError('');
                const speakerName = String(res.data?.speaker?.name || '').trim();
                const confidence = Number(res.data?.speaker?.confidence || 0);
                const speakerLabel = speakerName || 'Speaker';
                setLiveTranscriptEntries((prev) => {
                  const next = [
                    ...prev,
                    {
                      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                      speaker: speakerLabel,
                      confidence,
                      text: piece,
                    },
                  ];
                  return next.length > 40 ? next.slice(next.length - 40) : next;
                });
                setLiveTranscript((prev) => (prev ? `${prev} ${piece}` : piece));
              }
              liveFailStreak = 0;
              liveRetryAfterMs = 0;
            } catch (err) {
              liveFailStreak += 1;
              const cooldownMs = Math.min(20000, 2500 * liveFailStreak);
              liveRetryAfterMs = Date.now() + cooldownMs;
              if (isMountedRef.current) {
                setLiveTranscriptError(getLiveTranscriptUiError(err));
              }
            }
          }
        } finally {
          liveFlushBusy = false;
          if (liveQueue.length > 0) {
            void flushLiveTranscriptQueue();
          }
        }
      }

      function enqueueLiveTranscriptChunk(blob) {
        liveQueue.push(blob);
        void flushLiveTranscriptQueue();
      }

      disposeGlobalLiveVad();
      globalLiveVad = startLiveUtteranceSegmentation(stream, enqueueLiveTranscriptChunk);
      const liveSliceMs = globalLiveVad ? globalLiveVad.sliceMs : FALLBACK_LIVE_SLICE_MS;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunks.push(event.data);
          const rec = globalMediaRecorder;
          if (rec && rec.state === 'recording') {
            if (globalLiveVad) {
              globalLiveVad.onRecorderData(event.data);
            } else {
              enqueueLiveTranscriptChunk(event.data);
            }
          }
        }
      };

      mediaRecorder.onstop = async () => {
        disposeGlobalLiveVad();
        const blob = new Blob(chunks, { type: 'audio/webm' });
        if (globalStream) {
          globalStream.getTracks().forEach((t) => t.stop());
          globalStream = null;
          globalMediaRecorder = null;
          globalActiveMeetingId = null;
        }
        await uploadAudio(blob, String(meetingId));
      };

      mediaRecorderRef.current = mediaRecorder;
      if (isMountedRef.current) {
        setLiveTranscript('');
        setLiveTranscriptEntries([]);
        setLiveTranscriptError('');
      }
      mediaRecorder.start(liveSliceMs);
      if (isMountedRef.current) {
        setRecording(true);
        setPaused(false);
        setError('');
      }
    } catch (err) {
      console.error('Error starting recording:', err);
      const st = err.response?.status;
      if (isMountedRef.current) {
        setError(
          typeof st === 'number' && st >= 400
            ? formatApiError(
                err,
                'Could not start recording on the server. Try again or open the meeting from Meetings.'
              )
            : 'Unable to access microphone. Please check browser permissions.'
        );
      }
    }
  };

  const pauseRecording = () => {
    const recorder = globalMediaRecorder || mediaRecorderRef.current;
    if (recorder && recorder.state === 'recording') {
      if (globalLiveVad) {
        globalLiveVad.flushPending();
      }
      recorder.pause();
      if (isMountedRef.current) setPaused(true);
    }
  };

  const resumeRecording = () => {
    const recorder = globalMediaRecorder || mediaRecorderRef.current;
    if (recorder && recorder.state === 'paused') {
      if (globalLiveVad) {
        globalLiveVad.resetAfterResume();
      }
      recorder.resume();
      if (isMountedRef.current) setPaused(false);
    }
  };

  const uploadAudio = async (blob, uploadMeetingId) => {
    if (!uploadMeetingId) return;
    if (isMountedRef.current) {
      setUploading(true);
      setUploadNotice(
        blob.size > 25 * 1024 * 1024
          ? 'Large recording — uploading, then we optimize it on the server before transcription.'
          : ''
      );
    }
    try {
      const fileToSend = new File([blob], 'meeting-audio.webm', { type: 'audio/webm' });
      const data = new FormData();
      data.append('audio', fileToSend);
      const res = await axios.post(`/meetings/${uploadMeetingId}/end`, data, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      if (isMountedRef.current) {
        setMeeting(res.data.meeting);
        setUploading(false);
        setUploadNotice('');
        if (res.data?.celebrateFirstMeeting) setFirstMeetingToast(true);
      }
      if (pendingEndUpload) {
        pendingEndUpload.resolve(res);
        pendingEndUpload = null;
      }
    } catch (err) {
      console.error('Error uploading audio:', err);
      if (pendingEndUpload) {
        pendingEndUpload.reject(err);
        pendingEndUpload = null;
      }
      if (isMountedRef.current) {
        setError(formatApiError(err, 'Failed to upload audio'));
        setUploading(false);
        setUploadNotice('');
      }
    }
  };

  const stopRecordingAndWaitForUpload = () =>
    new Promise((resolve, reject) => {
      const rec = globalMediaRecorder;
      if (!rec || rec.state === 'inactive') {
        resolve(null);
        return;
      }
      pendingEndUpload = { resolve, reject };
      try {
        rec.stop();
        if (isMountedRef.current) {
          setRecording(false);
          setPaused(false);
          setLiveTranscript('');
          setLiveTranscriptEntries([]);
          setLiveTranscriptError('');
        }
      } catch (e) {
        pendingEndUpload = null;
        reject(e);
      }
    });

  const handleEndMeeting = async () => {
    if (!meeting) return;
    try {
      if (isGlobalRecordingActive()) {
        await stopRecordingAndWaitForUpload();
      } else {
        const res = await axios.post(`/meetings/${meeting._id}/end`);
        if (isMountedRef.current && res.data?.meeting) {
          setMeeting(res.data.meeting);
        }
        if (isMountedRef.current && res.data?.celebrateFirstMeeting) {
          setFirstMeetingToast(true);
        }
      }
      if (isMountedRef.current) setMeetingEnded(true);
    } catch (err) {
      console.error('Error ending meeting:', err);
      if (isMountedRef.current) {
        setError(formatApiError(err, 'Failed to end meeting'));
      }
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

  const formatTimeOnly = (dateString) => {
    if (!dateString) return 'Not scheduled';
    const date = new Date(dateString);
    return date.toLocaleTimeString('en-US', { 
      hour: '2-digit', 
      minute: '2-digit',
      hour12: true 
    });
  };

  const formatDateCompact = (dateString) => {
    if (!dateString) return 'Not scheduled';
    const date = new Date(dateString);
    if (Number.isNaN(date.getTime())) return 'Not scheduled';
    return date.toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  if (loading) {
    return (
      <div className="meeting-summary-screen meeting-in-progress">
        <div className="meeting-summary-loading">
          <div className="loading-spinner" />
          <p>Loading meeting details...</p>
        </div>
      </div>
    );
  }

  if (error && !meeting) {
    return (
      <div className="meeting-summary-screen meeting-in-progress">
        <div className="meeting-summary-container">
          <div className="meeting-summary-error">{error}</div>
          <button
            type="button"
            className="meeting-summary-btn meeting-summary-btn--secondary"
            style={{ marginTop: 16 }}
            onClick={() => navigate(isCuraSurface ? '/cura' : isInterviewSurface ? '/interview' : '/meetings')}
          >
            {isCuraSurface ? 'Back to Cura' : isInterviewSurface ? 'Back to Interview Mode' : `Back to ${T.meetings()}`}
          </button>
        </div>
      </div>
    );
  }

  if (!meeting) {
    return (
      <div className="meeting-summary-screen meeting-in-progress">
        <div className="meeting-summary-container">
          <div className="meeting-summary-error">Meeting not found</div>
          <button
            type="button"
            className="meeting-summary-btn meeting-summary-btn--secondary"
            style={{ marginTop: 16 }}
            onClick={() => navigate(isCuraSurface ? '/cura' : isInterviewSurface ? '/interview' : '/meetings')}
          >
            {isCuraSurface ? 'Back to Cura' : isInterviewSurface ? 'Back to Interview Mode' : `Back to ${T.meetings()}`}
          </button>
        </div>
      </div>
    );
  }

  const recordingLive = recording || isGlobalRecordingActive();
  const isInterview =
    FEATURE_INTERVIEW_UI && (meeting?.summaryMode === 'interview' || isInterviewSurface);
  const isCura =
    FEATURE_CURA_UI &&
    (meeting?.summaryMode === 'clinical' || meeting?.patientId || isCuraSurface);
  const routePaths = meeting ? meetingPaths(meeting) : null;
  const meetingEducationMode = meetingHasEducationContext(meeting) || isEducation;
  const meetingLocationTrimmed = meeting ? String(meeting.meetingRoom || '').trim() : '';
  const hasMeetingLocation = meetingLocationTrimmed.length > 0;
  const showLiveStatusChip =
    recordingLive ||
    meeting.status === 'In Progress' ||
    meeting.transcriptionStatus === 'Recording';
  const endMeetingLabel = isInterview
    ? 'End Interview'
    : isCura
      ? 'End Consultation'
      : meetingEducationMode
        ? 'End Lecture'
        : T.endMeeting();

  const renderEndMeetingButton = (className = 'meeting-summary-btn mip-btn-end-meeting') => (
    <button
      type="button"
      className={className}
      onClick={handleEndMeeting}
      disabled={uploading}
    >
      {uploading ? 'Uploading…' : endMeetingLabel}
    </button>
  );

  return (
    <div className="meeting-summary-screen meeting-in-progress">
      <div className="meeting-summary-container">
        {firstMeetingToast && (
          <div className="mip-first-meeting-toast" role="status">
            Nice — your meeting is now structured and actionable.
          </div>
        )}
        <div className={`meeting-summary-card mip-card${meeting && !loading ? ' ux-screen-enter' : ''}`}>
          {meetingEnded ? (
            <>
              <div className="meeting-summary-ready-badge mip-ready-badge mip-ready-badge--ended">
                <span className="meeting-summary-ready-badge__dot mip-ready-badge__dot--ended" />
                {isInterview ? 'Interview ended' : isCura ? 'Consultation ended' : meetingEducationMode ? 'Lecture ended' : 'Meeting ended'}
              </div>
              <h1 className="meeting-summary-page-title">{meeting.title || 'Untitled meeting'}</h1>
              <p className="meeting-summary-subtitle">
                {isInterview
                  ? 'Session ended — next, review AI recommendations'
                  : isCura
                    ? 'Visit ended — here\'s your summary'
                    : 'Session ended'}
              </p>
              <p className="mip-ai-disclaimer">
                {isInterview ? (
                  <>
                    This interview is closed. Open the summary to see the transcript, evaluation signals, and hiring
                    recommendation (they may take a minute to generate). Review, edit if needed, then finalize the
                    decision internally.
                  </>
                ) : isCura ? (
                  <>
                    I&apos;ll put together a plain-language briefing from the recording. Open it, tweak anything, then tap Done.
                  </>
                ) : (
                  <>
                    Your {T.meeting().toLowerCase()} is closed. Open the summary to review the transcript and AI-generated
                    minutes before you send anything to participants.
                  </>
                )}
              </p>
              <div className="meeting-summary-actions">
                <button
                  type="button"
                  className="meeting-summary-btn meeting-summary-btn--primary"
                  onClick={() => navigate(routePaths?.report || `/meetings/${meetingId}/summary`)}
                >
                  {isInterview
                    ? 'View interview summary & recommendations'
                    : isCura
                      ? 'Open visit summary'
                      : `View ${T.meetingSummary()}`}
                </button>
                <button
                  type="button"
                  className="meeting-summary-btn meeting-summary-btn--secondary"
                  onClick={() => navigate(routePaths?.detail || routePaths?.dashboard || `/meetings/${meetingId}`)}
                >
                  {isCura ? 'Back to dashboard' : `Back to ${T.meeting()} details`}
                </button>
              </div>
            </>
          ) : (
            <>
              <header className="mip-live-header">
                <div className="mip-live-header__row">
                  <span
                    className={`mip-status-chip${showLiveStatusChip ? ' mip-status-chip--live' : ' mip-status-chip--ready'}`}
                  >
                    {showLiveStatusChip ? 'LIVE' : 'READY'}
                  </span>
                </div>
                <h1 className="meeting-summary-page-title mip-live-title">{meeting.title || 'Untitled meeting'}</h1>
                <p className="meeting-summary-subtitle mip-live-subtitle">
                  {isInterview
                    ? meeting.status === 'Scheduled'
                      ? 'Start recording when the interview begins — we’ll build notes and hiring recommendations afterward.'
                      : 'Interview in progress'
                    : isCura
                      ? meeting.status === 'Scheduled'
                        ? 'Hit record when the patient is ready — notes are written automatically after.'
                        : 'Consultation in progress'
                    : meeting.status === 'Scheduled'
                      ? 'When you begin, start recording below.'
                      : meetingEducationMode ? 'Lecture in progress' : 'Meeting in progress'}
                </p>
              </header>

              {meeting.transcriptionEnabled && (
                <>
                <div className="mip-recording-hero mip-recording-hero--primary">
                  {!recordingLive && !uploading && (
                    <>
                      <p className="mip-recording-consent" role="note">
                        {isCura
                          ? 'By starting recording, you confirm the patient is aware audio is captured for your visit summary. Use Chrome or Edge for the most reliable capture.'
                          : 'By starting recording, you confirm participants are aware audio is captured for transcription and summary. Use Chrome or Edge for the most reliable in-browser capture. Recordings over 25 MB are compressed on our servers before sending to transcription.'}
                      </p>
                      <button type="button" className="mip-recording-hero__start" onClick={startRecording}>
                        Start Recording
                      </button>
                    </>
                  )}
                  {recordingLive && !uploading && (
                    <div className="mip-recording-hero__active">
                      <div className="mip-recording-hero__status-row">
                        {!paused ? (
                          <span className="mip-recording-hero__live-dot" aria-hidden />
                        ) : (
                          <span className="mip-recording-hero__paused-dot" aria-hidden />
                        )}
                        <span className="mip-recording-hero__status-text">
                          {paused ? 'Paused' : 'Recording…'}
                        </span>
                        <span className="mip-recording-hero__timer">{formatTime(elapsedTime)}</span>
                      </div>
                      <div className="mip-recording-hero__controls">
                        {!paused ? (
                          <button
                            type="button"
                            className="meeting-summary-btn meeting-summary-btn--secondary mip-recording-hero__ctrl mip-recording-hero__ctrl--pause"
                            onClick={pauseRecording}
                          >
                            Pause Recording
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="meeting-summary-btn meeting-summary-btn--secondary mip-recording-hero__ctrl mip-recording-hero__ctrl--resume"
                            onClick={resumeRecording}
                          >
                            Resume Recording
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                  {uploading && (
                    <div className="mip-uploading-status mip-uploading-status--hero">
                      <div className="upload-spinner" />
                      <div className="mip-uploading-status__text">
                        <span>Uploading audio…</span>
                        {uploadNotice ? (
                          <span className="mip-uploading-status__hint" role="status">
                            {uploadNotice}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  )}
                  <div className="mip-end-meeting-block">
                    {renderEndMeetingButton('meeting-summary-btn mip-btn-end-meeting mip-btn-end-meeting--prominent')}
                    <p className="mip-end-meeting-hint">
                      {recordingLive
                        ? 'When you are finished, end the session — we upload the recording and generate your transcript.'
                        : 'You can end the session at any time. If you recorded audio, it will be uploaded for transcription.'}
                    </p>
                  </div>
                </div>
                {recordingLive && !uploading && !isCura && (
                  <section
                    className={`mip-live-transcript${paused ? ' mip-live-transcript--paused' : ''}`}
                    aria-label="Live transcription preview"
                  >
                    <div className="mip-live-transcript__chrome">
                      <span className="mip-live-transcript__badge">
                        <span className="mip-live-transcript__badge-dot" aria-hidden />
                        Live transcript
                      </span>
                      <span className="mip-live-transcript__hint">Preview · may differ from final</span>
                    </div>
                    {paused ? (
                      <p className="mip-live-transcript__paused-msg">
                        Paused — preview resumes when you resume recording.
                      </p>
                    ) : (
                      <>
                        {liveTranscriptError ? (
                          <div className="mip-live-transcript__err" role="alert">
                            {liveTranscriptError}
                          </div>
                        ) : null}
                        <div className="mip-live-transcript__body" aria-live="polite">
                          {liveTranscriptEntries.length > 0 ? (
                            <div className="mip-live-transcript__list">
                              {liveTranscriptEntries.map((entry) => (
                                <div key={entry.id} className="mip-live-transcript__line">
                                  <span className="mip-live-transcript__speaker">
                                    {entry.speaker}
                                    {entry.confidence >= 0.01 ? (
                                      <span className="mip-live-transcript__speaker-conf">
                                        {` (${Math.round(entry.confidence * 100)}%)`}
                                      </span>
                                    ) : null}
                                  </span>
                                  <span className="mip-live-transcript__line-text">{entry.text}</span>
                                </div>
                              ))}
                            </div>
                          ) : liveTranscript ? (
                            <p className="mip-live-transcript__text">{liveTranscript}</p>
                          ) : (
                            <p className="mip-live-transcript__placeholder">
                              Listening… text updates after short phrases (we split on natural pauses).
                            </p>
                          )}
                        </div>
                      </>
                    )}
                  </section>
                )}
                </>
              )}

              {meeting.parentContinuation && (
                <div className="meeting-detail-continuation mip-continuation">
                  <p className="meeting-detail-continuation-title">Continuing from prior session</p>
                  {meeting.parentContinuation.title && (
                    <p className="mip-continuation-parent-title">{meeting.parentContinuation.title}</p>
                  )}
                  {meeting.parentContinuation.sessionCheckpointSummary && (
                    <p className="meeting-detail-continuation-recap">
                      {meeting.parentContinuation.sessionCheckpointSummary}
                    </p>
                  )}
                </div>
              )}

              <div className="mip-session-details">
                <button
                  type="button"
                  className="mip-session-details__toggle"
                  aria-expanded={sessionDetailsOpen}
                  onClick={() => setSessionDetailsOpen((o) => !o)}
                >
                  <span className="mip-session-details__toggle-label">Session details</span>
                  <span className="mip-session-details__teaser">
                    {formatDateCompact(meeting.scheduledTime || meeting.startTime)} ·{' '}
                    {formatTimeOnly(meeting.scheduledTime)}
                    {hasMeetingLocation ? ` · ${meetingLocationTrimmed}` : ''}
                  </span>
                  <svg
                    className={`mip-session-details__chev${sessionDetailsOpen ? ' is-open' : ''}`}
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    aria-hidden
                  >
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>
                <div
                  className={`mip-session-details__panel${sessionDetailsOpen ? ' mip-session-details__panel--open' : ''}`}
                  aria-hidden={!sessionDetailsOpen}
                >
                  <div className="mip-session-details__panel-inner">
                    <div className="mip-meta-strip" aria-label="Session details">
                      <div className="mip-meta-chunk">
                        <span className="mip-meta-k">Date</span>
                        <span className="mip-meta-v">{formatDateCompact(meeting.scheduledTime || meeting.startTime)}</span>
                      </div>
                      <div className="mip-meta-chunk">
                        <span className="mip-meta-k">Time</span>
                        <span className="mip-meta-v">{formatTimeOnly(meeting.scheduledTime)}</span>
                      </div>
                      <div className="mip-meta-chunk">
                        <span className="mip-meta-k">Duration</span>
                        <span className="mip-meta-v mip-meta-v--mono">
                          {recordingLive ? formatTime(elapsedTime) : '00:00'}
                        </span>
                      </div>
                      {hasMeetingLocation ? (
                        <div className="mip-meta-chunk">
                          <span className="mip-meta-k">Location</span>
                          <span className="mip-meta-v">{meetingLocationTrimmed}</span>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>

        {meetingEducationMode ? (
          <div className="meeting-summary-section meeting-summary-section--keypoints mip-participants-section mip-participants-section--after-meta">
            <h2 className="meeting-summary-heading">
              {`Classroom${meeting.educationClassroomName ? `: ${meeting.educationClassroomName}` : ''}`}
            </h2>
          </div>
        ) : null}

        {meeting.participants && meeting.participants.length > 0 && !meetingEducationMode && (
          <div className="meeting-summary-section meeting-summary-section--keypoints mip-participants-section mip-participants-section--after-meta">
            <h2 className="meeting-summary-heading">
              {meetingEducationMode
                ? `Classroom${meeting.educationClassroomName ? `: ${meeting.educationClassroomName}` : ''}`
                : 'Participants'}
            </h2>
            <div className="participants-list participants-list--room mip-participants-list">
            <div className="participants-grid participants-grid--room">
              {meeting.participants.map((p, idx) => {
                const emailKey = p.email && String(p.email).trim().toLowerCase();
                const hasVoice =
                  emailKey && voiceProfiles[emailKey]?.hasProfile;
                return (
                  <div key={idx} className="mip-participant-row">
                    <div className="mip-participant-avatar" aria-hidden>
                      <span className="mip-participant-initials">
                        {(p.name || p.email || '?').trim().charAt(0).toUpperCase()}
                      </span>
                    </div>
                    <div className="mip-participant-text">
                      <div className="mip-participant-name">{p.name || 'Unnamed'}</div>
                      {!meetingEducationMode && p.email ? (
                        <div className="mip-participant-email">{p.email}</div>
                      ) : null}
                    </div>
                    {hasVoice ? (
                      <span
                        className="mip-participant-voice mip-participant-voice--pulse"
                        title="Voice profile configured"
                      >
                        <svg
                          width="18"
                          height="18"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          aria-hidden
                        >
                          <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                          <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                          <line x1="12" y1="19" x2="12" y2="23" />
                          <line x1="8" y1="23" x2="16" y2="23" />
                        </svg>
                      </span>
                    ) : null}
                  </div>
                );
              })}
            </div>
            </div>
          </div>
        )}

              <div className="mip-secondary-row">
                <button
                  type="button"
                  className="mip-secondary-row__link"
                  onClick={() =>
                    navigate(isInterview ? '/interview' : '/meetings', {
                      state: isInterview ? undefined : { showAllMeetings: true },
                    })
                  }
                >
                  {isInterview
                    ? 'View all interviews'
                    : meetingEducationMode
                      ? 'View all lectures'
                      : 'View all meetings'}
                </button>
                <p className="mip-ai-disclaimer mip-ai-disclaimer--footer">
                  Audio is captured in your browser. Ending the session uploads audio for your transcript.
                </p>
              </div>

        {error && <div className="meeting-summary-action-error">{error}</div>}

        {!meeting.transcriptionEnabled ? (
          <div className="meeting-summary-actions mip-footer-actions">
            {renderEndMeetingButton('meeting-summary-btn mip-btn-end-meeting mip-btn-end-meeting--prominent')}
          </div>
        ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default MeetingInProgress;

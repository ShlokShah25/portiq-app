/**
 * Live-transcript capture: split microphone audio into utterances (pause-based VAD) and hand each
 * one over as a self-contained 16 kHz mono WAV blob.
 *
 * Why not MediaRecorder slices: MediaRecorder writes the WebM/MP4 header only into its FIRST slice,
 * so every later utterance built from slices is headerless and cannot be decoded server-side —
 * the live transcript stopped after the first sentence. PCM → WAV avoids containers entirely and
 * gives the speaker matcher clean, exactly-bounded audio.
 *
 * VAD runs inside the audio callback (not requestAnimationFrame), so segmentation keeps working
 * when the tab is in the background.
 */

const TARGET_SAMPLE_RATE = 16000;
const FRAME_SIZE = 2048;
const PRE_ROLL_MS = 300;
const PAUSE_SILENCE_MS = 650;
const MIN_SPEECH_MS = 350;
const MAX_UTTERANCE_MS = 12000;
/** Absolute RMS bounds for the adaptive speech threshold. */
const MIN_THRESHOLD = 0.006;
const MAX_THRESHOLD = 0.03;
const NOISE_FLOOR_MULTIPLIER = 3;

function frameRms(samples) {
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}

/** Linear-interpolation resample of mono Float32 PCM. */
function resample(input, fromRate, toRate) {
  if (fromRate === toRate) return input;
  const ratio = fromRate / toRate;
  const outLength = Math.floor(input.length / ratio);
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i += 1) {
    const pos = i * ratio;
    const idx = Math.floor(pos);
    const frac = pos - idx;
    const a = input[idx] || 0;
    const b = input[idx + 1] !== undefined ? input[idx + 1] : a;
    out[i] = a + (b - a) * frac;
  }
  return out;
}

export function encodeWav16(samples, sampleRate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeStr = (off, str) => {
    for (let i = 0; i < str.length; i += 1) view.setUint8(off + i, str.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  let off = 44;
  for (let i = 0; i < samples.length; i += 1, off += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([view], { type: 'audio/wav' });
}

/**
 * @param {MediaStream} stream
 * @param {(blob: Blob) => void} onUtterance called with a WAV blob per utterance
 * @param {() => boolean} isActive returns false while paused/stopped (audio is ignored)
 * @returns {object|null} controller ({ flushPending, dispose, resetAfterResume }) or null if Web Audio is unavailable
 */
export function startLiveUtteranceCapture(stream, onUtterance, isActive) {
  const Ctx = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
  if (!Ctx) return null;

  let audioCtx;
  try {
    audioCtx = new Ctx();
  } catch (e) {
    console.warn('Live capture: AudioContext not available', e);
    return null;
  }
  audioCtx.resume().catch(() => {});

  const source = audioCtx.createMediaStreamSource(stream);
  const processor = audioCtx.createScriptProcessor(FRAME_SIZE, 1, 1);
  // ScriptProcessor only runs while connected to the destination; keep it silent.
  const mute = audioCtx.createGain();
  mute.gain.value = 0;
  source.connect(processor);
  processor.connect(mute);
  mute.connect(audioCtx.destination);

  const sampleRate = audioCtx.sampleRate;
  const frameMs = (FRAME_SIZE / sampleRate) * 1000;
  const preRollFrames = Math.max(1, Math.round(PRE_ROLL_MS / frameMs));

  const state = {
    stopped: false,
    preRoll: [],
    frames: [],
    inUtterance: false,
    speechMs: 0,
    silenceMs: 0,
    utteranceMs: 0,
    noiseFloor: 0.01,
  };

  function resetUtterance() {
    state.frames = [];
    state.inUtterance = false;
    state.speechMs = 0;
    state.silenceMs = 0;
    state.utteranceMs = 0;
  }

  function flushPending() {
    if (!state.inUtterance || state.frames.length === 0) {
      resetUtterance();
      return;
    }
    const enough = state.speechMs >= MIN_SPEECH_MS;
    const frames = state.frames;
    resetUtterance();
    if (!enough) return;
    let total = 0;
    for (const f of frames) total += f.length;
    const joined = new Float32Array(total);
    let off = 0;
    for (const f of frames) {
      joined.set(f, off);
      off += f.length;
    }
    try {
      onUtterance(encodeWav16(resample(joined, sampleRate, TARGET_SAMPLE_RATE), TARGET_SAMPLE_RATE));
    } catch (e) {
      console.warn('Live capture: could not encode utterance', e);
    }
  }

  processor.onaudioprocess = (event) => {
    if (state.stopped) return;
    if (isActive && !isActive()) {
      // Paused: drop audio and anything half-captured so the resumed utterance starts clean.
      state.preRoll = [];
      if (state.inUtterance) flushPending();
      return;
    }
    const frame = new Float32Array(event.inputBuffer.getChannelData(0));
    const rms = frameRms(frame);
    const threshold = Math.min(
      MAX_THRESHOLD,
      Math.max(MIN_THRESHOLD, state.noiseFloor * NOISE_FLOOR_MULTIPLIER)
    );
    const isSpeech = rms >= threshold;

    if (!isSpeech) {
      // Track background noise slowly so quiet laptop mics and noisy rooms both segment well.
      state.noiseFloor = state.noiseFloor * 0.95 + rms * 0.05;
    }

    if (!state.inUtterance) {
      state.preRoll.push(frame);
      if (state.preRoll.length > preRollFrames) state.preRoll.shift();
      if (isSpeech) {
        state.inUtterance = true;
        state.frames = state.preRoll.slice();
        state.preRoll = [];
        state.utteranceMs = state.frames.length * frameMs;
        state.speechMs = frameMs;
      }
      return;
    }

    state.frames.push(frame);
    state.utteranceMs += frameMs;
    if (isSpeech) {
      state.speechMs += frameMs;
      state.silenceMs = 0;
    } else {
      state.silenceMs += frameMs;
    }

    if (state.silenceMs >= PAUSE_SILENCE_MS || state.utteranceMs >= MAX_UTTERANCE_MS) {
      flushPending();
    }
  };

  return {
    flushPending,
    resetAfterResume() {
      state.preRoll = [];
      resetUtterance();
    },
    dispose() {
      state.stopped = true;
      try {
        processor.onaudioprocess = null;
        source.disconnect();
        processor.disconnect();
        mute.disconnect();
      } catch (_) {
        /* ignore */
      }
      if (audioCtx.state !== 'closed') audioCtx.close().catch(() => {});
    },
  };
}

const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec, execFileSync } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const { getFfmpegPath } = require('./ffmpegPaths');
const { workerRequest } = require('./voiceEmbeddingWorker');
const voiceMatching = require('./voiceMatching');

/** Fallback speaker embedding size (mel static + mel delta); must match stored vectors from this path. */
const FFT_VOICE_EMBEDDING_DIM = 128;
const FFT_FRAME_SIZE = 512;
const FFT_HOP = 256;
const FFT_MEL_BANDS = 64;

/** Resolve a Python binary for voice_embedding.py (Railway often has `python` but not `python3`). */
function resolvePythonBinaryForVoice() {
  const fromEnv = String(process.env.PYTHON_BIN || process.env.PYTHON || '').trim();
  if (fromEnv) {
    if (path.isAbsolute(fromEnv)) return fromEnv;
    const cwd = typeof process.cwd === 'function' ? process.cwd() : '';
    return cwd ? path.join(cwd, fromEnv) : fromEnv;
  }
  for (const bin of ['python3', 'python']) {
    try {
      execFileSync(bin, ['-c', 'import sys; sys.exit(0)'], { stdio: 'ignore' });
      return bin;
    } catch (_) {
      /* try next */
    }
  }
  return null;
}

/**
 * Speaker identification — pyannote.audio only (see server/utils/voice_embedding.py).
 * ------------------------------------------------------------
 * - Embeddings: HF_TOKEN + Python + pyannote/embedding. Optional dominant-speaker crop
 *   via pyannote/speaker-diarization-3.1 (VOICE_PYANNOTE_DIARIZATION, default off). Embeddings come
 *   from a persistent worker (voiceEmbeddingWorker.js) so the model loads once per server process.
 * - When pyannote/HF is unavailable, enrollment falls back to an FFT mel-spectral fingerprint
 *   (128-dim) unless VOICE_EMBEDDING_STRICT=true. Live identification uses the same fallback.
 * - Reject ambiguous matches: best score must be clearly above the runner-up (margin).
 *
 * Enrollment: VOICE_ENROLLMENT_CLEAN_AUDIO (default true) runs ffmpeg band-limit + dynaudnorm
 * before embeddings. Set VOICE_ENROLLMENT_CLEAN_AUDIO=false to disable.
 *
 * Matching math lives in voiceMatching.js (default model: WeSpeaker ResNet34 — VOICE_EMBEDDING_MODEL).
 * Tune via env: VOICE_WESPEAKER_MIN, VOICE_WESPEAKER_MARGIN, VOICE_PYANNOTE_MIN, VOICE_MATCH_MARGIN, VOICE_FFT_MATCH_MIN,
 * VOICE_ENROLL_MIN_SECONDS, VOICE_ENROLL_MIN_RMS. VOICE_MATCH_DEBUG=true logs per-utterance scores
 * (or run server/scripts/calibrate-voice-thresholds.js on your own recordings).
 * Identification uses the same band-limit + dynaudnorm chain as enrollment when
 * VOICE_IDENTIFICATION_CLEAN_AUDIO is true (default).
 * VOICE_VAD_TRIM_SILENCE_DB (35–55, default 50): silenceremove threshold in dB.
 * 3+ enrolled: VOICE_MULTI_CONFIDENT_MIN (default 0.75); VOICE_MULTI_CLOSEST_FLOOR (default 0.5).
 * 2 enrolled: VOICE_CONFIDENT_PICK_MIN (default 0.75) for a single top-1 pick when other blocks miss.
 */

// Optional: use ffmpeg to apply simple voice-activity-based trimming
let ffmpeg = null;
try {
  ffmpeg = require('fluent-ffmpeg');
} catch (e) {
  console.warn('⚠️  fluent-ffmpeg not installed for voiceRecognition. VAD preprocessing will be skipped for voice samples.');
}

/**
 * Apply simple VAD-style trimming to remove leading/trailing silence.
 * This helps make embeddings more robust by focusing on actual speech.
 */
async function preprocessAudioForEmbedding(audioFilePath) {
  if (!ffmpeg) return audioFilePath;

  const outputPath = audioFilePath.replace(/\.[^.]+$/, '_trimmed_for_vad.wav');
  // Quieter than -40dB: laptop mics often sit around -45…-50dB RMS; treat only true silence as silence.
  const db = Math.min(
    55,
    Math.max(35, parseInt(process.env.VOICE_VAD_TRIM_SILENCE_DB || '50', 10) || 50)
  );

  return new Promise((resolve, reject) => {
    // Use silenceremove to trim silence at beginning and end
    // Threshold and duration are conservative to avoid cutting speech.
    ffmpeg(audioFilePath)
      .audioFilters(
        `silenceremove=start_periods=1:start_silence=0.3:start_threshold=-${db}dB:stop_periods=1:stop_silence=0.5:stop_threshold=-${db}dB`
      )
      .outputOptions(['-ac', '1', '-ar', '16000'])
      .on('end', () => {
        resolve(outputPath);
      })
      .on('error', (err) => {
        console.warn('⚠️  VAD preprocessing failed, using raw audio instead:', err.message);
        resolve(audioFilePath);
      })
      .save(outputPath);
  });
}

/**
 * Speech band + gentle dynamics — same chain for enrollment samples and meeting chunks
 * so live chunks match enrollment preprocessing (especially quiet laptop mics).
 * @param {'enrollment'|'identification'} mode
 * @returns temp .wav path or null
 */
function tryFfmpegNormalizeVoiceAudioSync(inputPath, mode) {
  if (!inputPath || !fs.existsSync(inputPath)) return null;
  const envForMode =
    mode === 'enrollment'
      ? process.env.VOICE_ENROLLMENT_CLEAN_AUDIO
      : process.env.VOICE_IDENTIFICATION_CLEAN_AUDIO != null
        ? process.env.VOICE_IDENTIFICATION_CLEAN_AUDIO
        : process.env.VOICE_ENROLLMENT_CLEAN_AUDIO;
  if (String(envForMode || 'true').toLowerCase() === 'false') {
    return null;
  }
  const prefix = mode === 'enrollment' ? 'portiq_enroll_norm' : 'portiq_ident_norm';
  const out = path.join(
    os.tmpdir(),
    `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}.wav`
  );
  try {
    execFileSync(
      getFfmpegPath(),
      [
        '-nostdin',
        '-y',
        '-i',
        inputPath,
        '-af',
        'highpass=f=80,lowpass=f=7500,dynaudnorm=f=200:g=17',
        '-ac',
        '1',
        '-ar',
        '16000',
        out,
      ],
      { stdio: ['ignore', 'ignore', 'pipe'], maxBuffer: 25 * 1024 * 1024, timeout: 120000 }
    );
    if (!fs.existsSync(out) || fs.statSync(out).size < 256) {
      try {
        if (fs.existsSync(out)) fs.unlinkSync(out);
      } catch (_) {
        /* ignore */
      }
      return null;
    }
    return out;
  } catch (e) {
    console.warn(
      `⚠️  Voice ${mode} normalize step failed, using previous stage:`,
      e.message || e
    );
    try {
      if (fs.existsSync(out)) fs.unlinkSync(out);
    } catch (_) {
      /* ignore */
    }
    return null;
  }
}

/** @deprecated use tryFfmpegNormalizeVoiceAudioSync(path, 'enrollment') */
function tryFfmpegCleanVoiceEnrollmentSync(inputPath) {
  return tryFfmpegNormalizeVoiceAudioSync(inputPath, 'enrollment');
}

/**
 * Generate voice embedding from audio file
 * Uses pyannote.audio via Python script for production-quality embeddings
 * Falls back to simplified approach if Python script is not available
 */
/** Thrown when pyannote / Python embedding cannot run (config, deps, HF access). */
function voiceEmbeddingUnavailable(message, details = '') {
  const e = new Error(message);
  e.code = 'VOICE_EMBEDDING_UNAVAILABLE';
  e.details = String(details || '').trim().slice(0, 8000);
  return e;
}

function isVoiceEmbeddingStrict() {
  return String(process.env.VOICE_EMBEDDING_STRICT || '').toLowerCase() === 'true';
}

/** Default ON so enrollment saves instead of 503 when pyannote/HF is missing. */
function allowVoiceEmbeddingFallback() {
  return (
    String(process.env.ENABLE_FAKE_VOICE_EMBEDDING || '').toLowerCase() === 'true' ||
    !isVoiceEmbeddingStrict()
  );
}

/** Neural speaker model used for new voiceprints: 'wespeaker' (default) or legacy 'pyannote'. */
function defaultNeuralModel() {
  const m = String(process.env.VOICE_EMBEDDING_MODEL || 'wespeaker').trim().toLowerCase();
  return m === 'pyannote' ? 'pyannote' : 'wespeaker';
}

/**
 * Neural speaker embedding via voice_embedding.py (persistent worker, one-shot fallback).
 * @param {string} processedPath
 * @param {'wespeaker'|'pyannote'} [model]
 * @returns {Promise<number[]>}
 */
async function tryPyannoteEmbedding(processedPath, model = defaultNeuralModel()) {
  const pythonScript = path.join(__dirname, 'voice_embedding.py');
  if (!fs.existsSync(pythonScript)) {
    throw voiceEmbeddingUnavailable(
      'Voice embedding script is missing on the server.',
      `Expected file: ${pythonScript}`
    );
  }
  try {

    const hfToken = String(process.env.HF_TOKEN || process.env.HUGGINGFACE_TOKEN || '').trim();

    if (!hfToken) {
      console.warn('⚠️  HF_TOKEN not found in environment. Make sure to set it before starting the server.');
    } else {
      console.log(`🔑 Using HuggingFace token (length: ${hfToken.length})`);
    }

    const pythonBin = resolvePythonBinaryForVoice();
    if (!pythonBin) {
      throw voiceEmbeddingUnavailable(
        'Python 3 is not available on the server PATH.',
        'Set PYTHON_BIN to your python executable, or deploy with nixpacks.toml so Python installs on Railway.'
      );
    }

    const env = { ...process.env };
    if (hfToken) {
      env.HF_TOKEN = hfToken;
      env.HUGGINGFACE_TOKEN = hfToken;
    }

    const embedTimeout = Math.min(
      900000,
      Math.max(45000, parseInt(process.env.VOICE_EMBEDDING_TIMEOUT_MS || '240000', 10) || 240000)
    );

    // Fast path: persistent worker with the model already loaded.
    try {
      const resp = await workerRequest(
        { cmd: 'embed', path: processedPath, model },
        { pythonBin, env, timeoutMs: parseInt(process.env.VOICE_WORKER_REQUEST_TIMEOUT_MS || '60000', 10) || 60000 }
      );
      if (Array.isArray(resp.embedding) && resp.embedding.length > 0) {
        return resp.embedding;
      }
    } catch (workerErr) {
      console.warn('⚠️  Voice worker unavailable, using one-shot embedding:', workerErr.message || workerErr);
    }

    const command = `"${pythonBin}" "${pythonScript}" "${processedPath}" --model=${model}`;

    console.log(
      `📝 Executing: ${pythonBin} voice_embedding.py "${processedPath}" (timeout ${embedTimeout}ms) ${hfToken ? '[HF_TOKEN in env]' : '[no HF_TOKEN]'}`
    );

    let stdout = '';
    let stderr = '';
    try {
      const out = await execPromise(command, {
        timeout: embedTimeout,
        env,
        maxBuffer: 50 * 1024 * 1024,
      });
      stdout = String(out.stdout || '');
      stderr = String(out.stderr || '').trim();
    } catch (execErr) {
      stdout = String(execErr.stdout || '');
      stderr = String(execErr.stderr || '').trim();
      const bits = [stderr, stdout, execErr.message].filter(Boolean);
      const combined = bits.join('\n').slice(0, 8000);
      console.warn('⚠️  Python embedding process failed:', combined.slice(0, 2000));

      let headline = 'Voice embedding (Python / pyannote) failed on the server.';
      const low = combined.toLowerCase();
      const blob = `${combined}\n${execErr.message || ''}`;
      const code = execErr && execErr.code;
      if (
        code === 127 ||
        /enoent|not found|python3: not found|python: not found|spawn .*enoent/i.test(blob)
      ) {
        headline =
          'Python was not found or failed to start. Set PYTHON_BIN or install Python 3 (Railway: use nixpacks.toml in this repo).';
      } else if (!hfToken && (low.includes('token') || low.includes('401') || low.includes('403'))) {
        headline =
          'Hugging Face token is missing or invalid. Set HF_TOKEN (or HUGGINGFACE_TOKEN) and restart the server.';
      } else if (low.includes('403') || low.includes('restricted') || low.includes('gated')) {
        headline =
          'Hugging Face rejected access to pyannote models. Accept the model terms on huggingface.co for pyannote/embedding (and speaker-diarization if used), and use a token with read access.';
      } else if (low.includes('modulenotfounderror') || low.includes('no module named')) {
        headline =
          'Python voice dependencies are missing. Run: pip install -r server/requirements-voice.txt (Railway: redeploy after nixpacks.toml installs them).';
      } else if (low.includes('torch') || low.includes('cuda')) {
        headline = 'PyTorch / audio stack error while generating the embedding. See server logs for details.';
      } else if (/etimedout|timed out|timeout/i.test(combined) || execErr?.killed) {
        headline = `Voice embedding timed out after ${embedTimeout}ms. Set VOICE_EMBEDDING_TIMEOUT_MS (e.g. 600000) for first-time model download, then retry.`;
      }

      throw voiceEmbeddingUnavailable(headline, combined);
    }

    if (stderr && !stderr.includes('Warning') && !stderr.includes('UserWarning')) {
      console.warn('⚠️  Python script stderr:', stderr.slice(0, 1500));
    }

    let embedding;
    try {
      embedding = JSON.parse(stdout.trim());
    } catch (parseErr) {
      throw voiceEmbeddingUnavailable(
        'Voice embedding script did not return valid JSON.',
        [stderr, stdout].filter(Boolean).join('\n').slice(0, 8000)
      );
    }

    if (!Array.isArray(embedding) || embedding.length === 0) {
      throw voiceEmbeddingUnavailable(
        'Voice embedding script returned an empty or invalid vector.',
        [stderr, stdout].filter(Boolean).join('\n').slice(0, 8000)
      );
    }

    console.log(`✅ Voice embedding generated: ${embedding.length} dimensions`);
    return embedding;
  } catch (pythonError) {
    if (pythonError && pythonError.code === 'VOICE_EMBEDDING_UNAVAILABLE') {
      throw pythonError;
    }
    console.warn('⚠️  Python script failed:', pythonError.message);
    throw voiceEmbeddingUnavailable(
      'Voice embedding (Python / pyannote) failed.',
      pythonError.message || String(pythonError)
    );
  }
}

async function generateVoiceEmbedding(audioFilePath) {
  let processedPath = null;
  let cleanPath = null;
  try {
    // Read audio file
    if (!fs.existsSync(audioFilePath)) {
      throw new Error('Audio file not found');
    }

    // Preprocess with simple VAD to trim silence where possible
    processedPath = await preprocessAudioForEmbedding(audioFilePath);

    // Crystal-clear chain: band-limit + dynamics on top of trim (temp file cleaned up below)
    cleanPath = tryFfmpegNormalizeVoiceAudioSync(processedPath, 'enrollment');
    const embeddingPath = cleanPath || processedPath;

    let firstErr = null;
    for (const model of [...new Set([defaultNeuralModel(), 'pyannote'])]) {
      try {
        return await tryPyannoteEmbedding(embeddingPath, model);
      } catch (e) {
        if (!firstErr) firstErr = e;
        console.warn(`⚠️  Voice embedding with ${model} failed:`, e.message || e);
      }
    }
    if (!allowVoiceEmbeddingFallback()) throw firstErr;
    console.warn(
      '⚠️  Voice embedding: neural models unavailable, using FFT / mel-spectral fallback:',
      firstErr.message || firstErr
    );
    return await generateFftMelVoiceEmbedding(embeddingPath);
  } catch (error) {
    console.error('Error generating voice embedding:', error);
    throw error;
  } finally {
    if (cleanPath && fs.existsSync(cleanPath)) {
      try {
        fs.unlinkSync(cleanPath);
      } catch (_) {
        /* ignore */
      }
    }
    if (processedPath && processedPath !== audioFilePath && fs.existsSync(processedPath)) {
      try {
        fs.unlinkSync(processedPath);
      } catch (_) {
        /* ignore */
      }
    }
  }
}

/**
 * Browser MediaRecorder uploads are often webm/opus — normalize to 16 kHz mono WAV
 * before quality checks and pyannote (same idea as live-transcription chunk convert).
 * @returns {string|null} temp wav path or null when conversion is skipped/failed
 */
function convertVoiceEnrollmentToWav(inputPath) {
  if (!inputPath || !fs.existsSync(inputPath)) return null;
  const ext = path.extname(inputPath).toLowerCase();
  if (ext === '.wav') return null;

  const outPath = path.join(
    os.tmpdir(),
    `voice-enroll-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.wav`
  );
  try {
    execFileSync(
      getFfmpegPath(),
      ['-nostdin', '-y', '-i', inputPath, '-ac', '1', '-ar', '16000', '-vn', outPath],
      { stdio: ['ignore', 'ignore', 'pipe'], maxBuffer: 25 * 1024 * 1024, timeout: 120000 }
    );
    if (fs.existsSync(outPath) && fs.statSync(outPath).size > 400) {
      return outPath;
    }
  } catch (err) {
    console.warn('voice-enrollment ffmpeg convert skipped:', err.message || err);
  }
  try {
    if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
  } catch (_) {
    /* ignore */
  }
  return null;
}

/**
 * Decode arbitrary audio to mono s16le @ 16 kHz via ffmpeg (used for enrollment RMS checks).
 */
function ffmpegDecodeToMonoS16le16k(audioPath) {
  const out = path.join(
    os.tmpdir(),
    `portiq_pcm_${Date.now()}_${Math.random().toString(36).slice(2, 10)}.raw`
  );
  try {
    execFileSync(
      getFfmpegPath(),
      ['-nostdin', '-y', '-i', audioPath, '-ac', '1', '-ar', '16000', '-f', 's16le', out],
      { stdio: ['ignore', 'ignore', 'pipe'], maxBuffer: 25 * 1024 * 1024, timeout: 120000 }
    );
    return fs.readFileSync(out);
  } finally {
    try {
      if (fs.existsSync(out)) fs.unlinkSync(out);
    } catch (_) {
      /* ignore */
    }
  }
}

/**
 * Enrollment quality (quiet room, long enough sample, audible level) — reduces bad stored vectors.
 */
function validateVoiceEnrollmentQuality(audioPath) {
  let pcm;
  try {
    pcm = ffmpegDecodeToMonoS16le16k(audioPath);
  } catch (e) {
    return {
      ok: false,
      code: 'decode',
      reason: 'Could not decode audio. Use a supported format (WAV, MP3, M4A) and try again.',
      details: e.message || String(e),
    };
  }
  const sampleCount = Math.floor(pcm.length / 2);
  if (sampleCount < 2) {
    return { ok: false, code: 'empty', reason: 'Recording appears empty.', details: '' };
  }
  const durationSec = sampleCount / 16000;
  const minSec = Math.min(
    60,
    Math.max(2, parseFloat(process.env.VOICE_ENROLL_MIN_SECONDS || '6', 10) || 6)
  );
  if (durationSec < minSec) {
    return {
      ok: false,
      code: 'too_short',
      reason: `Recording is too short (${durationSec.toFixed(1)}s). In a quiet place, speak clearly for at least ${minSec} seconds (follow the on-screen script).`,
      details: '',
    };
  }
  let sumSq = 0;
  for (let i = 0; i < sampleCount; i++) {
    const v = pcm.readInt16LE(i * 2) / 32768;
    sumSq += v * v;
  }
  const rms = Math.sqrt(sumSq / sampleCount);
  const minRms = Math.min(
    0.5,
    Math.max(0.004, parseFloat(process.env.VOICE_ENROLL_MIN_RMS || '0.012', 10) || 0.012)
  );
  const maxRms = Math.min(
    1,
    Math.max(0.2, parseFloat(process.env.VOICE_ENROLL_MAX_RMS || '0.98', 10) || 0.98)
  );
  if (rms < minRms) {
    return {
      ok: false,
      code: 'too_quiet',
      reason:
        'Volume is too low for a reliable voiceprint. Move closer to the microphone and speak at a normal level.',
      details: `Measured RMS ${rms.toFixed(4)} (minimum ${minRms}).`,
    };
  }
  if (rms > maxRms) {
    return {
      ok: false,
      code: 'too_loud',
      reason:
        'Audio may be too loud or clipped. Reduce input gain and try again.',
      details: `Measured RMS ${rms.toFixed(4)}.`,
    };
  }
  return { ok: true, durationSec, rms, code: 'ok' };
}

function l2Normalize(vec) {
  let s = 0;
  for (let i = 0; i < vec.length; i++) s += vec[i] * vec[i];
  const n = Math.sqrt(s) || 1;
  return vec.map((x) => x / n);
}

function hzToMel(hz) {
  return 2595 * Math.log10(1 + Math.max(0, hz) / 700);
}

function melToHz(m) {
  return 700 * (Math.pow(10, m / 2595) - 1);
}

function int16leBufferToFloatFrame(buf, offset, frameSize) {
  const frame = new Float64Array(frameSize);
  const n = Math.min(frameSize, (buf.length - offset) >> 1);
  for (let i = 0; i < n; i++) {
    const v = buf.readInt16LE(offset + i * 2);
    frame[i] = v / 32768;
  }
  return frame;
}

/** Real-input DFT magnitude spectrum (one bin per k); n is power of 2, uses O(n^2) — fine for n=512. */
function dftMagnitudesReal(signal) {
  const n = signal.length;
  const half = n / 2;
  const mag = new Float64Array(half + 1);
  for (let k = 0; k <= half; k++) {
    let re = 0;
    let im = 0;
    for (let t = 0; t < n; t++) {
      const angle = (-2 * Math.PI * k * t) / n;
      re += signal[t] * Math.cos(angle);
      im += signal[t] * Math.sin(angle);
    }
    mag[k] = Math.sqrt(re * re + im * im);
  }
  return mag;
}

function buildMelFilterbank(sr, nFft, nMels, fMin, fMax) {
  const nBins = nFft / 2 + 1;
  const fftHz = (k) => (k * sr) / nFft;
  const melMin = hzToMel(fMin);
  const melMax = hzToMel(fMax);
  const mels = [];
  for (let i = 0; i <= nMels + 1; i++) {
    const m = melMin + (i * (melMax - melMin)) / (nMels + 1);
    mels.push(melToHz(m));
  }
  const fb = [];
  for (let m = 0; m < nMels; m++) {
    const fLo = mels[m];
    const fMid = mels[m + 1];
    const fHi = mels[m + 2];
    const weights = new Float64Array(nBins);
    for (let k = 0; k < nBins; k++) {
      const f = fftHz(k);
      let w = 0;
      if (f >= fLo && f <= fHi) {
        if (f <= fMid && fMid > fLo) w = (f - fLo) / (fMid - fLo);
        else if (fMid < fHi) w = (fHi - f) / (fHi - fMid);
      }
      weights[k] = w;
    }
    fb.push(weights);
  }
  return fb;
}

/**
 * Lightweight spectral "embedding" from short audio: log-mel energy + temporal deltas.
 * Uses explicit DFT (FFT-sized windows) — no ML runtime; pairs with same-length stored vectors only.
 */
async function generateFftMelVoiceEmbedding(audioFilePath) {
  const sr = 16000;
  let pcm;
  try {
    pcm = ffmpegDecodeToMonoS16le16k(audioFilePath);
  } catch (e) {
    console.warn('⚠️  ffmpeg decode for FFT embedding failed:', e.message);
    throw new Error(
      'Could not decode audio for speaker fingerprint (ffmpeg required on server for FFT fallback).'
    );
  }
  if (!pcm || pcm.length < 256) {
    throw new Error('Audio too short for spectral embedding');
  }

  const melFb = buildMelFilterbank(sr, FFT_FRAME_SIZE, FFT_MEL_BANDS, 80, 7600);
  const frameFeats = [];

  for (let start = 0; start + FFT_FRAME_SIZE <= pcm.length; start += FFT_HOP) {
    const frame = int16leBufferToFloatFrame(pcm, start, FFT_FRAME_SIZE);
    for (let i = 0; i < FFT_FRAME_SIZE; i++) {
      frame[i] *= 0.5 * (1 - Math.cos((2 * Math.PI * i) / (FFT_FRAME_SIZE - 1)));
    }
    const mag = dftMagnitudesReal(frame);
    const mel = new Float64Array(FFT_MEL_BANDS);
    for (let m = 0; m < FFT_MEL_BANDS; m++) {
      let e = 0;
      const w = melFb[m];
      for (let k = 0; k < mag.length; k++) e += mag[k] * w[k];
      mel[m] = Math.log(1 + Math.max(e, 1e-10));
    }
    frameFeats.push(mel);
  }

  if (frameFeats.length === 0) {
    const pad = int16leBufferToFloatFrame(pcm, 0, FFT_FRAME_SIZE);
    for (let i = 0; i < FFT_FRAME_SIZE; i++) {
      pad[i] *= 0.5 * (1 - Math.cos((2 * Math.PI * i) / (FFT_FRAME_SIZE - 1)));
    }
    const mag = dftMagnitudesReal(pad);
    const mel = new Float64Array(FFT_MEL_BANDS);
    for (let m = 0; m < FFT_MEL_BANDS; m++) {
      let e = 0;
      const w = melFb[m];
      for (let k = 0; k < mag.length; k++) e += mag[k] * w[k];
      mel[m] = Math.log(1 + Math.max(e, 1e-10));
    }
    frameFeats.push(mel);
  }

  const mean = new Float64Array(FFT_MEL_BANDS);
  for (const f of frameFeats) {
    for (let b = 0; b < FFT_MEL_BANDS; b++) mean[b] += f[b];
  }
  for (let b = 0; b < FFT_MEL_BANDS; b++) mean[b] /= frameFeats.length;

  const delta = new Float64Array(FFT_MEL_BANDS);
  if (frameFeats.length > 1) {
    let count = 0;
    for (let t = 1; t < frameFeats.length; t++) {
      for (let b = 0; b < FFT_MEL_BANDS; b++) {
        delta[b] += Math.abs(frameFeats[t][b] - frameFeats[t - 1][b]);
      }
      count++;
    }
    for (let b = 0; b < FFT_MEL_BANDS; b++) delta[b] /= count;
  }

  const emb = [...mean, ...delta];
  while (emb.length < FFT_VOICE_EMBEDDING_DIM) emb.push(0);
  const out = l2Normalize(emb.slice(0, FFT_VOICE_EMBEDDING_DIM));
  for (let i = 0; i < out.length; i++) {
    if (!Number.isFinite(out[i])) out[i] = 0;
  }
  return out;
}

/** Cosine similarity between same-dimensional embeddings (0 when dimensions differ). */
const compareEmbeddings = voiceMatching.cosine;

const { profileEmbeddingKind, embeddingKindForVector, newVoiceSessionContext, profileTemplates, KIND_ORDER } =
  voiceMatching;

/** Strongest embedding family each profile can be scored with → the families a sample needs. */
function neededKinds(profiles) {
  const kinds = new Set();
  for (const p of profiles || []) {
    const have = new Set(profileTemplates(p).map((t) => t.kind));
    const best = KIND_ORDER.find((k) => have.has(k));
    if (best) kinds.add(best);
  }
  return kinds;
}

/**
 * Embed one audio file in every family needed to score `profiles`.
 * @returns {Promise<{ wespeaker: number[]|null, pyannote: number[]|null, fft: number[]|null }>}
 */
async function embedForProfiles(embeddingPath, profiles) {
  const kinds = neededKinds(profiles);
  const out = { wespeaker: null, pyannote: null, fft: null };
  for (const kind of ['wespeaker', 'pyannote']) {
    if (!kinds.has(kind)) continue;
    try {
      out[kind] = await tryPyannoteEmbedding(embeddingPath, kind);
    } catch (e) {
      console.warn(`Segment ${kind} embedding unavailable:`, e.message || e);
    }
  }
  if (kinds.has('fft') && allowVoiceEmbeddingFallback()) {
    try {
      out.fft = await generateFftMelVoiceEmbedding(embeddingPath);
    } catch (e) {
      console.warn('Segment FFT embedding failed:', e.message || e);
    }
  }
  return out;
}

/**
 * @param {object[]} profiles VoiceProfile docs (voiceVector, voiceEmbeddings, embeddingKind, email, name)
 * @param {object|null} sessionContext per-meeting learning state (newVoiceSessionContext())
 * @param {{ cohortByKind?: object }} [opts] other people's voiceprints for score normalisation
 */
function matchEmbeddingToProfiles(embByKind, profiles, sessionContext = null, opts = {}) {
  return voiceMatching.matchEmbeddingToProfiles(embByKind, profiles, sessionContext, opts);
}

/**
 * Identify the speaker of a short (single-speaker) audio file — used for live utterances.
 */
async function identifySpeaker(audioFilePath, voiceProfiles, sessionContext = null, opts = {}) {
  let processedPath = null;
  let cleanPath = null;
  try {
    if (!fs.existsSync(audioFilePath)) {
      throw new Error('Audio file not found');
    }
    const profiles = (voiceProfiles || []).filter((p) => profileTemplates(p).length > 0);
    if (profiles.length === 0) return null;

    processedPath = await preprocessAudioForEmbedding(audioFilePath);
    cleanPath = tryFfmpegNormalizeVoiceAudioSync(processedPath, 'identification');
    const embeddingPath = cleanPath || processedPath;

    const embByKind = await embedForProfiles(embeddingPath, profiles);
    if (!embByKind.wespeaker && !embByKind.pyannote && !embByKind.fft) return null;
    return matchEmbeddingToProfiles(embByKind, profiles, sessionContext, opts);
  } catch (error) {
    console.error('Error identifying speaker:', error);
    return null;
  } finally {
    try {
      if (cleanPath && fs.existsSync(cleanPath)) fs.unlinkSync(cleanPath);
    } catch (_) {
      /* ignore */
    }
    try {
      if (processedPath && processedPath !== audioFilePath && fs.existsSync(processedPath)) {
        fs.unlinkSync(processedPath);
      }
    } catch (_) {
      /* ignore */
    }
  }
}

function voiceWorkerEnv() {
  const hfToken = String(process.env.HF_TOKEN || process.env.HUGGINGFACE_TOKEN || '').trim();
  const env = { ...process.env };
  if (hfToken) {
    env.HF_TOKEN = hfToken;
    env.HUGGINGFACE_TOKEN = hfToken;
  }
  return env;
}

/** Fire-and-forget model load at boot (skipped without HF credentials or Python). */
function warmVoiceWorker() {
  const hfToken = String(process.env.HF_TOKEN || process.env.HUGGINGFACE_TOKEN || '').trim();
  const pythonBin = resolvePythonBinaryForVoice();
  if (!hfToken || !pythonBin) return;
  workerRequest({ cmd: 'ping' }, { pythonBin, env: voiceWorkerEnv(), timeoutMs: 30000 }).catch((e) =>
    console.warn('⚠️  Voice worker warm-up failed (will retry on first use):', e.message || e)
  );
}

/**
 * pyannote embeddings for many [start, end] windows of one 16 kHz mono WAV, in a single worker call.
 * @returns {Promise<(number[]|null)[]|null>} null when the worker is unavailable
 */
async function embedAudioWindows(wavPath, windows, model = defaultNeuralModel()) {
  const pythonBin = resolvePythonBinaryForVoice();
  if (!pythonBin || !Array.isArray(windows) || !windows.length) return null;
  const env = voiceWorkerEnv();
  // The worker is sequential: small batches let live-meeting requests interleave instead of
  // queuing behind a whole recording (and timing out, which would restart the worker mid-job).
  const batchSize = Math.max(1, parseInt(process.env.VOICE_WINDOW_BATCH || '24', 10) || 24);
  const out = [];
  try {
    for (let i = 0; i < windows.length; i += batchSize) {
      const batch = windows.slice(i, i + batchSize);
      const resp = await workerRequest(
        { cmd: 'embed_windows', path: wavPath, windows: batch, model },
        // ~0.3s per window on CPU plus audio load; generous ceiling.
        { pythonBin, env, timeoutMs: 60000 + batch.length * 3000 }
      );
      if (!Array.isArray(resp.embeddings) || resp.embeddings.length !== batch.length) return null;
      out.push(...resp.embeddings);
    }
    return out;
  } catch (e) {
    console.warn('⚠️  Window embeddings unavailable:', e.message || e);
    return null;
  }
}

/**
 * Self-consistency of an enrollment sample: embed its two halves and compare. A clean sample of one
 * person scores high; background talk, music, a second voice or heavy noise scores low — exactly
 * the samples that later fail to recognise anyone.
 * @returns {Promise<number|null>} cosine between halves, or null when it cannot be measured
 */
async function assessEnrollmentConsistency(wavPath, durationSec, kind) {
  if (kind !== 'wespeaker' && kind !== 'pyannote') return null;
  const d = Number(durationSec) || 0;
  if (d < 5) return null;
  const half = d / 2;
  const embs = await embedAudioWindows(wavPath, [[0, half], [half, d]], kind);
  if (!embs || !embs[0] || !embs[1]) return null;
  return compareEmbeddings(embs[0], embs[1]);
}

module.exports = {
  generateVoiceEmbedding,
  assessEnrollmentConsistency,
  compareEmbeddings,
  identifySpeaker,
  matchEmbeddingToProfiles,
  newVoiceSessionContext,
  embedAudioWindows,
  warmVoiceWorker,
  profileEmbeddingKind,
  embeddingKindForVector,
  validateVoiceEnrollmentQuality,
  convertVoiceEnrollmentToWav,
  FFT_VOICE_EMBEDDING_DIM,
};

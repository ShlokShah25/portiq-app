const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec, execFileSync } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

/**
 * Speaker identification — accuracy expectations
 * ------------------------------------------------------------
 * - Target “workspace safe” labels (wrong name ~never): use pyannote embeddings (HF_TOKEN + Python)
 *   and strict matching (default). FFT/mel fallback is noisier; still uses conservative thresholds.
 * - Reject ambiguous matches: best score must be clearly above the runner-up (margin).
 * - Enrollment: require enough speech at healthy volume so stored vectors are stable.
 *
 * Enrollment: VOICE_ENROLLMENT_CLEAN_AUDIO (default true) runs ffmpeg band-limit + dynaudnorm
 * before embeddings for clearer samples. Set VOICE_ENROLLMENT_CLEAN_AUDIO=false to disable.
 *
 * Tune via env: VOICE_MATCH_STRICT, VOICE_PYANNOTE_MIN, VOICE_FFT_MIN, VOICE_MATCH_MARGIN,
 * VOICE_SINGLE_PYANNOTE_MIN, VOICE_SINGLE_FFT_MIN, VOICE_FFT_CONFIRM_MIN,
 * VOICE_SINGLE_PYANNOTE_RELAXED, VOICE_SINGLE_FFT_RELAXED, VOICE_ENROLL_MIN_SECONDS, VOICE_ENROLL_MIN_RMS.
 * Identification uses the same band-limit + dynaudnorm chain as enrollment when
 * VOICE_IDENTIFICATION_CLEAN_AUDIO is true (default), so live chunks match stored embeddings.
 * VOICE_VAD_TRIM_SILENCE_DB (35–55, default 50): silenceremove threshold in dB — higher = only trim very quiet silence.
 * 3+ enrolled: VOICE_MULTI_CONFIDENT_MIN (default 0.75) accepts best match; below that VOICE_MULTI_CLOSEST_FLOOR
 * (default 0.5) picks closest embedding — avoids “all unidentified” when scores are weak but ordered.
 * 2 enrolled: VOICE_CONFIDENT_PICK_MIN (default 0.75) picks best py/fft top-1 when the dual-speaker block did not
 * already choose (keeps single-speaker labels; pooled [A/B] in text stays rare).
 *
 * Identification: pyannote first when available; if confidence/margin fails, FFT can confirm the same
 * person (same email top-1 on both) or fall back to FFT-only scoring when enrollments are FFT-sized.
 */

/** Mel slice size (log-mel mean + delta); paired with acoustic prosody features for fallback embeddings. */
const FFT_MEL_EMBEDDING_DIM = 128;
/** Extra pitch / prosody / band-shape features (appended after mel for richer fingerprint). */
const ACOUSTIC_FEATURE_DIM = 32;
/** Full fallback embedding = mel + acoustics (legacy DB may still store 128 mel-only). */
const FFT_VOICE_EMBEDDING_DIM = FFT_MEL_EMBEDDING_DIM + ACOUSTIC_FEATURE_DIM;
const FFT_FRAME_SIZE = 512;
const FFT_HOP = 256;
const FFT_MEL_BANDS = 64;
/** `pcm` buffers are s16le bytes; frame/hop strides must be in bytes. */
const FFT_FRAME_BYTES = FFT_FRAME_SIZE * 2;
const FFT_HOP_BYTES = FFT_HOP * 2;

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
 * so pyannote/FFT scores are comparable to stored profiles (especially quiet laptop mics).
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
      'ffmpeg',
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
/**
 * Pyannote embedding only (no FFT fallback). Used for dual-path identification.
 * @returns {Promise<number[]|null>}
 */
async function tryPyannoteEmbedding(processedPath) {
  const pythonScript = path.join(__dirname, 'voice_embedding.py');
  if (!fs.existsSync(pythonScript)) return null;
  try {
    console.log('🎤 Generating voice embedding using pyannote.audio...');

    const hfToken = process.env.HF_TOKEN || process.env.HUGGINGFACE_TOKEN;

    if (!hfToken) {
      console.warn('⚠️  HF_TOKEN not found in environment. Make sure to set it before starting the server.');
    } else {
      console.log(`🔑 Using HuggingFace token (length: ${hfToken.length})`);
    }

    const env = { ...process.env };
    if (hfToken) {
      env.HF_TOKEN = hfToken;
      env.HUGGINGFACE_TOKEN = hfToken;
    }

    const command = hfToken
      ? `python3 "${pythonScript}" "${processedPath}" "${hfToken}"`
      : `python3 "${pythonScript}" "${processedPath}"`;

    console.log(`📝 Executing: python3 voice_embedding.py "${processedPath}" ${hfToken ? '[token provided]' : '[no token]'}`);

    const { stdout, stderr } = await execPromise(command, {
      timeout: 30000,
      env: env,
    });

    if (stderr && !stderr.includes('Warning') && !stderr.includes('UserWarning')) {
      console.warn('⚠️  Python script warning:', stderr);
    }

    const embedding = JSON.parse(stdout.trim());

    if (!Array.isArray(embedding) || embedding.length === 0) {
      throw new Error('Invalid embedding format from Python script');
    }

    console.log(`✅ Voice embedding generated: ${embedding.length} dimensions`);
    return embedding;
  } catch (pythonError) {
    console.warn('⚠️  Python script failed:', pythonError.message);
    return null;
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

    const py = await tryPyannoteEmbedding(embeddingPath);
    if (py) return py;

    // Fallback: simplified embedding when pyannote/Python/HF is not available.
    // Default ON so voice enrollment saves instead of 500; set VOICE_EMBEDDING_STRICT=true to hard-fail without ML.
    const strict = String(process.env.VOICE_EMBEDDING_STRICT || '').toLowerCase() === 'true';
    const allowFallback =
      String(process.env.ENABLE_FAKE_VOICE_EMBEDDING || '').toLowerCase() === 'true' || !strict;
    if (!allowFallback) {
      throw new Error(
        'Voice embedding backend unavailable (pyannote/HF missing or failed). ' +
          'Set HF_TOKEN and server-side Python+pyannote, or unset VOICE_EMBEDDING_STRICT and rely on fallback, ' +
          'or set ENABLE_FAKE_VOICE_EMBEDDING=true.'
      );
    }
    console.warn(
      '⚠️  Voice embedding: using FFT / mel-spectral fallback (set HF_TOKEN + pyannote for production-grade embeddings)'
    );
    const embedding = await generateFftMelVoiceEmbedding(embeddingPath);
    return embedding;
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

function hzToMel(hz) {
  return 2595 * Math.log10(1 + Math.max(0, hz) / 700);
}

function melToHz(m) {
  return 700 * (Math.pow(10, m / 2595) - 1);
}

/**
 * Decode arbitrary audio to mono s16le @ 16 kHz via ffmpeg (required for spectral path).
 */
function ffmpegDecodeToMonoS16le16k(audioPath) {
  const out = path.join(
    os.tmpdir(),
    `portiq_pcm_${Date.now()}_${Math.random().toString(36).slice(2, 10)}.raw`
  );
  try {
    execFileSync(
      'ffmpeg',
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
    Math.max(2, parseFloat(process.env.VOICE_ENROLL_MIN_SECONDS || '4', 10) || 4)
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

function l2Normalize(vec) {
  let s = 0;
  for (let i = 0; i < vec.length; i++) s += vec[i] * vec[i];
  const n = Math.sqrt(s) || 1;
  return vec.map((x) => x / n);
}

function meanStd(arr) {
  if (!arr.length) return { mean: 0, std: 0 };
  let m = 0;
  for (const x of arr) m += x;
  m /= arr.length;
  let v = 0;
  for (const x of arr) v += (x - m) * (x - m);
  v = Math.sqrt(v / arr.length);
  return { mean: m, std: v };
}

/**
 * Pitch proxy (Hz) via autocorrelation peak in speech range; 0 if unclear.
 */
function estimatePitchHzFromFrame(frame, sr) {
  const n = frame.length;
  let mu = 0;
  for (let i = 0; i < n; i++) mu += frame[i];
  mu /= n;
  const x = new Float64Array(n);
  for (let i = 0; i < n; i++) x[i] = frame[i] - mu;
  const minLag = Math.max(2, Math.floor(sr / 500));
  const maxLag = Math.min(Math.floor(n / 2) - 1, Math.floor(sr / 70));
  let bestLag = 0;
  let best = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0;
    for (let i = 0; i < n - lag; i++) s += x[i] * x[i + lag];
    if (s > best) {
      best = s;
      bestLag = lag;
    }
  }
  if (bestLag < 1 || best <= 0) return { hz: 0, clarity: 0 };
  let e = 0;
  for (let i = 0; i < n; i++) e += x[i] * x[i];
  const clarity = e > 1e-10 ? best / e : 0;
  return { hz: sr / bestLag, clarity: Math.min(1, clarity) };
}

/**
 * Spectral centroid / rolloff (Hz), ZCR, subband energy ratios from magnitude bins.
 */
function spectralShapeFromMag(mag, sr, nFft) {
  const nBins = mag.length;
  let sumMag = 1e-10;
  let centNum = 0;
  for (let k = 0; k < nBins; k++) {
    const hz = (k * sr) / nFft;
    sumMag += mag[k];
    centNum += hz * mag[k];
  }
  const centroid = centNum / sumMag;
  let cum = 0;
  const target = 0.85 * sumMag;
  let rolloff = 0;
  for (let k = 0; k < nBins; k++) {
    cum += mag[k];
    if (cum >= target) {
      rolloff = (k * sr) / nFft;
      break;
    }
  }
  const nyq = sr / 2;
  let low = 0;
  let mid = 0;
  let high = 0;
  for (let k = 0; k < nBins; k++) {
    const hz = (k * sr) / nFft;
    const m = mag[k];
    if (hz < 1000) low += m;
    else if (hz < 4000) mid += m;
    else high += m;
  }
  const s = low + mid + high + 1e-10;
  return {
    centroid,
    rolloff,
    bandLow: low / s,
    bandMid: mid / s,
    bandHigh: high / s,
  };
}

/**
 * Prosody / acoustic statistics (pitch rhythm, spectral shape, energy) — complements mel texture.
 */
function computeAcousticProsodyVector(pcm, sr) {
  const sampleCount = Math.floor(pcm.length / 2);
  if (sampleCount < FFT_FRAME_SIZE) {
    return new Array(ACOUSTIC_FEATURE_DIM).fill(0);
  }

  const centroids = [];
  const rolloffs = [];
  const zcrs = [];
  const rmsList = [];
  const pitches = [];
  const clarities = [];
  const fluxes = [];
  let prevMag = null;

  for (let start = 0; start + FFT_FRAME_BYTES <= pcm.length; start += FFT_HOP_BYTES) {
    const frame = int16leBufferToFloatFrame(pcm, start, FFT_FRAME_SIZE);
    for (let i = 0; i < FFT_FRAME_SIZE; i++) {
      frame[i] *= 0.5 * (1 - Math.cos((2 * Math.PI * i) / (FFT_FRAME_SIZE - 1)));
    }
    let rms = 0;
    for (let i = 0; i < FFT_FRAME_SIZE; i++) rms += frame[i] * frame[i];
    rms = Math.sqrt(rms / FFT_FRAME_SIZE);
    rmsList.push(rms);

    let zc = 0;
    for (let i = 1; i < FFT_FRAME_SIZE; i++) {
      if (frame[i - 1] * frame[i] < 0) zc += 1;
    }
    zcrs.push(zc / FFT_FRAME_SIZE);

    const mag = dftMagnitudesReal(frame);
    const sh = spectralShapeFromMag(mag, sr, FFT_FRAME_SIZE);
    centroids.push(sh.centroid);
    rolloffs.push(sh.rolloff);

    if (prevMag) {
      let f = 0;
      for (let k = 0; k < Math.min(mag.length, prevMag.length); k++) {
        f += Math.abs(mag[k] - prevMag[k]);
      }
      fluxes.push(f / mag.length);
    }
    prevMag = mag;

    const { hz, clarity } = estimatePitchHzFromFrame(frame, sr);
    if (hz > 50 && hz < 500 && clarity > 0.15) {
      pitches.push(hz);
      clarities.push(clarity);
    }
  }

  const c = meanStd(centroids);
  const r = meanStd(rolloffs);
  const z = meanStd(zcrs);
  const rm = meanStd(rmsList);
  const p = meanStd(pitches);
  const clar = meanStd(clarities);
  const fl = meanStd(fluxes);

  let rmsDelta = 0;
  if (rmsList.length > 1) {
    let acc = 0;
    for (let i = 1; i < rmsList.length; i++) acc += Math.abs(rmsList[i] - rmsList[i - 1]);
    rmsDelta = acc / (rmsList.length - 1);
  }
  const voicedFrac = pitches.length / Math.max(1, rmsList.length);
  const dynRange =
    rmsList.length > 0 ? Math.max(...rmsList) / (Math.max(1e-6, Math.min(...rmsList))) : 1;

  const raw = [
    c.mean / 8000,
    c.std / 2000,
    r.mean / 8000,
    r.std / 2000,
    z.mean,
    z.std,
    rm.mean,
    rm.std,
    p.mean / 500,
    p.std / 100,
    voicedFrac,
    clar.mean,
    fl.mean / 10,
    fl.std / 10,
    rmsDelta * 5,
    rm.std / (rm.mean + 1e-6),
    Math.log1p(dynRange) / 5,
    c.mean / (r.mean + 1e-6) / 3,
    shFromLastBandLow(pcm, sr),
    z.mean / (rm.mean + 1e-6),
    pitches.length > 2 ? (Math.max(...pitches) - Math.min(...pitches)) / 200 : 0,
    centroids.length > 0 ? (Math.max(...centroids) - Math.min(...centroids)) / 4000 : 0,
    rolloffs.length > 0 ? (Math.max(...rolloffs) - Math.min(...rolloffs)) / 4000 : 0,
    fluxes.length > 2 ? meanStd(fluxes).std / (fl.mean + 1e-6) : 0,
    rmsList.length > 4 ? stdOf(rmsList.slice(0, Math.floor(rmsList.length / 2))) / (rm.mean + 1e-6) : 0,
    rmsList.length > 4 ? stdOf(rmsList.slice(Math.floor(rmsList.length / 2))) / (rm.mean + 1e-6) : 0,
    Math.min(1, pitches.length / 20),
    Math.min(1, clar.mean * 2),
    Math.tanh(c.std / 500),
    Math.tanh(r.std / 500),
    Math.tanh(z.std),
  ];

  while (raw.length < ACOUSTIC_FEATURE_DIM) raw.push(0);
  return raw.slice(0, ACOUSTIC_FEATURE_DIM).map((x) => (Number.isFinite(x) ? Math.tanh(x) : 0));
}

function stdOf(a) {
  if (!a.length) return 0;
  const { mean, std } = meanStd(a);
  return std;
}

function shFromLastBandLow(pcm, sr) {
  /* Overall HF/LF proxy using one DFT on the first full frame. */
  const frame = int16leBufferToFloatFrame(pcm, 0, FFT_FRAME_SIZE);
  const n = frame.length;
  if (n < 64) return 0;
  for (let i = 0; i < n; i++) {
    frame[i] *= 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
  }
  const mag = dftMagnitudesReal(frame);
  const sh = spectralShapeFromMag(mag, sr, n);
  return Math.tanh((sh.bandHigh - sh.bandLow) * 2);
}

/**
 * Lightweight spectral "embedding" from short audio: log-mel energy + temporal deltas + acoustic prosody.
 * Uses explicit DFT — no ML runtime; pairs with same-length stored vectors only.
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

  for (let start = 0; start + FFT_FRAME_BYTES <= pcm.length; start += FFT_HOP_BYTES) {
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

  const melBlock = [...mean, ...delta];
  const acoustic = computeAcousticProsodyVector(pcm, sr);
  const emb = melBlock.concat(acoustic);
  while (emb.length < FFT_VOICE_EMBEDDING_DIM) emb.push(0);
  const out = l2Normalize(emb.slice(0, FFT_VOICE_EMBEDDING_DIM));
  for (let i = 0; i < out.length; i++) {
    if (!Number.isFinite(out[i])) out[i] = 0;
  }
  return out;
}

/**
 * Legacy enrollments may store 128-D mel-only FFT vectors; new pipeline uses 160-D mel + acoustics.
 */
function embeddingsCompatible(len1, len2) {
  if (len1 === len2) return true;
  return (
    (len1 === FFT_MEL_EMBEDDING_DIM && len2 === FFT_VOICE_EMBEDDING_DIM) ||
    (len2 === FFT_MEL_EMBEDDING_DIM && len1 === FFT_VOICE_EMBEDDING_DIM)
  );
}

/**
 * Compare two voice embeddings using cosine similarity (mel-only prefix when 128 vs 160).
 */
function compareEmbeddings(embedding1, embedding2) {
  if (!Array.isArray(embedding1) || !Array.isArray(embedding2)) return 0;

  let a = embedding1;
  let b = embedding2;
  if (a.length !== b.length) {
    if (
      (a.length === FFT_MEL_EMBEDDING_DIM && b.length === FFT_VOICE_EMBEDDING_DIM) ||
      (b.length === FFT_MEL_EMBEDDING_DIM && a.length === FFT_VOICE_EMBEDDING_DIM)
    ) {
      a = a.length === FFT_VOICE_EMBEDDING_DIM ? a.slice(0, FFT_MEL_EMBEDDING_DIM) : a;
      b = b.length === FFT_VOICE_EMBEDDING_DIM ? b.slice(0, FFT_MEL_EMBEDDING_DIM) : b;
    } else {
      return 0;
    }
  }

  let dotProduct = 0;
  let norm1 = 0;
  let norm2 = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    norm1 += a[i] * a[i];
    norm2 += b[i] * b[i];
  }

  norm1 = Math.sqrt(norm1);
  norm2 = Math.sqrt(norm2);

  if (norm1 === 0 || norm2 === 0) {
    return 0;
  }

  return dotProduct / (norm1 * norm2);
}

function parseThresholdEnv(key, def, min, max) {
  const v = parseFloat(process.env[key] || '', 10);
  if (Number.isNaN(v)) return def;
  return Math.min(max, Math.max(min, v));
}

function emailKey(profile) {
  return String(profile && profile.email).toLowerCase();
}

function scoreVoiceProfiles(segmentEmbedding, profiles, sessionContext, kind) {
  if (!Array.isArray(segmentEmbedding) || segmentEmbedding.length === 0) return [];
  const scored = [];
  const useCtx = !!(sessionContext && sessionContext.centroids && sessionContext.centroids.size > 0);

  for (const profile of profiles) {
    const pv = profile && profile.voiceVector;
    if (!Array.isArray(pv) || !embeddingsCompatible(segmentEmbedding.length, pv.length)) continue;

    let baseScore = compareEmbeddings(segmentEmbedding, pv);

    if (useCtx) {
      const key = emailKey(profile);
      const cent = sessionContext.centroids.get(key);
      const mean = centroidMean(cent);
      if (Array.isArray(mean) && embeddingsCompatible(segmentEmbedding.length, mean.length)) {
        const ctxScore = compareEmbeddings(segmentEmbedding, mean);
        const w = kind === 'pyannote' ? 0.65 : 0.55;
        baseScore = w * baseScore + (1 - w) * ctxScore;
      }
    }

    scored.push({ profile, score: baseScore });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored;
}

/**
 * Global winner under absolute + margin rules (same semantics as strict identifySpeaker).
 */
function tryPickFromScored(scored, minConf, minSingle, margin, pairSimBoost) {
  if (!scored || scored.length === 0) return null;
  const best = scored[0];
  const second = scored[1];
  if (scored.length === 1) {
    if (best.score >= minSingle) return { profile: best.profile, confidence: best.score, tieBreak: 'global' };
    return null;
  }
  const effectiveMargin = margin + pairSimBoost;
  if (best.score >= minConf && (!second || best.score - second.score >= effectiveMargin)) {
    return { profile: best.profile, confidence: best.score, tieBreak: 'global' };
  }
  return null;
}

function cloneEmbedding(e) {
  return Array.isArray(e) ? e.slice() : [];
}

function centroidMean(c) {
  if (!c || !c.sum || !c.n) return null;
  const out = new Array(c.sum.length);
  for (let i = 0; i < c.sum.length; i++) out[i] = c.sum[i] / c.n;
  return l2Normalize(out);
}

function updateSessionCentroid(ctx, email, embedding) {
  if (!ctx || !email || !embedding) return;
  const key = String(email).toLowerCase();
  let c = ctx.centroids.get(key);
  if (!c) {
    ctx.centroids.set(key, { sum: cloneEmbedding(embedding), n: 1 });
    return;
  }
  if (c.sum.length !== embedding.length) {
    ctx.centroids.set(key, { sum: cloneEmbedding(embedding), n: 1 });
    return;
  }
  for (let i = 0; i < embedding.length; i++) c.sum[i] += embedding[i];
  c.n += 1;
}

/** Best of pyannote vs FFT top-1 (for multi-speaker fallbacks). */
function pickBestMergedScoredCandidate(scoredPy, scoredFft) {
  const cands = [];
  if (scoredPy && scoredPy[0]) {
    cands.push({ profile: scoredPy[0].profile, score: scoredPy[0].score, kind: 'pyannote' });
  }
  if (scoredFft && scoredFft[0]) {
    cands.push({ profile: scoredFft[0].profile, score: scoredFft[0].score, kind: 'fft' });
  }
  if (!cands.length) return null;
  cands.sort((a, b) => b.score - a.score);
  return cands[0];
}

function maxStoredProfileSimilarity(scored) {
  let maxSim = 0;
  for (let i = 0; i < scored.length; i++) {
    const vi = scored[i].profile && scored[i].profile.voiceVector;
    if (!Array.isArray(vi)) continue;
    for (let j = i + 1; j < scored.length; j++) {
      const vj = scored[j].profile && scored[j].profile.voiceVector;
      if (!Array.isArray(vj) || !embeddingsCompatible(vi.length, vj.length)) continue;
      const s = compareEmbeddings(vi, vj);
      if (s > maxSim) maxSim = s;
    }
  }
  return maxSim;
}

/**
 * When global scores are ambiguous (similar-sounding people), use meeting-local context:
 * - continuity with previous chunk
 * - running centroid per enrolled email (who spoke most recently in that timbre)
 */
function resolveSimilarVoicesWithSession(
  segmentEmbedding,
  scored,
  minConf,
  effectiveMargin,
  ctx,
  isFftFallback,
  embeddingKind
) {
  if (!ctx || scored.length < 2) return null;

  const best = scored[0];
  const second = scored[1];
  const ambiguous = second && best.score - second.score < effectiveMargin;

  const contHi = parseThresholdEnv('VOICE_CONTINUITY_HIGH', 0.82, 0.68, 0.96);
  const contLo = parseThresholdEnv('VOICE_CONTINUITY_SWITCH', 0.68, 0.45, 0.85);
  const centroidMin = parseThresholdEnv('VOICE_CENTROID_MATCH_MIN', 0.76, 0.55, 0.94);

  const continuityAllowed =
    !ctx.lastEmbeddingKind ||
    !embeddingKind ||
    ctx.lastEmbeddingKind === embeddingKind;

  if (continuityAllowed && ctx.lastEmbedding && ctx.lastEmail) {
    const cont = compareEmbeddings(segmentEmbedding, ctx.lastEmbedding);
    const lastKey = String(ctx.lastEmail).toLowerCase();
    const lastScored = scored.find((s) => emailKey(s.profile) === lastKey);

    if (cont >= contHi && lastScored && lastScored.score >= minConf - (isFftFallback ? 0.12 : 0.08)) {
      return {
        profile: lastScored.profile,
        confidence: Math.min(0.99, (best.score + cont + lastScored.score) / 3),
        tieBreak: 'continuity_same',
      };
    }

    if (ambiguous && cont <= contLo && second) {
      const other = scored.find((s) => emailKey(s.profile) !== lastKey);
      if (other && other.score >= minConf - 0.15 && other.score + 0.02 >= (lastScored ? lastScored.score : 0)) {
        return {
          profile: other.profile,
          confidence: other.score,
          tieBreak: 'turn_switch',
        };
      }
    }
  }

  let bestCentEmail = null;
  let bestCentScore = -1;
  for (const s of scored.slice(0, 4)) {
    const key = emailKey(s.profile);
    const cent = ctx.centroids.get(key);
    const mean = centroidMean(cent);
    if (!mean) continue;
    const cs = compareEmbeddings(segmentEmbedding, mean);
    if (cs > bestCentScore) {
      bestCentScore = cs;
      bestCentEmail = key;
    }
  }
  if (bestCentEmail && bestCentScore >= centroidMin) {
    const prof = scored.find((s) => emailKey(s.profile) === bestCentEmail);
    if (prof && prof.score >= minConf - 0.18) {
      return {
        profile: prof.profile,
        confidence: Math.min(0.97, (prof.score + bestCentScore) / 2),
        tieBreak: 'session_centroid',
      };
    }
  }

  if (ambiguous && best.score >= minConf - 0.05) {
    return {
      profile: best.profile,
      confidence: best.score * 0.92,
      tieBreak: 'weak_leader',
    };
  }

  return null;
}

/**
 * High-confidence speaker match: pyannote first when available; FFT confirms uncertain pyannote
 * matches or scores FFT-only enrollments. Session continuity compares same embedding kind only.
 * Default strict = true (workspace-safe). Set VOICE_MATCH_STRICT=false for legacy looser behavior.
 */
async function identifySpeaker(audioFilePath, voiceProfiles, sessionContext = null) {
  let processedPath = null;
  let cleanPath = null;
  try {
    if (!fs.existsSync(audioFilePath)) {
      throw new Error('Audio file not found');
    }

    processedPath = await preprocessAudioForEmbedding(audioFilePath);
    cleanPath = tryFfmpegNormalizeVoiceAudioSync(processedPath, 'identification');
    const embeddingPath = cleanPath || processedPath;

    const pyEmb = await tryPyannoteEmbedding(embeddingPath);
    let fftEmb = null;
    try {
      fftEmb = await generateFftMelVoiceEmbedding(embeddingPath);
    } catch (fftErr) {
      console.warn('⚠️  FFT embedding for speaker match failed:', fftErr.message || fftErr);
    }

    if (!pyEmb && !fftEmb) return null;

    const profiles = (voiceProfiles || []).filter(
      (p) => p && Array.isArray(p.voiceVector) && p.voiceVector.length > 0
    );
    if (profiles.length === 0) return null;

    const strict = String(process.env.VOICE_MATCH_STRICT || 'true').toLowerCase() !== 'false';

    if (!strict) {
      const thresholdPy = parseThresholdEnv('VOICE_MATCH_THRESHOLD', 0.72, 0.5, 0.95);
      const thresholdFft = parseThresholdEnv('VOICE_FFT_MATCH_THRESHOLD', 0.58, 0.4, 0.92);
      let bestMatch = null;
      let bestScore = 0;
      let segUsed = null;
      let kindUsed = null;
      const trySeg = (seg, th, kind) => {
        for (const profile of profiles) {
          const pv = profile.voiceVector;
          if (!embeddingsCompatible(seg.length, pv.length)) continue;
          const similarity = compareEmbeddings(seg, pv);
          if (similarity > bestScore && similarity >= th) {
            bestScore = similarity;
            bestMatch = profile;
            segUsed = seg;
            kindUsed = kind;
          }
        }
      };
      if (pyEmb) trySeg(pyEmb, thresholdPy, 'pyannote');
      if (!bestMatch && fftEmb) trySeg(fftEmb, thresholdFft, 'fft');
      if (bestMatch && sessionContext && segUsed) {
        sessionContext.lastEmbedding = cloneEmbedding(segUsed);
        sessionContext.lastEmail = bestMatch.email;
        sessionContext.lastEmbeddingKind = kindUsed;
        updateSessionCentroid(sessionContext, bestMatch.email, segUsed);
      }
      return bestMatch ? { profile: bestMatch, confidence: bestScore } : null;
    }

    const pyMin = parseThresholdEnv('VOICE_PYANNOTE_MIN', 0.9, 0.75, 0.99);
    const fftMin = parseThresholdEnv('VOICE_FFT_MIN', 0.84, 0.65, 0.95);
    const fftConfirmMin = parseThresholdEnv('VOICE_FFT_CONFIRM_MIN', 0.82, 0.6, 0.95);
    const singlePy = parseThresholdEnv('VOICE_SINGLE_PYANNOTE_MIN', 0.92, 0.78, 0.995);
    const singleFft = parseThresholdEnv('VOICE_SINGLE_FFT_MIN', 0.86, 0.68, 0.97);
    const margin = parseThresholdEnv('VOICE_MATCH_MARGIN', 0.1, 0.02, 0.35);

    const scoredPy = pyEmb ? scoreVoiceProfiles(pyEmb, profiles, sessionContext, 'pyannote') : [];
    const scoredFft = fftEmb ? scoreVoiceProfiles(fftEmb, profiles, sessionContext, 'fft') : [];

    const pairSimPy = maxStoredProfileSimilarity(scoredPy);
    const pairSimFft = maxStoredProfileSimilarity(scoredFft);
    const similarPairBoost =
      Math.max(pairSimPy, pairSimFft) >= parseThresholdEnv('VOICE_CONFUSABLE_PAIR_MIN', 0.82, 0.6, 0.99)
        ? parseThresholdEnv('VOICE_MARGIN_BOOST_FOR_SIMILAR', 0.06, 0, 0.2)
        : 0;
    const effectiveMargin = margin + similarPairBoost;

    let chosen = null;
    let embeddingForSession = null;
    let embeddingKind = null;

    const applySession = (pick, emb, kind) => {
      if (sessionContext && pick && pick.profile && emb) {
        const learnMin = parseThresholdEnv('VOICE_LEARN_MIN', 0.86, 0.7, 0.99);
        if (!Number.isFinite(pick.confidence) || pick.confidence < learnMin) {
          // Keep lastEmbeddingKind for continuity even if we skip centroid learning.
          sessionContext.lastEmbedding = cloneEmbedding(emb);
          sessionContext.lastEmail = pick.profile.email;
          sessionContext.lastEmbeddingKind = kind;
          return;
        }
        sessionContext.lastEmbedding = cloneEmbedding(emb);
        sessionContext.lastEmail = pick.profile.email;
        sessionContext.lastEmbeddingKind = kind;
        updateSessionCentroid(sessionContext, pick.profile.email, emb);
      }
    };

    if (pyEmb && scoredPy.length > 0) {
      chosen = tryPickFromScored(scoredPy, pyMin, singlePy, margin, similarPairBoost);
      if (chosen) {
        embeddingForSession = pyEmb;
        embeddingKind = 'pyannote';
      }
    }

    if (!chosen && pyEmb && fftEmb && scoredPy.length > 0 && scoredFft.length > 0) {
      const bestPy = scoredPy[0];
      const bestFft = scoredFft[0];
      if (emailKey(bestPy.profile) === emailKey(bestFft.profile) && bestFft.score >= fftConfirmMin) {
        const secondPy = scoredPy[1];
        const pyWeak =
          bestPy.score < pyMin || (secondPy && bestPy.score - secondPy.score < effectiveMargin);
        if (pyWeak) {
          chosen = {
            profile: bestPy.profile,
            confidence: Math.min(0.96, (bestPy.score + bestFft.score) / 2),
            tieBreak: 'fft_confirms_py',
          };
          embeddingForSession = pyEmb;
          embeddingKind = 'pyannote';
        }
      }
    }

    const noPyCandidates = !pyEmb || scoredPy.length === 0;
    if (!chosen && fftEmb && scoredFft.length > 0 && noPyCandidates) {
      chosen = tryPickFromScored(scoredFft, fftMin, singleFft, margin, similarPairBoost);
      if (chosen) {
        embeddingForSession = fftEmb;
        embeddingKind = 'fft';
      }
    }

    if (!chosen && sessionContext) {
      let seg = null;
      let scored = [];
      let minConfForResolve = fftMin;
      let kindForResolve = 'fft';
      let isFftFallback = true;
      if (pyEmb && scoredPy.length >= 2) {
        seg = pyEmb;
        scored = scoredPy;
        minConfForResolve = pyMin;
        kindForResolve = 'pyannote';
        isFftFallback = false;
      } else if (fftEmb && scoredFft.length >= 2) {
        seg = fftEmb;
        scored = scoredFft;
        minConfForResolve = fftMin;
        kindForResolve = 'fft';
        isFftFallback = true;
      }
      if (seg && scored.length >= 2) {
        const resolved = resolveSimilarVoicesWithSession(
          seg,
          scored,
          minConfForResolve,
          effectiveMargin,
          sessionContext,
          isFftFallback,
          kindForResolve
        );
        if (resolved) {
          chosen = resolved;
          embeddingForSession = seg;
          embeddingKind = kindForResolve;
        }
      }
    }

    if (!chosen && profiles.length === 1) {
      const p = profiles[0];
      const pv = p.voiceVector;
      const relaxedPy = parseThresholdEnv('VOICE_SINGLE_PYANNOTE_RELAXED', 0.84, 0.65, 0.95);
      const relaxedFft = parseThresholdEnv('VOICE_SINGLE_FFT_RELAXED', 0.78, 0.55, 0.94);
      if (pyEmb && embeddingsCompatible(pyEmb.length, pv.length)) {
        const s = compareEmbeddings(pyEmb, pv);
        if (s >= relaxedPy) {
          chosen = { profile: p, confidence: s, tieBreak: 'single_enrolled_voice' };
          embeddingForSession = pyEmb;
          embeddingKind = 'pyannote';
        }
      }
      if (!chosen && fftEmb && embeddingsCompatible(fftEmb.length, pv.length)) {
        const s = compareEmbeddings(fftEmb, pv);
        if (s >= relaxedFft) {
          chosen = { profile: p, confidence: s, tieBreak: 'single_enrolled_voice_fft' };
          embeddingForSession = fftEmb;
          embeddingKind = 'fft';
        }
      }
    }

    // Exactly two enrolled: prefer a single label at ≥75% when scores support it (aligned with VOICE_CONFIDENT_PICK_MIN).
    if (!chosen && profiles.length === 2) {
      const smallPyMin = parseThresholdEnv('VOICE_SMALL_GROUP_PY_MIN', 0.75, 0.65, 0.98);
      const smallFftMin = parseThresholdEnv('VOICE_SMALL_GROUP_FFT_MIN', 0.75, 0.6, 0.96);

      const bestPy = scoredPy[0];
      const bestFft = scoredFft[0];

      let pick = null;
      let emb = null;
      let kind = null;

      if (bestPy && bestPy.score >= smallPyMin) {
        pick = { profile: bestPy.profile, confidence: bestPy.score, tieBreak: 'small_group_py' };
        emb = pyEmb;
        kind = 'pyannote';
      }

      if (bestFft && bestFft.score >= smallFftMin) {
        if (
          bestPy &&
          emailKey(bestPy.profile) === emailKey(bestFft.profile) &&
          bestFft.score >= fftConfirmMin
        ) {
          const combined = Math.min(0.97, (bestPy.score + bestFft.score) / 2);
          pick = { profile: bestPy.profile, confidence: combined, tieBreak: 'small_group_both' };
          emb = pyEmb || fftEmb;
          kind = pyEmb ? 'pyannote' : 'fft';
        } else if (!pick || bestFft.score > pick.confidence) {
          pick = { profile: bestFft.profile, confidence: bestFft.score, tieBreak: 'small_group_fft' };
          emb = fftEmb;
          kind = 'fft';
        }
      }

      if (pick && emb) {
        chosen = pick;
        embeddingForSession = emb;
        embeddingKind = kind;
      }
    }

    if (!chosen && profiles.length === 2) {
      const merged = pickBestMergedScoredCandidate(scoredPy, scoredFft);
      const confPick = parseThresholdEnv('VOICE_CONFIDENT_PICK_MIN', 0.75, 0.6, 0.92);
      if (merged && merged.score >= confPick) {
        const emb = merged.kind === 'pyannote' ? pyEmb : fftEmb;
        if (emb) {
          chosen = {
            profile: merged.profile,
            confidence: merged.score,
            tieBreak: 'dual_confident_pick',
          };
          embeddingForSession = emb;
          embeddingKind = merged.kind;
        }
      }
    }

    // Three or more enrolled: never leave the chunk unidentified if we have any ranked score —
    // use ≥75% as high confidence; else pick closest above a floor (embedding “nearest neighbour”).
    if (!chosen && profiles.length >= 3) {
      const merged = pickBestMergedScoredCandidate(scoredPy, scoredFft);
      const confMin = parseThresholdEnv('VOICE_MULTI_CONFIDENT_MIN', 0.75, 0.55, 0.92);
      const closestFloor = parseThresholdEnv('VOICE_MULTI_CLOSEST_FLOOR', 0.5, 0.35, 0.72);
      if (merged && merged.score >= confMin) {
        const emb = merged.kind === 'pyannote' ? pyEmb : fftEmb;
        if (emb) {
          chosen = {
            profile: merged.profile,
            confidence: merged.score,
            tieBreak: 'multi_three_plus_confident',
          };
          embeddingForSession = emb;
          embeddingKind = merged.kind;
        }
      } else if (merged && merged.score >= closestFloor) {
        const emb = merged.kind === 'pyannote' ? pyEmb : fftEmb;
        if (emb) {
          chosen = {
            profile: merged.profile,
            confidence: merged.score,
            tieBreak: 'multi_three_plus_closest',
          };
          embeddingForSession = emb;
          embeddingKind = merged.kind;
        }
      }
    }

    if (!chosen) return null;

    applySession(chosen, embeddingForSession, embeddingKind);

    const { profile, confidence, tieBreak } = chosen;
    return tieBreak ? { profile, confidence, tieBreak } : { profile, confidence };
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

module.exports = {
  generateVoiceEmbedding,
  compareEmbeddings,
  identifySpeaker,
  generateFftMelVoiceEmbedding,
  FFT_MEL_EMBEDDING_DIM,
  FFT_VOICE_EMBEDDING_DIM,
  validateVoiceEnrollmentQuality,
};

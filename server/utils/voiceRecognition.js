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
 * Tune via env: VOICE_MATCH_STRICT, VOICE_PYANNOTE_MIN, VOICE_FFT_MIN, VOICE_MATCH_MARGIN,
 * VOICE_SINGLE_PYANNOTE_MIN, VOICE_SINGLE_FFT_MIN, VOICE_ENROLL_MIN_SECONDS, VOICE_ENROLL_MIN_RMS.
 */

/** Fallback speaker embedding size (mel static + mel delta); must match stored vectors from this path. */
const FFT_VOICE_EMBEDDING_DIM = 128;
const FFT_FRAME_SIZE = 512;
const FFT_HOP = 256;
const FFT_MEL_BANDS = 64;

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

  return new Promise((resolve, reject) => {
    // Use silenceremove to trim silence at beginning and end
    // Threshold and duration are conservative to avoid cutting speech.
    ffmpeg(audioFilePath)
      .audioFilters('silenceremove=start_periods=1:start_silence=0.3:start_threshold=-40dB:stop_periods=1:stop_silence=0.5:stop_threshold=-40dB')
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
 * Generate voice embedding from audio file
 * Uses pyannote.audio via Python script for production-quality embeddings
 * Falls back to simplified approach if Python script is not available
 */
async function generateVoiceEmbedding(audioFilePath) {
  try {
    // Read audio file
    if (!fs.existsSync(audioFilePath)) {
      throw new Error('Audio file not found');
    }

    // Preprocess with simple VAD to trim silence where possible
    const processedPath = await preprocessAudioForEmbedding(audioFilePath);

    // Try to use Python script with pyannote.audio (recommended)
    const pythonScript = path.join(__dirname, 'voice_embedding.py');
    
    if (fs.existsSync(pythonScript)) {
      try {
        console.log('🎤 Generating voice embedding using pyannote.audio...');
        
        // Get HuggingFace token from environment
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
        
        // Pass token as command-line argument (more reliable than env vars)
        const command = hfToken 
          ? `python3 "${pythonScript}" "${processedPath}" "${hfToken}"`
          : `python3 "${pythonScript}" "${processedPath}"`;
        
        console.log(`📝 Executing: python3 voice_embedding.py "${audioFilePath}" ${hfToken ? '[token provided]' : '[no token]'}`);
        
        const { stdout, stderr } = await execPromise(command, {
          timeout: 30000, // 30 second timeout
          env: env
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
        console.warn('⚠️  Python script failed, using fallback method:', pythonError.message);
        // Fall through to fallback method
      }
    }
    
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
    const embedding = await generateFftMelVoiceEmbedding(processedPath);
    return embedding;
  } catch (error) {
    console.error('Error generating voice embedding:', error);
    throw error;
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

/**
 * Compare two voice embeddings using cosine similarity
 */
function compareEmbeddings(embedding1, embedding2) {
  if (embedding1.length !== embedding2.length) {
    return 0;
  }
  
  let dotProduct = 0;
  let norm1 = 0;
  let norm2 = 0;
  
  for (let i = 0; i < embedding1.length; i++) {
    dotProduct += embedding1[i] * embedding2[i];
    norm1 += embedding1[i] * embedding1[i];
    norm2 += embedding2[i] * embedding2[i];
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
  for (let i = 0; i < embedding.length; i++) c.sum[i] += embedding[i];
  c.n += 1;
}

function maxStoredProfileSimilarity(scored) {
  let maxSim = 0;
  for (let i = 0; i < scored.length; i++) {
    const vi = scored[i].profile && scored[i].profile.voiceVector;
    if (!Array.isArray(vi)) continue;
    for (let j = i + 1; j < scored.length; j++) {
      const vj = scored[j].profile && scored[j].profile.voiceVector;
      if (!Array.isArray(vj) || vi.length !== vj.length) continue;
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
  isFftFallback
) {
  if (!ctx || scored.length < 2) return null;

  const best = scored[0];
  const second = scored[1];
  const ambiguous = second && best.score - second.score < effectiveMargin;

  const contHi = parseThresholdEnv('VOICE_CONTINUITY_HIGH', 0.82, 0.68, 0.96);
  const contLo = parseThresholdEnv('VOICE_CONTINUITY_SWITCH', 0.68, 0.45, 0.85);
  const centroidMin = parseThresholdEnv('VOICE_CENTROID_MATCH_MIN', 0.76, 0.55, 0.94);

  if (ctx.lastEmbedding && ctx.lastEmail) {
    const cont = compareEmbeddings(segmentEmbedding, ctx.lastEmbedding);
    const lastKey = String(ctx.lastEmail).toLowerCase();
    const lastScored = scored.find((s) => String(s.profile.email).toLowerCase() === lastKey);

    if (cont >= contHi && lastScored && lastScored.score >= minConf - (isFftFallback ? 0.12 : 0.08)) {
      return {
        profile: lastScored.profile,
        confidence: Math.min(0.99, (best.score + cont + lastScored.score) / 3),
        tieBreak: 'continuity_same',
      };
    }

    if (ambiguous && cont <= contLo && second) {
      const other = scored.find((s) => String(s.profile.email).toLowerCase() !== lastKey);
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
    const key = String(s.profile.email).toLowerCase();
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
    const prof = scored.find((s) => String(s.profile.email).toLowerCase() === bestCentEmail);
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
 * High-confidence speaker match: absolute threshold + margin vs runner-up (avoids wrong-person labels).
 * Pass optional `sessionContext` (per meeting) to disambiguate similar voices via continuity + centroids.
 * Default strict = true (workspace-safe). Set VOICE_MATCH_STRICT=false for legacy looser behavior.
 */
async function identifySpeaker(audioFilePath, voiceProfiles, sessionContext = null) {
  try {
    const segmentEmbedding = await generateVoiceEmbedding(audioFilePath);
    const isFftFallback =
      Array.isArray(segmentEmbedding) && segmentEmbedding.length === FFT_VOICE_EMBEDDING_DIM;
    const strict = String(process.env.VOICE_MATCH_STRICT || 'true').toLowerCase() !== 'false';

    if (!strict) {
      const threshold = isFftFallback
        ? parseThresholdEnv('VOICE_FFT_MATCH_THRESHOLD', 0.58, 0.4, 0.92)
        : parseThresholdEnv('VOICE_MATCH_THRESHOLD', 0.72, 0.5, 0.95);
      let bestMatch = null;
      let bestScore = 0;
      for (const profile of voiceProfiles) {
        const pv = profile && profile.voiceVector;
        if (!Array.isArray(pv) || pv.length !== segmentEmbedding.length) continue;
        const similarity = compareEmbeddings(segmentEmbedding, pv);
        if (similarity > bestScore && similarity >= threshold) {
          bestScore = similarity;
          bestMatch = profile;
        }
      }
      if (bestMatch && sessionContext) {
        sessionContext.lastEmbedding = cloneEmbedding(segmentEmbedding);
        sessionContext.lastEmail = bestMatch.email;
        updateSessionCentroid(sessionContext, bestMatch.email, segmentEmbedding);
      }
      return bestMatch ? { profile: bestMatch, confidence: bestScore } : null;
    }

    const pyMin = parseThresholdEnv('VOICE_PYANNOTE_MIN', 0.9, 0.75, 0.99);
    const fftMin = parseThresholdEnv('VOICE_FFT_MIN', 0.84, 0.65, 0.95);
    const singlePy = parseThresholdEnv('VOICE_SINGLE_PYANNOTE_MIN', 0.92, 0.78, 0.995);
    const singleFft = parseThresholdEnv('VOICE_SINGLE_FFT_MIN', 0.86, 0.68, 0.97);
    const margin = parseThresholdEnv('VOICE_MATCH_MARGIN', 0.1, 0.02, 0.35);

    const minConf = isFftFallback ? fftMin : pyMin;
    const minSingle = isFftFallback ? singleFft : singlePy;

    const scored = [];
    for (const profile of voiceProfiles) {
      const pv = profile && profile.voiceVector;
      if (!Array.isArray(pv) || pv.length !== segmentEmbedding.length) continue;
      const similarity = compareEmbeddings(segmentEmbedding, pv);
      scored.push({ profile, score: similarity });
    }
    scored.sort((a, b) => b.score - a.score);

    if (scored.length === 0) return null;

    const best = scored[0];
    const second = scored[1];

    if (scored.length === 1) {
      if (best.score >= minSingle) {
        if (sessionContext) {
          sessionContext.lastEmbedding = cloneEmbedding(segmentEmbedding);
          sessionContext.lastEmail = best.profile.email;
          updateSessionCentroid(sessionContext, best.profile.email, segmentEmbedding);
        }
        return { profile: best.profile, confidence: best.score };
      }
      return null;
    }

    const pairSim = maxStoredProfileSimilarity(scored);
    const similarPairBoost =
      pairSim >= parseThresholdEnv('VOICE_CONFUSABLE_PAIR_MIN', 0.82, 0.6, 0.99)
        ? parseThresholdEnv('VOICE_MARGIN_BOOST_FOR_SIMILAR', 0.06, 0, 0.2)
        : 0;
    const effectiveMargin = margin + similarPairBoost;

    let chosen = null;

    if (best.score >= minConf && (!second || best.score - second.score >= effectiveMargin)) {
      chosen = { profile: best.profile, confidence: best.score, tieBreak: 'global' };
    } else if (sessionContext) {
      const resolved = resolveSimilarVoicesWithSession(
        segmentEmbedding,
        scored,
        minConf,
        effectiveMargin,
        sessionContext,
        isFftFallback
      );
      if (resolved) chosen = resolved;
    }

    if (!chosen) return null;

    if (sessionContext && chosen && chosen.profile) {
      sessionContext.lastEmbedding = cloneEmbedding(segmentEmbedding);
      sessionContext.lastEmail = chosen.profile.email;
      updateSessionCentroid(sessionContext, chosen.profile.email, segmentEmbedding);
    }

    const { profile, confidence, tieBreak } = chosen;
    return tieBreak ? { profile, confidence, tieBreak } : { profile, confidence };
  } catch (error) {
    console.error('Error identifying speaker:', error);
    return null;
  }
}

module.exports = {
  generateVoiceEmbedding,
  compareEmbeddings,
  identifySpeaker,
  generateFftMelVoiceEmbedding,
  FFT_VOICE_EMBEDDING_DIM,
  validateVoiceEnrollmentQuality,
};

const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec, execFileSync } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const { getFfmpegPath } = require('./ffmpegPaths');

/** Resolve a Python binary for voice_embedding.py (Railway often has `python` but not `python3`). */
function resolvePythonBinaryForVoice() {
  const fromEnv = String(process.env.PYTHON_BIN || process.env.PYTHON || '').trim();
  if (fromEnv) return fromEnv;
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
 *   via pyannote/speaker-diarization-3.1 (VOICE_PYANNOTE_DIARIZATION, default on in Python).
 * - Spectral/FFT fallback was removed — re-enroll voice after upgrading the server.
 * - Reject ambiguous matches: best score must be clearly above the runner-up (margin).
 *
 * Enrollment: VOICE_ENROLLMENT_CLEAN_AUDIO (default true) runs ffmpeg band-limit + dynaudnorm
 * before embeddings. Set VOICE_ENROLLMENT_CLEAN_AUDIO=false to disable.
 *
 * Tune via env: VOICE_MATCH_STRICT, VOICE_PYANNOTE_MIN, VOICE_MATCH_MARGIN,
 * VOICE_SINGLE_PYANNOTE_MIN, VOICE_SINGLE_PYANNOTE_RELAXED, VOICE_ENROLL_MIN_SECONDS, VOICE_ENROLL_MIN_RMS.
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

/**
 * pyannote/embedding via voice_embedding.py (optional diarization crop in Python).
 * @returns {Promise<number[]>}
 */
async function tryPyannoteEmbedding(processedPath) {
  const pythonScript = path.join(__dirname, 'voice_embedding.py');
  if (!fs.existsSync(pythonScript)) {
    throw voiceEmbeddingUnavailable(
      'Voice embedding script is missing on the server.',
      `Expected file: ${pythonScript}`
    );
  }
  try {
    console.log('🎤 Generating voice embedding using pyannote.audio...');

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

    const command = `"${pythonBin}" "${pythonScript}" "${processedPath}"`;

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

    return await tryPyannoteEmbedding(embeddingPath);
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

function l2Normalize(vec) {
  let s = 0;
  for (let i = 0; i < vec.length; i++) s += vec[i] * vec[i];
  const n = Math.sqrt(s) || 1;
  return vec.map((x) => x / n);
}

/** Pyannote embedding dimensions must match between live chunk and stored profile. */
function embeddingsCompatible(len1, len2) {
  return len1 === len2;
}

/** Cosine similarity between same-dimensional pyannote embeddings. */
function compareEmbeddings(embedding1, embedding2) {
  if (!Array.isArray(embedding1) || !Array.isArray(embedding2)) return 0;

  const a = embedding1;
  const b = embedding2;
  if (a.length !== b.length) {
    return 0;
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
        const w = 0.65;
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

/** Top-1 from pyannote-ranked scores. */
function pickTopScoredCandidate(scoredPy) {
  if (!scoredPy || !scoredPy[0]) return null;
  return { profile: scoredPy[0].profile, score: scoredPy[0].score };
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

    if (cont >= contHi && lastScored && lastScored.score >= minConf - 0.08) {
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
 * Speaker match: pyannote embedding only (see voice_embedding.py; optional diarization crop in Python).
 * Default strict = true (workspace-safe). Set VOICE_MATCH_STRICT=false for looser thresholding.
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
    if (!pyEmb) return null;

    const profiles = (voiceProfiles || []).filter(
      (p) => p && Array.isArray(p.voiceVector) && p.voiceVector.length > 0
    );
    if (profiles.length === 0) return null;

    const strict = String(process.env.VOICE_MATCH_STRICT || 'true').toLowerCase() !== 'false';

    if (!strict) {
      const thresholdPy = parseThresholdEnv('VOICE_MATCH_THRESHOLD', 0.72, 0.5, 0.95);
      let bestMatch = null;
      let bestScore = 0;
      for (const profile of profiles) {
        const pv = profile.voiceVector;
        if (!embeddingsCompatible(pyEmb.length, pv.length)) continue;
        const similarity = compareEmbeddings(pyEmb, pv);
        if (similarity > bestScore && similarity >= thresholdPy) {
          bestScore = similarity;
          bestMatch = profile;
        }
      }
      if (bestMatch && sessionContext) {
        sessionContext.lastEmbedding = cloneEmbedding(pyEmb);
        sessionContext.lastEmail = bestMatch.email;
        sessionContext.lastEmbeddingKind = 'pyannote';
        updateSessionCentroid(sessionContext, bestMatch.email, pyEmb);
      }
      return bestMatch ? { profile: bestMatch, confidence: bestScore } : null;
    }

    const pyMin = parseThresholdEnv('VOICE_PYANNOTE_MIN', 0.9, 0.75, 0.99);
    const singlePy = parseThresholdEnv('VOICE_SINGLE_PYANNOTE_MIN', 0.92, 0.78, 0.995);
    const margin = parseThresholdEnv('VOICE_MATCH_MARGIN', 0.1, 0.02, 0.35);

    const scoredPy = scoreVoiceProfiles(pyEmb, profiles, sessionContext, 'pyannote');

    const pairSimPy = maxStoredProfileSimilarity(scoredPy);
    const similarPairBoost =
      pairSimPy >= parseThresholdEnv('VOICE_CONFUSABLE_PAIR_MIN', 0.82, 0.6, 0.99)
        ? parseThresholdEnv('VOICE_MARGIN_BOOST_FOR_SIMILAR', 0.06, 0, 0.2)
        : 0;
    const effectiveMargin = margin + similarPairBoost;

    let chosen = null;
    let embeddingForSession = null;
    const embeddingKind = 'pyannote';

    const applySession = (pick, emb, kind) => {
      if (sessionContext && pick && pick.profile && emb) {
        const learnMin = parseThresholdEnv('VOICE_LEARN_MIN', 0.86, 0.7, 0.99);
        if (!Number.isFinite(pick.confidence) || pick.confidence < learnMin) {
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

    if (scoredPy.length > 0) {
      chosen = tryPickFromScored(scoredPy, pyMin, singlePy, margin, similarPairBoost);
      if (chosen) {
        embeddingForSession = pyEmb;
      }
    }

    if (!chosen && sessionContext && scoredPy.length >= 2) {
      const resolved = resolveSimilarVoicesWithSession(
        pyEmb,
        scoredPy,
        pyMin,
        effectiveMargin,
        sessionContext,
        'pyannote'
      );
      if (resolved) {
        chosen = resolved;
        embeddingForSession = pyEmb;
      }
    }

    if (!chosen && profiles.length === 1) {
      const p = profiles[0];
      const pv = p.voiceVector;
      const relaxedPy = parseThresholdEnv('VOICE_SINGLE_PYANNOTE_RELAXED', 0.84, 0.65, 0.95);
      if (embeddingsCompatible(pyEmb.length, pv.length)) {
        const s = compareEmbeddings(pyEmb, pv);
        if (s >= relaxedPy) {
          chosen = { profile: p, confidence: s, tieBreak: 'single_enrolled_voice' };
          embeddingForSession = pyEmb;
        }
      }
    }

    if (!chosen && profiles.length === 2) {
      const smallPyMin = parseThresholdEnv('VOICE_SMALL_GROUP_PY_MIN', 0.75, 0.65, 0.98);
      const bestPy = scoredPy[0];
      if (bestPy && bestPy.score >= smallPyMin) {
        chosen = { profile: bestPy.profile, confidence: bestPy.score, tieBreak: 'small_group_py' };
        embeddingForSession = pyEmb;
      }
    }

    if (!chosen && profiles.length === 2) {
      const merged = pickTopScoredCandidate(scoredPy);
      const confPick = parseThresholdEnv('VOICE_CONFIDENT_PICK_MIN', 0.75, 0.6, 0.92);
      if (merged && merged.score >= confPick) {
        chosen = {
          profile: merged.profile,
          confidence: merged.score,
          tieBreak: 'dual_confident_pick',
        };
        embeddingForSession = pyEmb;
      }
    }

    if (!chosen && profiles.length >= 3) {
      const merged = pickTopScoredCandidate(scoredPy);
      const confMin = parseThresholdEnv('VOICE_MULTI_CONFIDENT_MIN', 0.75, 0.55, 0.92);
      const closestFloor = parseThresholdEnv('VOICE_MULTI_CLOSEST_FLOOR', 0.5, 0.35, 0.72);
      if (merged && merged.score >= confMin) {
        chosen = {
          profile: merged.profile,
          confidence: merged.score,
          tieBreak: 'multi_three_plus_confident',
        };
        embeddingForSession = pyEmb;
      } else if (merged && merged.score >= closestFloor) {
        chosen = {
          profile: merged.profile,
          confidence: merged.score,
          tieBreak: 'multi_three_plus_closest',
        };
        embeddingForSession = pyEmb;
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
  validateVoiceEnrollmentQuality,
};

const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec, execFileSync } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

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

/**
 * Find best matching voice profile for an audio segment
 */
async function identifySpeaker(audioFilePath, voiceProfiles) {
  try {
    // Generate embedding for the audio segment
    const segmentEmbedding = await generateVoiceEmbedding(audioFilePath);

    let bestMatch = null;
    let bestScore = 0;
    const isFftFallback =
      Array.isArray(segmentEmbedding) && segmentEmbedding.length === FFT_VOICE_EMBEDDING_DIM;
    const threshold = isFftFallback
      ? Math.min(
          0.92,
          Math.max(0.4, parseFloat(process.env.VOICE_FFT_MATCH_THRESHOLD || '0.58', 10) || 0.58)
        )
      : Math.min(
          0.95,
          Math.max(0.5, parseFloat(process.env.VOICE_MATCH_THRESHOLD || '0.72', 10) || 0.72)
        );

    // Compare with all stored voice profiles (same vector length only — pyannote vs FFT are incompatible)
    for (const profile of voiceProfiles) {
      const pv = profile && profile.voiceVector;
      if (!Array.isArray(pv) || pv.length !== segmentEmbedding.length) continue;
      const similarity = compareEmbeddings(segmentEmbedding, pv);
      if (similarity > bestScore && similarity >= threshold) {
        bestScore = similarity;
        bestMatch = profile;
      }
    }
    
    return bestMatch ? {
      profile: bestMatch,
      confidence: bestScore
    } : null;
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
};

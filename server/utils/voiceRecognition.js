const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

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
      '⚠️  Voice embedding: using simplified fallback (set HF_TOKEN + pyannote for accurate speaker vectors, or VOICE_EMBEDDING_STRICT=true to require ML)'
    );
    const audioStats = await getAudioStats(processedPath);
    const embedding = createEmbeddingFromStats(audioStats);
    
    return embedding;
  } catch (error) {
    console.error('Error generating voice embedding:', error);
    throw error;
  }
}

/**
 * Get basic audio statistics (fallback method)
 */
async function getAudioStats(audioFilePath) {
  const stats = fs.statSync(audioFilePath);
  return {
    size: stats.size,
    duration: 0,
    sampleRate: 16000
  };
}

/**
 * Create embedding from audio stats (fallback - NOT production-ready)
 * This is a placeholder. Use pyannote.audio for actual voice recognition.
 */
function createEmbeddingFromStats(stats) {
  // Simple hash-based embedding (NOT production-ready)
  // Only use this for testing. Install pyannote.audio for real voice recognition.
  const embedding = new Array(128).fill(0);
  const hash = stats.size % 1000000;
  for (let i = 0; i < 128; i++) {
    embedding[i] = (hash * (i + 1)) % 1000 / 1000;
  }
  
  return embedding;
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
    const threshold = 0.7; // Similarity threshold (adjust as needed)
    
    // Compare with all stored voice profiles
    for (const profile of voiceProfiles) {
      const similarity = compareEmbeddings(segmentEmbedding, profile.voiceVector);
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
  identifySpeaker
};

/**
 * Ensure local audio file is ≤25 MB for OpenAI Whisper API.
 * Uses ffmpeg: mono 16 kHz MP3, stepping down bitrate until under the cap.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const WHISPER_MAX_BYTES = 25 * 1024 * 1024;

/** Bitrates to try, high → low (speech remains usable at lower rates). */
const BITRATE_LADDER = ['64k', '56k', '48k', '40k', '32k', '24k', '20k', '16k', '12k'];

function unlinkQuiet(p) {
  try {
    if (p && fs.existsSync(p)) fs.unlinkSync(p);
  } catch (_) {
    /* ignore */
  }
}

function runFfmpegToMp3(ffmpeg, inputPath, outputPath, audioBitrate) {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .noVideo()
      .audioChannels(1)
      .audioFrequency(16000)
      .audioBitrate(audioBitrate)
      .audioCodec('libmp3lame')
      .format('mp3')
      .on('end', () => resolve())
      .on('error', (err) => reject(err))
      .save(outputPath);
  });
}

/**
 * @param {string} inputPath absolute or relative path to audio file
 * @param {import('fluent-ffmpeg')} ffmpegLib fluent-ffmpeg constructor (or null)
 * @returns {Promise<{ path: string, pathsToCleanup: string[] }>}
 */
async function ensureWhisperSizedAudio(inputPath, ffmpegLib) {
  if (!inputPath || !fs.existsSync(inputPath)) {
    const e = new Error('Audio file not found');
    e.code = 'INPUT_MISSING';
    throw e;
  }

  const stat = fs.statSync(inputPath);
  if (stat.size === 0) {
    const e = new Error('Audio file is empty (0 bytes)');
    e.code = 'INPUT_EMPTY';
    throw e;
  }

  if (stat.size <= WHISPER_MAX_BYTES) {
    return { path: inputPath, pathsToCleanup: [] };
  }

  if (!ffmpegLib) {
    const mb = (stat.size / (1024 * 1024)).toFixed(1);
    const e = new Error(
      `Recording is ${mb} MB; Whisper accepts up to 25 MB per file. ` +
        'Install ffmpeg on the server to compress automatically, or use a shorter recording.'
    );
    e.code = 'FFMPEG_REQUIRED';
    throw e;
  }

  const dir = path.dirname(inputPath);
  const id = crypto.randomBytes(8).toString('hex');
  const pathsToCleanup = [];
  let lastPath = null;

  try {
    for (let i = 0; i < BITRATE_LADDER.length; i++) {
      const br = BITRATE_LADDER[i];
      const out = path.join(dir, `_whisper_${id}_${i}.mp3`);
      if (lastPath) unlinkQuiet(lastPath);
      lastPath = out;
      pathsToCleanup.push(out);

      await runFfmpegToMp3(ffmpegLib, inputPath, out, br);
      const sz = fs.statSync(out).size;
      if (sz <= WHISPER_MAX_BYTES) {
        console.log(
          `✅ Whisper compression: ${(stat.size / (1024 * 1024)).toFixed(2)} MB → ${(sz / (1024 * 1024)).toFixed(2)} MB (${br}, mono 16kHz mp3)`
        );
        return { path: out, pathsToCleanup: [out] };
      }
      console.warn(
        `⚠️ Compressed to ${(sz / (1024 * 1024)).toFixed(2)} MB at ${br}; still over 25 MB, trying lower bitrate…`
      );
    }

    if (lastPath) unlinkQuiet(lastPath);
    const e = new Error(
      'This recording is too long to fit under the 25 MB transcription limit, even after compression. ' +
        'Try splitting into shorter sessions or reducing recording length.'
    );
    e.code = 'AUDIO_TOO_LARGE';
    throw e;
  } catch (err) {
    for (const p of pathsToCleanup) unlinkQuiet(p);
    throw err;
  }
}

module.exports = {
  WHISPER_MAX_BYTES,
  ensureWhisperSizedAudio,
};

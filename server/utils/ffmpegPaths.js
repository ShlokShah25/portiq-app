'use strict';

/**
 * Resolve ffmpeg/ffprobe for exec/spawn and fluent-ffmpeg.
 * Long audio (>10 min), Whisper compression, and voice preprocessing spawn these binaries.
 * Railway: nixpacks.toml includes `ffmpeg` in nixPkgs. Override with FFMPEG_PATH / FFPROBE_PATH if needed.
 */

const fs = require('fs');
const { execFileSync } = require('child_process');

let cachedFfmpeg;
let cachedFfprobe;

function trimEnv(key) {
  const v = process.env[key];
  return typeof v === 'string' ? v.trim() : '';
}

/**
 * @param {string} envKey
 * @param {string} defaultName
 * @returns {string} absolute file path or name on PATH
 */
function resolveBinary(envKey, defaultName) {
  const fromEnv = trimEnv(envKey);
  if (fromEnv) {
    if (fs.existsSync(fromEnv)) return fromEnv;
    return fromEnv;
  }
  return defaultName;
}

function getFfmpegPath() {
  if (cachedFfmpeg == null) {
    cachedFfmpeg = resolveBinary('FFMPEG_PATH', 'ffmpeg');
  }
  return cachedFfmpeg;
}

function getFfprobePath() {
  if (cachedFfprobe == null) {
    cachedFfprobe = resolveBinary('FFPROBE_PATH', 'ffprobe');
  }
  return cachedFfprobe;
}

function applyFluentFfmpegPaths() {
  try {
    const fluent = require('fluent-ffmpeg');
    if (fluent && typeof fluent.setFfmpegPath === 'function') {
      fluent.setFfmpegPath(getFfmpegPath());
    }
    if (fluent && typeof fluent.setFfprobePath === 'function') {
      fluent.setFfprobePath(getFfprobePath());
    }
  } catch (_) {
    /* fluent-ffmpeg optional in some deploys */
  }
}

function ffmpegAvailableSync() {
  try {
    execFileSync(getFfmpegPath(), ['-version'], { stdio: 'ignore', timeout: 8000 });
    return true;
  } catch (_) {
    return false;
  }
}

function ffprobeAvailableSync() {
  try {
    execFileSync(getFfprobePath(), ['-version'], { stdio: 'ignore', timeout: 8000 });
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Call once after dotenv.config(), before loading routes that use audio tooling.
 */
function initFfmpegPaths() {
  applyFluentFfmpegPaths();
  const ff = ffmpegAvailableSync();
  const fp = ffprobeAvailableSync();
  if (!ff || !fp) {
    console.warn(
      '⚠️  ffmpeg/ffprobe not found on PATH. Long recordings (>10 min), large-file Whisper compression, and some voice features will fail until ffmpeg is installed. Railway: keep nixpacks.toml (includes ffmpeg) or set FFMPEG_PATH / FFPROBE_PATH to the binary paths.'
    );
  } else {
    console.log(`✅ ffmpeg tools available (${getFfmpegPath()}, ${getFfprobePath()})`);
  }
}

module.exports = {
  getFfmpegPath,
  getFfprobePath,
  applyFluentFfmpegPaths,
  initFfmpegPaths,
  ffmpegAvailableSync,
  ffprobeAvailableSync,
};

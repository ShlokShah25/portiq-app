#!/usr/bin/env node
/**
 * Measure speaker-recognition accuracy on YOUR audio and suggest thresholds.
 *
 * Usage:
 *   node server/scripts/calibrate-voice-thresholds.js <dir>
 *
 * <dir> holds one sub-folder per person, each with several short clips (wav/mp3/m4a/webm) of only
 * that person talking — ideally recorded the way meetings are (same room, same laptop/mic):
 *
 *   calib/ananya/1.wav  calib/ananya/2.wav  calib/marcus/1.m4a  …
 *
 * The first clip (alphabetically) of each person is used as their "enrollment"; every other clip is
 * identified against all enrolled people with the live matcher. Also pass a folder named `_guests`
 * with clips of people who are NOT enrolled to measure how often a stranger is wrongly named.
 *
 * Needs the same setup as the server (HF_TOKEN, Python venv, ffmpeg).
 */
const fs = require('fs');
const path = require('path');
const { generateVoiceEmbedding, convertVoiceEnrollmentToWav, embeddingKindForVector } = require('../utils/voiceRecognition');
const { cosine, thresholds, matchEmbeddingToProfiles } = require('../utils/voiceMatching');
const { shutdownVoiceWorker } = require('../utils/voiceEmbeddingWorker');

const AUDIO = /\.(wav|mp3|m4a|webm|ogg|flac|mp4)$/i;

async function embed(file) {
  const wav = convertVoiceEnrollmentToWav(file);
  try {
    return await generateVoiceEmbedding(wav || file);
  } finally {
    if (wav) fs.unlinkSync(wav);
  }
}

function pct(arr, p) {
  if (!arr.length) return NaN;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.round((p / 100) * (s.length - 1))))];
}

async function main() {
  const dir = process.argv[2];
  if (!dir || !fs.existsSync(dir)) {
    console.error('Usage: node server/scripts/calibrate-voice-thresholds.js <dir-with-one-folder-per-person>');
    process.exit(1);
  }
  const people = fs.readdirSync(dir).filter((d) => fs.statSync(path.join(dir, d)).isDirectory());
  const data = {};
  for (const person of people) {
    const files = fs.readdirSync(path.join(dir, person)).filter((f) => AUDIO.test(f)).sort();
    data[person] = [];
    for (const f of files) {
      process.stdout.write(`embedding ${person}/${f}…\r`);
      data[person].push(await embed(path.join(dir, person, f)));
    }
  }
  console.log('');
  const enrolled = people.filter((p) => p !== '_guests' && data[p].length >= 2);
  if (enrolled.length < 2) {
    console.error('Need at least 2 people with 2+ clips each.');
    process.exit(1);
  }
  const kind = embeddingKindForVector(data[enrolled[0]][0]);
  const t = thresholds(kind);
  const profiles = enrolled.map((p) => ({ email: p, name: p, voiceVector: data[p][0], embeddingKind: kind }));

  // Score distributions: test clip vs its own enrollment, and vs everyone else's.
  const same = [];
  const diff = [];
  for (const p of enrolled) {
    for (const e of data[p].slice(1)) {
      for (const q of profiles) (q.email === p ? same : diff).push(cosine(e, q.voiceVector));
    }
  }
  for (const e of data._guests || []) for (const q of profiles) diff.push(cosine(e, q.voiceVector));

  // Identification with the production matcher (no session learning — worst case).
  let correct = 0;
  let wrong = 0;
  let unnamed = 0;
  for (const p of enrolled) {
    for (const e of data[p].slice(1)) {
      const m = matchEmbeddingToProfiles({ [kind]: e }, profiles, null);
      if (!m) unnamed += 1;
      else if (m.profile.email === p) correct += 1;
      else wrong += 1;
    }
  }
  let guestNamed = 0;
  for (const e of data._guests || []) if (matchEmbeddingToProfiles({ [kind]: e }, profiles, null)) guestNamed += 1;

  // Lowest threshold with ≤1% of impostor scores above it.
  const strict = pct(diff, 99);
  const eerish = (() => {
    let best = { th: 0, gap: Infinity };
    for (let th = 0; th <= 1; th += 0.01) {
      const far = diff.filter((x) => x >= th).length / diff.length;
      const frr = same.filter((x) => x < th).length / same.length;
      if (Math.abs(far - frr) < best.gap) best = { th, gap: Math.abs(far - frr), far, frr };
    }
    return best;
  })();

  const f = (x) => (Number.isFinite(x) ? x.toFixed(3) : 'n/a');
  console.log(`\nModel: ${kind}   people: ${enrolled.length}   test clips: ${enrolled.reduce((n, p) => n + data[p].length - 1, 0)}   guest clips: ${(data._guests || []).length}`);
  console.log(`Same person  : p10 ${f(pct(same, 10))}  median ${f(pct(same, 50))}  p90 ${f(pct(same, 90))}`);
  console.log(`Different    : p50 ${f(pct(diff, 50))}  p90 ${f(pct(diff, 90))}  p99 ${f(pct(diff, 99))}`);
  console.log(`Equal-error threshold ≈ ${f(eerish.th)} (false accept ${(eerish.far * 100).toFixed(1)}%, false reject ${(eerish.frr * 100).toFixed(1)}%)`);
  console.log(`\nWith current thresholds (accept ${t.accept}, margin ${t.margin}):`);
  console.log(`  enrolled clips: ${correct} correct, ${wrong} WRONG, ${unnamed} unnamed`);
  if ((data._guests || []).length) console.log(`  guest clips wrongly named: ${guestNamed}/${data._guests.length}`);
  const envKey = kind === 'wespeaker' ? 'VOICE_WESPEAKER_MIN' : kind === 'pyannote' ? 'VOICE_PYANNOTE_MIN' : 'VOICE_FFT_MATCH_MIN';
  console.log(`\nSuggested: ${envKey}=${f(Math.max(eerish.th, strict))}  (never names a stranger in ≥99% of cases on this data)`);
  console.log('Wrong names are worse than unnamed ones — prefer the higher value if the two differ a lot.');
  shutdownVoiceWorker();
}

main().catch((e) => {
  console.error(e);
  shutdownVoiceWorker();
  process.exit(1);
});

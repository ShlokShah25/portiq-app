/**
 * Cohort of other people's voiceprints for score normalisation (see voiceMatching.makeNormaliser).
 * Vectors stay server-side and are only used for arithmetic; cached briefly to keep live
 * identification cheap.
 */
const VoiceProfile = require('../models/VoiceProfile');
const { profileEmbeddingKind } = require('./voiceMatching');

const TTL_MS = 10 * 60 * 1000;
const MAX_PROFILES = 1000;
let cache = null;
let cachedAt = 0;
let inflight = null;

async function loadCohort() {
  const rows = await VoiceProfile.find({})
    .select('email voiceVector embeddingKind')
    .sort({ updatedAt: -1 })
    .limit(MAX_PROFILES)
    .lean();
  const byKind = { wespeaker: [], pyannote: [], fft: [] };
  for (const r of rows) {
    if (!Array.isArray(r.voiceVector) || !r.voiceVector.length) continue;
    const kind = profileEmbeddingKind(r);
    if (byKind[kind]) byKind[kind].push({ email: String(r.email || '').toLowerCase(), vector: r.voiceVector });
  }
  return byKind;
}

/** @returns {Promise<{ wespeaker: object[], pyannote: object[], fft: object[] }|null>} */
async function getVoiceCohort() {
  if (String(process.env.VOICE_COHORT_NORM || 'true').toLowerCase() === 'false') return null;
  if (cache && Date.now() - cachedAt < TTL_MS) return cache;
  if (!inflight) {
    inflight = loadCohort()
      .then((c) => {
        cache = c;
        cachedAt = Date.now();
        return c;
      })
      .catch((e) => {
        console.warn('⚠️  Voice cohort unavailable:', e.message || e);
        return cache;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

function invalidateVoiceCohort() {
  cache = null;
}

module.exports = { getVoiceCohort, invalidateVoiceCohort };

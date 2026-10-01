/**
 * Re-embed voiceprints enrolled with an older model (legacy pyannote/embedding or the FFT
 * fallback) using the current model, from the enrollment sample already on disk. The old vector
 * is kept as a 'legacy' template, so nothing that matched before stops matching.
 *
 * Runs once in the background at boot; VOICE_PROFILE_UPGRADE=false disables it.
 */
const fs = require('fs');
const path = require('path');
const VoiceProfile = require('../models/VoiceProfile');
const {
  generateVoiceEmbedding,
  convertVoiceEnrollmentToWav,
  embeddingKindForVector,
  profileEmbeddingKind,
} = require('./voiceRecognition');
const { invalidateVoiceCohort } = require('./voiceCohort');

async function upgradeLegacyVoiceProfiles() {
  if (String(process.env.VOICE_PROFILE_UPGRADE || 'true').toLowerCase() === 'false') return;
  const target = String(process.env.VOICE_EMBEDDING_MODEL || 'wespeaker').toLowerCase() === 'pyannote' ? 'pyannote' : 'wespeaker';
  if (!String(process.env.HF_TOKEN || process.env.HUGGINGFACE_TOKEN || '').trim()) return;

  const rows = await VoiceProfile.find({ voiceSampleFile: { $ne: null } });
  const legacy = rows.filter((p) => profileEmbeddingKind(p) !== target);
  if (!legacy.length) return;
  console.log(`🔁 Upgrading ${legacy.length} voiceprint(s) to ${target}…`);

  let upgraded = 0;
  let missing = 0;
  for (const profile of legacy) {
    const samplePath = path.join(__dirname, '../..', String(profile.voiceSampleFile || ''));
    if (!profile.voiceSampleFile || !fs.existsSync(samplePath)) {
      missing += 1;
      continue;
    }
    let wav = null;
    try {
      wav = convertVoiceEnrollmentToWav(samplePath);
      const vec = await generateVoiceEmbedding(wav || samplePath);
      if (embeddingKindForVector(vec) !== target) {
        // Model unavailable right now — stop instead of spinning through every profile.
        console.warn('⚠️  Voiceprint upgrade paused: target model unavailable.');
        break;
      }
      const oldKind = profileEmbeddingKind(profile);
      profile.voiceEmbeddings = [
        ...(profile.voiceEmbeddings || []),
        { kind: oldKind, vector: profile.voiceVector, source: 'legacy', createdAt: new Date() },
      ];
      profile.voiceVector = vec;
      profile.embeddingKind = target;
      await profile.save();
      upgraded += 1;
    } catch (e) {
      console.warn(`⚠️  Could not upgrade voiceprint for ${profile.email}:`, e.message || e);
    } finally {
      if (wav) {
        try {
          fs.unlinkSync(wav);
        } catch (_) {
          /* ignore */
        }
      }
    }
  }
  if (upgraded) invalidateVoiceCohort();
  console.log(
    `🔁 Voiceprint upgrade: ${upgraded} upgraded` +
      (missing ? `, ${missing} without a stored sample (ask them to re-record)` : '')
  );
}

module.exports = { upgradeLegacyVoiceProfiles };

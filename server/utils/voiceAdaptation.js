/**
 * Adaptive enrollment: after a meeting, a person named with a clear, long, unambiguous match
 * gets that meeting's voice saved as an extra voiceprint. Enrollment happens on one mic in one
 * quiet moment; meetings happen in rooms — these templates are what make recognition hold up
 * there. Strict gates keep a wrong label from ever teaching the system.
 *
 * VOICE_ADAPTIVE_ENROLLMENT=false disables it.
 */
const VoiceProfile = require('../models/VoiceProfile');

const MAX_MEETING_TEMPLATES_PER_KIND = 6;

function num(key, def) {
  const v = parseFloat(process.env[key] || '');
  return Number.isNaN(v) ? def : v;
}

function adaptiveEnabled() {
  return String(process.env.VOICE_ADAPTIVE_ENROLLMENT || 'true').toLowerCase() !== 'false';
}

/**
 * @param {{ email, kind, vector, cal, margin, durationSec }[]} learned from buildSpeakerTimeline
 * @param {string} meetingId
 */
async function persistLearnedVoiceprints(learned, meetingId) {
  if (!adaptiveEnabled() || !Array.isArray(learned) || !learned.length) return 0;
  const minCal = num('VOICE_ADAPT_MIN_MARGIN_OVER_ACCEPT', 0.12);
  const minMargin = num('VOICE_ADAPT_MIN_RUNNER_UP_GAP', 0.15);
  const minSec = num('VOICE_ADAPT_MIN_SECONDS', 20);

  // One voice per person per meeting: keep the longest qualifying cluster.
  const best = new Map();
  for (const l of learned) {
    if (!l || !l.email || !Array.isArray(l.vector) || l.kind === 'fft') continue;
    if (l.cal < minCal || l.margin < minMargin || l.durationSec < minSec) continue;
    const key = `${String(l.email).toLowerCase()}|${l.kind}`;
    if (!best.has(key) || best.get(key).durationSec < l.durationSec) best.set(key, l);
  }

  let saved = 0;
  for (const l of best.values()) {
    try {
      const profile = await VoiceProfile.findOne({ email: String(l.email).toLowerCase() });
      if (!profile) continue;
      const mid = meetingId ? String(meetingId) : null;
      const others = (profile.voiceEmbeddings || []).filter(
        (e) => !(e.source === 'meeting' && mid && e.meetingId === mid && e.kind === l.kind)
      );
      const sameKindMeeting = others.filter((e) => e.source === 'meeting' && e.kind === l.kind);
      const rest = others.filter((e) => !(e.source === 'meeting' && e.kind === l.kind));
      const kept = sameKindMeeting
        .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
        .slice(-(MAX_MEETING_TEMPLATES_PER_KIND - 1));
      profile.voiceEmbeddings = [
        ...rest,
        ...kept,
        { kind: l.kind, vector: l.vector, source: 'meeting', meetingId: mid, createdAt: new Date() },
      ];
      await profile.save();
      saved += 1;
    } catch (e) {
      console.warn('⚠️  Could not save learned voiceprint:', e.message || e);
    }
  }
  if (saved) console.log(`🎓 Learned ${saved} in-meeting voiceprint(s) from meeting ${meetingId}`);
  return saved;
}

module.exports = { persistLearnedVoiceprints };

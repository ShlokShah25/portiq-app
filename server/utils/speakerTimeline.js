/**
 * Speaker-labelled transcript for a full recording.
 *
 * Every Whisper segment gets its own voice embedding (one batched call to the persistent pyannote
 * worker) and is matched against the participants' enrolled voiceprints. Voices that match nobody
 * are grouped into "Speaker 1", "Speaker 2", … so turns stay separated even for guests.
 *
 * Replaces the older approach of merging segments into 10–45 s buckets (several people per bucket,
 * one label for all of them) that was only used as hidden evidence for the summary.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { getFfmpegPath } = require('./ffmpegPaths');
const {
  compareEmbeddings,
  matchEmbeddingToProfiles,
  newVoiceSessionContext,
  embedAudioWindows,
  profileEmbeddingKind,
} = require('./voiceRecognition');

const MIN_WINDOW_SEC = 0.8;
const UNKNOWN_CLUSTER_MIN_SIM = 0.6;
const MAX_UNKNOWN_CLUSTERS = 8;
const MAX_SEGMENTS = 2500;

function timelineEnabled() {
  return String(process.env.VOICE_TIMELINE_ENABLED || 'true').toLowerCase() !== 'false';
}

function normalizeSegments(segments) {
  if (!Array.isArray(segments)) return [];
  return segments
    .map((s) => ({
      start: Number(s && s.start) || 0,
      end: Number(s && s.end) || 0,
      text: s && s.text != null ? String(s.text).replace(/\s+/g, ' ').trim() : '',
    }))
    .filter((s) => s.end > s.start && s.text.length > 0)
    .slice(0, MAX_SEGMENTS);
}

function toMono16kWav(inputPath) {
  const out = path.join(
    os.tmpdir(),
    `portiq_timeline_${Date.now()}_${Math.random().toString(36).slice(2, 9)}.wav`
  );
  execFileSync(getFfmpegPath(), ['-nostdin', '-y', '-i', inputPath, '-ac', '1', '-ar', '16000', '-vn', out], {
    stdio: ['ignore', 'ignore', 'pipe'],
    maxBuffer: 25 * 1024 * 1024,
    timeout: 600000,
  });
  return out;
}

/** Widen very short segments symmetrically so they still carry enough voice to embed. */
function embeddingWindow(seg, totalEnd) {
  const dur = seg.end - seg.start;
  if (dur >= MIN_WINDOW_SEC) return [seg.start, seg.end];
  const pad = (MIN_WINDOW_SEC - dur) / 2;
  return [Math.max(0, seg.start - pad), Math.min(totalEnd, seg.end + pad)];
}

function assignUnknownCluster(clusters, emb) {
  let best = null;
  let bestSim = -1;
  for (const c of clusters) {
    const sim = compareEmbeddings(emb, c.centroid);
    if (sim > bestSim) {
      bestSim = sim;
      best = c;
    }
  }
  if (best && bestSim >= UNKNOWN_CLUSTER_MIN_SIM) {
    const n = best.n + 1;
    best.centroid = best.centroid.map((v, i) => (v * best.n + emb[i]) / n);
    best.n = n;
    return best.label;
  }
  if (clusters.length >= MAX_UNKNOWN_CLUSTERS) return best ? best.label : 'Unidentified speaker';
  const label = `Speaker ${clusters.length + 1}`;
  clusters.push({ label, centroid: emb.slice(), n: 1 });
  return label;
}

/**
 * Label segments in two passes: the first learns how each enrolled person sounds in THIS room
 * (session centroids), the second re-scores every segment with that knowledge.
 */
function labelSegments(segs, embeddings, profiles, sessionContext) {
  const ctx = sessionContext || newVoiceSessionContext();
  for (let i = 0; i < segs.length; i++) {
    if (embeddings[i]) matchEmbeddingToProfiles({ pyannote: embeddings[i] }, profiles, ctx);
  }
  ctx.lastEmbedding = null;
  ctx.lastEmail = null;

  const clusters = Array.isArray(ctx.unknownClusters) ? ctx.unknownClusters : [];
  ctx.unknownClusters = clusters;
  const labels = segs.map((_, i) => {
    const emb = embeddings[i];
    if (!emb) return null;
    const m = matchEmbeddingToProfiles({ pyannote: emb }, profiles, ctx);
    if (m && m.profile) {
      return {
        speaker: String(m.profile.name || '').trim() || m.profile.email,
        email: m.profile.email,
        confidence: Number(m.confidence || 0),
      };
    }
    return { speaker: assignUnknownCluster(clusters, emb), email: '', confidence: 0 };
  });

  // Segments without a usable embedding inherit the neighbouring speaker.
  for (let i = 0; i < labels.length; i++) {
    if (labels[i]) continue;
    const prev = labels.slice(0, i).reverse().find(Boolean);
    const next = labels.slice(i + 1).find(Boolean);
    labels[i] = prev || next || { speaker: 'Unidentified speaker', email: '', confidence: 0 };
  }

  // A lone short segment sandwiched inside one speaker's turn is almost always that speaker.
  for (let i = 1; i < labels.length - 1; i++) {
    const dur = segs[i].end - segs[i].start;
    if (
      dur < 1.5 &&
      labels[i - 1].speaker === labels[i + 1].speaker &&
      labels[i].speaker !== labels[i - 1].speaker
    ) {
      labels[i] = { ...labels[i - 1] };
    }
  }
  return labels;
}

function mergeIntoTurns(segs, labels, offsetSec) {
  const turns = [];
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    const l = labels[i];
    const last = turns[turns.length - 1];
    if (last && last.speaker === l.speaker && s.start + offsetSec - last.end < 2.5) {
      last.end = s.end + offsetSec;
      last.text = `${last.text} ${s.text}`;
      if (l.email && !last.email) last.email = l.email;
      continue;
    }
    turns.push({
      start: Math.round((s.start + offsetSec) * 10) / 10,
      end: Math.round((s.end + offsetSec) * 10) / 10,
      speaker: l.speaker,
      email: l.email || '',
      text: s.text,
    });
  }
  return turns;
}

/** "Name: text" lines — the transcript format the summary prompt and the UI consume. */
function turnsToLabelledText(turns) {
  return (turns || [])
    .filter((t) => t && String(t.text || '').trim())
    .map((t) => `${t.speaker || 'Unidentified speaker'}: ${String(t.text).trim()}`)
    .join('\n');
}

/** Evidence block in the format reauditStructuredSummaryWithVoice already expects. */
function turnsToEvidenceTranscript(turns) {
  const lines = (turns || []).map(
    (t) => `[${t.speaker}] (${Number(t.start).toFixed(1)}s–${Number(t.end).toFixed(1)}s): ${t.text}`
  );
  if (!lines.length) return null;
  return `[Voice timeline from recording — use to fix speaker labels where content aligns]\n${lines.join('\n')}`;
}

/**
 * @param {string} audioPath recording (any ffmpeg-readable format)
 * @param {object[]} segments Whisper verbose_json segments
 * @param {object[]} voiceProfiles VoiceProfile docs of the people who may be speaking
 * @param {{ offsetSec?: number, sessionContext?: object }} [opts] offset/context for chunked long audio
 * @returns {Promise<{ turns: object[], labelledText: string, evidenceTranscript: string|null, identifiedSpeakers: number }|null>}
 *   null when attribution is unavailable (no pyannote profiles, worker down, ffmpeg missing)
 */
async function buildSpeakerTimeline(audioPath, segments, voiceProfiles, opts = {}) {
  if (!timelineEnabled()) return null;
  const segs = normalizeSegments(segments);
  if (!segs.length || !audioPath || !fs.existsSync(audioPath)) return null;
  const profiles = (voiceProfiles || []).filter(
    (p) => p && Array.isArray(p.voiceVector) && p.voiceVector.length && profileEmbeddingKind(p) === 'pyannote'
  );
  if (!profiles.length) return null;

  let wav = null;
  try {
    try {
      wav = toMono16kWav(audioPath);
    } catch (e) {
      console.warn('⚠️ Speaker timeline: ffmpeg conversion failed:', e.message || e);
      return null;
    }
    const totalEnd = segs[segs.length - 1].end + 1;
    const started = Date.now();
    const embeddings = await embedAudioWindows(
      wav,
      segs.map((s) => embeddingWindow(s, totalEnd))
    );
    if (!embeddings || embeddings.length !== segs.length || !embeddings.some(Boolean)) return null;

    const labels = labelSegments(segs, embeddings, profiles, opts.sessionContext);
    const turns = mergeIntoTurns(segs, labels, Number(opts.offsetSec) || 0);
    const identified = new Set(turns.filter((t) => t.email).map((t) => t.email));
    console.log(
      `🗣️  Speaker timeline: ${segs.length} segments → ${turns.length} turns, ${identified.size} enrolled speaker(s) named (${Date.now() - started}ms)`
    );
    return {
      turns,
      labelledText: turnsToLabelledText(turns),
      evidenceTranscript: turnsToEvidenceTranscript(turns),
      identifiedSpeakers: identified.size,
    };
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

module.exports = {
  buildSpeakerTimeline,
  turnsToLabelledText,
  turnsToEvidenceTranscript,
  // exported for tests
  labelSegments,
  mergeIntoTurns,
};

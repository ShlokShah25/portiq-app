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
const { embedAudioWindows, newVoiceSessionContext } = require('./voiceRecognition');
const {
  KIND_ORDER,
  cosine,
  weightedCentroid,
  thresholds,
  profileTemplates,
  clusterByVoice,
  assignClustersToProfiles,
} = require('./voiceMatching');

const MIN_WINDOW_SEC = 0.8;
const UNKNOWN_LABEL_REUSE_SIM = 0.6;
const MAX_UNKNOWN_LABELS = 8;
const MAX_SEGMENTS = 2500;
/** Above this many segments, adjacent near-identical segments are pre-merged before clustering. */
const MAX_CLUSTER_ITEMS = 500;

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

/**
 * Stable "Speaker N" labels for voices nobody enrolled — reused across long-audio chunks via
 * sessionContext.unknownClusters so the same guest keeps the same number all meeting.
 */
function unknownLabelFor(ctx, centroid) {
  const known = ctx.unknownClusters;
  let best = null;
  let bestSim = -1;
  for (const c of known) {
    if (c.centroid.length !== centroid.length) continue;
    const sim = cosine(centroid, c.centroid);
    if (sim > bestSim) {
      bestSim = sim;
      best = c;
    }
  }
  if (best && bestSim >= UNKNOWN_LABEL_REUSE_SIM) return best.label;
  if (known.length >= MAX_UNKNOWN_LABELS) return best ? best.label : 'Unidentified speaker';
  const label = `Speaker ${known.length + 1}`;
  known.push({ label, centroid: centroid.slice() });
  return label;
}

/**
 * Group consecutive segments that clearly share a voice so clustering stays fast on long meetings.
 * @returns {{ idx: number[], dur: number }[]}
 */
function premergeAdjacent(segIdx, segs, emb) {
  let groups = segIdx.map((i) => ({ idx: [i], dur: segs[i].end - segs[i].start }));
  let threshold = 0.85;
  while (groups.length > MAX_CLUSTER_ITEMS && threshold > 0.5) {
    const next = [];
    for (const g of groups) {
      const last = next[next.length - 1];
      if (last) {
        const a = weightedCentroid(last.idx.map((i) => emb[i]), last.idx.map((i) => segs[i].end - segs[i].start));
        const b = weightedCentroid(g.idx.map((i) => emb[i]), g.idx.map((i) => segs[i].end - segs[i].start));
        if (cosine(a, b) >= threshold) {
          last.idx.push(...g.idx);
          last.dur += g.dur;
          continue;
        }
      }
      next.push({ idx: g.idx.slice(), dur: g.dur });
    }
    groups = next;
    threshold -= 0.05;
  }
  return groups;
}

/**
 * Cluster segments by voice, then name each cluster as a whole.
 *
 * @param {object[]} segs normalised Whisper segments
 * @param {{ [kind: string]: (number[]|null)[] }} embByKind per-segment embeddings for each family
 * @param {object[]} profiles
 * @param {object} [sessionContext] shared across long-audio chunks
 * @param {{ cohortByKind?: object }} [opts]
 * @returns {{ labels: object[], learned: object[] }}
 */
function labelSegmentsByCluster(segs, embByKind, profiles, sessionContext, opts = {}) {
  const ctx = sessionContext || newVoiceSessionContext();
  if (!Array.isArray(ctx.unknownClusters)) ctx.unknownClusters = [];
  const primary = KIND_ORDER.find((k) => Array.isArray(embByKind[k]) && embByKind[k].some(Boolean));
  if (!primary) return { labels: segs.map(() => null), learned: [] };
  const primaryEmb = embByKind[primary];

  const withEmb = segs.map((_, i) => i).filter((i) => primaryEmb[i]);
  const groups = premergeAdjacent(withEmb, segs, primaryEmb);
  const items = groups.map((g) => ({
    emb: weightedCentroid(g.idx.map((i) => primaryEmb[i]), g.idx.map((i) => segs[i].end - segs[i].start)),
    dur: g.dur,
  }));
  const itemClusters = clusterByVoice(items, thresholds(primary).clusterMerge);
  const clusters = itemClusters.map((members) => members.flatMap((m) => groups[m].idx).sort((a, b) => a - b));

  // A cluster's voice in every family available (profiles may only have legacy voiceprints).
  const clusterVoices = clusters.map((segIdx) => {
    const weights = segIdx.map((i) => segs[i].end - segs[i].start);
    const voice = {};
    for (const kind of KIND_ORDER) {
      const arr = embByKind[kind];
      if (!Array.isArray(arr)) continue;
      const pick = segIdx.filter((i) => arr[i]);
      if (pick.length) voice[kind] = weightedCentroid(pick.map((i) => arr[i]), pick.map((i) => segs[i].end - segs[i].start));
    }
    return { embByKind: voice, durationSec: weights.reduce((a, b) => a + b, 0) };
  });

  const assigned = assignClustersToProfiles(clusterVoices, profiles, opts);
  const labels = segs.map(() => null);
  const learned = [];
  clusters.forEach((segIdx, ci) => {
    const a = assigned[ci];
    let label;
    if (a) {
      label = {
        speaker: String(a.profile.name || '').trim() || a.profile.email,
        email: a.profile.email,
        confidence: Number(a.raw || 0),
        via: 'voice',
      };
      learned.push({
        email: a.profile.email,
        kind: a.kind,
        vector: clusterVoices[ci].embByKind[a.kind],
        cal: a.cal,
        margin: a.margin,
        durationSec: clusterVoices[ci].durationSec,
      });
    } else {
      label = { speaker: unknownLabelFor(ctx, clusterVoices[ci].embByKind[primary]), email: '', confidence: 0, via: '' };
    }
    for (const i of segIdx) labels[i] = label;
  });

  // Segments without a usable embedding inherit the neighbouring speaker.
  for (let i = 0; i < labels.length; i++) {
    if (labels[i]) continue;
    const prev = labels.slice(0, i).reverse().find(Boolean);
    const next = labels.slice(i + 1).find(Boolean);
    labels[i] = prev || next || { speaker: 'Unidentified speaker', email: '', confidence: 0, via: '' };
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
  return { labels, learned };
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
      via: l.via || '',
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
  const profiles = (voiceProfiles || []).filter((p) =>
    profileTemplates(p).some((t) => t.kind === 'wespeaker' || t.kind === 'pyannote')
  );
  if (!profiles.length) return null;

  // Neural families present among the profiles' voiceprints (the strongest is used to cluster).
  const kinds = KIND_ORDER.filter(
    (k) => k !== 'fft' && profiles.some((p) => profileTemplates(p).some((t) => t.kind === k))
  );

  let wav = null;
  try {
    try {
      wav = toMono16kWav(audioPath);
    } catch (e) {
      console.warn('⚠️ Speaker timeline: ffmpeg conversion failed:', e.message || e);
      return null;
    }
    const totalEnd = segs[segs.length - 1].end + 1;
    const windows = segs.map((s) => embeddingWindow(s, totalEnd));
    const started = Date.now();
    const embByKind = {};
    for (const kind of kinds) {
      const embs = await embedAudioWindows(wav, windows, kind);
      if (embs && embs.length === segs.length && embs.some(Boolean)) embByKind[kind] = embs;
    }
    if (!Object.keys(embByKind).length) return null;

    const { labels, learned } = labelSegmentsByCluster(segs, embByKind, profiles, opts.sessionContext, {
      cohortByKind: opts.cohortByKind,
    });
    const turns = mergeIntoTurns(segs, labels, Number(opts.offsetSec) || 0);
    const identified = new Set(turns.filter((t) => t.email).map((t) => t.email));
    console.log(
      `🗣️  Speaker timeline: ${segs.length} segments → ${turns.length} turns, ${identified.size} enrolled speaker(s) named (${Object.keys(embByKind).join('+')}, ${Date.now() - started}ms)`
    );
    return {
      turns,
      learned,
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
  labelSegmentsByCluster,
  mergeIntoTurns,
};

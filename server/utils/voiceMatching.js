/**
 * Speaker matching — pure math over precomputed embeddings (no I/O), shared by live utterances,
 * full-recording attribution and the calibration script.
 *
 * Accuracy levers, in order of impact:
 *  1. Model: WeSpeaker ResNet34 ('wespeaker', 256-dim) by default; legacy pyannote/embedding (512)
 *     and the FFT fallback (128) still match their own enrolled vectors. A profile is always scored
 *     with the strongest family available for both sides.
 *  2. Several templates per person: the enrollment sample plus voiceprints learned from past
 *     meetings (same rooms / mics as future meetings). Score = best template.
 *  3. Per-meeting learning: once someone is confidently named, their in-room voice becomes an
 *     extra template for the rest of that meeting.
 *  4. Margin over the runner-up: two people who both "sort of" match → unnamed, never a guess.
 *  5. Cohort (AS-)normalisation when enough other voiceprints exist: rejects "generic" voices that
 *     score well against everyone.
 *  6. Clustering (full recordings): group segments by voice first, then name whole clusters —
 *     a cluster's averaged voice is far more reliable than any 2-second segment.
 */

const FFT_DIM = 128;
const WESPEAKER_DIM = 256;
const KIND_ORDER = ['wespeaker', 'pyannote', 'fft'];

function num(key, def, min, max) {
  const v = parseFloat(process.env[key] || '');
  if (Number.isNaN(v)) return def;
  return Math.min(max, Math.max(min, v));
}

function embeddingKindForVector(vec) {
  if (!Array.isArray(vec)) return 'pyannote';
  if (vec.length === FFT_DIM) return 'fft';
  if (vec.length === WESPEAKER_DIM) return 'wespeaker';
  return 'pyannote';
}

function profileEmbeddingKind(profile) {
  const explicit = String((profile && profile.embeddingKind) || '').toLowerCase();
  if (KIND_ORDER.includes(explicit)) return explicit;
  return embeddingKindForVector(profile && profile.voiceVector);
}

function cosine(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || !a.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function l2(vec) {
  let s = 0;
  for (const v of vec) s += v * v;
  const n = Math.sqrt(s) || 1;
  return vec.map((v) => v / n);
}

/** Duration-weighted mean of L2-normalised vectors, re-normalised. */
function weightedCentroid(vectors, weights) {
  if (!vectors.length) return null;
  const dim = vectors[0].length;
  const out = new Array(dim).fill(0);
  let total = 0;
  vectors.forEach((v, idx) => {
    const w = weights ? Math.max(0.1, weights[idx] || 0) : 1;
    const nv = l2(v);
    for (let i = 0; i < dim; i++) out[i] += nv[i] * w;
    total += w;
  });
  return l2(out.map((x) => x / (total || 1)));
}

/** Per-family decision thresholds (raw cosine). Calibrate with server/scripts/calibrate-voice-thresholds.js. */
function thresholds(kind) {
  if (kind === 'wespeaker') {
    return {
      accept: num('VOICE_WESPEAKER_MIN', 0.5, 0.2, 0.95),
      margin: num('VOICE_WESPEAKER_MARGIN', 0.08, 0.01, 0.4),
      continuity: num('VOICE_WESPEAKER_CONTINUITY', 0.7, 0.4, 0.98),
      clusterMerge: num('VOICE_WESPEAKER_CLUSTER_MERGE', 0.6, 0.3, 0.95),
    };
  }
  if (kind === 'fft') {
    return {
      accept: num('VOICE_FFT_MATCH_MIN', 0.8, 0.5, 0.98),
      margin: num('VOICE_FFT_MATCH_MARGIN', 0.03, 0.005, 0.2),
      continuity: num('VOICE_FFT_CONTINUITY_HIGH', 0.93, 0.7, 0.995),
      clusterMerge: 0.97,
    };
  }
  return {
    accept: num('VOICE_PYANNOTE_MIN', 0.55, 0.3, 0.95),
    margin: num('VOICE_MATCH_MARGIN', 0.06, 0.01, 0.35),
    continuity: num('VOICE_CONTINUITY_HIGH', 0.75, 0.5, 0.96),
    clusterMerge: num('VOICE_PYANNOTE_CLUSTER_MERGE', 0.6, 0.3, 0.95),
  };
}

/** Every stored voiceprint for a profile: { kind, vector }. */
function profileTemplates(profile) {
  const out = [];
  if (Array.isArray(profile && profile.voiceVector) && profile.voiceVector.length) {
    out.push({ kind: profileEmbeddingKind(profile), vector: profile.voiceVector, source: 'enrollment' });
  }
  const extra = Array.isArray(profile && profile.voiceEmbeddings) ? profile.voiceEmbeddings : [];
  for (const e of extra) {
    if (!e || !Array.isArray(e.vector) || !e.vector.length) continue;
    out.push({
      kind: KIND_ORDER.includes(e.kind) ? e.kind : embeddingKindForVector(e.vector),
      vector: e.vector,
      source: e.source || 'meeting',
    });
  }
  return out;
}

function emailKey(profile) {
  return String((profile && profile.email) || '').toLowerCase();
}

function newVoiceSessionContext() {
  return {
    lastEmbedding: null,
    lastEmail: null,
    lastEmbeddingKind: null,
    centroids: new Map(), // `${email}|${kind}` → { sum, n }
    unknownClusters: [],
  };
}

function sessionCentroid(ctx, email, kind) {
  const c = ctx && ctx.centroids && ctx.centroids.get(`${email}|${kind}`);
  if (!c || !c.n) return null;
  return l2(c.sum.map((v) => v / c.n));
}

function learnSession(ctx, email, kind, emb) {
  if (!ctx || !ctx.centroids) return;
  const key = `${String(email).toLowerCase()}|${kind}`;
  const nv = l2(emb);
  const c = ctx.centroids.get(key);
  if (!c || c.sum.length !== nv.length) {
    ctx.centroids.set(key, { sum: nv.slice(), n: 1 });
    return;
  }
  for (let i = 0; i < nv.length; i++) c.sum[i] += nv[i];
  c.n += 1;
}

/**
 * Adaptive symmetric score normalisation against a cohort of other people's voiceprints.
 * Returns null when the cohort is too small to be meaningful.
 */
function makeNormaliser(cohortByKind) {
  const minCohort = num('VOICE_COHORT_MIN', 12, 3, 1000);
  const topK = Math.round(num('VOICE_COHORT_TOPK', 20, 5, 200));
  const stats = (vec, cohort) => {
    const sims = cohort.map((c) => cosine(vec, c)).sort((a, b) => b - a).slice(0, topK);
    const mean = sims.reduce((a, b) => a + b, 0) / sims.length;
    const sd = Math.sqrt(sims.reduce((a, b) => a + (b - mean) * (b - mean), 0) / sims.length) || 0.05;
    return { mean, sd: Math.max(sd, 0.02) };
  };
  return (kind, testVec, templateVec, raw, excludeEmails) => {
    const cohortAll = (cohortByKind && cohortByKind[kind]) || [];
    const cohort = cohortAll.filter((c) => !excludeEmails || !excludeEmails.has(c.email)).map((c) => c.vector);
    if (cohort.length < minCohort) return null;
    const t = stats(testVec, cohort);
    const e = stats(templateVec, cohort);
    return 0.5 * ((raw - t.mean) / t.sd + (raw - e.mean) / e.sd);
  };
}

/**
 * Score every profile against one voice.
 * @param {{wespeaker?:number[], pyannote?:number[], fft?:number[]}} embByKind
 * @returns {{ profile, kind, raw, cal, norm, template }[]} sorted best-first by calibrated score
 *   (cal = raw − that family's accept threshold, so families are comparable).
 */
function scoreProfiles(embByKind, profiles, opts = {}) {
  const ctx = opts.sessionContext || null;
  const normalise = opts.cohortByKind ? makeNormaliser(opts.cohortByKind) : null;
  const meetingEmails = new Set((profiles || []).map(emailKey));
  const scored = [];
  for (const profile of profiles || []) {
    const templates = profileTemplates(profile);
    for (const kind of KIND_ORDER) {
      const emb = embByKind && embByKind[kind];
      if (!Array.isArray(emb) || !emb.length) continue;
      const tpl = templates.filter((t) => t.kind === kind && t.vector.length === emb.length);
      if (!tpl.length) continue;
      let raw = -1;
      let bestTpl = null;
      for (const t of tpl) {
        const s = cosine(emb, t.vector);
        if (s > raw) {
          raw = s;
          bestTpl = t.vector;
        }
      }
      // In-room voice learned earlier in this meeting (slightly discounted: it is self-taught).
      const cent = ctx ? sessionCentroid(ctx, emailKey(profile), kind) : null;
      if (cent) {
        const cs = cosine(emb, cent) - 0.03;
        if (cs > raw) {
          raw = cs;
          bestTpl = cent;
        }
      }
      const t = thresholds(kind);
      const norm = normalise ? normalise(kind, emb, bestTpl, raw, meetingEmails) : null;
      scored.push({ profile, kind, raw, cal: raw - t.accept, norm, template: bestTpl });
      break; // strongest family only
    }
  }
  scored.sort((a, b) => b.cal - a.cal);
  return scored;
}

function passesCohortGate(entry) {
  if (entry.norm == null) return true;
  return entry.norm >= num('VOICE_COHORT_MIN_SCORE', 1.0, -5, 20);
}

/**
 * Decide which enrolled person (if any) produced one voice sample.
 * @returns {{ profile, confidence, kind, tieBreak }|null}
 */
function matchEmbeddingToProfiles(embByKind, profiles, sessionContext = null, opts = {}) {
  const scored = scoreProfiles(embByKind, profiles, { ...opts, sessionContext });
  const debug = process.env.VOICE_MATCH_DEBUG === 'true';
  let chosen = null;

  if (scored.length) {
    const best = scored[0];
    const second = scored[1];
    const t = thresholds(best.kind);
    const clearWinner = !second || best.cal - second.cal >= t.margin;
    if (best.cal >= 0 && clearWinner && passesCohortGate(best)) {
      chosen = { profile: best.profile, confidence: best.raw, kind: best.kind, tieBreak: 'global' };
    }

    // Same voice as the previous utterance (turn continues) and still plausibly that person.
    const ctx = sessionContext;
    if (!chosen && ctx && ctx.lastEmbedding && ctx.lastEmail) {
      const last = scored.find((x) => emailKey(x.profile) === String(ctx.lastEmail).toLowerCase());
      const lastEmb = last && embByKind[last.kind];
      if (last && ctx.lastEmbeddingKind === last.kind && lastEmb) {
        const cont = cosine(lastEmb, ctx.lastEmbedding);
        if (cont >= thresholds(last.kind).continuity && last.cal >= -0.1 && last === scored[0]) {
          chosen = {
            profile: last.profile,
            confidence: Math.min(0.99, (last.raw + cont) / 2),
            kind: last.kind,
            tieBreak: 'continuity_same',
          };
        }
      }
    }
  }

  if (debug) {
    console.log(
      `[voice-match] ${scored
        .slice(0, 4)
        .map((x) => `${x.profile.email}=${x.raw.toFixed(3)}(${x.kind}${x.norm != null ? ` z${x.norm.toFixed(1)}` : ''})`)
        .join(' ')} → ${chosen ? `${chosen.profile.email} [${chosen.tieBreak}]` : 'unknown'}`
    );
  }

  if (sessionContext) {
    if (chosen) {
      const emb = embByKind[chosen.kind];
      sessionContext.lastEmbedding = emb.slice();
      sessionContext.lastEmail = chosen.profile.email;
      sessionContext.lastEmbeddingKind = chosen.kind;
      // Learn the in-room voice only from clear wins so one mistake cannot drag it.
      const best = scored[0];
      if (chosen.tieBreak === 'global' && best.cal >= 0.05) learnSession(sessionContext, chosen.profile.email, chosen.kind, emb);
    } else {
      sessionContext.lastEmail = null;
      sessionContext.lastEmbedding = null;
    }
  }
  return chosen;
}

/**
 * Average-linkage agglomerative clustering of segment embeddings (cosine), duration-weighted.
 * @param {{ emb:number[], dur:number }[]} items
 * @returns {number[][]} clusters as arrays of item indexes
 */
function clusterByVoice(items, mergeThreshold) {
  const n = items.length;
  if (!n) return [];
  let clusters = items.map((_, i) => ({ members: [i], weight: Math.max(0.2, items[i].dur || 1) }));
  // Similarity matrix (average linkage maintained via Lance–Williams update).
  let sim = [];
  for (let i = 0; i < n; i++) {
    sim.push(new Float64Array(n));
    for (let j = 0; j < i; j++) {
      const s = cosine(items[i].emb, items[j].emb);
      sim[i][j] = s;
      sim[j][i] = s;
    }
  }
  const alive = new Array(n).fill(true);
  for (;;) {
    let bi = -1;
    let bj = -1;
    let bs = -Infinity;
    for (let i = 0; i < n; i++) {
      if (!alive[i]) continue;
      const row = sim[i];
      for (let j = i + 1; j < n; j++) {
        if (alive[j] && row[j] > bs) {
          bs = row[j];
          bi = i;
          bj = j;
        }
      }
    }
    if (bi < 0 || bs < mergeThreshold) break;
    const wa = clusters[bi].weight;
    const wb = clusters[bj].weight;
    for (let k = 0; k < n; k++) {
      if (!alive[k] || k === bi || k === bj) continue;
      const s = (wa * sim[bi][k] + wb * sim[bj][k]) / (wa + wb);
      sim[bi][k] = s;
      sim[k][bi] = s;
    }
    clusters[bi] = { members: clusters[bi].members.concat(clusters[bj].members), weight: wa + wb };
    alive[bj] = false;
  }
  sim = null;
  return clusters.filter((_, i) => alive[i]).map((c) => c.members.sort((a, b) => a - b));
}

/**
 * Name whole voice clusters: best (cluster, person) pairs first, each person used once unless a
 * second cluster is an unambiguous strong match (one voice split in two by the clustering).
 * @param {{ embByKind: object, durationSec: number }[]} clusterVoices
 * @returns {({ profile, raw, kind, cal, margin }|null)[]} per cluster
 */
function assignClustersToProfiles(clusterVoices, profiles, opts = {}) {
  const pairs = [];
  const perCluster = clusterVoices.map((cv) => scoreProfiles(cv.embByKind, profiles, opts));
  perCluster.forEach((scored, ci) => {
    scored.forEach((s, rank) => {
      const next = scored.find((x, r) => r !== rank && x !== s);
      pairs.push({ ci, s, margin: next ? s.cal - next.cal : 1 });
    });
  });
  pairs.sort((a, b) => b.s.cal - a.s.cal);
  const result = new Array(clusterVoices.length).fill(null);
  const used = new Set();
  const splitBonus = num('VOICE_CLUSTER_SPLIT_BONUS', 0.1, 0, 0.5);
  for (const p of pairs) {
    if (result[p.ci]) continue;
    const t = thresholds(p.s.kind);
    if (p.s.cal < 0 || !passesCohortGate(p.s)) continue;
    const isBestForCluster = perCluster[p.ci][0] === p.s;
    if (!isBestForCluster || p.margin < t.margin) continue;
    const email = emailKey(p.s.profile);
    if (used.has(email) && p.s.cal < splitBonus) continue;
    used.add(email);
    result[p.ci] = { profile: p.s.profile, raw: p.s.raw, kind: p.s.kind, cal: p.s.cal, margin: p.margin };
  }
  return result;
}

module.exports = {
  KIND_ORDER,
  FFT_DIM,
  WESPEAKER_DIM,
  cosine,
  l2,
  weightedCentroid,
  thresholds,
  embeddingKindForVector,
  profileEmbeddingKind,
  profileTemplates,
  newVoiceSessionContext,
  scoreProfiles,
  matchEmbeddingToProfiles,
  clusterByVoice,
  assignClustersToProfiles,
};

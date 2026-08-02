/**
 * Additive long-audio wrapper (hierarchical chunk → mid-summary → final).
 * Long path runs when ffprobe duration > 10 minutes (meetings and interviews).
 * Short recordings (≤10 min) always use the existing transcribeAndSummarize path unchanged.
 *
 * Long audio is ON by default. Set ENABLE_LONG_AUDIO_PROCESSING=false (or 0/no/off) to disable
 * hierarchical processing and force the legacy single-file path for all durations.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execFile } = require('child_process');
const util = require('util');

const execFileAsync = util.promisify(execFile);
const { getFfmpegPath, getFfprobePath } = require('./ffmpegPaths');
const {
  transcribeAndSummarize,
  coalesceEducationRevisionQuestions,
  ensureEducationRevisionQuestionsAsync,
  normalizeEducationLectureMarkdown,
} = require('./meetingTranscription');
const {
  INTERVIEW_EVALUATION_SYSTEM_PROMPT,
  normalizeInterviewJson,
  mapInterviewToPipelinePayload,
  buildInterviewUserJsonInstructions,
} = require('./meetingSummaryModes');
const { mirrorMeetingAudioToPersistentDir } = require('./meetingAudioMirror');
const Meeting = require('../models/Meeting');
const Admin = require('../models/Admin');

const CHUNK_SEC = 300;
const LONG_THRESHOLD_SEC = 600;
const GROUP_SIZE = 5;
const CHUNK_SUFFIX = '.wav';

function longAudioProcessingEnabled() {
  const v = String(process.env.ENABLE_LONG_AUDIO_PROCESSING ?? '').trim().toLowerCase();
  if (v === 'false' || v === '0' || v === 'no' || v === 'off') return false;
  return true;
}

function getSummaryChatModel() {
  return process.env.OPENAI_SUMMARY_MODEL || 'gpt-4o-mini';
}

function openAiTimeoutMs() {
  return Math.min(
    30 * 60 * 1000,
    Math.max(120000, parseInt(process.env.OPENAI_TIMEOUT_MS || '1200000', 10) || 1200000)
  );
}

function getOpenAiForAggregation() {
  const OpenAI = require('openai');
  if (!process.env.OPENAI_API_KEY) return null;
  return new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    timeout: openAiTimeoutMs(),
  });
}

function formatClock(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

/**
 * @param {string} inputPath
 * @returns {number} seconds, 0 if unknown
 */
function getAudioDurationSeconds(inputPath) {
  try {
    const { execFileSync } = require('child_process');
    const out = execFileSync(
      'ffprobe',
      [
        '-v',
        'error',
        '-show_entries',
        'format=duration',
        '-of',
        'default=noprint_wrappers=1:nokey=1',
        inputPath,
      ],
      { encoding: 'utf8', timeout: 120000, maxBuffer: 2 * 1024 * 1024 }
    );
    const n = parseFloat(String(out).trim());
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch (e) {
    console.warn('[long-audio] ffprobe failed; using standard single-file path:', e.message || e);
    return 0;
  }
}

/**
 * @param {string} inputPath
 * @param {number} startSec
 * @param {number} durationSec
 * @param {string} outPath absolute .wav path
 */
async function extractAudioChunkWav(inputPath, startSec, durationSec, outPath) {
  await execFileAsync(
    getFfmpegPath(),
    [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-ss',
      String(startSec),
      '-i',
      inputPath,
      '-t',
      String(durationSec),
      '-vn',
      '-ac',
      '1',
      '-ar',
      '16000',
      outPath,
    ],
    { timeout: 15 * 60 * 1000, maxBuffer: 50 * 1024 * 1024 }
  );
}

function chunkSummaryBlock(summaryData, isInterview) {
  if (!summaryData) return '';
  const parts = [];
  const sum = String(summaryData.summary || '').trim();
  if (sum) parts.push(isInterview ? `Candidate summary:\n${sum}` : sum);
  const kp = (summaryData.keyPoints || []).filter(Boolean);
  if (kp.length) {
    const label = isInterview ? 'Strengths' : 'Key points';
    parts.push(`${label}:\n` + kp.map((k) => `- ${k}`).join('\n'));
  }
  if (isInterview) {
    const concerns = (summaryData.importantNotes || []).filter(Boolean);
    if (concerns.length) {
      parts.push('Concerns:\n' + concerns.map((n) => `- ${n}`).join('\n'));
    }
    const hire = String(summaryData.hiringRecommendation || '').trim();
    if (hire) parts.push(`Draft recommendation: ${hire}`);
  }
  return parts.join('\n\n').trim();
}

function tryParseJsonObject(raw) {
  const t = String(raw || '').trim();
  if (!t) return null;
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(t.slice(start, end + 1));
  } catch (_) {
    return null;
  }
}

async function combineChunkSummariesMidInterview(openai, chunkBlocks) {
  const joined = chunkBlocks
    .map((b, i) => `### Segment ${i + 1}\n${b}`)
    .join('\n\n---\n\n');
  const res = await openai.chat.completions.create({
    model: getSummaryChatModel(),
    messages: [
      {
        role: 'system',
        content:
          'You combine partial hiring evaluations from sequential segments of ONE interview. Output cohesive prose in English (no JSON). Preserve evidence from the segments only; do not invent strengths or concerns.',
      },
      {
        role: 'user',
        content:
          'Merge these partial interview evaluation segments into one section summary for the hiring team.\n\n' +
          joined,
      },
    ],
    temperature: 0.2,
    max_tokens: 2800,
  });
  return String(res.choices?.[0]?.message?.content || '').trim();
}

async function aggregateFinalInterviewFromMids(openai, midSummaries, meeting) {
  const joined = midSummaries
    .map((m, i) => `### Section ${i + 1}\n${m}`)
    .join('\n\n---\n\n');
  const role = String(meeting?.interviewRole || '').trim();
  const candidate = String(meeting?.interviewCandidateName || '').trim();
  const user =
    `Interview title: ${String(meeting?.title || 'Interview').trim()}\n` +
    (candidate ? `Candidate: ${candidate}\n` : '') +
    (role ? `Role (position): ${role}\n` : '') +
    '\nCombine these section evaluations into ONE final hiring evaluation JSON.\n' +
    buildInterviewUserJsonInstructions() +
    '\n\n' +
    joined;

  const res = await openai.chat.completions.create({
    model: getSummaryChatModel(),
    messages: [
      { role: 'system', content: INTERVIEW_EVALUATION_SYSTEM_PROMPT },
      { role: 'user', content: user },
    ],
    temperature: 0.15,
    max_tokens: 4500,
    response_format: { type: 'json_object' },
  });
  const raw = String(res.choices?.[0]?.message?.content || '').trim();
  const parsed = tryParseJsonObject(raw);
  if (!parsed) return null;
  const normalized = normalizeInterviewJson(parsed);
  return mapInterviewToPipelinePayload(normalized);
}

async function combineChunkSummariesMid(openai, chunkBlocks, _groupIndex, isEducation) {
  const joined = chunkBlocks
    .map((b, i) => `### Part ${i + 1}\n${b}`)
    .join('\n\n---\n\n');
  const sys = isEducation
    ? 'You combine partial lecture summaries from sequential segments of ONE class session. Output a single cohesive section summary in clear English prose (no JSON, no markdown code fences). Preserve teaching order and substantive depth. Prefer organization that will merge cleanly into STRUCTURED NOTES vs DETAILED EXPLANATION—facts and contrasts intact; no invented content.'
    : 'You combine partial meeting summaries from sequential segments of ONE session. Output a single cohesive section summary in clear English prose (no JSON). Preserve chronological sense. Do not invent facts not supported by the inputs.';

  const user =
    'Combine the following lecture/meeting segment summaries into a clean, structured section summary.\n\n' + joined;

  const res = await openai.chat.completions.create({
    model: getSummaryChatModel(),
    messages: [
      { role: 'system', content: sys },
      { role: 'user', content: user },
    ],
    temperature: 0.2,
    max_tokens: 2800,
  });
  return String(res.choices?.[0]?.message?.content || '').trim();
}

async function aggregateFinalFromMids(openai, midSummaries, meetingTitle, isEducation) {
  const joined = midSummaries
    .map((m, i) => `### Section ${i + 1}\n${m}`)
    .join('\n\n---\n\n');

  const sys = isEducation
    ? 'You merge section summaries of ONE PortIQ lecture into final JSON for students. Preserve full teaching depth—do not compress explanations. Output shape: keyPoints = 5–8 ONE-line QUICK REVISION strings; prefer Term = meaning; **bold** around the term only. summary = GFM Markdown (no raw HTML): ## STRUCTURED NOTES (Definitions/Objectives/Functions/Key Concepts with short "- " bullets, one idea per line, clear spacing) then ## DETAILED EXPLANATION (short paragraphs, optional ### mini-headings, full depth). **Bold** only key terms and light headings—never full sentences. Pipe tables ONLY for true comparisons; never force tables. revisionQuestions = 4–6 numbered lines (Define / Differentiate / Explain / short answer). Clarity over clutter. Transcript fidelity rule: keep spoken formulas exactly (no invented symbols) and keep dictated assignment questions faithful (no AI-rewritten substitutes). Do not replace section content with generic “importance of the unit” filler—keep concrete topics, numbers, and examples from the section summaries. English only.'
    : 'You merge section summaries of ONE meeting into final structured minutes. Output ONLY valid JSON (no markdown fences). All string values must be professional English.';

  const jsonKeysLine = isEducation
    ? 'Return ONLY a JSON object with keys: keyPoints (5–8 one-line QUICK REVISION; prefer Term = meaning; **bold** on term only), summary (GFM: ## STRUCTURED NOTES + ## DETAILED EXPLANATION as in system prompt; no revision questions inside), revisionQuestions (REQUIRED, 4–6 numbered exam-style questions), actionItems, decisions, nextSteps, importantNotes (same types as single-lecture spec).\n'
    : 'Return ONLY a JSON object with keys: summary (string), keyPoints (array of strings), actionItems (array of objects with task, assignee, dueDate as YYYY-MM-DD or null, notes), decisions (array of strings), nextSteps (array of strings), importantNotes (array of strings).\n';

  const user =
    `Session title (may be a placeholder; rely on section content): ${String(meetingTitle || 'Session').trim()}\n\n` +
    'Combine these section summaries into a final structured summary with clear key points.\n' +
    jsonKeysLine +
    '\n' +
    joined;

  const res = await openai.chat.completions.create({
    model: getSummaryChatModel(),
    messages: [
      { role: 'system', content: sys },
      { role: 'user', content: user },
    ],
    temperature: 0.15,
    max_tokens: isEducation ? 7000 : 4500,
    response_format: { type: 'json_object' },
  });
  const raw = String(res.choices?.[0]?.message?.content || '').trim();
  const parsed = tryParseJsonObject(raw);
  if (!parsed || typeof parsed !== 'object') return null;
  let revisionQuestions = '';
  if (isEducation) {
    if (typeof parsed.revisionQuestions === 'string') {
      revisionQuestions = parsed.revisionQuestions.trim();
    } else if (Array.isArray(parsed.revisionQuestions)) {
      revisionQuestions = parsed.revisionQuestions
        .map((x) => String(x || '').trim())
        .filter(Boolean)
        .map((line, i) => (/^\d+[.)]\s/.test(line) ? line : `${i + 1}. ${line}`))
        .join('\n');
    }
  }
  const out = {
    summary: typeof parsed.summary === 'string' ? parsed.summary : '',
    revisionQuestions,
    keyPoints: Array.isArray(parsed.keyPoints) ? parsed.keyPoints.map((x) => String(x || '').trim()).filter(Boolean) : [],
    actionItems: Array.isArray(parsed.actionItems) ? parsed.actionItems : [],
    decisions: Array.isArray(parsed.decisions) ? parsed.decisions.map((x) => String(x || '').trim()).filter(Boolean) : [],
    nextSteps: Array.isArray(parsed.nextSteps) ? parsed.nextSteps.map((x) => String(x || '').trim()).filter(Boolean) : [],
    importantNotes: Array.isArray(parsed.importantNotes)
      ? parsed.importantNotes.map((x) => String(x || '').trim()).filter(Boolean)
      : [],
  };
  if (isEducation) {
    coalesceEducationRevisionQuestions(out);
    if (out.summary) out.summary = normalizeEducationLectureMarkdown(out.summary);
  }
  return out;
}

function normalizeActionItems(raw) {
  return (raw || []).map((item) => {
    if (!item || typeof item !== 'object') {
      return { task: '', assignee: '', dueDate: null, notes: '' };
    }
    return {
      task: String(item.task || '').trim(),
      assignee: String(item.assignee || '').trim(),
      dueDate: item.dueDate != null && String(item.dueDate).trim() ? String(item.dueDate).trim() : null,
      notes: String(item.notes || '').trim(),
    };
  });
}

async function saveTranscriptCheckpoint(meetingId, text) {
  if (!meetingId) return;
  const t = String(text || '').trim();
  if (!t) return;
  try {
    await Meeting.findByIdAndUpdate(meetingId, {
      $set: { transcription: t, transcriptionStatus: 'Processing' },
    });
    console.log(`[long-audio] Checkpoint transcript (${t.length} chars) for meeting ${meetingId}`);
  } catch (e) {
    console.warn('[long-audio] Transcript checkpoint failed (non-fatal):', e.message || e);
  }
}

/**
 * @param {string} audioFilePath
 * @param {object} meeting
 * @param {{ productType?: string }} options
 */
async function runLongAudioPipeline(audioFilePath, meeting, options) {
  const meetingId = meeting && meeting._id;
  const meetingTitle = (meeting && meeting.title) || 'Meeting';
  let resolvedProductType = String(options.productType || '').trim().toLowerCase();
  if (!resolvedProductType && meeting && meeting.adminId) {
    try {
      const a = await Admin.findById(meeting.adminId).select('productType').lean();
      resolvedProductType = String(a?.productType || '').trim().toLowerCase();
    } catch (_) {
      /* ignore */
    }
  }
  const isEducation = resolvedProductType === 'education';
  const isInterview = String(meeting?.summaryMode || '').toLowerCase() === 'interview';

  mirrorMeetingAudioToPersistentDir(audioFilePath);

  const durationSec = getAudioDurationSeconds(audioFilePath);
  const nChunks = Math.max(1, Math.ceil(durationSec / CHUNK_SEC));
  console.log(
    `[long-audio] start meeting=${meetingId} duration=${durationSec.toFixed(1)}s chunks=${nChunks} groupSize=${GROUP_SIZE}`
  );

  const runId = crypto.randomBytes(8).toString('hex');
  const tmpDir = os.tmpdir();
  const chunkPaths = [];
  const chunkOpts = {
    ...options,
    longAudioPipeline: { skipMeetingSideEffects: true },
  };

  const chunkRecords = [];

  try {
    for (let i = 0; i < nChunks; i++) {
      const startSec = i * CHUNK_SEC;
      const dur = Math.min(CHUNK_SEC, durationSec - startSec);
      if (dur <= 0.5) break;
      const chunkPath = path.join(tmpDir, `portiq_long_${runId}_${i}${CHUNK_SUFFIX}`);
      chunkPaths.push(chunkPath);
      await extractAudioChunkWav(audioFilePath, startSec, dur, chunkPath);

      let summaryData = null;
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          summaryData = await transcribeAndSummarize(chunkPath, meeting, chunkOpts);
          if (attempt > 1) {
            console.log(`[long-audio] chunk ${i + 1}/${nChunks} OK after retry`);
          }
          break;
        } catch (e) {
          console.warn(
            `[long-audio] chunk ${i + 1}/${nChunks} attempt ${attempt}/2 failed:`,
            e.message || e
          );
          if (attempt >= 2) summaryData = null;
        }
      }

      const t0 = formatClock(startSec);
      const t1 = formatClock(startSec + dur);
      const transcriptPiece = summaryData
        ? String(summaryData.transcription || '').trim()
        : '';
      const labeled = transcriptPiece ? `[${t0}–${t1}]\n${transcriptPiece}` : '';

      chunkRecords.push({
        index: i,
        startSec,
        durationSec: dur,
        label: `${t0}–${t1}`,
        summaryData,
        transcriptLabeled: labeled,
        summaryBlock: chunkSummaryBlock(summaryData, isInterview),
      });

      if (!summaryData) {
        console.warn(`[long-audio] chunk ${i + 1}/${nChunks} skipped after retries`);
      }
    }

    const successful = chunkRecords.filter((c) => c.summaryData);
    if (!successful.length) {
      throw new Error('Long audio processing: every chunk failed; falling back is not attempted here.');
    }

    const fullTranscription = chunkRecords
      .map((c) => c.transcriptLabeled)
      .filter(Boolean)
      .join('\n\n');

    await saveTranscriptCheckpoint(meetingId, fullTranscription);

    const aggOpenai = getOpenAiForAggregation();
    if (!aggOpenai) throw new Error('OpenAI API key not configured');

    const mids = [];
    for (let g = 0; ; g++) {
      const startIdx = g * GROUP_SIZE;
      if (startIdx >= chunkRecords.length) break;
      const slice = chunkRecords.slice(startIdx, startIdx + GROUP_SIZE);
      const blocks = slice.map((c) => c.summaryBlock).filter(Boolean);
      if (!blocks.length) {
        console.warn(`[long-audio] group ${g + 1} has no text; skipping mid-summary`);
        continue;
      }
      let mid = '';
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          mid = isInterview
            ? await combineChunkSummariesMidInterview(aggOpenai, blocks)
            : await combineChunkSummariesMid(aggOpenai, blocks, g, isEducation);
          break;
        } catch (e) {
          console.warn(`[long-audio] mid-summary group ${g + 1} attempt ${attempt}/2:`, e.message || e);
          if (attempt >= 2) mid = blocks.join('\n\n');
        }
      }
      mids.push(mid);
      console.log(`[long-audio] mid-summary group ${g + 1}/${Math.ceil(chunkRecords.length / GROUP_SIZE)} (${blocks.length} chunk summaries)`);
    }

    console.log(`[long-audio] mid-summaries=${mids.length}; starting final aggregation`);

    if (!mids.filter((m) => String(m || '').trim()).length) {
      throw new Error('Long audio processing: no mid-summary text produced from chunks.');
    }

    let finalParsed = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        finalParsed = isInterview
          ? await aggregateFinalInterviewFromMids(aggOpenai, mids, meeting)
          : await aggregateFinalFromMids(aggOpenai, mids, meetingTitle, isEducation);
        if (finalParsed) break;
      } catch (e) {
        console.warn(`[long-audio] final aggregation attempt ${attempt}/2:`, e.message || e);
      }
    }

    if (!finalParsed) {
      const fallbackSummary = mids.join('\n\n');
      console.warn('[long-audio] final JSON parse failed; using concatenated mid-summaries as summary body');
      return {
        transcription: fullTranscription,
        summary: fallbackSummary,
        revisionQuestions: '',
        keyPoints: [],
        actionItems: [],
        decisions: [],
        nextSteps: [],
        importantNotes: isInterview
          ? ['Long interview mode: final hiring JSON step failed; review section text in the summary field.']
          : [
              'Long audio mode: final structured JSON step failed; review the section summary text in the main summary field.',
            ],
        hiringRecommendation: '',
        hiringRecommendationReason: '',
        evaluationSignals: null,
      };
    }

    console.log('[long-audio] final aggregation complete');

    if (isEducation && finalParsed) {
      await ensureEducationRevisionQuestionsAsync(finalParsed, fullTranscription, meetingTitle);
    }

    return {
      transcription: fullTranscription,
      summary: finalParsed.summary || '',
      revisionQuestions: String(finalParsed.revisionQuestions || '').trim(),
      keyPoints: finalParsed.keyPoints || [],
      actionItems: normalizeActionItems(finalParsed.actionItems),
      decisions: finalParsed.decisions || [],
      nextSteps: finalParsed.nextSteps || [],
      importantNotes: finalParsed.importantNotes || [],
      hiringRecommendation: finalParsed.hiringRecommendation || '',
      hiringRecommendationReason: finalParsed.hiringRecommendationReason || '',
      evaluationSignals: finalParsed.evaluationSignals || null,
      discProfile: finalParsed.discProfile || '',
      discScores: finalParsed.discScores || null,
      discSummary: finalParsed.discSummary || '',
    };
  } finally {
    for (const p of chunkPaths) {
      try {
        if (p && fs.existsSync(p)) fs.unlinkSync(p);
      } catch (_) {
        /* ignore */
      }
    }
  }
}

/**
 * Entry: same signature as transcribeAndSummarize. Routes long files when flag on and duration > 10 min.
 */
async function transcribeAndSummarizeWithLongAudioSupport(audioFilePath, meeting, options = {}) {
  const cleanOpts = { ...options };
  delete cleanOpts.longAudioPipeline;

  if (!longAudioProcessingEnabled()) {
    return transcribeAndSummarize(audioFilePath, meeting, cleanOpts);
  }
  const durationSec = getAudioDurationSeconds(audioFilePath);
  if (!durationSec || durationSec <= LONG_THRESHOLD_SEC) {
    return transcribeAndSummarize(audioFilePath, meeting, cleanOpts);
  }

  console.log(
    `[long-audio] routing to hierarchical pipeline (duration ${durationSec.toFixed(1)}s > ${LONG_THRESHOLD_SEC}s)`
  );
  return runLongAudioPipeline(audioFilePath, meeting, cleanOpts);
}

module.exports = {
  transcribeAndSummarizeWithLongAudioSupport,
  longAudioProcessingEnabled,
  getAudioDurationSeconds,
};

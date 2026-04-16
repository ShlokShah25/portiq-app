const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const { sendEmail, isEmailConfigured, getDefaultFrom } = require('./emailService');
const { buildMeetingSummaryPdfBuffer } = require('./meetingSummaryPdf');
const {
  buildGoogleCalendarUrlForMeeting,
  buildOutlookCalendarUrlForMeeting,
  buildMeetingIcs,
} = require('./calendarInviteLinks');
const { enrichActionItemsWithDueDates } = require('./actionItemDueDate');
const { mirrorMeetingAudioToPersistentDir } = require('./meetingAudioMirror');
const VoiceProfile = require('../models/VoiceProfile');
const Admin = require('../models/Admin');
const Meeting = require('../models/Meeting');
const {
  SUMMARY_MODES,
  INTERVIEW_EVALUATION_SYSTEM_PROMPT,
  normalizeInterviewJson,
  mapInterviewToPipelinePayload,
  buildInterviewUserJsonInstructions,
} = require('./meetingSummaryModes');
const { ensureWhisperSizedAudio, WHISPER_MAX_BYTES } = require('./audioCompressForWhisper');
const { identifySpeaker } = require('./voiceRecognition');

/**
 * Save Whisper output to MongoDB before summarization so GPT failures or deploys never wipe recoverable text.
 */
async function checkpointTranscriptionToDb(meetingId, transcriptText) {
  if (!meetingId) return;
  const t = String(transcriptText || '').trim();
  if (!t) return;
  try {
    await Meeting.findByIdAndUpdate(meetingId, {
      $set: {
        transcription: t,
        transcriptionStatus: 'Processing',
      },
    });
    console.log(`💾 Transcript checkpoint saved to database (${t.length} chars) for meeting ${meetingId}`);
  } catch (err) {
    console.warn('⚠️ Transcript checkpoint failed (non-fatal):', err.message);
  }
}
let ffmpeg = null;
try {
  ffmpeg = require('fluent-ffmpeg');
} catch (e) {
  console.warn('⚠️  fluent-ffmpeg not installed. Audio compression will be skipped. Install ffmpeg system package for automatic compression.');
}

// Initialize OpenAI client
let openai = null;
if (process.env.OPENAI_API_KEY) {
  openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
  });
  console.log('✅ OpenAI client initialized for meeting transcription');
} else {
  console.warn('⚠️  OPENAI_API_KEY not set. Meeting transcription will not work.');
}

/** Whisper + chat retries (default 5; override with OPENAI_PIPELINE_MAX_RETRIES). */
const OPENAI_PIPELINE_MAX_RETRIES = Math.min(
  10,
  Math.max(3, parseInt(process.env.OPENAI_PIPELINE_MAX_RETRIES || '5', 10) || 5)
);

function isRetryableOpenAiError(apiError) {
  if (!apiError) return false;
  const s = apiError.status;
  if (s === 408 || s === 429 || s === 500 || s === 502 || s === 503) return true;
  const code = apiError.code;
  if (code && ['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN'].includes(code)) {
    return true;
  }
  return false;
}

function getSummaryChatModel() {
  return process.env.OPENAI_SUMMARY_MODEL || 'gpt-4o-mini';
}

// Email is sent via shared emailService (Resend or SMTP)

function safeListParticipantNames(participants = []) {
  return (participants || [])
    .map((p) => (p && (p.name || p.email) ? String(p.name || p.email).trim() : ''))
    .filter(Boolean)
    .slice(0, 40);
}

/** Only real-looking emails — avoids junk like "unknown" breaking VoiceProfile lookups. */
function isValidEmailForLookup(email) {
  if (!email || typeof email !== 'string') return false;
  const t = email.trim();
  return /\S+@\S+\.\S+/.test(t);
}

/**
 * Participant lines for summary prompts — does not fail on unnamed guests; avoids repeating "Unknown".
 */
function formatParticipantLinesForSummaryPrompt(participants) {
  const arr = Array.isArray(participants) ? participants : [];
  return arr
    .map((p, i) => {
      const name = p && p.name ? String(p.name).trim() : '';
      const email = p && p.email ? String(p.email).trim() : '';
      const local = email && email.includes('@') ? email.split('@')[0] : '';
      const label = name || local || `Participant ${i + 1}`;
      return `- ${label}${email ? ` (${email})` : ''}`;
    })
    .join('\n');
}

function speakerAttributionPreamble() {
  return (
    `[Speaker attribution — required; transcript is the only source of truth]\n` +
    '- Never invent dialogue, "translations", foreign-language quotes, or thematic analysis that is not clearly supported by the transcript text below.\n' +
    `- If you are not sure who spoke a line, label them [Unidentified speaker] (or [Speaker 1] / [Speaker 2] if you can separate turns but not identities). ` +
    `Do not skip attribution.\n` +
    `- When a voice profile is listed for someone below, you may use their name ONLY for content that plausibly matches that person; if confidence is low, prefer [Unidentified speaker].\n` +
    `- Every key point MUST begin with a bracketed speaker label, e.g. [Jamie Lee]: … or [Unidentified speaker]: …\n\n`
  );
}

/** Optional voice-profile hint for speaker attribution (shared by standard + interview summary paths). */
async function buildTranscriptWithSpeakerHints(meetingObj, transcriptTextTrim) {
  const baseTranscript = String(transcriptTextTrim || '').trim();
  if (!meetingObj) {
    return speakerAttributionPreamble() + baseTranscript;
  }
  try {
    const participantEmails = (meetingObj.participants || [])
      .filter((p) => p && isValidEmailForLookup(p.email))
      .map((p) => p.email.trim().toLowerCase());

    const candidateVoiceEmails = Array.isArray(meetingObj.interviewCandidates)
      ? meetingObj.interviewCandidates
          .map((c) =>
            c && c.voiceEmail ? String(c.voiceEmail).trim().toLowerCase() : ''
          )
          .filter((e) => isValidEmailForLookup(e))
      : [];

    let adminEmail = '';
    if (meetingObj.adminId) {
      try {
        const adm = await Admin.findById(meetingObj.adminId).select('email').lean();
        if (adm && adm.email && isValidEmailForLookup(adm.email)) {
          adminEmail = String(adm.email).trim().toLowerCase();
        }
      } catch (_) {
        /* ignore */
      }
    }

    const allVoiceLookupEmails = [
      ...new Set([...participantEmails, ...candidateVoiceEmails, ...(adminEmail ? [adminEmail] : [])]),
    ];

    if (allVoiceLookupEmails.length === 0) {
      return speakerAttributionPreamble() + baseTranscript;
    }

    const voiceProfiles = await VoiceProfile.find({
      email: { $in: allVoiceLookupEmails },
    });

    if (voiceProfiles.length === 0) {
      const participantListOnly = (meetingObj.participants || [])
        .map((p, i) => {
          const name = p && p.name ? String(p.name).trim() : '';
          const email = p && p.email ? String(p.email).trim() : '';
          if (!name && !email) return `Participant ${i + 1} (no email on file)`;
          if (email) return `${name || email.split('@')[0]} (${email})`;
          return name;
        })
        .filter(Boolean)
        .join(', ');
      const roster =
        participantListOnly || (adminEmail ? `Organizer account email on file: ${adminEmail}` : '');
      return (
        (roster ? `Invited participants / roster hints (may speak): ${roster}\n\n` : '') +
        speakerAttributionPreamble() +
        baseTranscript
      );
    }

    console.log(`✅ Found ${voiceProfiles.length} voice profile(s) for speaker identification`);

    const participantList = (meetingObj.participants || [])
      .map((p, i) => {
        const name = p && p.name ? String(p.name).trim() : '';
        const email = p && p.email ? String(p.email).trim() : '';
        if (!name && !email) return `Participant ${i + 1} (no email on file)`;
        if (email) return `${name || email.split('@')[0]} (${email})`;
        return name;
      })
      .join(', ');

    const interviewerEmails = [
      ...(Array.isArray(meetingObj.interviewInterviewerEmails)
        ? meetingObj.interviewInterviewerEmails
        : []),
      meetingObj.interviewInterviewerEmail,
    ]
      .map((e) => String(e || '').trim().toLowerCase())
      .filter(Boolean)
      .filter((e, i, arr) => arr.indexOf(e) === i);
    const interviewerHints =
      interviewerEmails.length && Array.isArray(meetingObj.participants)
        ? interviewerEmails
            .map((email) => {
              const ip = meetingObj.participants.find(
                (p) => p && String(p.email || '').trim().toLowerCase() === email
              );
              if (!ip) return '';
              const nm = String(ip.name || '').trim() || email.split('@')[0];
              return `Designated interviewer (from participant list): ${nm} (${email})`;
            })
            .filter(Boolean)
        : [];

    const candidateHints = Array.isArray(meetingObj.interviewCandidates)
      ? meetingObj.interviewCandidates
          .filter((c) => c && String(c.name || '').trim())
          .map((c) => {
            const n = String(c.name).trim();
            const r = String(c.role || '').trim();
            const ve = c.voiceEmail ? String(c.voiceEmail).trim() : '';
            return `- Candidate: ${n}${r ? ` — role: ${r}` : ''}${ve ? ` (voice id: ${ve})` : ''}`;
          })
      : [];

    let prefix = '';
    if (interviewerHints.length || candidateHints.length) {
      prefix =
        `[Interview roster hints — use only when supported by the audio/transcript]\n` +
        (interviewerHints.length ? `${interviewerHints.join('\n')}\n` : '') +
        (candidateHints.length ? `${candidateHints.join('\n')}\n` : '') +
        `\n`;
    }

    if (participantList) {
      prefix += `Invited participants (may also speak): ${participantList}\n\n`;
    }
    if (adminEmail) {
      prefix += `Organizer / host account (may have a voice profile on file): ${adminEmail}\n\n`;
    }

    transcriptWithSpeakers =
      prefix +
      `[Voice profiles on file — use names only when transcript evidence supports it]\n` +
      voiceProfiles.map((vp) => `- ${String(vp.name || '').trim()} <${vp.email}>`).join('\n') +
      `\n\n` +
      speakerAttributionPreamble() +
      baseTranscript;
  } catch (speakerErr) {
    console.warn('⚠️  Error processing speaker identification:', speakerErr.message);
    transcriptWithSpeakers = speakerAttributionPreamble() + baseTranscript;
  }
  return transcriptWithSpeakers;
}

/**
 * Interview evaluation — same pipeline, different system prompt + JSON shape.
 */
async function generateInterviewMeetingSummaryFromTranscript(transcriptRaw, meetingObj, options = {}) {
  if (!openai) {
    throw new Error('OpenAI API key not configured');
  }

  const summaryChatModel = getSummaryChatModel();
  const detectedLanguage =
    String(options.detectedLanguage || '').trim().toLowerCase() || 'unknown';
  const transcriptTextTrim = String(transcriptRaw || '').trim();
  if (!transcriptTextTrim) {
    throw new Error('Stored transcript is empty');
  }

  const maxRetries = OPENAI_PIPELINE_MAX_RETRIES;
  const transcriptWithSpeakers = await buildTranscriptWithSpeakerHints(meetingObj, transcriptTextTrim);

  const interviewerEmails = [
    ...(Array.isArray(meetingObj.interviewInterviewerEmails)
      ? meetingObj.interviewInterviewerEmails
      : []),
    meetingObj.interviewInterviewerEmail,
  ]
    .map((e) => String(e || '').trim().toLowerCase())
    .filter(Boolean)
    .filter((e, i, arr) => arr.indexOf(e) === i);
  const interviewerLine = (() => {
    if (!interviewerEmails.length || !Array.isArray(meetingObj.participants)) return '';
    const names = interviewerEmails
      .map((email) => {
        const ip = meetingObj.participants.find(
          (p) => p && String(p.email || '').trim().toLowerCase() === email
        );
        if (!ip) return '';
        return String(ip.name || '').trim() || email.split('@')[0];
      })
      .filter(Boolean);
    if (!names.length) return '';
    return `Interviewer(s) (expected): ${names.join(', ')}`;
  })();

  const multiCandidates = Array.isArray(meetingObj.interviewCandidates)
    ? meetingObj.interviewCandidates
        .filter((c) => c && String(c.name || '').trim())
        .map((c) => {
          const n = String(c.name).trim();
          const r = String(c.role || '').trim();
          return r ? `- ${n} (${r})` : `- ${n}`;
        })
    : [];

  const candidateName = String(meetingObj.interviewCandidateName || '').trim();
  const role = String(meetingObj.interviewRole || '').trim();
  const hasAnyRoleHint =
    (role && role.length > 0) ||
    (Array.isArray(meetingObj.interviewCandidates) &&
      meetingObj.interviewCandidates.some((c) => c && String(c.role || '').trim()));

  const optionalContext = [
    interviewerLine,
    multiCandidates.length
      ? `Candidate(s) (hints only):\n${multiCandidates.join('\n')}`
      : candidateName && `Expected candidate name (hint only): ${candidateName}`,
    !multiCandidates.length && role && `Role / position (hint only): ${role}`,
    hasAnyRoleHint &&
      `Role as reference (critical): Use the role(s) above as the rubric for the interviewee’s answers. For each ` +
        `strength, concern, and signal, ask whether their answers demonstrate what this role requires. Cite ` +
        `transcript-backed examples and explain fit or gaps relative to that role—not a generic “good/bad” interview.`,
  ]
    .filter(Boolean)
    .join('\n');

  const meetingTitle = meetingObj.title || 'Interview';

  const interviewUser =
    `Analyze the following interview transcript. When the transcript includes clear role cues or speaker labels, ` +
    `prefer describing speakers as Interviewer vs Candidate when supported by the text; do not invent roles.\n` +
    (hasAnyRoleHint
      ? `When a role is listed above, treat it as the standard against which you interpret and evaluate the candidate’s answers.\n\n`
      : '') +
    `Hard grounding rule: every claim must be directly supported by transcript evidence. Do not infer personality, intent, ` +
    `or behavior from weak signals. If evidence is missing, explicitly state "Insufficient evidence from transcript".\n\n` +
    (optionalContext ? `${optionalContext}\n\n` : '') +
    `Calendar / booking title (may be generic; do not treat as the ground truth about topic): ${meetingTitle}\n\n` +
    `Detected primary transcription language: ${detectedLanguage}\n\n` +
    `Transcript:\n\n${transcriptWithSpeakers}\n\n` +
    buildInterviewUserJsonInstructions();

  let summaryResponse = null;
  let summaryError = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(
        `   Interview evaluation (attempt ${attempt}/${maxRetries})… model=${summaryChatModel}`
      );
      summaryResponse = await openai.chat.completions.create({
        model: summaryChatModel,
        messages: [
          { role: 'system', content: INTERVIEW_EVALUATION_SYSTEM_PROMPT },
          { role: 'user', content: interviewUser },
        ],
        temperature: 0.2,
        response_format: { type: 'json_object' },
      });
      break;
    } catch (apiError) {
      summaryError = apiError;
      const retryable = isRetryableOpenAiError(apiError);
      if (retryable && attempt < maxRetries) {
        const waitTime = Math.pow(2, attempt) * 1000;
        console.warn(
          `⚠️  OpenAI API error during interview summary (${apiError.status || apiError.code || 'unknown'}), retrying in ${waitTime / 1000}s...`
        );
        await new Promise((resolve) => setTimeout(resolve, waitTime));
        continue;
      }
      throw apiError;
    }
  }

  if (!summaryResponse) {
    throw summaryError || new Error('Interview summary generation failed after all retries');
  }

  const rawContent = summaryResponse.choices[0].message.content || '';
  let summaryData = tryParseModelJsonObject(rawContent);
  if (!rawContent.trim() || Object.keys(summaryData).length === 0) {
    console.warn('⚠️ Empty or unparseable interview JSON; applying safeguards.');
  }

  const normalized = normalizeInterviewJson(summaryData);
  const payload = mapInterviewToPipelinePayload(normalized);

  if (!summaryPayloadHasDisplayableContent(payload)) {
    applyTranscriptExcerptFallbackSummary(payload, transcriptTextTrim);
  }

  console.log('✅ Interview evaluation summary generated');

  return {
    transcription: transcriptTextTrim,
    summary: payload.summary || '',
    keyPoints: payload.keyPoints || [],
    actionItems: [],
    decisions: [],
    nextSteps: [],
    importantNotes: payload.importantNotes || [],
    hiringRecommendation: payload.hiringRecommendation || '',
    hiringRecommendationReason: payload.hiringRecommendationReason || '',
    evaluationSignals: payload.evaluationSignals || null,
  };
}

function extractGroundingKeywords(text) {
  const s = String(text || '');
  const stop = new Set([
    'the',
    'and',
    'for',
    'with',
    'that',
    'this',
    'from',
    'into',
    'your',
    'you',
    'are',
    'was',
    'were',
    'will',
    'can',
    'could',
    'should',
    'would',
    'may',
    'might',
    'have',
    'has',
    'had',
    'not',
    'but',
    'all',
    'any',
    'our',
    'their',
    'they',
    'them',
    'then',
    'than',
    'also',
    'just',
    'about',
    'only',
    'when',
    'where',
    'which',
    'what',
    'who',
    'how',
    'why',
    'get',
    'make',
    'make',
    'confirm',
    'next',
    'follow',
    'followup',
    'update',
    'please',
    'meeting',
    'minutes',
    'summary',
    'action',
    'actions',
    'decision',
    'decisions',
  ]);

  const words = (s.match(/[A-Za-z0-9]{4,}/g) || [])
    .map((w) => String(w).toLowerCase())
    .filter((w) => !stop.has(w));

  // keep unique, preserve order
  const out = [];
  const seen = new Set();
  for (const w of words) {
    if (!seen.has(w)) {
      out.push(w);
      seen.add(w);
    }
  }
  return out;
}

function isGroundedAgainstTranscript(itemText, transcriptLower) {
  const item = String(itemText || '').trim();
  if (!item) return false;
  const keywords = extractGroundingKeywords(item);
  // If we can't find meaningful keywords, don't aggressively filter.
  if (!keywords.length) return true;
  return keywords.some((k) => transcriptLower.includes(k));
}

function buildTranscriptCompactForGrounding(transcript) {
  return String(transcript || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

/**
 * Drop summary sentences that introduce quotes, script runs, or ideas with no support in the transcript.
 */
function isSentenceGroundedInTranscript(sentence, transcriptRaw) {
  const tRaw = String(transcriptRaw || '');
  const tLow = tRaw.toLowerCase();
  const sent = String(sentence || '').trim();
  if (!sent) return true;
  if (/^not specified\.?$/i.test(sent)) return true;

  const quoteRe = /["'`]([^"'`]{5,})["'`]/g;
  let qm;
  while ((qm = quoteRe.exec(sent)) !== null) {
    const inner = qm[1].trim().toLowerCase().replace(/\s+/g, ' ');
    if (inner && !tLow.includes(inner)) return false;
  }

  const devanagariRuns = sent.match(/[\u0900-\u097F]{3,}/g) || [];
  for (const run of devanagariRuns) {
    if (!tRaw.includes(run)) return false;
  }

  const transCompact = buildTranscriptCompactForGrounding(tRaw);
  const sentCompact = buildTranscriptCompactForGrounding(sent);
  if (sentCompact.length < 10) {
    const toks = sent.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) || [];
    return toks.some((tok) => tLow.includes(tok));
  }

  const win = 14;
  const step = 5;
  for (let i = 0; i + win <= sentCompact.length; i += step) {
    const chunk = sentCompact.slice(i, i + win);
    if (chunk.length >= 10 && transCompact.includes(chunk)) return true;
  }

  const longToks = sent.toLowerCase().match(/[\p{L}\p{N}]{7,}/gu) || [];
  return longToks.some((tok) => tLow.includes(tok));
}

function filterGroundedExecutiveSummary(summary, transcriptRaw) {
  const full = String(transcriptRaw || '').trim();
  if (!full) return String(summary || '').trim();
  const text = String(summary || '').trim();
  if (!text) return '';

  const parts = text.split(/\n\n+/);
  const keptParas = [];
  for (const para of parts) {
    const chunks = para.includes('\n')
      ? para.split(/\n+/).map((c) => c.trim()).filter(Boolean)
      : para.split(/(?<=[.!?…])\s+/).map((c) => c.trim()).filter(Boolean);
    const kept = chunks.filter((c) => isSentenceGroundedInTranscript(c, transcriptRaw));
    if (kept.length) keptParas.push(kept.join(' '));
  }
  return keptParas.join('\n\n').trim();
}

const MEANINGLESS_SUMMARY_TOKENS = new Set([
  'not specified',
  'not applicable',
  'n/a',
  'na',
  'none',
  '—',
  '-',
]);

function lineHasDisplayableMeaning(text) {
  const t = String(text || '').trim().toLowerCase();
  if (!t) return false;
  return !MEANINGLESS_SUMMARY_TOKENS.has(t);
}

/**
 * True if the user would see any structured summary content (matches client MeetingSummary hasContent intent).
 */
function summaryPayloadHasDisplayableContent(data) {
  if (!data) return false;
  if (lineHasDisplayableMeaning(data.summary)) return true;
  if ((data.keyPoints || []).some((k) => lineHasDisplayableMeaning(k))) return true;
  if ((data.decisions || []).some((d) => lineHasDisplayableMeaning(d))) return true;
  if ((data.nextSteps || []).some((s) => lineHasDisplayableMeaning(s))) return true;
  if ((data.importantNotes || []).some((n) => lineHasDisplayableMeaning(n))) return true;
  const items = data.actionItems || [];
  for (const a of items) {
    if (lineHasDisplayableMeaning(a && a.task)) return true;
    if (lineHasDisplayableMeaning(a && a.notes)) return true;
  }
  return false;
}

function deepCopySummaryPayload(data) {
  return {
    summary: typeof data.summary === 'string' ? data.summary : '',
    keyPoints: [...(data.keyPoints || [])],
    decisions: [...(data.decisions || [])],
    nextSteps: [...(data.nextSteps || [])],
    importantNotes: [...(data.importantNotes || [])],
    actionItems: (data.actionItems || []).map((a) => ({
      ...(a && typeof a === 'object' ? a : {}),
      task: a && a.task != null ? String(a.task) : '',
      assignee: a && a.assignee != null ? String(a.assignee) : '',
      dueDate: a && a.dueDate != null ? a.dueDate : null,
      notes: a && a.notes != null ? String(a.notes) : '',
    })),
  };
}

function tryParseModelJsonObject(raw) {
  const s = String(raw || '').trim();
  if (!s) return {};
  try {
    return JSON.parse(s);
  } catch (_) {
    const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) {
      try {
        return JSON.parse(fence[1].trim());
      } catch (_) {
        /* continue */
      }
    }
    const start = s.indexOf('{');
    const end = s.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(s.slice(start, end + 1));
      } catch (_) {
        /* continue */
      }
    }
  }
  return {};
}

function applyGroundingFiltersToSummaryData(summaryData, transcriptFull) {
  const transcriptLower = String(transcriptFull || '').toLowerCase();
  if (typeof summaryData.summary === 'string' && summaryData.summary.trim()) {
    const filtered = filterGroundedExecutiveSummary(summaryData.summary, transcriptFull);
    summaryData.summary = filtered.trim();
  }
  summaryData.keyPoints = (summaryData.keyPoints || []).filter((kp) =>
    isGroundedAgainstTranscript(kp, transcriptLower)
  );
  summaryData.decisions = (summaryData.decisions || []).filter((d) =>
    isGroundedAgainstTranscript(d, transcriptLower)
  );
  summaryData.nextSteps = (summaryData.nextSteps || []).filter((s) =>
    isGroundedAgainstTranscript(s, transcriptLower)
  );
  summaryData.importantNotes = (summaryData.importantNotes || []).filter((n) =>
    isGroundedAgainstTranscript(n, transcriptLower)
  );
  summaryData.actionItems = (summaryData.actionItems || []).filter((a) => {
    const task = a && a.task ? a.task : '';
    const notes = a && a.notes ? a.notes : '';
    return (
      isGroundedAgainstTranscript(task, transcriptLower) ||
      isGroundedAgainstTranscript(notes, transcriptLower)
    );
  });
}

function applyTranscriptExcerptFallbackSummary(summaryData, transcriptTextTrim) {
  const t = String(transcriptTextTrim || '').trim();
  if (!t) {
    summaryData.summary =
      String(summaryData.summary || '').trim() ||
      'Summary could not be generated and no transcript text was available.';
    return;
  }
  const max = Math.min(
    20000,
    Math.max(2000, parseInt(process.env.SUMMARY_FALLBACK_TRANSCRIPT_MAX_CHARS || '12000', 10) || 12000)
  );
  const excerpt = t.length > max ? `${t.slice(0, max)}\n\n[…]` : t;
  summaryData.summary = `Here is an excerpt of your meeting transcript:\n\n${excerpt}`;
}

/**
 * If grounding stripped everything the model produced, keep the model output (API succeeded — don't ship empty).
 * If the model truly returned nothing usable, surface transcript text so the user never hits a blank summary from our logic.
 */
function reconcileSummaryPayloadAfterGrounding(preFilter, summaryData, transcriptTextTrim, anchorRef) {
  if (summaryPayloadHasDisplayableContent(summaryData)) {
    return;
  }
  const t = String(transcriptTextTrim || '').trim();
  if (t) {
    console.warn(
      '⚠️ Grounding removed all displayable summary content; falling back to raw transcript excerpt (safer than ungrounded model text).'
    );
    applyTranscriptExcerptFallbackSummary(summaryData, transcriptTextTrim);
    summaryData.keyPoints = [];
    summaryData.decisions = [];
    summaryData.nextSteps = [];
    summaryData.importantNotes = [];
    summaryData.actionItems = [];
    return;
  }
  if (summaryPayloadHasDisplayableContent(preFilter)) {
    console.warn(
      '⚠️ Grounding filter removed all displayable summary content and no transcript text is available; using unfiltered model output (API response was non-empty).'
    );
    summaryData.summary = preFilter.summary;
    summaryData.keyPoints = [...preFilter.keyPoints];
    summaryData.decisions = [...preFilter.decisions];
    summaryData.nextSteps = [...preFilter.nextSteps];
    summaryData.importantNotes = [...preFilter.importantNotes];
    summaryData.actionItems = preFilter.actionItems.map((a) => ({ ...a }));
    summaryData.actionItems = enrichActionItemsWithDueDates(summaryData.actionItems, anchorRef, {
      keyPoints: summaryData.keyPoints,
      summary: summaryData.summary,
      nextSteps: summaryData.nextSteps,
    });
    return;
  }
  console.warn(
    '⚠️ Model returned no usable structured summary; using transcript excerpt so the meeting is not left empty.'
  );
  applyTranscriptExcerptFallbackSummary(summaryData, transcriptTextTrim);
}

/**
 * Generate structured summary from transcript text only (no Whisper).
 * Used when the recording file is missing on disk but the transcript is still in the database.
 */
async function generateMeetingSummaryFromTranscript(transcriptRaw, meeting, options = {}) {
  if (!openai) {
    throw new Error('OpenAI API key not configured');
  }

  const meetingObj =
    typeof meeting === 'string'
      ? { _id: null, title: meeting, participants: [] }
      : meeting;
  const meetingTitle = meetingObj.title || 'Meeting';

  let resolvedProductType = String(options.productType || '').trim().toLowerCase();
  if (!resolvedProductType && meetingObj.adminId) {
    try {
      const a = await Admin.findById(meetingObj.adminId).select('productType').lean();
      if (a && a.productType) resolvedProductType = String(a.productType).trim().toLowerCase();
    } catch (_) {
      /* ignore */
    }
  }
  const isEducation = resolvedProductType === 'education';
  const summaryChatModel = getSummaryChatModel();
  const detectedLanguage =
    String(options.detectedLanguage || '').trim().toLowerCase() || 'unknown';

  const transcriptTextTrim = String(transcriptRaw || '').trim();
  if (!transcriptTextTrim) {
    throw new Error('Stored transcript is empty');
  }

  const summaryMode = String(
    options.summaryMode || meetingObj.summaryMode || SUMMARY_MODES.STANDARD
  ).toLowerCase();
  if (summaryMode === SUMMARY_MODES.INTERVIEW) {
    return generateInterviewMeetingSummaryFromTranscript(transcriptRaw, meetingObj, options);
  }

  console.log(
    `📝 Generating summary from stored transcript (${transcriptTextTrim.length} chars; language hint: ${detectedLanguage})`
  );

  const maxRetries = OPENAI_PIPELINE_MAX_RETRIES;

  const transcriptWithSpeakers = await buildTranscriptWithSpeakerHints(meetingObj, transcriptTextTrim);

    let durationMinutes = null;
    if (meetingObj && meetingObj.startTime && meetingObj.endTime) {
      const start = new Date(meetingObj.startTime);
      const end = new Date(meetingObj.endTime);
      if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime()) && end > start) {
        durationMinutes = Math.max(1, Math.round((end.getTime() - start.getTime()) / 60000));
      }
    }

  const anchorRef =
    meetingObj && (meetingObj.endTime || meetingObj.scheduledTime || meetingObj.startTime)
      ? new Date(meetingObj.endTime || meetingObj.scheduledTime || meetingObj.startTime)
      : new Date();
  const anchorLocalYmd = anchorRef.toLocaleDateString('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const anchorTomorrow = new Date(
    anchorRef.getFullYear(),
    anchorRef.getMonth(),
    anchorRef.getDate() + 1,
    12,
    0,
    0,
    0
  );
  const anchorTomorrowYmd = anchorTomorrow.toLocaleDateString('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  const systemRole = isEducation
    ? 'You are an AI assistant producing high-fidelity lecture and discussion notes from a single live session. '
    : 'You are an AI meeting assistant for professional, high-fidelity minutes. ';

  const systemEducationFocus = isEducation
    ? 'This output is for teaching and learning outcomes: help teachers teach better and help students revise effectively. Preserve learning goals when stated, definitions and distinctions as spoken, examples walked through, lists or taxonomies the speaker used, formulas or steps if verbalized, caveats and misconceptions addressed, and questions raised by learners. '
    : '';

  const systemElaborationDepth = isEducation
    ? 'When the instructor explains a concept at length, keep the substance in the summary and key points—not a single vague line like "discussed X". '
    : '';

  const summarySchemaHint = isEducation
    ? '"summary": "Coherent English narrative (typically 8–16 sentences when the session is substantive). Cover what was actually taught: definitions, comparisons, examples. Scale length with the transcript—not with the calendar title.",'
    : '"summary": "Clear executive summary in English (typically 6–12 sentences; add more only if the transcript is long). Every claim must be grounded in what was spoken—never in the calendar title.",';

  const keyPointsSchemaHint = isEducation
    ? '"keyPoints": ["Concrete, review-friendly bullets tied to the transcript; split long explanations across multiple bullets when needed"],'
    : '"keyPoints": ["Concrete point 1 with specifics from the transcript", "Concrete point 2 with specifics"],';

  const userElaborationRules = isEducation
    ? `- When an explanation was long, split across several key points so definitions and examples stay clear.\n` +
      `- Put nuances or clarified misunderstandings in importantNotes when they do not fit a crisp key point.\n`
    : '';

  const userEducationRules = isEducation
    ? `- Education mode: structure bullets like study notes where the transcript supports it (e.g. types of X, steps, criteria).\n` +
      `- If the instructor named terms, keep those terms and the gist of each definition as stated.\n` +
      `- If assignments, presentations, quizzes, homework, submissions, or project work are mentioned, ensure they appear as concrete action items with due dates when stated.\n` +
      `- Keep wording classroom-friendly and instructional, not corporate.\n`
    : '';

    let summaryResponse = null;
    let summaryError = null;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
      console.log(
        `   Generating summary (attempt ${attempt}/${maxRetries})… model=${summaryChatModel} mode=${isEducation ? 'education' : 'workplace'}`
      );
        summaryResponse = await openai.chat.completions.create({
        model: summaryChatModel,
          messages: [
        {
          role: 'system',
          content:
              systemRole +
              systemEducationFocus +
              systemElaborationDepth +
              'The transcript may contain multiple languages including English, Hindi, Gujarati, and Hinglish. ' +
            'Accurately understand all languages present, but provide your output only in professional English. ' +
              'HALLUCINATION GUARD: Never fabricate quotes, translations, or foreign-language phrases that do not appear in the transcript. If you paraphrase non-English speech, stay tightly tied to words that are actually there. ' +
              'Prioritize completeness over brevity: include every relevant discussion point, decision, risk, and commitment. ' +
              (isEducation
                ? 'Use clear teaching-friendly language; do not invent facts or examples not grounded in the transcript. '
                : 'Use professional business language, do not invent information, and only include decisions or actions that are clearly mentioned. ') +
              'NEVER infer the subject of the meeting from the calendar/booking title—titles are often placeholders (e.g. "Test", "Retest", "Quick call"). Substance must come only from the transcript. ' +
              'Output must follow the requested JSON structure only. ' +
            'CRITICAL: Base your summary ONLY on the current transcript. Do NOT bring in information or topics from any past meetings. ' +
              'The executive summary must capture ALL the major themes of the session ' +
              (isEducation
                ? '(topics taught, concepts compared, practice discussed, open questions). '
                : '(projects, planning, issues, risks, feedback, next steps). ') +
              'Highlight the most important concrete points such as names, topics, numbers, and deadlines. ' +
              'SPEAKER ATTRIBUTION: The executive summary narrative must attribute dialogue and positions to speakers whenever possible, using bracketed labels like [Alex Kim]: … or [Unidentified speaker]: … when identity is unclear. ' +
              'Use configured / roster names only when the transcript clearly supports that person saying it; otherwise [Unidentified speaker]. Never omit speaker context for attributed claims.',
        },
        {
          role: 'user',
          content:
            `Analyze the following SINGLE meeting transcript and generate a structured summary strictly about this meeting only.\n\n` +
              `Calendar / booking title (may be wrong or unrelated—do NOT treat as agenda or topic): ${meetingTitle}\n\n` +
              `Meeting time anchor (use for relative deadlines; local calendar dates are in the server timezone): ` +
              `ISO ${anchorRef.toISOString()} · "today/tonight/this evening/EOD" → dueDate ${anchorLocalYmd} · "tomorrow" → ${anchorTomorrowYmd}.\n\n` +
              `Detected primary transcription language: ${detectedLanguage}\n\n` +
            (durationMinutes
              ? `Approximate meeting duration: ${durationMinutes} minutes.\n\n`
              : '') +
            (meetingObj.participants && meetingObj.participants.length > 0
                ? `IMPORTANT: The following people are expected participants (some may be unnamed or guests). When names appear in the transcript, prefer the spellings below when they match:\n` +
                  formatParticipantLinesForSummaryPrompt(meetingObj.participants) +
                  `\n\nEnsure names in the summary and action items match the transcript; do not invent people who did not speak.\n\n`
              : '') +
            `Transcript:\n\n${transcriptWithSpeakers}\n\n` +
            `Follow these rules strictly:\n` +
            `- Focus ONLY on what is actually discussed in this transcript.\n` +
              `- Do NOT invent themes from the calendar title. If the title is generic but the audio is about travel, family, logistics, health, etc., write about what was spoken.\n` +
            `- Do NOT talk about the AI or summarization itself unless it is explicitly discussed.\n` +
            `- The executive summary must cover the full picture of the meeting: why it was held, what was discussed across all topics, key concerns, and overall outcome.\n` +
              `- Coverage is mandatory: include ALL relevant points that materially affect outcomes, responsibilities, risks, timelines, or scope.\n` +
              `- Do not collapse multiple distinct points into a vague sentence; keep distinct points separate and explicit.\n` +
              `- Avoid generic filler like "align on next steps", "confirm preparations", or "follow up" unless that wording/commitment exists in the transcript.\n` +
            `- Explicitly mention important specifics such as names, topics, projects, events, numbers, dates, and deadlines when they are clearly mentioned.\n` +
              userElaborationRules +
              userEducationRules +
              `- CRITICAL: Every key point MUST start with a bracketed speaker label, then a colon and space: "[Speaker Name]: …" or "[Unidentified speaker]: …" or "[Speaker 1]: …". Use roster or voice-profile names only when the transcript clearly supports that speaker; never invent names. Do not emit a key point without a speaker prefix.\n` +
              `- Executive summary: write in full sentences; when stating who said or decided something, use the same bracketed speaker labels.\n` +
            `- In actionItems, each task must be a specific, actionable task tied to what people actually said (no generic or invented tasks). Include the assignee name if mentioned.\n` +
              `- If there are no explicit action items in the transcript, set actionItems to []. Do not infer.\n` +
              `- For actionItems, set dueDate to YYYY-MM-DD only when a calendar deadline is clearly tied to THAT specific task.\n` +
              `- Map relative language using the meeting anchor above: "tonight", "today", "this evening", "EOD", "by end of day", Romanized Hindi/Hinglish like "aaj raat", "aaj sham/shaam" → ${anchorLocalYmd}. "tomorrow" / "kal" (when meaning next day) → ${anchorTomorrowYmd}.\n` +
              `- For absolute phrases ("24 March", "March 24th") use the meeting anchor year if the year is unstated. If no deadline is stated for that task ("soon", "ASAP" alone), use null.\n` +
              `- Never copy unrelated dates from examples, statistics, or other topics into an action item's dueDate.\n` +
              `- In decisions, include who made or proposed the decision only when identifiable. If there are no explicit decisions, set decisions to []. Do not infer.\n` +
              `- In nextSteps, include concrete follow-ups that logically continue from explicit next actions in the transcript. If none exist, set nextSteps to []. Do not infer.\n` +
              `- In importantNotes, include risks, blockers, dependencies, unresolved questions, and critical assumptions if discussed. If none exist, set importantNotes to []. Do not infer.\n` +
            `- Do not hallucinate information that was not discussed.\n` +
            `- Only include decisions or actions that are clearly mentioned.\n` +
            `- If a section has no information, set it to "Not specified".\n` +
            `- When participant names are mentioned in the transcript, use them to attribute statements. Match names from the participant list provided.\n\n` +
            `Return ONLY a JSON object with the following structure:\n` +
            `{\n` +
              `  ${summarySchemaHint}\n` +
              `  ${keyPointsSchemaHint}\n` +
            `  "actionItems": [\n` +
              `    {"task": "task description", "assignee": "person name if mentioned", "dueDate": "YYYY-MM-DD or null", "notes": "extra detail if needed"}\n` +
            `  ],\n` +
              `  "decisions": ["Decision 1 (with owner/context when known)", "Decision 2"],\n` +
              `  "nextSteps": ["Specific follow-up 1", "Specific follow-up 2"],\n` +
              `  "importantNotes": ["Risk/blocker/assumption/open-question 1", "item 2"]\n` +
              `}`,
          },
        ],
        temperature: 0.1,
        response_format: { type: 'json_object' },
        });
        console.log('✅ Summary generation completed successfully');
      break;
      } catch (apiError) {
        summaryError = apiError;
      const retryable = isRetryableOpenAiError(apiError);
        
      if (retryable && attempt < maxRetries) {
          const waitTime = Math.pow(2, attempt) * 1000;
        console.warn(
          `⚠️  OpenAI API error during summary (${apiError.status || apiError.code || 'unknown'}), retrying in ${waitTime / 1000}s...`
        );
        await new Promise((resolve) => setTimeout(resolve, waitTime));
          continue;
        } else {
          throw apiError;
        }
      }
    }
    
    if (!summaryResponse) {
      throw summaryError || new Error('Summary generation failed after all retries');
    }

  const rawContent = summaryResponse.choices[0].message.content || '';
  let summaryData = tryParseModelJsonObject(rawContent);
  if (!rawContent.trim() || Object.keys(summaryData).length === 0) {
    console.warn('⚠️ Empty or unparseable model JSON; applying transcript safeguards.');
  }

    if (typeof summaryData.summary !== 'string') summaryData.summary = '';
    if (!Array.isArray(summaryData.keyPoints)) summaryData.keyPoints = [];
    if (!Array.isArray(summaryData.actionItems)) summaryData.actionItems = [];
    if (!Array.isArray(summaryData.decisions)) summaryData.decisions = [];
    if (!Array.isArray(summaryData.nextSteps)) summaryData.nextSteps = [];
    if (!Array.isArray(summaryData.importantNotes)) summaryData.importantNotes = [];

  const preFilter = deepCopySummaryPayload(summaryData);
  applyGroundingFiltersToSummaryData(summaryData, transcriptTextTrim);

  summaryData.actionItems = enrichActionItemsWithDueDates(
    summaryData.actionItems,
    anchorRef,
    {
      keyPoints: summaryData.keyPoints,
      summary: summaryData.summary,
      nextSteps: summaryData.nextSteps,
    }
  );

  reconcileSummaryPayloadAfterGrounding(preFilter, summaryData, transcriptTextTrim, anchorRef);

  if (!summaryPayloadHasDisplayableContent(summaryData)) {
    applyTranscriptExcerptFallbackSummary(summaryData, transcriptTextTrim);
  }

  console.log('✅ Summary generated (from stored transcript)');

    return {
    transcription: transcriptTextTrim,
      summary: summaryData.summary || '',
      keyPoints: summaryData.keyPoints || [],
      actionItems: summaryData.actionItems || [],
      decisions: summaryData.decisions || [],
      nextSteps: summaryData.nextSteps || [],
    importantNotes: summaryData.importantNotes || [],
    hiringRecommendation: '',
    hiringRecommendationReason: '',
    evaluationSignals: null,
  };
}

/**
 * Emails that may have VoiceProfile rows (same logic as buildTranscriptWithSpeakerHints).
 */
async function getVoiceLookupEmailsForMeeting(meetingObj) {
  if (!meetingObj) return [];
  const participantEmails = (meetingObj.participants || [])
    .filter((p) => p && isValidEmailForLookup(p.email))
    .map((p) => p.email.trim().toLowerCase());
  const candidateVoiceEmails = Array.isArray(meetingObj.interviewCandidates)
    ? meetingObj.interviewCandidates
        .map((c) => (c && c.voiceEmail ? String(c.voiceEmail).trim().toLowerCase() : ''))
        .filter((e) => isValidEmailForLookup(e))
    : [];
  let adminEmail = '';
  if (meetingObj.adminId) {
    try {
      const adm = await Admin.findById(meetingObj.adminId).select('email').lean();
      if (adm && adm.email && isValidEmailForLookup(adm.email)) {
        adminEmail = String(adm.email).trim().toLowerCase();
      }
    } catch (_) {
      /* ignore */
    }
  }
  return [...new Set([...participantEmails, ...candidateVoiceEmails, ...(adminEmail ? [adminEmail] : [])])];
}

function normalizeWhisperSegments(segments) {
  if (!Array.isArray(segments)) return [];
  return segments
    .map((s) => ({
      start: Number(s && s.start) || 0,
      end: Number(s && s.end) || 0,
      text: s && s.text != null ? String(s.text).trim() : '',
    }))
    .filter((s) => s.end > s.start && s.text.length > 0);
}

/**
 * Merge Whisper segments into ~10–45s buckets; cap total buckets for long meetings.
 */
function coalesceSegmentsForVoiceAttribution(segments, opts = {}) {
  const MIN_DUR = opts.minDurSec != null ? opts.minDurSec : 10;
  const MAX_BUCKETS = opts.maxBuckets != null ? opts.maxBuckets : 90;
  let buckets = [];
  let cur = null;

  for (const seg of segments) {
    const dur = seg.end - seg.start;
    if (dur <= 0) continue;
    if (!cur) {
      cur = { start: seg.start, end: seg.end, texts: [seg.text] };
    } else {
      cur.end = seg.end;
      cur.texts.push(seg.text);
    }
    if (cur.end - cur.start >= MIN_DUR) {
      buckets.push(cur);
      cur = null;
    }
  }
  if (cur && cur.end > cur.start) buckets.push(cur);

  while (buckets.length > MAX_BUCKETS) {
    const merged = [];
    for (let i = 0; i < buckets.length; i += 2) {
      if (i + 1 < buckets.length) {
        merged.push({
          start: buckets[i].start,
          end: buckets[i + 1].end,
          texts: [...buckets[i].texts, ...buckets[i + 1].texts],
        });
      } else {
        merged.push(buckets[i]);
      }
    }
    buckets = merged;
  }
  return buckets;
}

function extractAudioSegmentWav(inputPath, startSec, durationSec, outPath) {
  execFileSync(
    'ffmpeg',
    [
      '-nostdin',
      '-y',
      '-ss',
      String(startSec),
      '-i',
      inputPath,
      '-t',
      String(durationSec),
      '-ac',
      '1',
      '-ar',
      '16000',
      '-vn',
      outPath,
    ],
    { stdio: ['ignore', 'ignore', 'pipe'], maxBuffer: 25 * 1024 * 1024, timeout: 180000 }
  );
}

/**
 * Build a bracketed timeline from audio + identifySpeaker (session centroids learn across chunks).
 */
async function buildVoiceAttributedEvidenceTranscript(meetingObj, audioPath, segments) {
  const norm = normalizeWhisperSegments(segments);
  if (!norm.length || !meetingObj || !audioPath || !fs.existsSync(audioPath)) return null;

  const emails = await getVoiceLookupEmailsForMeeting(meetingObj);
  if (emails.length === 0) return null;

  const voiceProfiles = await VoiceProfile.find({ email: { $in: emails } });
  if (!voiceProfiles.length) return null;

  const buckets = coalesceSegmentsForVoiceAttribution(norm);
  if (!buckets.length) return null;

  const sessionContext = {
    lastEmbedding: null,
    lastEmail: null,
    lastEmbeddingKind: null,
    centroids: new Map(),
  };

  const lines = [];
  for (let i = 0; i < buckets.length; i++) {
    const b = buckets[i];
    const dur = b.end - b.start;
    if (dur < 0.4) continue;

    const tmpWav = path.join(
      os.tmpdir(),
      `portiq_voice_ev_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 9)}.wav`
    );
    try {
      extractAudioSegmentWav(audioPath, b.start, dur, tmpWav);
    } catch (e) {
      console.warn('⚠️ Voice evidence: ffmpeg segment failed:', e.message || e);
      continue;
    }

    let label = '[Unidentified speaker]';
    try {
      const match = await identifySpeaker(tmpWav, voiceProfiles, sessionContext);
      if (match && match.profile) {
        const nm = String(match.profile.name || '').trim() || match.profile.email;
        label = `[${nm}]`;
      }
    } catch (e) {
      console.warn('⚠️ Voice evidence: identifySpeaker failed:', e.message || e);
    } finally {
      try {
        if (fs.existsSync(tmpWav)) fs.unlinkSync(tmpWav);
      } catch (_) {
        /* ignore */
      }
    }

    const chunkText = b.texts.join(' ').replace(/\s+/g, ' ').trim();
    if (chunkText) {
      lines.push(`${label} (${b.start.toFixed(1)}s–${b.end.toFixed(1)}s): ${chunkText}`);
    }
  }

  if (!lines.length) return null;
  return {
    transcript: `[Voice timeline from recording — use to fix speaker labels where content aligns]\n${lines.join('\n')}`,
    lines: lines.length,
  };
}

function truncateVoiceEvidenceForPrompt(text, maxChars) {
  const t = String(text || '');
  const cap = maxChars || 14000;
  if (t.length <= cap) return t;
  const half = Math.floor((cap - 80) / 2);
  return `${t.slice(0, half)}\n\n[... omitted middle of voice timeline ...]\n\n${t.slice(-half)}`;
}

/**
 * Second pass: reconcile structured summary with voice-backed timeline (higher-confidence names).
 */
async function reauditStructuredSummaryWithVoice(summaryResult, voiceEvidenceTranscript, meetingObj, anchorRef, transcriptTextTrim) {
  if (!openai || !summaryResult || !voiceEvidenceTranscript) return summaryResult;

  const summaryChatModel = getSummaryChatModel();
  const meetingTitle = meetingObj.title || 'Meeting';

  let enrolledProfiles = [];
  try {
    const em = await getVoiceLookupEmailsForMeeting(meetingObj);
    if (em.length) {
      enrolledProfiles = await VoiceProfile.find({ email: { $in: em } }).select('name email').lean();
    }
  } catch (e) {
    console.warn('⚠️ Voice re-audit: could not load enrolled profiles:', e.message || e);
  }
  const enrolledRosterLine =
    enrolledProfiles.length > 0
      ? enrolledProfiles
          .map((p) => `${String(p.name || '').trim() || p.email} <${p.email}>`)
          .join('; ')
      : 'None';
  const singleEnrolledDisplayName =
    enrolledProfiles.length === 1
      ? String(enrolledProfiles[0].name || '').trim() || enrolledProfiles[0].email
      : null;

  const labelMatches = String(voiceEvidenceTranscript || '').match(/\[(.+?)\]/g) || [];
  const rawLabels = labelMatches
    .map((m) => m.replace(/^\[|\]$/g, '').trim())
    .filter(
      (lab) =>
        lab &&
        !/^unidentified speaker$/i.test(lab) &&
        !/^(speaker\s*\d+)$/i.test(lab)
    );
  const uniqueLabels = [...new Set(rawLabels)];
  const singleVoiceName = uniqueLabels.length === 1 ? uniqueLabels[0] : null;
  const payload = JSON.stringify({
    summary: summaryResult.summary || '',
    keyPoints: summaryResult.keyPoints || [],
    actionItems: summaryResult.actionItems || [],
    decisions: summaryResult.decisions || [],
    nextSteps: summaryResult.nextSteps || [],
    importantNotes: summaryResult.importantNotes || [],
  });

  const evidence = truncateVoiceEvidenceForPrompt(voiceEvidenceTranscript, 14000);

  const userContent =
    `You reconcile speaker labels in a meeting summary using:\n` +
    `(1) FIRST-PASS structured JSON from the transcript, and\n` +
    `(2) a VOICE TIMELINE from the same recording (biometric matches; same order as the meeting).\n\n` +
    `Enrolled voice profiles (recorded samples in our system — prefer these names when fixing labels): ${enrolledRosterLine}\n\n` +
    `Rules:\n` +
    `- Use the voice timeline to replace [Unidentified speaker] or generic labels with a real [Name] ONLY when the summary point could plausibly come from that time range and the name is in the voice timeline or participant roster.\n` +
    `- If EXACTLY ONE enrolled profile exists above and the voice timeline is mostly [Unidentified speaker] due to low volume or noise, still replace [Unidentified speaker] in the summary with [that person's exact name] when the meeting is clearly a single-speaker or primary-host scenario — do not leave [Unidentified speaker] when one enrolled speaker is the only plausible voice source.\n` +
    `- If multiple enrolled profiles exist, do not guess from enrollment alone; use the voice timeline and transcript content.\n` +
    `- If voice says [Unidentified speaker] for a span, you may still replace it when the single-enrolled rule above applies; otherwise keep Unidentified unless the transcript alone identifies the speaker.\n` +
    `- Do NOT invent facts, decisions, quotes, or tasks. Do NOT add new content.\n` +
    `- Only adjust speaker prefixes / light grammar to match label changes.\n` +
    `- If unsure (multiple plausible live speakers with no timeline signal), keep the original speaker label.\n\n` +
    `Meeting title (calendar; may be wrong): ${meetingTitle}\n\n` +
    `FIRST-PASS JSON:\n${payload}\n\n` +
    `VOICE TIMELINE:\n${evidence}\n\n` +
    `Return ONLY valid JSON with keys: summary, keyPoints, actionItems, decisions, nextSteps, importantNotes. Same types as input.`;

  const response = await openai.chat.completions.create({
    model: summaryChatModel,
    messages: [
      {
        role: 'system',
        content:
          'You output only valid JSON objects. Preserve array shapes. Never use markdown fences.',
      },
      { role: 'user', content: userContent },
    ],
    temperature: 0.1,
    response_format: { type: 'json_object' },
  });

  const raw = response.choices[0].message.content || '';
  const parsed = tryParseModelJsonObject(raw);
  if (!parsed || typeof parsed.summary !== 'string') {
    console.warn('⚠️ Voice re-audit: could not parse model JSON; keeping first-pass summary.');
    return summaryResult;
  }

  const out = {
    ...summaryResult,
    summary: parsed.summary,
    keyPoints: Array.isArray(parsed.keyPoints) ? parsed.keyPoints : summaryResult.keyPoints,
    actionItems: Array.isArray(parsed.actionItems) ? parsed.actionItems : summaryResult.actionItems,
    decisions: Array.isArray(parsed.decisions) ? parsed.decisions : summaryResult.decisions,
    nextSteps: Array.isArray(parsed.nextSteps) ? parsed.nextSteps : summaryResult.nextSteps,
    importantNotes: Array.isArray(parsed.importantNotes) ? parsed.importantNotes : summaryResult.importantNotes,
  };

  // Deterministic single-voice fallback: if the voice timeline only ever shows ONE
  // concrete name label, aggressively replace generic/unidentified prefixes with it.
  if (singleVoiceName) {
    const label = `[${singleVoiceName}]`;
    const replaceLabel = (s) =>
      typeof s === 'string'
        ? s
            .replace(/\[Unidentified speaker\]/gi, label)
            .replace(/\[Speaker\s*1\]/gi, label)
            .replace(/\[Speaker\s*2\]/gi, label)
        : s;

    out.summary = replaceLabel(out.summary);
    out.keyPoints = (out.keyPoints || []).map((kp) => replaceLabel(kp));
    out.decisions = (out.decisions || []).map((d) => replaceLabel(d));
    out.nextSteps = (out.nextSteps || []).map((n) => replaceLabel(n));
    out.importantNotes = (out.importantNotes || []).map((n) => replaceLabel(n));
    out.actionItems = (out.actionItems || []).map((ai) => ({
      ...ai,
      task: replaceLabel(ai.task),
      notes: replaceLabel(ai.notes),
    }));
  } else if (singleEnrolledDisplayName) {
    // Timeline had 0 or 2+ distinct concrete names (often all [Unidentified speaker] when mic is low),
    // but exactly one VoiceProfile exists for this meeting — map generic labels to that person.
    const label = `[${singleEnrolledDisplayName}]`;
    const replaceLabel = (s) =>
      typeof s === 'string'
        ? s
            .replace(/\[Unidentified speaker\]/gi, label)
            .replace(/\[Speaker\s*1\]/gi, label)
            .replace(/\[Speaker\s*2\]/gi, label)
        : s;

    out.summary = replaceLabel(out.summary);
    out.keyPoints = (out.keyPoints || []).map((kp) => replaceLabel(kp));
    out.decisions = (out.decisions || []).map((d) => replaceLabel(d));
    out.nextSteps = (out.nextSteps || []).map((n) => replaceLabel(n));
    out.importantNotes = (out.importantNotes || []).map((n) => replaceLabel(n));
    out.actionItems = (out.actionItems || []).map((ai) => ({
      ...ai,
      task: replaceLabel(ai.task),
      notes: replaceLabel(ai.notes),
    }));
  }

  const tTrim = String(transcriptTextTrim || '').trim();
  out.actionItems = enrichActionItemsWithDueDates(out.actionItems, anchorRef, {
    keyPoints: out.keyPoints,
    summary: out.summary,
    nextSteps: out.nextSteps,
  });

  if (tTrim) {
    const preFilter = deepCopySummaryPayload(out);
    applyGroundingFiltersToSummaryData(out, tTrim);
    reconcileSummaryPayloadAfterGrounding(preFilter, out, tTrim, anchorRef);
    if (!summaryPayloadHasDisplayableContent(out)) {
      applyTranscriptExcerptFallbackSummary(out, tTrim);
    }
  }

  console.log('✅ Voice re-audit pass applied to structured summary');
  return out;
}

/**
 * Transcribe audio file and generate meeting summary
 * NOTE: This version is intentionally STRICT to the current meeting only.
 * It does NOT use any past-meeting \"learning\" context so it stays on-point.
 * @param {string} audioFilePath
 * @param {object|string} meeting - meeting doc or legacy title string
 * @param {{ productType?: string }} [options] - e.g. { productType: 'education' } from Admin
 */
async function transcribeAndSummarize(audioFilePath, meeting, options = {}) {
  if (!openai) {
    throw new Error('OpenAI API key not configured');
  }

  if (!fs.existsSync(audioFilePath)) {
    throw new Error('Audio file not found');
  }

  // Handle both old signature (audioFilePath, meetingTitle) and new (audioFilePath, meeting object)
  const meetingObj = typeof meeting === 'string' 
    ? { _id: null, title: meeting, participants: [] }
    : meeting;
  const meetingTitle = meetingObj.title || 'Meeting';

  // Prompt style: ONLY productType matters — not plan tier (Starter/Professional/Business).
  // All workplace tiers share the same meeting-minutes prompt; education accounts get lecture-style prompts.
  let resolvedProductType = String(options.productType || '').trim().toLowerCase();
  if (!resolvedProductType && meetingObj.adminId) {
    try {
      const a = await Admin.findById(meetingObj.adminId).select('productType').lean();
      if (a && a.productType) resolvedProductType = String(a.productType).trim().toLowerCase();
    } catch (_) {
      /* ignore */
    }
  }
  const isEducation = resolvedProductType === 'education';

  const summaryChatModel = getSummaryChatModel();

  let whisperTempPaths = [];

  try {
    // Validate file before processing
    const stats = fs.statSync(audioFilePath);
    const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(2);
    console.log(`🎙️  Starting transcription...`);
    console.log(`   File: ${audioFilePath}`);
    console.log(`   Size: ${fileSizeMB} MB`);
    if (stats.size > WHISPER_MAX_BYTES) {
      console.log(`   File exceeds Whisper ${WHISPER_MAX_BYTES / (1024 * 1024)} MB limit — will compress when ffmpeg is available`);
    }

    if (stats.size === 0) {
      throw new Error('Audio file is empty (0 bytes)');
    }

    mirrorMeetingAudioToPersistentDir(audioFilePath);

    const ensured = await ensureWhisperSizedAudio(audioFilePath, ffmpeg);
    const finalAudioPath = ensured.path;
    whisperTempPaths = Array.isArray(ensured.pathsToCleanup) ? ensured.pathsToCleanup : [];

    // Retry logic for OpenAI API calls (transient 5xx / rate limit / network)
    const maxRetries = OPENAI_PIPELINE_MAX_RETRIES;
    let transcription = null;
    let lastError = null;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`   Attempt ${attempt}/${maxRetries}...`);
        
        // Step 1: Transcribe audio (multilingual: English, Hindi, Gujarati, etc.)
        // We keep language auto-detect on purpose, but pass vocabulary hints so names and
        // domain words are less likely to be mangled.
        const participantNames = safeListParticipantNames(meetingObj.participants);
        const vocabularyHint = [
          // Keep transcription prompt neutral so it doesn't bias decoding toward a
          // specific domain (e.g. business vs academic lecture/definitions).
          'Accurate transcription only. Do not paraphrase or correct meaning. Preserve domain terms and abbreviations like MAE.',
          // Never inject the calendar title here—short names like "Test" / "Retest" prime the model
          // to mis-hear unrelated speech (e.g. travel, family) as those words.
          'Transcribe only what is spoken. Do not infer wording from any meeting name or calendar title.',
          String(meetingObj.summaryMode || '').toLowerCase() === 'interview'
            ? 'Interview context: when roles are clear from speech, prefer accurate wording for interviewer and candidate.'
            : '',
          participantNames.length
            ? `Participant names (spell as heard; hints only): ${participantNames.join(', ')}.`
            : '',
          'Preserve numbers, deadlines, action items, and proper nouns accurately.',
        ]
          .filter(Boolean)
          .join(' ');
        transcription = await openai.audio.transcriptions.create({
          file: fs.createReadStream(finalAudioPath),
          model: process.env.OPENAI_TRANSCRIPTION_MODEL || 'whisper-1',
          // Keep language undefined for mixed-language meetings; the model auto-detects.
          prompt: vocabularyHint,
          temperature: 0,
          response_format: 'verbose_json',
          timestamp_granularities: ['segment'],
        });
        
        console.log('✅ Transcription completed successfully');
        break; // Success, exit retry loop
      } catch (apiError) {
        lastError = apiError;
        const retryable = isRetryableOpenAiError(apiError);
        
        if (retryable && attempt < maxRetries) {
          const waitTime = Math.pow(2, attempt) * 1000; // Exponential backoff: 2s, 4s, 8s
          console.warn(
            `⚠️  OpenAI API error (${apiError.status || apiError.code || 'unknown'}), retrying in ${waitTime / 1000}s...`
          );
          await new Promise((resolve) => setTimeout(resolve, waitTime));
          continue;
        } else {
          throw apiError;
        }
      }
    }
    
    if (!transcription) {
      throw lastError || new Error('Transcription failed after all retries');
    }

    let transcriptText = transcription.text;
    const detectedLanguage =
      (transcription && transcription.language && String(transcription.language).toLowerCase()) || 'unknown';
    
    if (!transcriptText || transcriptText.trim().length === 0) {
      throw new Error('Transcription returned empty text - audio may be silent or corrupted');
    }
    
    console.log(`✅ Transcription text length: ${transcriptText.length} characters`);
    console.log(`✅ Detected transcription language: ${detectedLanguage}`);

    await checkpointTranscriptionToDb(meetingObj._id, transcriptText);

    let summaryResult;
    const maxSummaryAttempts = 3;
    for (let sumAttempt = 1; sumAttempt <= maxSummaryAttempts; sumAttempt++) {
      try {
        summaryResult = await generateMeetingSummaryFromTranscript(transcriptText, meetingObj, {
          ...options,
          detectedLanguage,
        });
        break;
      } catch (sumErr) {
        if (sumAttempt >= maxSummaryAttempts) {
          throw sumErr;
        }
        const retryable = isRetryableOpenAiError(sumErr);
        if (!retryable && sumAttempt >= 2) {
          throw sumErr;
        }
        const waitTime = retryable ? Math.pow(2, sumAttempt) * 1000 : 2000;
        console.warn(
          `⚠️ Summarization failed (${sumErr.status || sumErr.code || 'unknown'}); attempt ${sumAttempt}/${maxSummaryAttempts}, waiting ${waitTime / 1000}s:`,
          sumErr.message
        );
        await new Promise((r) => setTimeout(r, waitTime));
      }
    }

    const summaryMode = String(meetingObj.summaryMode || SUMMARY_MODES.STANDARD || '').toLowerCase();
    const reauditOn = String(process.env.VOICE_REAUDIT_ENABLED || 'true').toLowerCase() !== 'false';

    if (
      reauditOn &&
      summaryResult &&
      summaryMode !== 'interview' &&
      transcription &&
      Array.isArray(transcription.segments) &&
      transcription.segments.length > 0
    ) {
      const anchorRef =
        meetingObj && (meetingObj.endTime || meetingObj.scheduledTime || meetingObj.startTime)
          ? new Date(meetingObj.endTime || meetingObj.scheduledTime || meetingObj.startTime)
          : new Date();
      try {
        const ev = await buildVoiceAttributedEvidenceTranscript(
          meetingObj,
          finalAudioPath,
          transcription.segments
        );
        if (ev && ev.transcript && ev.transcript.length > 400) {
          console.log(
            `🔄 Voice re-audit: ${ev.lines} timeline chunks, ${ev.transcript.length} chars evidence`
          );
          summaryResult = await reauditStructuredSummaryWithVoice(
            summaryResult,
            ev.transcript,
            meetingObj,
            anchorRef,
            transcriptText
          );
        }
      } catch (reauditErr) {
        console.warn('⚠️ Voice re-audit skipped:', reauditErr.message || reauditErr);
      }
    }

    return summaryResult;
  } catch (error) {
    console.error('❌ Transcription error:', error);
    console.error('   Error status:', error.status);
    console.error('   Error message:', error.message);
    console.error('   Error type:', error.type);
    
    const wrap = (message) => {
      const e = new Error(message);
      if (error && typeof error === 'object') {
        if (error.status != null) e.status = error.status;
        if (error.code) e.code = error.code;
        if (error.type) e.type = error.type;
      }
      return e;
    };

    // User-safe copy: classify downstream from `status` / message; avoid blaming the account holder for provider or config issues.
    if (error.status === 500 || error.status === 502 || error.status === 503) {
      throw wrap(
        'Our AI provider returned a temporary error. Please try again in a few minutes.'
      );
    }
    if (error.status === 401) {
      throw wrap('Summary generation is not available right now. Please try again later or contact support.');
    }
    if (error.status === 429) {
      throw wrap('Our AI provider is busy (rate limited). Please wait a moment and try again.');
    }
    if (error.status === 413) {
      throw wrap(
        'The audio is still too large for our transcription provider after compression. Try a shorter recording or split the meeting.'
      );
    }
    const msg = String((error && error.message) || '');
    const code = error && error.code;

    if (code === 'FFMPEG_REQUIRED' || code === 'AUDIO_TOO_LARGE') {
      throw wrap(msg);
    }

    if (
      msg &&
      /invalid file format|could not open|invalid data found|not a valid/i.test(msg) &&
      !/Whisper accepts|compress/i.test(msg)
    ) {
      throw wrap(
        'We could not read this audio file. Use a supported format (for example mp3, wav, m4a, webm) and try again.'
      );
    }
    
    throw error;
  } finally {
    for (const p of whisperTempPaths) {
      if (p && p !== audioFilePath && fs.existsSync(p)) {
        try {
          fs.unlinkSync(p);
          console.log('🧹 Cleaned up temporary Whisper-sized audio file');
        } catch (cleanupErr) {
          console.warn('⚠️  Failed to cleanup temp audio file:', cleanupErr.message);
        }
      }
    }
  }
}

async function translateSummaryForEmail(summaryData, language) {
  if (!openai) {
    console.warn('⚠️  OpenAI not configured; cannot generate translated summary.');
    return null;
  }

  const targetLanguage = language.trim();
  const baseTextParts = [];
  if (summaryData.summary) {
    baseTextParts.push(`Executive summary:\n${summaryData.summary}`);
  }
  if ((summaryData.keyPoints || []).length) {
    baseTextParts.push(
      'Key points:\n' + summaryData.keyPoints.map((p, idx) => `${idx + 1}. ${p}`).join('\n')
    );
  }
  if ((summaryData.decisions || []).length) {
    baseTextParts.push(
      'Decisions:\n' + summaryData.decisions.map((d, idx) => `${idx + 1}. ${d}`).join('\n')
    );
  }
  if ((summaryData.nextSteps || []).length) {
    baseTextParts.push(
      'Next steps:\n' + summaryData.nextSteps.map((s, idx) => `${idx + 1}. ${s}`).join('\n')
    );
  }
  if ((summaryData.importantNotes || []).length) {
    baseTextParts.push(
      'Important notes:\n' + summaryData.importantNotes.map((n, idx) => `${idx + 1}. ${n}`).join('\n')
    );
  }

  const baseText = baseTextParts.join('\n\n').trim();
  if (!baseText) return null;

  try {
    const response = await openai.chat.completions.create({
      model: getSummaryChatModel(),
      messages: [
        {
          role: 'system',
          content:
            `You are a professional translator. Translate the following meeting summary content from English into ${targetLanguage}. ` +
            'Keep the structure readable but concise. Do NOT include any English in the translated output.',
        },
        {
          role: 'user',
          content: baseText,
        },
      ],
      temperature: 0.2,
    });

    const translated = response.choices?.[0]?.message?.content?.trim();
    if (!translated) return null;

    return translated;
  } catch (err) {
    console.error('❌ Failed to translate summary for email:', err.message);
    return null;
  }
}

/**
 * Send meeting summary to participants via email/WhatsApp
 */
async function sendMeetingSummary(meeting, summaryData, options = {}) {
  let productType = 'workplace';
  try {
    if (meeting?.adminId) {
      const admin = await Admin.findById(meeting.adminId).select('productType').lean();
      productType = String(admin?.productType || 'workplace').toLowerCase();
    }
  } catch (e) {
    productType = 'workplace';
  }
  const isEducation = productType === 'education';
  const summaryNoun = isEducation ? 'Lecture Summary' : 'Meeting Summary';
  const sessionNoun = isEducation ? 'lecture' : 'meeting';
  const audienceNoun = isEducation ? 'students' : 'participants';
  const platformLabel = isEducation ? 'Education Lecture Intelligence Platform' : 'Meeting Intelligence Platform';
  const assistantLabel = isEducation ? 'PortIQ Education Assistant' : 'PortIQ Meeting Assistant';

  let participantEmails = (meeting.participants || [])
    .map(p => p.email)
    .filter(Boolean);

  // If no explicit participant emails were captured, fall back to organizer email
  if ((!participantEmails || participantEmails.length === 0) && meeting.organizer) {
    const organizerEmail = typeof meeting.organizer === 'string'
      ? meeting.organizer
      : meeting.organizer.email || meeting.organizer.name || null;

    if (organizerEmail && String(organizerEmail).includes('@')) {
      participantEmails = [organizerEmail];
      console.log('📧 No participant emails found; falling back to organizer for summary email');
    }
  }

  // Compute duration for email/PDF display
  let durationMinutes = null;
  if (meeting.startTime && meeting.endTime) {
    const start = new Date(meeting.startTime);
    const end = new Date(meeting.endTime);
    if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime()) && end > start) {
      durationMinutes = Math.max(1, Math.round((end.getTime() - start.getTime()) / 60000));
    }
  }

  console.log(`📧 ${summaryNoun} ready to send:`);
  console.log(`   ${isEducation ? 'Lecture' : 'Meeting'}: ${meeting.title}`);
  console.log(`   ${isEducation ? 'Recipients' : 'Participants'}: ${participantEmails.join(', ')}`);
  console.log(`   Summary: ${String(summaryData.summary || '').substring(0, 100)}...`);

  if (!isEmailConfigured() || participantEmails.length === 0) {
    console.warn('⚠️  Email not configured (set RESEND_API_KEY or MAIL_*) or no participant emails. Summary will not be emailed.');
    return { success: true, message: 'Summary prepared (email not sent - not configured or no emails)' };
  }

  const subject = `${summaryNoun} \u2013 ${meeting.title} | ${assistantLabel}`;
  const textLines = [
    'Hello,',
    '',
    `Please find attached the automatically generated summary for the ${sessionNoun} titled "${meeting.title}".`,
    '',
    `The attached document contains the executive summary, key discussion points, decisions made, and action items identified during the ${sessionNoun}.`,
    '',
    '---',
    'PortIQ Technologies',
    platformLabel,
    '',
    `This summary was automatically generated by the ${assistantLabel}.`,
    '',
    'For any concerns please contact',
    'help@portiqtechnologies.com'
  ];

  const meetingDate = meeting.startTime ? new Date(meeting.startTime) : new Date();
  const dateStamp = meetingDate.toISOString().split('T')[0]; // YYYY-MM-DD
  const safeTitleForFile = (meeting.title || 'Meeting')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

  const pdfBuffer = await buildMeetingSummaryPdfBuffer(meeting, summaryData, durationMinutes);

  const logoUrl = process.env.COMPANY_LOGO_URL || 'https://portiqtechnologies.com/logo.png';

  const baseUrl =
    process.env.MEETING_SUMMARY_BASE_URL ||
    process.env.CLIENT_BASE_URL ||
    'https://meetingassistant.portiqtechnologies.com';
  const summaryUrl = `${String(baseUrl).replace(/\/+$/, '')}/meetings/${meeting._id}/summary`;

  const toAllDayDate = (value) => {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return { y, m, day, date: `${y}-${m}-${day}`, compact: `${y}${m}${day}` };
  };

  const buildGoogleCalendarUrlForTask = (taskTitle, details, dueDate) => {
    const parts = toAllDayDate(dueDate);
    if (!parts) return null;
    const start = parts.compact;
    const endD = new Date(new Date(dueDate).getTime() + 24 * 60 * 60 * 1000);
    const endParts = toAllDayDate(endD);
    const end = endParts ? endParts.compact : start;
    const params = new URLSearchParams({
      action: 'TEMPLATE',
      text: taskTitle || 'Action item',
      details: details || '',
      dates: `${start}/${end}`,
    });
    return `https://calendar.google.com/calendar/render?${params.toString()}`;
  };

  const buildOutlookCalendarUrlForTask = (taskTitle, details, dueDate) => {
    const parts = toAllDayDate(dueDate);
    if (!parts) return null;
    const startdt = parts.date;
    const endD = new Date(new Date(dueDate).getTime() + 24 * 60 * 60 * 1000);
    const endParts = toAllDayDate(endD);
    const enddt = endParts ? endParts.date : parts.date;
    const params = new URLSearchParams({
      path: '/calendar/action/compose',
      subject: taskTitle || 'Action item',
      body: details || '',
      startdt,
      enddt,
      allday: 'true',
    });
    return `https://outlook.office.com/calendar/0/deeplink/compose?${params.toString()}`;
  };

  const buildActionItemsIcs = (items) => {
    const esc = (s) =>
      String(s || '')
        .replace(/\\/g, '\\\\')
        .replace(/\n/g, '\\n')
        .replace(/,/g, '\\,')
        .replace(/;/g, '\\;');

    const dtStamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//PortIQ//Meeting Assistant//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
    ];

    (items || []).forEach((a, idx) => {
      if (!a || !a.dueDate) return;
      const dueParts = toAllDayDate(a.dueDate);
      if (!dueParts) return;
      const endD = new Date(new Date(a.dueDate).getTime() + 24 * 60 * 60 * 1000);
      const endParts = toAllDayDate(endD);
      const uid = `${meeting._id}-${idx}-${Date.now()}@portiq`;
      const summary = a.task ? `Action: ${a.task}` : 'Action item';
      const desc = [
        meeting.title ? `Meeting: ${meeting.title}` : null,
        a.assignee ? `Assignee: ${a.assignee}` : null,
        'Created via PortIQ Meeting Assistant.',
        summaryUrl ? `Summary: ${summaryUrl}` : null,
      ]
        .filter(Boolean)
        .join('\\n');

      lines.push('BEGIN:VEVENT');
      lines.push(`UID:${uid}`);
      lines.push(`DTSTAMP:${dtStamp}`);
      lines.push(`DTSTART;VALUE=DATE:${dueParts.compact}`);
      lines.push(`DTEND;VALUE=DATE:${endParts ? endParts.compact : dueParts.compact}`);
      lines.push(`SUMMARY:${esc(summary)}`);
      lines.push(`DESCRIPTION:${esc(desc)}`);
      lines.push('END:VEVENT');
    });

    lines.push('END:VCALENDAR');
    return lines.join('\r\n');
  };

  const actionItemsForEmail = (summaryData.actionItems || [])
    .map((a) => ({
      task: a?.task || (typeof a === 'string' ? a : ''),
      assignee: a?.assignee || '',
      dueDate: a?.dueDate || null,
    }))
    .filter((a) => a.task);

  const actionItemsWithDates = actionItemsForEmail.filter((a) => a.dueDate && toAllDayDate(a.dueDate));

  const actionItemsBlock = actionItemsWithDates.length
    ? `
      <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
      <p style="margin: 0 0 10px 0; font-size: 13px; color: #4b5563;">
        <strong>Action items (add to your calendar):</strong>
      </p>
      <div style="font-size: 13px; color: #111827;">
        ${actionItemsWithDates.map((a) => {
          const due = new Date(a.dueDate);
          const dueText = Number.isNaN(due.getTime()) ? '' : due.toLocaleDateString();
          const details = [
            meeting.title ? `${isEducation ? 'Lecture' : 'Meeting'}: ${meeting.title}` : null,
            a.assignee ? `Assignee: ${a.assignee}` : null,
            summaryUrl ? `Summary: ${summaryUrl}` : null,
          ].filter(Boolean).join('\\n');
          const gcal = buildGoogleCalendarUrlForTask(a.task, details, a.dueDate);
          const outlook = buildOutlookCalendarUrlForTask(a.task, details, a.dueDate);
          const safeTask = String(a.task).replace(/</g, '&lt;');
          return `
            <div style="border: 1px solid #e5e7eb; border-radius: 10px; padding: 12px 14px; margin-bottom: 10px; background: #f9fafb;">
              <div style="font-weight: 700; margin-bottom: 4px;">${safeTask}</div>
              <div style="color: #4b5563; margin-bottom: 8px;">
                ${a.assignee ? `<span>Assignee: ${String(a.assignee).replace(/</g, '&lt;')}</span><br/>` : ''}
                ${dueText ? `<span>Due: ${dueText}</span>` : ''}
              </div>
              <table cellpadding="0" cellspacing="0" border="0" role="presentation" style="margin:0;">
                <tr>
                  ${gcal ? `<td style="padding:0 16px 8px 0;vertical-align:middle;"><a href="${gcal}" target="_blank" rel="noopener noreferrer" style="color:#2563eb;text-decoration:none;font-weight:600;white-space:nowrap;">Add to Google Calendar</a></td>` : ''}
                  ${outlook ? `<td style="padding:0 0 8px 0;vertical-align:middle;"><a href="${outlook}" target="_blank" rel="noopener noreferrer" style="color:#2563eb;text-decoration:none;font-weight:600;white-space:nowrap;">Add to Outlook</a></td>` : ''}
                </tr>
              </table>
            </div>
          `;
        }).join('')}
        <p style="margin: 8px 0 0 0; color: #6b7280;">
          Tip: You can also import the attached <strong>.ics</strong> file to add all action items at once.
        </p>
      </div>
    `
    : '';

  const meetingStart = meeting.startTime || meeting.scheduledTime;
  const meetingEnd = meeting.endTime || (meetingStart ? new Date(new Date(meetingStart).getTime() + 60 * 60 * 1000) : null);
  const meetingDetailsForCalendar = [
    meeting.organizer ? `${isEducation ? 'Teacher' : 'Organizer'}: ${meeting.organizer}` : null,
    (meeting.participants || []).length
      ? `${isEducation ? 'Students' : 'Participants'}:\n${(meeting.participants || [])
          .map(p => (p?.email ? `${p.name || p.email} (${p.email})` : (p?.name || '')))
          .filter(Boolean)
          .map(x => `- ${x}`)
          .join('\n')}`
      : null,
    summaryUrl ? `Summary: ${summaryUrl}` : null,
    'Created via PortIQ Meeting Assistant.',
  ]
    .filter(Boolean)
    .join('\n\n');

  const meetingCalendarGoogle = meetingStart && meetingEnd
    ? buildGoogleCalendarUrlForMeeting({
        title: meeting.title || (isEducation ? 'Lecture' : 'Meeting'),
        details: meetingDetailsForCalendar,
        location: meeting.meetingRoom || '',
        startDate: meetingStart,
        endDate: meetingEnd,
      })
    : null;

  const meetingCalendarOutlook = meetingStart && meetingEnd
    ? buildOutlookCalendarUrlForMeeting({
        title: meeting.title || (isEducation ? 'Lecture' : 'Meeting'),
        details: meetingDetailsForCalendar,
        location: meeting.meetingRoom || '',
        startDate: meetingStart,
        endDate: meetingEnd,
      })
    : null;

  const meetingIcs = meetingStart && meetingEnd
    ? buildMeetingIcs({
        meetingId: meeting._id,
        title: meeting.title || (isEducation ? 'Lecture' : 'Meeting'),
        description: meetingDetailsForCalendar,
        location: meeting.meetingRoom || '',
        startDate: meetingStart,
        endDate: meetingEnd,
      })
    : null;

  const meetingCalendarBlock = (meetingCalendarGoogle || meetingCalendarOutlook)
    ? `
      <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
      <p style="margin: 0 0 10px 0; font-size: 13px; color: #4b5563;">
        <strong>Add this ${sessionNoun} to your calendar:</strong>
      </p>
      <table cellpadding="0" cellspacing="0" border="0" role="presentation" style="margin:0;font-size:13px;">
        <tr>
          ${meetingCalendarGoogle ? `<td style="padding:0 16px 8px 0;vertical-align:middle;"><a href="${meetingCalendarGoogle}" target="_blank" rel="noopener noreferrer" style="color:#2563eb;text-decoration:none;font-weight:600;white-space:nowrap;">Add to Google Calendar</a></td>` : ''}
          ${meetingCalendarOutlook ? `<td style="padding:0 0 8px 0;vertical-align:middle;"><a href="${meetingCalendarOutlook}" target="_blank" rel="noopener noreferrer" style="color:#2563eb;text-decoration:none;font-weight:600;white-space:nowrap;">Add to Outlook</a></td>` : ''}
        </tr>
      </table>
      <p style="margin: 10px 0 0 0; font-size: 12px; color: #6b7280;">
        Tip: You can also import the attached <strong>${isEducation ? 'Lecture' : 'Meeting'} .ics</strong> file.
      </p>
    `
    : '';

  let translatedBlock = '';
  if (options.translationLanguage) {
    const translated = await translateSummaryForEmail(summaryData, options.translationLanguage);
    if (translated) {
      translatedBlock = `
      <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
      <p style="margin: 0 0 8px 0; font-size: 13px; color: #4b5563;">
        Translated summary (<strong>${options.translationLanguage}</strong>):
      </p>
      <div style="white-space: pre-wrap; font-size: 13px; color: #111827; background: #f9fafb; padding: 12px 14px; border-radius: 8px; border: 1px solid #e5e7eb;">
        ${translated.replace(/</g, '&lt;')}
      </div>`;
    }
  }

  const htmlBody = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 14px; color: #111827; line-height: 1.6;">
      <div style="text-align: left; margin-bottom: 16px;">
        <img src="${logoUrl}" alt="PortIQ Technologies" style="max-width: 160px; height: auto; display: block; margin-bottom: 12px;" />
      </div>
      <p>Hello,</p>
      <p>
        Please find attached the automatically generated summary for the ${sessionNoun} titled
        "<strong>${meeting.title}</strong>".
      </p>
      <p>
        The attached document contains the executive summary, key discussion points, decisions made,
        and action items identified during the ${sessionNoun}.
      </p>
      <p>
        View the meeting summary online:<br/>
        <a href="${summaryUrl}" target="_blank" rel="noopener noreferrer" style="color: #2563eb; text-decoration: none;">
          ${summaryUrl}
        </a>
      </p>
      ${meetingCalendarBlock}
      ${actionItemsBlock}
      <br/>
      <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
      <p style="margin: 0;">
        <strong>PortIQ Technologies</strong><br/>
        ${platformLabel}
      </p>
      <p style="margin: 12px 0 0 0; font-size: 13px; color: #4b5563;">
        This summary was automatically generated by the ${assistantLabel}.
      </p>
      <p style="margin: 8px 0 0 0; font-size: 13px; color: #4b5563;">
        For any concerns please contact<br/>
        <a href="mailto:help@portiqtechnologies.com" style="color: #2563eb; text-decoration: none;">
          help@portiqtechnologies.com
        </a>
      </p>
      ${translatedBlock}
    </div>
  `;

  const result = await sendEmail({
    from: getDefaultFrom(),
    to: participantEmails,
    subject,
    text: textLines.join('\n'),
    html: htmlBody,
    attachments: [
      {
        filename: `${isEducation ? 'Lecture' : 'Meeting'}-Summary-${safeTitleForFile}-${dateStamp}.pdf`,
        content: pdfBuffer,
        contentType: 'application/pdf',
      },
      ...(meetingIcs
        ? [{
            filename: `${isEducation ? 'Lecture' : 'Meeting'}-${safeTitleForFile}-${dateStamp}.ics`,
            content: Buffer.from(meetingIcs, 'utf8'),
            contentType: 'text/calendar; charset=utf-8',
          }]
        : []),
      ...(actionItemsWithDates.length > 0
        ? [{
            filename: `Action-Items-${safeTitleForFile}-${dateStamp}.ics`,
            content: Buffer.from(buildActionItemsIcs(actionItemsWithDates), 'utf8'),
            contentType: 'text/calendar; charset=utf-8',
          }]
        : []),
    ],
  });

  if (result.success) {
    console.log(`✅ ${summaryNoun} email sent`);
    return { success: true, message: `Summary emailed to ${audienceNoun}` };
  }
  console.error(`❌ Failed to send ${summaryNoun.toLowerCase()} email:`, result.error);
  return { success: false, message: 'Summary generated but email failed to send', error: result.error };
}

function getMailTransporter() {
  const { getMailTransporter: getTransporter } = require('./emailService');
  return getTransporter();
}

/**
 * Transcribe a short audio chunk with Whisper (live preview during recording).
 * Not used for the final stored transcript — full meeting audio is transcribed on /end.
 */
async function transcribeLiveChunkFile(audioPath) {
  if (!openai) {
    const err = new Error('OpenAI transcription is not configured');
    err.code = 'OPENAI_NOT_CONFIGURED';
    throw err;
  }
  if (!audioPath || !fs.existsSync(audioPath)) {
    throw new Error('Audio file missing');
  }
  const st = fs.statSync(audioPath);
  if (st.size < 800) {
    return '';
  }
  // Lock language for chunked preview: noisy rooms often mis-trigger Whisper as non-English.
  // Full meeting /end pipeline stays auto-detect. Set OPENAI_LIVE_TRANSCRIPTION_LANGUAGE=auto to omit.
  const liveLangRaw = process.env.OPENAI_LIVE_TRANSCRIPTION_LANGUAGE;
  const liveLang =
    liveLangRaw === undefined || liveLangRaw === ''
      ? 'en'
      : String(liveLangRaw).trim().toLowerCase();
  const createParams = {
    file: fs.createReadStream(audioPath),
    model: process.env.OPENAI_TRANSCRIPTION_MODEL || 'whisper-1',
    temperature: 0,
    response_format: 'json',
  };
  if (liveLang && liveLang !== 'auto') {
    createParams.language = liveLang;
  }
  try {
    const transcription = await openai.audio.transcriptions.create(createParams);
    const text = transcription && transcription.text ? String(transcription.text) : '';
    return text.trim();
  } catch (err) {
    const msg = String(err?.message || '').toLowerCase();
    // Live chunking can intermittently produce tiny/corrupt segments (especially around pause/resume
    // or browser recorder boundaries). Skip these instead of surfacing noisy 400 errors in UI.
    if (
      msg.includes('invalid file format') ||
      msg.includes('could not decode') ||
      msg.includes('file appears to be empty') ||
      msg.includes('audio could not be decoded')
    ) {
      return '';
    }
    throw err;
  }
}

module.exports = {
  transcribeAndSummarize,
  generateMeetingSummaryFromTranscript,
  sendMeetingSummary,
  getMailTransporter,
  transcribeLiveChunkFile,
};

/**
 * When the main transcribe→summarize pipeline throws after Whisper, we often still have
 * a checkpointed transcript in MongoDB. Recover by running summarization again instead of
 * leaving the meeting stuck in Failed with no user-visible output.
 */
const Meeting = require('../models/Meeting');
const { generateMeetingSummaryFromTranscript } = require('./meetingTranscription');
const { clearTranscriptionFailureFields } = require('./transcriptionFailureCodes');

function safeParseDate(value) {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function buildPipelineUpdateFromSummaryData(summaryData) {
  const safeActionItems = (summaryData.actionItems || []).map((item) => ({
    task: item.task || '',
    assignee: item.assignee || '',
    dueDate: safeParseDate(item.dueDate),
    status: 'not_started',
    reviewReminderSent: false,
    reviewReminderSentAt: null,
  }));

  const hr = summaryData.hiringRecommendation != null ? String(summaryData.hiringRecommendation) : '';
  const hrr =
    summaryData.hiringRecommendationReason != null ? String(summaryData.hiringRecommendationReason) : '';
  const ev = summaryData.evaluationSignals !== undefined ? summaryData.evaluationSignals : null;

  return {
    transcription: summaryData.transcription,
    summary: summaryData.summary,
    keyPoints: summaryData.keyPoints,
    actionItems: safeActionItems,
    decisions: summaryData.decisions || [],
    nextSteps: summaryData.nextSteps || [],
    importantNotes: summaryData.importantNotes || [],
    originalSummary: summaryData.summary,
    originalKeyPoints: summaryData.keyPoints || [],
    originalActionItems: safeActionItems,
    originalDecisions: summaryData.decisions || [],
    originalNextSteps: summaryData.nextSteps || [],
    originalImportantNotes: summaryData.importantNotes || [],
    pendingSummary: summaryData.summary,
    pendingKeyPoints: summaryData.keyPoints || [],
    pendingActionItems: safeActionItems,
    pendingDecisions: summaryData.decisions || [],
    pendingNextSteps: summaryData.nextSteps || [],
    pendingImportantNotes: summaryData.importantNotes || [],
    hiringRecommendation: hr,
    hiringRecommendationReason: hrr,
    evaluationSignals: ev,
    pendingHiringRecommendation: hr,
    pendingHiringRecommendationReason: hrr,
    pendingEvaluationSignals: ev,
    originalHiringRecommendation: hr,
    originalHiringRecommendationReason: hrr,
    originalEvaluationSignals: ev,
    transcriptionStatus: 'Completed',
    summaryStatus: 'Pending Approval',
    educationSummaryTeacherReviewedAt: null,
    ...clearTranscriptionFailureFields(),
  };
}

function buildDeterministicFallbackSummaryData(transcriptText, meetingDoc, options = {}) {
  const t = String(transcriptText || '').replace(/\s+/g, ' ').trim();
  const rawProduct =
    String(
      options.productType ||
        meetingDoc?.productType ||
        meetingDoc?.adminProductType ||
        ''
    )
      .trim()
      .toLowerCase();
  const isEducation =
    rawProduct === 'education' ||
    !!(
      meetingDoc &&
      (meetingDoc.educationClassroomId ||
        meetingDoc.educationClassroomName ||
        meetingDoc.educationSubject ||
        meetingDoc.educationTeacherName)
    );

  const sentenceLike = t
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const maxSentences = isEducation ? 18 : 14;
  const picked = sentenceLike.slice(0, maxSentences);
  const summaryCore = picked.length > 0 ? picked.join(' ') : t.slice(0, 3500);
  const summaryPrefix = isEducation
    ? 'Lecture recap fallback:'
    : 'Meeting recap fallback:';

  const keyPoints =
    sentenceLike.length > maxSentences
      ? sentenceLike.slice(maxSentences, maxSentences + 8)
      : [];

  return {
    transcription: t,
    summary: `${summaryPrefix} ${summaryCore}`.trim(),
    keyPoints,
    actionItems: [],
    decisions: [],
    nextSteps: [],
    importantNotes: [
      'Auto-generated fallback summary because AI structured summarization was temporarily unavailable.',
    ],
  };
}

/**
 * @returns {Promise<boolean>} true if meeting was recovered to Completed
 */
async function recoverSummaryFromCheckpointedTranscript(meetingId, options = {}) {
  if (!meetingId) return false;
  const fresh = await Meeting.findById(meetingId);
  if (!fresh) return false;
  const t = String(fresh.transcription || '').trim();
  if (t.length < 10) return false;

  const attempts = Math.min(3, Math.max(1, Number(process.env.SUMMARY_RECOVERY_ATTEMPTS) || 2));

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const summaryData = await generateMeetingSummaryFromTranscript(t, fresh, {
        productType: options.productType,
      });
      const update = buildPipelineUpdateFromSummaryData(summaryData);
      await Meeting.findByIdAndUpdate(meetingId, { $set: update }, { new: true });
      console.log(
        `✅ Recovered meeting ${meetingId} from checkpointed transcript (attempt ${attempt}/${attempts})`
      );
      return true;
    } catch (err) {
      console.warn(
        `⚠️ Summary recovery attempt ${attempt}/${attempts} failed for ${meetingId}:`,
        err.message
      );
      if (attempt < attempts) {
        await new Promise((r) => setTimeout(r, 2500 * attempt));
      }
    }
  }

  try {
    const fallback = buildDeterministicFallbackSummaryData(t, fresh, options);
    const update = buildPipelineUpdateFromSummaryData(fallback);
    await Meeting.findByIdAndUpdate(meetingId, { $set: update }, { new: true });
    console.warn(
      `⚠️ Recovered meeting ${meetingId} with deterministic fallback summary after AI retries failed`
    );
    return true;
  } catch (fallbackErr) {
    console.error(
      `❌ Deterministic fallback recovery failed for ${meetingId}:`,
      fallbackErr.message || fallbackErr
    );
    return false;
  }
}

module.exports = {
  buildPipelineUpdateFromSummaryData,
  buildDeterministicFallbackSummaryData,
  recoverSummaryFromCheckpointedTranscript,
};

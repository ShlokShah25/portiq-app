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
    transcriptionStatus: 'Completed',
    summaryStatus: 'Pending Approval',
    ...clearTranscriptionFailureFields(),
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
  return false;
}

module.exports = {
  buildPipelineUpdateFromSummaryData,
  recoverSummaryFromCheckpointedTranscript,
};

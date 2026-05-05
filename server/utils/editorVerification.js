const { meetingHasSummaryContent, attachSummaryUiState } = require('./meetingSummaryUiState');

/**
 * When an authorized editor is set and the summary is not yet sent, summary content
 * is only returned after a valid editor verification code is supplied (header or body).
 */
function meetingNeedsEditorVerification(meeting) {
  if (!meeting) return false;
  const editor = meeting.authorizedEditorEmail && String(meeting.authorizedEditorEmail).trim();
  if (!editor) return false;
  const st = meeting.summaryStatus || '';
  if (st === 'Sent' || st === 'Approved') return false;
  if (!meetingHasSummaryContent(meeting)) return false;
  const ts = meeting.transcriptionStatus || '';
  if (ts !== 'Completed') return false;
  return true;
}

function getEditorVerificationCodeFromRequest(req) {
  const h = req.header('X-Editor-Verification-Code');
  if (h && String(h).trim()) return String(h).trim();
  const b = req.body && req.body.code;
  if (b != null && String(b).trim()) return String(b).trim();
  return '';
}

function editorVerificationProofValid(meeting, req) {
  const code = getEditorVerificationCodeFromRequest(req);
  if (!code || !meeting.editorVerificationCode) return false;
  if (code !== meeting.editorVerificationCode) return false;
  if (!meeting.editorVerificationExpiry || new Date() > new Date(meeting.editorVerificationExpiry)) {
    return false;
  }
  return true;
}

/**
 * Strip AI summary content from a plain meeting object (API payload).
 */
function redactMeetingPayloadForEditorVerification(payload) {
  if (!payload || typeof payload !== 'object') return;
  payload.editorVerificationRequired = true;
  payload.pendingSummary = '';
  payload.summary = '';
  payload.pendingKeyPoints = [];
  payload.keyPoints = [];
  payload.pendingActionItems = [];
  payload.actionItems = [];
  payload.pendingDecisions = [];
  payload.decisions = [];
  payload.pendingNextSteps = [];
  payload.nextSteps = [];
  payload.pendingImportantNotes = [];
  payload.importantNotes = [];
  payload.pendingHiringRecommendation = '';
  payload.hiringRecommendation = '';
  payload.pendingHiringRecommendationReason = '';
  payload.hiringRecommendationReason = '';
  payload.pendingEvaluationSignals = null;
  payload.evaluationSignals = null;
  payload.pendingRevisionQuestions = '';
  payload.revisionQuestions = '';
  if (payload.originalRevisionQuestions !== undefined) payload.originalRevisionQuestions = '';
  if (payload.transcription !== undefined) payload.transcription = '';
  if (payload.parentContinuation && typeof payload.parentContinuation === 'object') {
    payload.parentContinuation = {
      ...payload.parentContinuation,
      priorSummarySnippet: null,
    };
  }
  attachSummaryUiState(payload);
}

function assertEditorVerificationOrRespond(meeting, req, res) {
  if (!meetingNeedsEditorVerification(meeting)) return true;
  if (editorVerificationProofValid(meeting, req)) return true;
  res.status(403).json({
    error: 'Verification required',
    details:
      'Enter the verification code emailed to the authorized editor (use Resend code if needed), then try again.',
  });
  return false;
}

module.exports = {
  meetingNeedsEditorVerification,
  getEditorVerificationCodeFromRequest,
  editorVerificationProofValid,
  redactMeetingPayloadForEditorVerification,
  assertEditorVerificationOrRespond,
};

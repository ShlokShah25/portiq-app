import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import axios from 'axios';
import { isEducation } from '../config/product';
import { FEATURE_INTERVIEW_UI } from '../config/featureFlags';
import { getSummaryEmptyBodyMessage } from '../utils/summaryEmptyReasonCopy';
import {
  editorOtpHeaders,
  setStoredEditorOtp,
  clearStoredEditorOtp,
} from '../utils/meetingEditorOtp';
import './MeetingSummary.css';
import MeetingSummaryReadonlyBody from './MeetingSummaryReadonlyBody';
import { formatApiError } from '../utils/apiErrorMessage';
import { stripEducationSummaryForDisplay } from '../utils/educationSummaryDisplay';

/** True when this meeting is a lecture/class (metadata on the meeting doc), independent of client shell. */
function meetingHasEducationContext(m) {
  if (!m || typeof m !== 'object') return false;
  if (m.educationSummaryTeacherReviewedAt) return true;
  if (String(m.educationClassroomId || '').trim()) return true;
  if (String(m.educationSubject || '').trim()) return true;
  if (String(m.educationClassroomName || '').trim()) return true;
  if (String(m.educationTeacherName || '').trim()) return true;
  if (String(m.educationTeacherEmail || '').trim()) return true;
  return false;
}

const MeetingSummary = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [meeting, setMeeting] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editingSummary, setEditingSummary] = useState(false);
  const [editableSummary, setEditableSummary] = useState(null);
  const [actionError, setActionError] = useState('');
  const [saving, setSaving] = useState(false);
  const [translationLanguage, setTranslationLanguage] = useState('');
  const [allowsTranslatedSummary, setAllowsTranslatedSummary] = useState(false);
  /** Server product from profile when meeting payload has no accountProductType (older API). */
  const [serverProductType, setServerProductType] = useState(null);
  const [retryBusy, setRetryBusy] = useState(false);
  const [retryError, setRetryError] = useState('');
  const [otpInput, setOtpInput] = useState('');
  const [verifyBusy, setVerifyBusy] = useState(false);
  const [verifyError, setVerifyError] = useState('');
  const [resendBusy, setResendBusy] = useState(false);
  const [resendNotice, setResendNotice] = useState('');

  const fetchMeeting = useCallback(
    async (opts = {}) => {
      const silent = opts.silent === true;
      if (!id) return;
      if (!silent) setLoading(true);
      try {
        const res = await axios.get(`/meetings/${id}`, {
          headers: editorOtpHeaders(id),
        });
        setMeeting(res.data.meeting);
        setError('');
      } catch (err) {
        setError(formatApiError(err, 'Meeting not found'));
        setMeeting(null);
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [id]
  );

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    fetchMeeting();
  }, [id, fetchMeeting]);

  /** While the server is transcribing, poll so the summary appears without a manual refresh. */
  useEffect(() => {
    if (!id) return;
    if (meeting?.transcriptionStatus !== 'Processing') return;

    const t = setInterval(() => {
      fetchMeeting({ silent: true });
    }, 4000);
    return () => clearInterval(t);
  }, [meeting?.transcriptionStatus, id, fetchMeeting]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await axios.get('/admin/profile');
        if (cancelled) return;
        const admin = res.data?.admin || {};
        setAllowsTranslatedSummary(!!admin.allowsTranslatedSummary);
        setServerProductType(String(admin.productType || 'workplace').toLowerCase());
      } catch (_) {
        if (!cancelled) {
          setAllowsTranslatedSummary(false);
          setServerProductType(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <div className="meeting-summary-screen">
        <div className="meeting-summary-loading">
          <div className="loading-spinner" />
          <p className="meeting-summary-thinking" role="status">
            Understanding your conversation
            <span className="meeting-summary-thinking-dots" aria-hidden>
              <span className="meeting-summary-thinking-dot" />
              <span className="meeting-summary-thinking-dot" />
              <span className="meeting-summary-thinking-dot" />
            </span>
          </p>
        </div>
      </div>
    );
  }

  if (error && !meeting) {
    return (
      <div className="meeting-summary-screen">
        <div className="meeting-summary-container">
          <div className="meeting-summary-error">{error}</div>
        </div>
      </div>
    );
  }

  if (!meeting) return null;

  const accountPt = String(meeting.accountProductType || '').trim().toLowerCase();
  const educationFromMeetingMeta = meetingHasEducationContext(meeting);
  const isEducationMode =
    educationFromMeetingMeta ||
    accountPt === 'education' ||
    (accountPt !== 'workplace' && serverProductType != null && serverProductType === 'education') ||
    (accountPt !== 'workplace' && serverProductType == null && isEducation);

  const rawSummaryText = meeting.pendingSummary || meeting.summary || '';
  const rawKeyPoints =
    meeting.pendingKeyPoints && meeting.pendingKeyPoints.length
      ? meeting.pendingKeyPoints
      : meeting.keyPoints || [];
  const rawActionItems =
    meeting.pendingActionItems && meeting.pendingActionItems.length
      ? meeting.pendingActionItems
      : meeting.actionItems || [];
  const rawDecisions =
    meeting.pendingDecisions && meeting.pendingDecisions.length
      ? meeting.pendingDecisions
      : meeting.decisions || [];
  const rawNextSteps =
    meeting.pendingNextSteps && meeting.pendingNextSteps.length
      ? meeting.pendingNextSteps
      : meeting.nextSteps || [];
  const rawImportantNotes =
    meeting.pendingImportantNotes && meeting.pendingImportantNotes.length
      ? meeting.pendingImportantNotes
      : meeting.importantNotes || [];

  const eduStripped = isEducationMode
    ? stripEducationSummaryForDisplay({
        summary: rawSummaryText,
        keyPoints: rawKeyPoints,
        decisions: rawDecisions,
        nextSteps: rawNextSteps,
        importantNotes: rawImportantNotes,
        actionItems: rawActionItems,
      })
    : null;

  const summaryText = eduStripped ? eduStripped.summary : rawSummaryText;
  const keyPoints = eduStripped ? eduStripped.keyPoints : rawKeyPoints;
  const actionItems = eduStripped ? eduStripped.actionItems : rawActionItems;
  const decisions = eduStripped ? eduStripped.decisions : rawDecisions;
  const nextSteps = eduStripped ? eduStripped.nextSteps : rawNextSteps;
  const importantNotes = eduStripped ? eduStripped.importantNotes : rawImportantNotes;

  const summaryMode = meeting.summaryMode === 'interview' ? 'interview' : 'standard';
  const isInterview = FEATURE_INTERVIEW_UI && summaryMode === 'interview';
  const hiringRecommendation = String(
    meeting.pendingHiringRecommendation || meeting.hiringRecommendation || ''
  ).trim();
  const hiringRecommendationReason = String(
    meeting.pendingHiringRecommendationReason || meeting.hiringRecommendationReason || ''
  ).trim();
  const evaluationSignals =
    meeting.pendingEvaluationSignals != null
      ? meeting.pendingEvaluationSignals
      : meeting.evaluationSignals;

  const decisionsDisplay = (decisions || []).filter(
    (d) => String(d || '').trim().toLowerCase() !== 'not specified'
  );

  const hasInterviewHiring =
    isInterview &&
    (hiringRecommendation ||
      hiringRecommendationReason ||
      (evaluationSignals &&
        typeof evaluationSignals === 'object' &&
        Object.keys(evaluationSignals).length > 0));

  // Use explicit length checks — a bare `.length` chain can evaluate to `0`, which React then renders.
  const hasContent =
    !!String(summaryText || '').trim() ||
    keyPoints.length > 0 ||
    actionItems.length > 0 ||
    decisionsDisplay.length > 0 ||
    nextSteps.length > 0 ||
    importantNotes.length > 0 ||
    hasInterviewHiring;
  /** Any state before distribution — not only strict "Pending Approval" (legacy rows may omit status). */
  const canEditAndSend = meeting.summaryStatus !== 'Sent' && hasContent;
  const educationReviewed = !!meeting.educationSummaryTeacherReviewedAt;

  const transcriptForFallback = String(meeting.transcription || '').trim();
  const hasStoredTranscript = !!transcriptForFallback;
  const showTranscriptFallback =
    !hasContent &&
    hasStoredTranscript &&
    meeting.transcriptionStatus !== 'Processing';
  const canRetryTranscription =
    meeting.transcriptionEnabled &&
    !!((meeting.audioFile && String(meeting.audioFile).trim()) || hasStoredTranscript) &&
    (meeting.transcriptionStatus === 'Failed' ||
      meeting.transcriptionStatus === 'Not Started' ||
      (meeting.transcriptionStatus === 'Completed' && !hasContent));

  const handleRequestEditorOtp = async () => {
    if (!id || !meeting?.authorizedEditorEmail) return;
    setResendBusy(true);
    setVerifyError('');
    setResendNotice('');
    try {
      await axios.post(`/meetings/${id}/request-verification`, {
        email: String(meeting.authorizedEditorEmail).trim(),
      });
      setResendNotice('If email is configured, the code was sent to the authorized editor’s inbox.');
      window.setTimeout(() => setResendNotice(''), 10000);
    } catch (err) {
      const d = err.response?.data;
      setVerifyError(
        [d?.error, d?.details].filter(Boolean).join(' — ') || 'Could not send verification email.'
      );
    } finally {
      setResendBusy(false);
    }
  };

  const handleVerifyEditorOtp = async () => {
    if (!id) return;
    const code = String(otpInput || '').trim();
    if (!code) {
      setVerifyError('Enter the verification code from the email.');
      return;
    }
    setVerifyBusy(true);
    setVerifyError('');
    try {
      await axios.post(`/meetings/${id}/verify-and-get-summary`, { code });
      setStoredEditorOtp(id, code);
      await fetchMeeting({ silent: true });
      setOtpInput('');
    } catch (err) {
      const d = err.response?.data;
      setVerifyError(
        [d?.error, d?.details].filter(Boolean).join(' — ') || 'Verification failed.'
      );
      clearStoredEditorOtp(id);
    } finally {
      setVerifyBusy(false);
    }
  };

  const handleRetryTranscription = async () => {
    setRetryBusy(true);
    setRetryError('');
    try {
      await axios.post(`/meetings/${id}/retry-transcription`);
      await fetchMeeting({ silent: true });
    } catch (err) {
      const d = err.response?.data;
      setRetryError(formatApiError(err, 'Failed to retry transcription.'));
    } finally {
      setRetryBusy(false);
    }
  };

  const startEditing = async () => {
    setActionError('');
    try {
      if (isEducationMode && meeting?.educationSummaryTeacherReviewedAt) {
        setSaving(true);
        await axios.put(
          `/meetings/${id}/pending-summary`,
          { educationCancelReview: true },
          { headers: editorOtpHeaders(id) }
        );
        await fetchMeeting({ silent: true });
      }
    } catch (err) {
      const d = err.response?.data;
      setActionError(
        [d?.error, d?.details].filter(Boolean).join(' — ') || 'Could not reopen notes for editing.'
      );
      return;
    } finally {
      setSaving(false);
    }
    setEditableSummary({
      summary: summaryText,
      keyPoints: [...keyPoints],
      actionItems: (actionItems || []).map((item) => ({
        ...(item._id ? { _id: item._id } : {}),
        task: item.task || '',
        assignee: item.assignee || '',
        dueDate: item.dueDate || null,
        ...(item.status ? { status: item.status } : {}),
      })),
      decisions: [...(decisions || [])],
      nextSteps: [...(nextSteps || [])],
      importantNotes: [...(importantNotes || [])],
      summaryMode,
      hiringRecommendation,
      hiringRecommendationReason,
      evaluationSignals: evaluationSignals || null,
    });
    setEditingSummary(true);
  };

  const handleSaveEducationReview = async () => {
    if (!id || !editableSummary) return;
    setSaving(true);
    setActionError('');
    const otpHeaders = editorOtpHeaders(id);
    try {
      const pendingBody = {
        summary: editableSummary.summary,
        keyPoints: editableSummary.keyPoints,
        actionItems: editableSummary.actionItems,
        decisions: editableSummary.decisions,
        nextSteps: editableSummary.nextSteps,
        importantNotes: editableSummary.importantNotes,
        markEducationReviewComplete: true,
      };
      if (editableSummary.summaryMode === 'interview') {
        pendingBody.hiringRecommendation = editableSummary.hiringRecommendation || '';
        pendingBody.hiringRecommendationReason = editableSummary.hiringRecommendationReason || '';
        pendingBody.evaluationSignals = editableSummary.evaluationSignals;
      }
      const res = await axios.put(`/meetings/${id}/pending-summary`, pendingBody, { headers: otpHeaders });
      setMeeting(res.data.meeting);
      setEditingSummary(false);
      setEditableSummary(null);
    } catch (err) {
      setActionError(formatApiError(err, 'Failed to save review.'));
    } finally {
      setSaving(false);
    }
  };

  const handleApproveAndSend = async () => {
    setSaving(true);
    setActionError('');
    const otpHeaders = editorOtpHeaders(id);
    try {
      if (editableSummary) {
        const pendingBody = {
          summary: editableSummary.summary,
          keyPoints: editableSummary.keyPoints,
          actionItems: editableSummary.actionItems,
          decisions: editableSummary.decisions,
          nextSteps: editableSummary.nextSteps,
          importantNotes: editableSummary.importantNotes,
        };
        if (editableSummary.summaryMode === 'interview') {
          pendingBody.hiringRecommendation = editableSummary.hiringRecommendation || '';
          pendingBody.hiringRecommendationReason = editableSummary.hiringRecommendationReason || '';
          pendingBody.evaluationSignals = editableSummary.evaluationSignals;
        }
        await axios.put(`/meetings/${id}/pending-summary`, pendingBody, { headers: otpHeaders });
      }
      const res = await axios.post(
        `/meetings/${id}/approve-and-send`,
        {
          additionalParticipants: [],
          translationLanguage:
            allowsTranslatedSummary && translationLanguage ? translationLanguage : null,
        },
        { headers: otpHeaders }
      );
      setMeeting(res.data.meeting);
      setEditingSummary(false);
      setEditableSummary(null);
      clearStoredEditorOtp(id);
      const msg =
        res.data.message ||
        (isInterview
          ? 'Decision finalized and saved.'
          : res.data.emailSent
            ? isEducationMode
              ? 'Lecture notes were sent to the class.'
              : 'Summary approved and sent to participants.'
            : isEducationMode
              ? 'Lecture notes were saved. Emails could not be sent (check mail configuration).'
              : 'Summary approved and saved. Emails could not be sent (check mail configuration).');
      alert(msg);
      navigate('/meetings');
    } catch (err) {
      const d = err.response?.data;
      setActionError(
        formatApiError(
          err,
          isInterview ? 'Failed to finalize decision.' : 'Failed to save or send summary.'
        )
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="meeting-summary-screen">
      <div className="meeting-summary-container ux-screen-enter">
        <div className="meeting-summary-card">
          <h1 className="meeting-summary-page-title">{meeting.title || 'Untitled meeting'}</h1>

          {!meeting.editorVerificationRequired &&
            !editingSummary &&
            !!hasContent &&
            actionItems.length > 0 && (
            <MeetingSummaryReadonlyBody
              meeting={meeting}
              meetingId={id}
              summaryText=""
              keyPoints={[]}
              actionItems={actionItems}
              decisions={[]}
              nextSteps={[]}
              importantNotes={[]}
              isEducation={isEducationMode}
              readOnlyEducationAssignments={isEducationMode && canEditAndSend}
              onMeetingPatched={setMeeting}
              showReadyBadge={false}
              includeSections="actionItemsOnly"
              staggerSections
              summaryMode={summaryMode}
              hiringRecommendation={hiringRecommendation}
              hiringRecommendationReason={hiringRecommendationReason}
              evaluationSignals={evaluationSignals}
            />
          )}

          <p className="meeting-summary-subtitle">
            {isEducationMode ? 'Lecture Notes' : 'Meeting Summary'}
          </p>

          {meeting.editorVerificationRequired && (
            <div
              className="meeting-summary-editor-verify"
              role="region"
              aria-label="Authorized editor verification"
            >
              <h2 className="meeting-summary-heading">Verification required</h2>
              <p className="meeting-summary-body">
                An authorized editor is set for this meeting
                {meeting.authorizedEditorEmail ? (
                  <>
                    {' '}
                    (<span className="meeting-summary-editor-verify__email">{meeting.authorizedEditorEmail}</span>
                    ).
                  </>
                ) : (
                  '.'
                )}{' '}
                Enter the code from the email they received to view or edit the summary before it is sent to{' '}
                {isEducationMode ? 'the class.' : 'participants.'}
              </p>
              <div className="meeting-summary-editor-verify__row">
                <button
                  type="button"
                  className="meeting-summary-btn meeting-summary-btn--secondary"
                  disabled={resendBusy || !meeting.authorizedEditorEmail}
                  onClick={handleRequestEditorOtp}
                >
                  {resendBusy ? 'Sending…' : 'Resend code to editor'}
                </button>
              </div>
              {resendNotice && (
                <p className="meeting-summary-editor-verify__notice" role="status">
                  {resendNotice}
                </p>
              )}
              <div className="meeting-summary-editor-verify__field">
                <label className="meeting-summary-language-label" htmlFor="summary-editor-otp">
                  Verification code
                </label>
                <input
                  id="summary-editor-otp"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  className="meeting-summary-editor-verify__input"
                  placeholder="6-digit code"
                  value={otpInput}
                  onChange={(e) => setOtpInput(e.target.value.replace(/\D/g, '').slice(0, 8))}
                />
              </div>
              {verifyError && (
                <div className="meeting-summary-action-error" role="alert">
                  {verifyError}
                </div>
              )}
              <button
                type="button"
                className="meeting-summary-btn meeting-summary-btn--primary"
                disabled={verifyBusy}
                onClick={handleVerifyEditorOtp}
              >
                {verifyBusy ? (
                  <>
                    <span className="meeting-summary-btn-spinner" aria-hidden />
                    Verifying…
                  </>
                ) : (
                  'Verify and view summary'
                )}
              </button>
            </div>
          )}

          {!meeting.editorVerificationRequired && (
          <p
            style={{
              marginTop: '4px',
              marginBottom: '16px',
              fontSize: '12px',
              color: 'rgba(148, 163, 184, 0.95)',
              fontStyle: 'italic',
            }}
          >
            {isEducationMode
              ? 'This class recap, key ideas, and assignments are generated by AI and may not be 100% accurate. Please review carefully before sharing with students.'
              : 'This summary and its action items are generated by AI and may not be 100% accurate. Please review carefully before sharing or acting on them.'}
          </p>
          )}

          {canEditAndSend && allowsTranslatedSummary && !meeting.editorVerificationRequired && (
            <div className="meeting-summary-language-row">
              {!isEducationMode ? (
                <label className="meeting-summary-language-label">
                  Also send translated summary in:
                </label>
              ) : null}
              <select
                className="meeting-summary-language-select"
                value={translationLanguage}
                onChange={e => setTranslationLanguage(e.target.value)}
              >
                <option value="">English only</option>
                <option value="Hindi">Hindi</option>
                <option value="Spanish">Spanish</option>
                <option value="French">French</option>
                <option value="German">German</option>
                <option value="Russian">Russian</option>
                <option value="Chinese (Simplified)">Chinese (Simplified)</option>
                <option value="Japanese">Japanese</option>
              </select>
            </div>
          )}

          {!hasContent && !editingSummary && !meeting.editorVerificationRequired && (
            <div className="meeting-summary-empty">
              {meeting.transcriptionStatus === 'Processing' ? (
                <p className="meeting-summary-thinking meeting-summary-thinking--muted" role="status">
                  Understanding your conversation
                  <span className="meeting-summary-thinking-dots" aria-hidden>
                    <span className="meeting-summary-thinking-dot" />
                    <span className="meeting-summary-thinking-dot" />
                    <span className="meeting-summary-thinking-dot" />
                  </span>
                </p>
              ) : (
                <>
                  <p className="meeting-summary-empty-message">
                    {getSummaryEmptyBodyMessage(meeting)}
                  </p>
                  {showTranscriptFallback && (
                    <details className="meeting-summary-transcript-fallback">
                      <summary className="meeting-summary-transcript-fallback-summary">
                        View saved transcript
                      </summary>
                      <div className="meeting-summary-transcript-fallback-body">
                        {transcriptForFallback}
                      </div>
                    </details>
                  )}
                  {retryError && (
                    <div className="meeting-summary-action-error meeting-summary-retry-error">
                      {retryError}
                    </div>
                  )}
                  {canRetryTranscription && (
                    <div className="meeting-summary-retry-row">
                      <button
                        type="button"
                        className="meeting-summary-btn meeting-summary-btn--primary"
                        disabled={retryBusy}
                        onClick={handleRetryTranscription}
                      >
                        {retryBusy ? (
                          <>
                            <span className="meeting-summary-btn-spinner" aria-hidden />
                            Starting…
                          </>
                        ) : (
                          'Regenerate summary'
                        )}
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {editingSummary && editableSummary && !meeting.editorVerificationRequired && (
            <>
              <div className="meeting-summary-edit">
                <div className="meeting-summary-edit-field">
                  <label>
                    {FEATURE_INTERVIEW_UI && editableSummary.summaryMode === 'interview'
                      ? 'Summary'
                      : isEducationMode
                        ? 'What we covered (class recap)'
                        : 'Minutes of the meeting'}
                  </label>
                  <textarea
                    value={editableSummary.summary}
                    onChange={e => setEditableSummary({ ...editableSummary, summary: e.target.value })}
                    rows={5}
                    className="meeting-summary-textarea"
                  />
                </div>
                {FEATURE_INTERVIEW_UI && editableSummary.summaryMode === 'interview' && (
                  <>
                    <div className="meeting-summary-edit-field">
                      <label htmlFor="edit-hiring-rec">Final recommendation</label>
                      <select
                        id="edit-hiring-rec"
                        className="meeting-summary-select"
                        value={editableSummary.hiringRecommendation || ''}
                        onChange={(e) =>
                          setEditableSummary({ ...editableSummary, hiringRecommendation: e.target.value })
                        }
                      >
                        <option value="">Select…</option>
                        <option value="Strong Hire">Strong Hire</option>
                        <option value="Lean Hire">Lean Hire</option>
                        <option value="No Hire">No Hire</option>
                      </select>
                    </div>
                    <div className="meeting-summary-edit-field">
                      <label htmlFor="edit-hiring-reason">Recommendation reasoning</label>
                      <textarea
                        id="edit-hiring-reason"
                        value={editableSummary.hiringRecommendationReason || ''}
                        onChange={(e) =>
                          setEditableSummary({
                            ...editableSummary,
                            hiringRecommendationReason: e.target.value,
                          })
                        }
                        rows={3}
                        className="meeting-summary-textarea"
                      />
                    </div>
                  </>
                )}
                <div className="meeting-summary-edit-field">
                  <label>
                    {FEATURE_INTERVIEW_UI && editableSummary.summaryMode === 'interview'
                      ? 'Key strengths (one per line)'
                      : isEducationMode
                        ? 'Main ideas to remember (one per line)'
                        : 'Key Points (one per line)'}
                  </label>
                  <textarea
                    value={(editableSummary.keyPoints || []).join('\n')}
                    onChange={e => setEditableSummary({ ...editableSummary, keyPoints: e.target.value.split('\n').filter(l => l.trim()) })}
                    rows={5}
                    className="meeting-summary-textarea"
                  />
                </div>
                <div className="meeting-summary-edit-field">
                  <label>{isEducationMode ? 'Assignments & follow-ups' : 'Action Items'}</label>
                  <small className="meeting-summary-edit-hint">
                    {isEducationMode
                      ? 'One per line. Format: Work to do | Assigned to | Due date as YYYY-MM-DD (optional)'
                      : 'One per line. Format: Task | Assignee | Due date as YYYY-MM-DD (optional)'}
                  </small>
                  <textarea
                    value={(editableSummary.actionItems || []).map((item) => {
                      let dueStr = '';
                      if (item.dueDate) {
                        const d = new Date(item.dueDate);
                        dueStr = !Number.isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : '';
                      }
                      return `${item.task || ''} | ${item.assignee || ''} | ${dueStr}`;
                    }).join('\n')}
                    onChange={(e) => {
                      const prev = editableSummary.actionItems || [];
                      const lines = e.target.value.split('\n').filter((l) => l.trim());
                      const items = lines.map((line, idx) => {
                        const parts = line.split('|').map((p) => p.trim());
                        let dueDate = null;
                        if (parts[2]) {
                          const raw = parts[2];
                          const d = /^\d{4}-\d{2}-\d{2}$/.test(raw)
                            ? new Date(`${raw}T12:00:00.000Z`)
                            : new Date(raw);
                          dueDate = !Number.isNaN(d.getTime()) ? d : null;
                        }
                        const carry = prev[idx];
                        return {
                          ...(carry?._id ? { _id: carry._id } : {}),
                          task: parts[0] || '',
                          assignee: parts[1] || '',
                          dueDate,
                          ...(carry?.status ? { status: carry.status } : {}),
                        };
                      });
                      setEditableSummary({ ...editableSummary, actionItems: items });
                    }}
                    rows={6}
                    className="meeting-summary-textarea"
                    style={{ fontFamily: 'ui-monospace, monospace' }}
                  />
                </div>
                <div className="meeting-summary-edit-field">
                  <label>
                    {isEducationMode ? 'Takeaways & clarifications (one per line)' : 'Decisions (one per line)'}
                  </label>
                  <textarea
                    value={(editableSummary.decisions || []).join('\n')}
                    onChange={e => setEditableSummary({ ...editableSummary, decisions: e.target.value.split('\n').filter(l => l.trim()) })}
                    rows={4}
                    className="meeting-summary-textarea"
                  />
                </div>
                <div className="meeting-summary-edit-field">
                  <label>
                    {isEducationMode ? 'Homework, prep & next steps (one per line)' : 'Next Steps (one per line)'}
                  </label>
                  <textarea
                    value={(editableSummary.nextSteps || []).join('\n')}
                    onChange={e => setEditableSummary({ ...editableSummary, nextSteps: e.target.value.split('\n').filter(l => l.trim()) })}
                    rows={4}
                    className="meeting-summary-textarea"
                  />
                </div>
                <div className="meeting-summary-edit-field">
                  <label>
                    {FEATURE_INTERVIEW_UI && editableSummary.summaryMode === 'interview'
                      ? 'Concerns / red flags (one per line)'
                      : isEducationMode
                        ? 'Extra notes from class (one per line)'
                        : 'Important Notes (one per line)'}
                  </label>
                  <textarea
                    value={(editableSummary.importantNotes || []).join('\n')}
                    onChange={e => setEditableSummary({ ...editableSummary, importantNotes: e.target.value.split('\n').filter(l => l.trim()) })}
                    rows={4}
                    className="meeting-summary-textarea"
                  />
                </div>
              </div>
              {actionError && (
                <div className="meeting-summary-action-error" role="alert">
                  {actionError}
                </div>
              )}
              {canEditAndSend && (
                <div className="meeting-summary-actions meeting-summary-actions--send-first">
                  {isEducationMode ? (
                    <>
                      <button
                        type="button"
                        className="meeting-summary-btn meeting-summary-btn--primary meeting-summary-btn--send"
                        disabled={saving}
                        onClick={handleSaveEducationReview}
                      >
                        {saving ? (
                          <>
                            <span className="meeting-summary-btn-spinner" aria-hidden />
                            Saving…
                          </>
                        ) : (
                          'Save review'
                        )}
                      </button>
                      <button
                        type="button"
                        className="meeting-summary-btn meeting-summary-btn--secondary"
                        onClick={() =>
                          (setEditingSummary(false), setEditableSummary(null), setActionError(''))
                        }
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="meeting-summary-btn meeting-summary-btn--primary meeting-summary-btn--send"
                        disabled={saving}
                        onClick={handleApproveAndSend}
                      >
                        {saving ? (
                          <>
                            <span className="meeting-summary-btn-spinner" aria-hidden />
                            Finalizing…
                          </>
                        ) : isInterview ? (
                          'Finalize Decision'
                        ) : (
                          'Send Summary to Participants'
                        )}
                      </button>
                      <button
                        type="button"
                        className="meeting-summary-btn meeting-summary-btn--secondary"
                        onClick={() =>
                          (setEditingSummary(false), setEditableSummary(null), setActionError(''))
                        }
                      >
                        Cancel Edit
                      </button>
                    </>
                  )}
                </div>
              )}
            </>
          )}

          {!!hasContent && !editingSummary && !meeting.editorVerificationRequired && (
            <>
              {!isInterview &&
                (decisionsDisplay.length > 0 || nextSteps.length > 0) && (
                  <section
                    className="meeting-summary-outcomes-strip"
                    aria-label="Decisions and next steps"
                  >
                    <p className="meeting-summary-outcomes-strip__eyebrow">Outcomes</p>
                    {decisionsDisplay.length > 0 && (
                      <div className="meeting-summary-outcomes-strip__block">
                        <h3 className="meeting-summary-outcomes-strip__label">Decisions</h3>
                        <ul className="meeting-summary-outcomes-strip__list">
                          {decisionsDisplay.slice(0, 6).map((d, i) => (
                            <li key={`dec-${i}`}>{String(d || '').trim()}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {nextSteps.length > 0 && (
                      <div className="meeting-summary-outcomes-strip__block">
                        <h3 className="meeting-summary-outcomes-strip__label">Next steps</h3>
                        <ul className="meeting-summary-outcomes-strip__list">
                          {nextSteps.slice(0, 6).map((s, i) => (
                            <li key={`ns-${i}`}>{String(s || '').trim()}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </section>
                )}
              <div
                className={
                  actionItems.length > 0 ? 'meeting-summary-secondary-block' : undefined
                }
              >
                <MeetingSummaryReadonlyBody
                  meeting={meeting}
                  meetingId={id}
                  summaryText={summaryText}
                  keyPoints={keyPoints}
                  actionItems={actionItems}
                  decisions={decisions}
                  nextSteps={nextSteps}
                  importantNotes={importantNotes}
                  isEducation={isEducationMode}
                  readOnlyEducationAssignments={isEducationMode && canEditAndSend}
                  onMeetingPatched={setMeeting}
                  includeSections="withoutActionItems"
                  staggerSections
                  summaryMode={summaryMode}
                  hiringRecommendation={hiringRecommendation}
                  hiringRecommendationReason={hiringRecommendationReason}
                  evaluationSignals={evaluationSignals}
                />
              </div>
              {actionError && (
                <div className="meeting-summary-action-error meeting-summary-action-error--near-actions" role="alert">
                  {actionError}
                </div>
              )}
              {canEditAndSend && (
                <div className="meeting-summary-actions meeting-summary-actions--send-first meeting-summary-actions--after-body">
                  {isInterview ? (
                    <>
                      <button
                        type="button"
                        className="meeting-summary-btn meeting-summary-btn--primary meeting-summary-btn--send"
                        disabled={saving}
                        onClick={handleApproveAndSend}
                      >
                        {saving ? (
                          <>
                            <span className="meeting-summary-btn-spinner" aria-hidden />
                            Finalizing…
                          </>
                        ) : (
                          'Finalize Decision'
                        )}
                      </button>
                      <button
                        type="button"
                        className="meeting-summary-btn meeting-summary-btn--secondary"
                        onClick={startEditing}
                      >
                        Edit Summary
                      </button>
                    </>
                  ) : isEducationMode && !educationReviewed ? (
                    <button
                      type="button"
                      className="meeting-summary-btn meeting-summary-btn--primary meeting-summary-btn--send"
                      disabled={saving}
                      onClick={startEditing}
                    >
                      Review and Edit Notes
                    </button>
                  ) : isEducationMode && educationReviewed ? (
                    <>
                      <button
                        type="button"
                        className="meeting-summary-btn meeting-summary-btn--primary meeting-summary-btn--send"
                        disabled={saving}
                        onClick={handleApproveAndSend}
                      >
                        {saving ? (
                          <>
                            <span className="meeting-summary-btn-spinner" aria-hidden />
                            Sending…
                          </>
                        ) : (
                          'Send lecture notes to class'
                        )}
                      </button>
                      <button
                        type="button"
                        className="meeting-summary-btn meeting-summary-btn--secondary"
                        onClick={startEditing}
                      >
                        Edit notes
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="meeting-summary-btn meeting-summary-btn--primary meeting-summary-btn--send"
                        disabled={saving}
                        onClick={handleApproveAndSend}
                      >
                        {saving ? (
                          <>
                            <span className="meeting-summary-btn-spinner" aria-hidden />
                            Finalizing…
                          </>
                        ) : (
                          'Send Summary to Participants'
                        )}
                      </button>
                      <button
                        type="button"
                        className="meeting-summary-btn meeting-summary-btn--secondary"
                        onClick={startEditing}
                      >
                        Edit Summary
                      </button>
                    </>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default MeetingSummary;

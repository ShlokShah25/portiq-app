/**
 * Shared helpers for Interview Mode UI (workplace hiring surface).
 */

export function meetingIdStr(m) {
  const id = m?._id ?? m?.id;
  return id != null ? String(id) : '';
}

export function interviewRosterRows(m) {
  const arr = Array.isArray(m?.interviewCandidates) ? m.interviewCandidates : [];
  const named = arr
    .map((c) => ({
      name: String(c?.name || '').trim(),
      role: String(c?.role || '').trim(),
    }))
    .filter((c) => c.name);
  if (named.length > 0) return named;
  const legName = String(m?.interviewCandidateName || '').trim();
  if (!legName) return [];
  return [
    {
      name: legName,
      role: String(m?.interviewRole || '').trim(),
    },
  ];
}

export function interviewCandidateSubtitle(m) {
  const rows = interviewRosterRows(m);
  if (rows.length === 0) return 'Interview session';
  if (rows.length === 1) {
    return rows[0].role ? `${rows[0].name} · ${rows[0].role}` : rows[0].name;
  }
  return `${rows.length} candidates`;
}

export function interviewerLabel(m) {
  const emails = Array.isArray(m?.interviewInterviewerEmails)
    ? m.interviewInterviewerEmails
    : m?.interviewInterviewerEmail
      ? [m.interviewInterviewerEmail]
      : [];
  const parts = emails.map((e) => String(e || '').trim()).filter(Boolean);
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0];
  return parts.join(', ');
}

export function hiringVerdictShort(m) {
  const h = String(m?.hiringRecommendation || m?.pendingHiringRecommendation || '').trim();
  if (!h) return '';
  if (/strong/i.test(h)) return 'Strong Hire';
  if (/lean hire/i.test(h)) return 'Hire';
  if (/no hire/i.test(h)) return 'No Hire';
  if (/neutral/i.test(h)) return 'Neutral';
  return h;
}

export function hiringVerdictClass(m) {
  const h = String(m?.hiringRecommendation || m?.pendingHiringRecommendation || '').trim().toLowerCase();
  if (h.includes('strong')) return 'interview-verdict--strong';
  if (h.includes('lean') || (h.includes('hire') && !h.includes('no'))) return 'interview-verdict--hire';
  if (h.includes('no hire')) return 'interview-verdict--nohire';
  if (h.includes('neutral')) return 'interview-verdict--neutral';
  return 'interview-verdict--muted';
}

export function isInterviewDecisionPending(m) {
  if (m?.summaryMode !== 'interview') return false;
  if (m.transcriptionStatus === 'Failed') return false;
  if (m.transcriptionStatus !== 'Completed') return false;
  if (m.summaryStatus === 'Sent') return false;
  const hasSummary = String(m.pendingSummary || m.summary || '').trim().length > 0;
  const hasHiringDraft =
    String(
      m.pendingHiringRecommendation ||
        m.hiringRecommendation ||
        m.pendingHiringRecommendationReason ||
        m.hiringRecommendationReason ||
        ''
    ).trim().length > 0;
  const hasEval =
    (m.pendingEvaluationSignals &&
      typeof m.pendingEvaluationSignals === 'object' &&
      Object.keys(m.pendingEvaluationSignals).length > 0) ||
    (m.evaluationSignals &&
      typeof m.evaluationSignals === 'object' &&
      Object.keys(m.evaluationSignals).length > 0);
  return hasSummary || hasHiringDraft || hasEval;
}

export function interviewStatusLabel(m) {
  if (!m) return 'Scheduled';
  if (m.status === 'In Progress' || m.transcriptionStatus === 'Recording') return 'Live';
  if (m.transcriptionStatus === 'Failed') return 'Failed';
  if (m.transcriptionStatus !== 'Completed' && m.status !== 'Completed') {
    if (m.status === 'Scheduled') return 'Scheduled';
    return 'In progress';
  }
  if (isInterviewDecisionPending(m)) return 'Needs decision';
  if (m.summaryStatus === 'Sent') return 'Finalized';
  if (String(m.pendingSummary || m.summary || '').trim()) return 'Draft ready';
  return 'Processing';
}

export function interviewContextText(m) {
  const agenda = String(m?.agenda || '').trim();
  if (agenda) return agenda;
  const title = String(m?.title || '').trim();
  return title || '';
}

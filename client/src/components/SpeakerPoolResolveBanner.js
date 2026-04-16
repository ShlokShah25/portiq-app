import React, { useMemo, useState } from 'react';
import axios from 'axios';
import { Users } from 'lucide-react';
import {
  findFirstTwoPersonSpeakerBracket,
  joinSummaryTextForSpeakerDetection,
} from '../utils/speakerPoolBracket';
import { formatApiError } from '../utils/apiErrorMessage';

function matchParticipant(fragment, participants) {
  const f = String(fragment || '')
    .trim()
    .toLowerCase();
  if (!f) return null;
  for (const p of participants || []) {
    if (!p || !p.email) continue;
    const em = String(p.email).trim().toLowerCase();
    const nm = String(p.name || '').trim().toLowerCase();
    const local = em.includes('@') ? em.split('@')[0] : '';
    if (f === em || f === nm) return p;
    if (nm && (nm === f || nm.includes(f) || f.includes(nm))) return p;
    if (local && (f === local || local.includes(f) || f.includes(local))) return p;
  }
  return null;
}

/**
 * When the summary contains [Name1 / Name2], offer one-click resolution and persist to the server.
 */
export default function SpeakerPoolResolveBanner({
  meeting,
  meetingId,
  summaryText,
  keyPoints,
  decisions,
  nextSteps,
  importantNotes,
  actionItems,
  onMeetingPatched,
  isInterview,
}) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const participants = useMemo(() => {
    return (meeting?.participants || []).filter((p) => p && String(p.email || '').trim());
  }, [meeting]);

  const combined = useMemo(
    () =>
      joinSummaryTextForSpeakerDetection({
        summaryText,
        keyPoints,
        decisions,
        nextSteps,
        importantNotes,
        actionItems,
      }),
    [summaryText, keyPoints, decisions, nextSteps, importantNotes, actionItems]
  );

  const pool = useMemo(() => findFirstTwoPersonSpeakerBracket(combined), [combined]);

  const matchPair = useMemo(() => {
    if (!pool || participants.length < 2) return null;
    const a = matchParticipant(pool.left, participants);
    const b = matchParticipant(pool.right, participants);
    if (!a || !b) return null;
    if (String(a.email).toLowerCase() === String(b.email).toLowerCase()) return null;
    return { a, b };
  }, [pool, participants]);

  if (isInterview || !meetingId || !pool || !matchPair || !combined.includes(pool.bracket)) {
    return null;
  }

  const pick = async (participant) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const res = await axios.post(`/meetings/${meetingId}/resolve-speaker-pool`, {
        poolBracket: pool.bracket,
        chosenParticipantEmail: String(participant.email).trim(),
      });
      const msg = res.data?.message || 'Saved.';
      setNotice(msg);
      if (onMeetingPatched && res.data?.meeting) {
        onMeetingPatched(res.data.meeting);
      }
    } catch (err) {
      setError(formatApiError(err));
    } finally {
      setBusy(false);
    }
  };

  const labelFor = (p) => String(p.name || '').trim() || String(p.email || '').split('@')[0];

  return (
    <div
      className="meeting-summary-speaker-pool meeting-summary-section meeting-summary-section--ux-reveal"
      role="region"
      aria-label="Who was speaking"
    >
      <div className="meeting-summary-speaker-pool__inner">
        <div className="meeting-summary-speaker-pool__title">
          <Users className="meeting-summary-speaker-pool__icon" size={18} strokeWidth={1.75} aria-hidden />
          <span>Speaker wasn’t fully identified</span>
        </div>
        <p className="meeting-summary-speaker-pool__hint">
          This line used a shared label (<strong>{pool.bracket}</strong>). Tap who was actually speaking so we
          remember for next time and the summary updates everywhere.
        </p>
        <div className="meeting-summary-speaker-pool__actions">
          <button
            type="button"
            className="meeting-summary-speaker-pool__btn"
            disabled={busy}
            onClick={() => pick(matchPair.a)}
          >
            It was {labelFor(matchPair.a)}
          </button>
          <button
            type="button"
            className="meeting-summary-speaker-pool__btn"
            disabled={busy}
            onClick={() => pick(matchPair.b)}
          >
            It was {labelFor(matchPair.b)}
          </button>
        </div>
        {busy && <p className="meeting-summary-speaker-pool__meta">Saving…</p>}
        {notice ? (
          <p className="meeting-summary-speaker-pool__success" role="status">
            {notice}
          </p>
        ) : null}
        {error ? <p className="meeting-summary-speaker-pool__err">{error}</p> : null}
      </div>
    </div>
  );
}

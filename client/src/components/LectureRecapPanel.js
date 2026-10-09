import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import {
  Sparkles,
  Loader2,
  BarChart3,
  PenLine,
  Presentation,
  Check,
  Link2,
  ExternalLink,
  ChevronDown,
  Send,
  FileText,
  ListChecks,
  RotateCw,
} from 'lucide-react';
import PageCanvas from './LecturePageCanvas';
import './LectureRecapPanel.css';

function apiError(err, fallback) {
  const d = err?.response?.data;
  return [d?.error, d?.details].filter(Boolean).join(' — ') || fallback;
}

/**
 * The publish panel at the top of a finished lecture (MeetingSummary.js).
 * Three steps, in the order a teacher actually does them:
 *   1. Review the notes   — opens the editor below; saving marks them reviewed
 *   2. Quiz               — generate, check the answer key, optionally make it required
 *   3. Send to class      — publishes the notes and emails every student ONE link
 *                           (pages from class + notes + quiz + Q&A)
 * Sending keeps the teacher on this page so they can copy / re-send the link.
 * See server/routes/smartboard.js (recap/send) and meetings.js (approve-and-send).
 */
export default function LectureRecapPanel({
  meeting,
  onQuizGenerated,
  onMeetingUpdated,
  onReviewNotes,
  editingNotes = false,
  requestHeaders,
}) {
  const navigate = useNavigate();
  const [quizBusy, setQuizBusy] = useState(false);
  const [quizError, setQuizError] = useState('');
  const [sendBusy, setSendBusy] = useState(false);
  const [notice, setNotice] = useState(null); // { ok: boolean, text: string }
  const [recapUrl, setRecapUrl] = useState('');
  const [copied, setCopied] = useState(false);
  const [mandatoryBusy, setMandatoryBusy] = useState(false);
  const [quizOpen, setQuizOpen] = useState(false);

  const meetingId = meeting?._id;
  const questions = meeting?.quiz?.questions || [];
  const hasQuiz = questions.length > 0;
  const mandatory = Boolean(meeting?.quiz?.mandatory);
  const attemptCount = (meeting?.quiz?.attempts || []).length;
  const studentCount = (meeting?.participants || []).filter((p) => String(p?.email || '').trim()).length;
  const sent = meeting?.summaryStatus === 'Sent';
  const notesDrafted = Boolean(String(meeting?.pendingSummary || meeting?.summary || '').trim());
  const notesWriting =
    !notesDrafted && (meeting?.transcriptionStatus === 'Processing' || meeting?.transcriptionStatus === 'Not Started' || !meeting?.transcriptionStatus);
  const notesFailed = !notesDrafted && meeting?.transcriptionStatus === 'Failed';
  const reviewed = sent || Boolean(meeting?.educationSummaryTeacherReviewedAt);
  const canSend = notesDrafted && reviewed && !sent;

  // Same merge the server does for the student page, so the teacher sees — before sending
  // anything — exactly which pages made it in, in the order they were used.
  const coveredPages = useMemo(() => {
    const slides = (meeting?.slideDeck?.slides || [])
      .filter((s) => !!s.shownAt)
      .map((s) => ({ type: 'slide', index: s.index, imageUrl: s.imageUrl, annotations: s.annotations, at: s.shownAt }));
    const wbPages = (meeting?.whiteboard?.pages || [])
      .filter((p) => !!p.touchedAt)
      .map((p) => ({ type: 'whiteboard', index: p.index, annotations: p.annotations, at: p.touchedAt }));
    return [...slides, ...wbPages].sort((a, b) => new Date(a.at) - new Date(b.at));
  }, [meeting?.slideDeck?.slides, meeting?.whiteboard?.pages]);
  const pageCount = coveredPages.length;

  useEffect(() => {
    if (!meetingId) return undefined;
    let cancelled = false;
    axios
      .get(`/meetings/${meetingId}/recap-link`)
      .then((res) => {
        if (!cancelled) setRecapUrl(res.data?.recapUrl || '');
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [meetingId]);

  if (!meetingId) return null;

  const handleGenerateQuiz = async () => {
    setQuizBusy(true);
    setQuizError('');
    try {
      const res = await axios.post(`/meetings/${meetingId}/quiz/generate`, null, { timeout: 120000 });
      if (res.data.recapUrl) setRecapUrl(res.data.recapUrl);
      onQuizGenerated?.(res.data.quiz);
      setQuizOpen(true);
    } catch (err) {
      setQuizError(apiError(err, 'Could not write the quiz. The notes may still be finishing — try again in a moment.'));
    } finally {
      setQuizBusy(false);
    }
  };

  const handleToggleMandatory = async () => {
    setMandatoryBusy(true);
    setQuizError('');
    try {
      const res = await axios.put(`/meetings/${meetingId}/quiz/mandatory`, { mandatory: !mandatory });
      onQuizGenerated?.({ ...meeting.quiz, mandatory: res.data.mandatory });
    } catch (err) {
      setQuizError(apiError(err, 'Could not update the required setting.'));
    } finally {
      setMandatoryBusy(false);
    }
  };

  const emailRecap = async () => {
    const res = await axios.post(`/meetings/${meetingId}/recap/send`, null, { timeout: 120000 });
    if (res.data.recapUrl) setRecapUrl(res.data.recapUrl);
    const n = Number(res.data.sent) || 0;
    const failed = Array.isArray(res.data.failed) ? res.data.failed.length : 0;
    return { n, failed };
  };

  const handleSendToClass = async () => {
    setSendBusy(true);
    setNotice(null);
    let published = false;
    try {
      const res = await axios.post(
        `/meetings/${meetingId}/approve-and-send`,
        { additionalParticipants: [], translationLanguage: null, skipEmail: true },
        { headers: requestHeaders || {}, timeout: 120000 }
      );
      published = true;
      if (res.data?.meeting) onMeetingUpdated?.(res.data.meeting);
      const { n, failed } = await emailRecap();
      setNotice({
        ok: failed === 0,
        text:
          failed === 0
            ? `Sent. ${n} student${n === 1 ? '' : 's'} got the recap link by email.`
            : `Published. ${n} email${n === 1 ? '' : 's'} went out, ${failed} could not be delivered — copy the link below and share it with them.`,
      });
    } catch (err) {
      setNotice({
        ok: false,
        text: published
          ? `Notes are published, but the email did not go out (${apiError(err, 'mail error')}). Copy the link below and share it with the class.`
          : apiError(err, 'Could not publish the notes. Try again.'),
      });
    } finally {
      setSendBusy(false);
    }
  };

  const handleResend = async () => {
    setSendBusy(true);
    setNotice(null);
    try {
      const { n, failed } = await emailRecap();
      setNotice({
        ok: failed === 0,
        text: failed === 0 ? `Link sent again to ${n} student${n === 1 ? '' : 's'}.` : `Sent to ${n}; ${failed} could not be delivered.`,
      });
    } catch (err) {
      setNotice({ ok: false, text: apiError(err, 'Could not send the email. Copy the link and share it instead.') });
    } finally {
      setSendBusy(false);
    }
  };

  const handleCopy = async () => {
    if (!recapUrl) return;
    try {
      await navigator.clipboard.writeText(recapUrl);
    } catch {
      // Clipboard API is blocked on some school networks / older browsers.
      const ta = document.createElement('textarea');
      ta.value = recapUrl;
      ta.setAttribute('readonly', '');
      ta.style.position = 'absolute';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
      } catch {
        /* nothing more we can do */
      }
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const stepState = (done, current) => (done ? 'is-done' : current ? 'is-current' : 'is-waiting');
  const step1 = stepState(reviewed, !reviewed);
  const step2 = stepState(hasQuiz, reviewed && !hasQuiz);
  const step3 = stepState(sent, canSend);

  const StepMarker = ({ n, state }) => (
    <span className="publish-panel__marker" aria-hidden>
      {state === 'is-done' ? <Check size={14} strokeWidth={3} /> : n}
    </span>
  );

  const studentsLabel = `${studentCount} student${studentCount === 1 ? '' : 's'}`;

  return (
    <section className="publish-panel lecture-recap-panel" data-tour="lecture-recap-panel" aria-label="Publish to class">
      <header className="publish-panel__head">
        <div>
          <p className="publish-panel__eyebrow">Publish to class</p>
          <h2 className="publish-panel__title">
            {sent ? 'Your class has the recap' : 'Three steps and your class has everything'}
          </h2>
          <p className="publish-panel__lede">
            One link per student: {pageCount > 0 ? `${pageCount} page${pageCount === 1 ? '' : 's'} from class, ` : ''}
            the notes{hasQuiz ? ', a 5-question quiz' : ''} and a place to ask questions.
          </p>
        </div>
        <span className={`publish-panel__chip ${sent ? 'is-sent' : 'is-draft'}`}>
          <span className="publish-panel__chip-dot" aria-hidden />
          {sent ? 'Sent to class' : 'Draft · students see nothing yet'}
        </span>
      </header>

      <ol className="publish-panel__steps">
        <li className={`publish-panel__step ${step1}`}>
          <StepMarker n={1} state={step1} />
          <div className="publish-panel__step-body">
            <h3>
              <FileText size={15} strokeWidth={2} aria-hidden /> Review the notes
            </h3>
            <p>
              {notesDrafted
                ? reviewed
                  ? sent
                    ? 'Published with the recap.'
                    : 'Reviewed. You can still make changes before sending.'
                  : 'Written from your recording. Read them, fix anything, then save.'
                : notesFailed
                  ? 'The notes could not be written from this recording. Use Regenerate below.'
                  : 'Writing the notes from your recording — usually 1–2 minutes.'}
            </p>
          </div>
          <div className="publish-panel__step-action">
            {notesDrafted && !sent ? (
              <button
                type="button"
                className={`publish-panel__btn ${reviewed ? 'publish-panel__btn--ghost' : 'publish-panel__btn--primary'}`}
                onClick={onReviewNotes}
                disabled={editingNotes}
                data-action="review-notes"
              >
                <PenLine size={15} strokeWidth={2} aria-hidden />
                {editingNotes ? 'Editing below' : reviewed ? 'Edit notes' : 'Review notes'}
              </button>
            ) : notesWriting ? (
              <span className="publish-panel__pending">
                <Loader2 size={15} className="lecture-recap-panel__spin" aria-hidden /> Writing…
              </span>
            ) : null}
          </div>
        </li>

        <li className={`publish-panel__step ${step2}`}>
          <StepMarker n={2} state={step2} />
          <div className="publish-panel__step-body">
            <h3>
              <ListChecks size={15} strokeWidth={2} aria-hidden /> Quiz
              <span className="publish-panel__optional">optional</span>
            </h3>
            <p>
              {hasQuiz
                ? `${questions.length} questions from what you said in class${mandatory ? ' · required' : ''}.`
                : 'Five multiple-choice questions written from the lecture transcript.'}
            </p>
            {hasQuiz && (
              <div className="publish-panel__quiz-row">
                <label className="publish-panel__toggle">
                  <input type="checkbox" checked={mandatory} disabled={mandatoryBusy} onChange={handleToggleMandatory} />
                  <span className="publish-panel__switch" aria-hidden />
                  <span>Required — students enter name and email</span>
                </label>
                <button
                  type="button"
                  className="publish-panel__link-btn"
                  onClick={() => setQuizOpen((v) => !v)}
                  aria-expanded={quizOpen}
                  data-action="toggle-quiz"
                >
                  <ChevronDown size={15} strokeWidth={2} aria-hidden className={quizOpen ? 'is-open' : ''} />
                  {quizOpen ? 'Hide answer key' : 'Check the answer key'}
                </button>
                <button type="button" className="publish-panel__link-btn" onClick={() => navigate('/quiz-results')}>
                  <BarChart3 size={15} strokeWidth={2} aria-hidden />
                  {attemptCount > 0 ? `${attemptCount} attempt${attemptCount === 1 ? '' : 's'}` : 'No attempts yet'}
                </button>
              </div>
            )}
          </div>
          <div className="publish-panel__step-action">
            <button
              type="button"
              className={`publish-panel__btn ${hasQuiz ? 'publish-panel__btn--ghost' : reviewed ? 'publish-panel__btn--primary' : 'publish-panel__btn--secondary'}`}
              onClick={handleGenerateQuiz}
              disabled={quizBusy || !notesDrafted}
              title={notesDrafted ? undefined : 'Available once the notes are written'}
              data-action="generate-quiz"
            >
              {quizBusy ? (
                <Loader2 size={15} className="lecture-recap-panel__spin" aria-hidden />
              ) : hasQuiz ? (
                <RotateCw size={15} strokeWidth={2} aria-hidden />
              ) : (
                <Sparkles size={15} strokeWidth={2} aria-hidden />
              )}
              {quizBusy ? 'Writing…' : hasQuiz ? 'Regenerate' : 'Generate quiz'}
            </button>
          </div>
          {hasQuiz && quizOpen && (
            <ol className="lecture-recap-panel__questions publish-panel__questions">
              {questions.map((q, qi) => (
                <li key={qi}>
                  <p className="lecture-recap-panel__q">
                    {q.question}
                    {(q.topic || q.difficulty) && (
                      <span className="lecture-recap-panel__q-tags">
                        {q.topic ? <em>{q.topic}</em> : null}
                        {q.difficulty ? <em className={`is-${q.difficulty}`}>{q.difficulty}</em> : null}
                      </span>
                    )}
                  </p>
                  <ul>
                    {(q.options || []).map((opt, oi) => (
                      <li key={oi} className={oi === q.correctIndex ? 'is-correct' : ''}>
                        <span>{String.fromCharCode(65 + oi)}</span>
                        {opt}
                      </li>
                    ))}
                  </ul>
                  {q.explanation && <p className="lecture-recap-panel__q-why">{q.explanation}</p>}
                </li>
              ))}
              <li className="lecture-recap-panel__questions-note">
                Not happy with a question? Regenerate for a fresh set. Students only see answers after they submit.
              </li>
            </ol>
          )}
          {quizError && <p className="publish-panel__notice is-error publish-panel__notice--inline">{quizError}</p>}
        </li>

        <li className={`publish-panel__step ${step3}`}>
          <StepMarker n={3} state={step3} />
          <div className="publish-panel__step-body">
            <h3>
              <Send size={15} strokeWidth={2} aria-hidden /> Send to class
            </h3>
            <p>
              {sent
                ? 'Published. Share the link again any time — it always shows the latest notes and quiz.'
                : studentCount > 0
                  ? `Publishes the notes and emails ${studentsLabel} one recap link.`
                  : 'Publishes the notes. This class has no student emails — copy the link and share it.'}
              {!sent && !reviewed && notesDrafted ? ' Review the notes first.' : ''}
            </p>
            {(sent || recapUrl) && (
              <div className="publish-panel__share">
                <button type="button" className="publish-panel__link-btn" onClick={handleCopy} disabled={!recapUrl} data-action="copy-link">
                  {copied ? <Check size={15} strokeWidth={2.5} aria-hidden /> : <Link2 size={15} strokeWidth={2} aria-hidden />}
                  {copied ? 'Link copied' : 'Copy student link'}
                </button>
                {recapUrl && (
                  <a className="publish-panel__link-btn" href={recapUrl} target="_blank" rel="noreferrer" data-action="preview">
                    <ExternalLink size={14} strokeWidth={2} aria-hidden />
                    Preview as a student
                  </a>
                )}
                {sent && studentCount > 0 && (
                  <button type="button" className="publish-panel__link-btn" onClick={handleResend} disabled={sendBusy} data-action="resend-link">
                    <RotateCw size={14} strokeWidth={2} aria-hidden />
                    Email the link again
                  </button>
                )}
              </div>
            )}
          </div>
          <div className="publish-panel__step-action">
            {sent ? (
              <span className="publish-panel__done">
                <Check size={15} strokeWidth={3} aria-hidden /> Sent
              </span>
            ) : (
              <button
                type="button"
                className="publish-panel__btn publish-panel__btn--primary publish-panel__btn--send"
                onClick={handleSendToClass}
                disabled={!canSend || sendBusy}
                title={canSend ? undefined : 'Review and save the notes first'}
                data-action="send-to-class"
              >
                {sendBusy ? <Loader2 size={15} className="lecture-recap-panel__spin" aria-hidden /> : <Send size={15} strokeWidth={2} aria-hidden />}
                {sendBusy ? 'Sending…' : 'Send to class'}
              </button>
            )}
          </div>
        </li>
      </ol>

      {notice && <p className={`publish-panel__notice ${notice.ok ? 'is-ok' : 'is-error'}`} role="status">{notice.text}</p>}

      {pageCount > 0 && (
        <div className="publish-panel__pages-wrap">
          <p className="publish-panel__pages-label">What students will see from class</p>
          <div className="lecture-recap-panel__pages">
            {coveredPages.map((p, i) => (
              <figure key={`${p.type}-${p.index}`} className="lecture-recap-panel__page-thumb">
                <PageCanvas page={p} alt={p.type === 'slide' ? `Slide ${p.index + 1}` : 'Whiteboard page'} />
                <figcaption>
                  {p.type === 'slide' ? (
                    <Presentation size={11} strokeWidth={2.5} aria-hidden />
                  ) : (
                    <PenLine size={11} strokeWidth={2.5} aria-hidden />
                  )}
                  {i + 1}. {p.type === 'slide' ? `Slide ${p.index + 1}` : 'Whiteboard'}
                </figcaption>
              </figure>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

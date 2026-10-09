import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { Sparkles, Mail, Loader2, BarChart3, PenLine, Presentation, Check, Link2, ExternalLink, ChevronDown } from 'lucide-react';
import PageCanvas from './LecturePageCanvas';
import './LectureRecapPanel.css';

/**
 * Post-lecture panel on MeetingSummary.js. This is where a teacher turns a finished lecture
 * into what students get: the pages covered in class, the notes, a 5-question quiz and a place
 * to ask questions — all behind one link.
 *
 * Shown for every lecture, including ones taught with no slides or whiteboard: those students
 * still get the notes, the quiz and Q&A.
 * See server/routes/smartboard.js.
 */
export default function LectureRecapPanel({ meeting, onQuizGenerated }) {
  const navigate = useNavigate();
  const [quizBusy, setQuizBusy] = useState(false);
  const [quizError, setQuizError] = useState('');
  const [sendBusy, setSendBusy] = useState(false);
  const [sendNotice, setSendNotice] = useState(null); // { ok: boolean, text: string }
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
  const notesPublished = Boolean(String(meeting?.summary || '').trim());
  const notesDrafted = Boolean(String(meeting?.pendingSummary || '').trim());
  const notesReady = notesPublished || notesDrafted || Boolean(String(meeting?.transcription || '').trim());

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

  // The link exists as soon as the lecture does; fetch it up front so "Copy link" and
  // "Preview" work before any quiz is generated or email sent.
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
      setQuizError(
        err.response?.data?.error || 'Could not generate the quiz. The lecture notes may not be ready yet — try again in a moment.'
      );
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
      setQuizError(err.response?.data?.error || 'Could not update the required setting.');
    } finally {
      setMandatoryBusy(false);
    }
  };

  const handleSendRecap = async () => {
    setSendBusy(true);
    setSendNotice(null);
    try {
      const res = await axios.post(`/meetings/${meetingId}/recap/send`, null, { timeout: 120000 });
      if (res.data.recapUrl) setRecapUrl(res.data.recapUrl);
      const sent = Number(res.data.sent) || 0;
      const failed = Array.isArray(res.data.failed) ? res.data.failed.length : 0;
      setSendNotice({
        ok: failed === 0,
        text:
          failed === 0
            ? `Recap sent to ${sent} student${sent === 1 ? '' : 's'}.`
            : `Sent to ${sent}, but ${failed} could not be delivered. Copy the link and share it with them directly.`,
      });
    } catch (err) {
      setSendNotice({ ok: false, text: err.response?.data?.error || 'Could not send the recap email. Copy the link and share it instead.' });
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

  const notesStatus = notesPublished
    ? { tone: 'ok', text: 'Notes published' }
    : notesDrafted
      ? { tone: 'wait', text: 'Notes appear for students once you send the summary below' }
      : { tone: 'wait', text: 'Notes are still being written' };

  return (
    <div className="lecture-recap-panel" data-tour="lecture-recap-panel">
      <div className="lecture-recap-panel__head">
        <h2 className="meeting-summary-heading">Student recap</h2>
        <span className="lecture-recap-panel__meta">One link: what you covered, the notes, a quiz and Q&amp;A</span>
      </div>

      <ul className="lecture-recap-panel__checklist">
        <li className={pageCount > 0 ? 'is-ok' : 'is-muted'}>
          <span className="lecture-recap-panel__tick" aria-hidden>
            {pageCount > 0 ? <Check size={12} strokeWidth={3} /> : null}
          </span>
          {pageCount > 0
            ? `${pageCount} page${pageCount === 1 ? '' : 's'} from class, with your notes on them`
            : 'No slides or whiteboard pages were used in this lecture'}
        </li>
        <li className={notesStatus.tone === 'ok' ? 'is-ok' : 'is-wait'}>
          <span className="lecture-recap-panel__tick" aria-hidden>
            {notesStatus.tone === 'ok' ? <Check size={12} strokeWidth={3} /> : null}
          </span>
          {notesStatus.text}
        </li>
        <li className={hasQuiz ? 'is-ok' : 'is-wait'}>
          <span className="lecture-recap-panel__tick" aria-hidden>
            {hasQuiz ? <Check size={12} strokeWidth={3} /> : null}
          </span>
          {hasQuiz
            ? `${questions.length}-question quiz ready${mandatory ? ' · required' : ''}`
            : 'No quiz yet — generate one below'}
        </li>
      </ul>

      {pageCount > 0 && (
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
      )}

      <div className="lecture-recap-panel__actions">
        <button
          type="button"
          className="meeting-summary-btn meeting-summary-btn--secondary"
          onClick={handleGenerateQuiz}
          disabled={quizBusy || !notesReady}
          title={notesReady ? undefined : 'Available once the lecture notes are ready'}
          data-action="generate-quiz"
        >
          {quizBusy ? (
            <Loader2 size={16} className="lecture-recap-panel__spin" aria-hidden />
          ) : (
            <Sparkles size={16} strokeWidth={2} aria-hidden />
          )}
          {quizBusy ? 'Writing the quiz…' : hasQuiz ? 'Regenerate quiz' : 'Generate 5-question quiz'}
        </button>
        <button
          type="button"
          className="meeting-summary-btn meeting-summary-btn--primary"
          onClick={handleSendRecap}
          disabled={sendBusy || studentCount === 0}
          title={studentCount === 0 ? 'This lecture has no student emails' : undefined}
          data-action="send-recap"
        >
          {sendBusy ? (
            <Loader2 size={16} className="lecture-recap-panel__spin" aria-hidden />
          ) : (
            <Mail size={16} strokeWidth={2} aria-hidden />
          )}
          {sendBusy ? 'Sending…' : `Email recap to ${studentCount > 0 ? `${studentCount} student${studentCount === 1 ? '' : 's'}` : 'class'}`}
        </button>
        <button
          type="button"
          className="meeting-summary-btn meeting-summary-btn--secondary"
          onClick={handleCopy}
          disabled={!recapUrl}
          data-action="copy-link"
        >
          {copied ? <Check size={16} strokeWidth={2.5} aria-hidden /> : <Link2 size={16} strokeWidth={2} aria-hidden />}
          {copied ? 'Link copied' : 'Copy student link'}
        </button>
        {recapUrl && (
          <a className="lecture-recap-panel__preview" href={recapUrl} target="_blank" rel="noreferrer" data-action="preview">
            <ExternalLink size={14} strokeWidth={2} aria-hidden />
            Preview as a student
          </a>
        )}
      </div>

      {quizError && <p className="lecture-recap-panel__error">{quizError}</p>}
      {sendNotice && (
        <p className={sendNotice.ok ? 'lecture-recap-panel__notice' : 'lecture-recap-panel__error'}>{sendNotice.text}</p>
      )}

      {hasQuiz && (
        <div className="lecture-recap-panel__quiz">
          <div className="lecture-recap-panel__quiz-settings">
            <label className="lecture-recap-panel__toggle">
              <input type="checkbox" checked={mandatory} disabled={mandatoryBusy} onChange={handleToggleMandatory} />
              <span>Required: students must enter their name and email to take it</span>
            </label>
            <button type="button" className="lecture-recap-panel__results-link" onClick={() => navigate('/quiz-results')}>
              <BarChart3 size={14} strokeWidth={2} aria-hidden />
              {attemptCount > 0 ? `${attemptCount} attempt${attemptCount === 1 ? '' : 's'} so far` : 'No attempts yet'} · view results
            </button>
          </div>

          <button
            type="button"
            className="lecture-recap-panel__quiz-toggle"
            onClick={() => setQuizOpen((v) => !v)}
            aria-expanded={quizOpen}
            data-action="toggle-quiz"
          >
            <ChevronDown size={16} strokeWidth={2} aria-hidden className={quizOpen ? 'is-open' : ''} />
            {quizOpen ? 'Hide the questions' : 'Review the questions and answers'}
          </button>

          {quizOpen && (
            <ol className="lecture-recap-panel__questions">
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
                Not happy with a question? Regenerate to get a fresh set. Students never see the answers until they submit.
              </li>
            </ol>
          )}
        </div>
      )}
    </div>
  );
}

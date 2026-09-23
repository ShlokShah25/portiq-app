import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { Sparkles, Mail, Loader2, BarChart3, PenLine, Presentation } from 'lucide-react';
import './LectureRecapPanel.css';

/**
 * Post-lecture panel on MeetingSummary.js: generate the 5-question quiz (needs the
 * finished summary, which is why this lives here and not on the live Smartboard panel
 * in MeetingInProgress.js) and email the interactive recap link to the class.
 * Rendered when this lecture has either an uploaded slide deck or any touched
 * whiteboard pages — a teacher who only used the whiteboard still gets a recap.
 * See server/routes/smartboard.js.
 */
export default function LectureRecapPanel({ meeting, onQuizGenerated }) {
  const navigate = useNavigate();
  const [quizBusy, setQuizBusy] = useState(false);
  const [quizError, setQuizError] = useState('');
  const [sendBusy, setSendBusy] = useState(false);
  const [sendNotice, setSendNotice] = useState('');
  const [recapUrl, setRecapUrl] = useState('');
  const [mandatoryBusy, setMandatoryBusy] = useState(false);

  const slideCount = (meeting?.slideDeck?.slides || []).filter((s) => s.shownAt).length;
  const whiteboardCount = (meeting?.whiteboard?.pages || []).filter((p) => p.touchedAt).length;
  const pageCount = slideCount + whiteboardCount;
  const hasQuiz = (meeting?.quiz?.questions || []).length > 0;
  const mandatory = Boolean(meeting?.quiz?.mandatory);
  const attemptCount = (meeting?.quiz?.attempts || []).length;

  // Same merge server/routes/smartboard.js does for the student recap page, done
  // client-side here so the teacher can see — before sending anything — that both
  // slides and whiteboard pages actually made it into what students will see, in the
  // order they were used, not just whichever type happens to render first.
  const coveredPages = useMemo(() => {
    const slides = (meeting?.slideDeck?.slides || [])
      .filter((s) => !!s.shownAt)
      .map((s) => ({ type: 'slide', index: s.index, imageUrl: s.imageUrl, at: s.shownAt }));
    const wbPages = (meeting?.whiteboard?.pages || [])
      .filter((p) => !!p.touchedAt)
      .map((p) => ({ type: 'whiteboard', index: p.index, at: p.touchedAt }));
    return [...slides, ...wbPages].sort((a, b) => new Date(a.at) - new Date(b.at));
  }, [meeting?.slideDeck?.slides, meeting?.whiteboard?.pages]);

  if (pageCount === 0) return null;

  const handleGenerateQuiz = async () => {
    setQuizBusy(true);
    setQuizError('');
    try {
      const res = await axios.post(`/meetings/${meeting._id}/quiz/generate`);
      setRecapUrl(res.data.recapUrl || '');
      onQuizGenerated?.(res.data.quiz);
    } catch (err) {
      setQuizError(err.response?.data?.error || 'Could not generate the quiz — the lecture summary may not be ready yet.');
    } finally {
      setQuizBusy(false);
    }
  };

  const handleToggleMandatory = async () => {
    setMandatoryBusy(true);
    setQuizError('');
    try {
      const res = await axios.put(`/meetings/${meeting._id}/quiz/mandatory`, { mandatory: !mandatory });
      onQuizGenerated?.({ ...meeting.quiz, mandatory: res.data.mandatory });
    } catch (err) {
      setQuizError(err.response?.data?.error || 'Could not update the mandatory setting.');
    } finally {
      setMandatoryBusy(false);
    }
  };

  const handleSendRecap = async () => {
    setSendBusy(true);
    setSendNotice('');
    try {
      const res = await axios.post(`/meetings/${meeting._id}/recap/send`);
      setRecapUrl(res.data.recapUrl || '');
      setSendNotice('Recap link emailed to the class.');
    } catch (err) {
      setSendNotice(err.response?.data?.error || 'Could not send the recap email.');
    } finally {
      setSendBusy(false);
    }
  };

  return (
    <div className="lecture-recap-panel">
      <div className="lecture-recap-panel__head">
        <h2 className="meeting-summary-heading">Interactive lecture recap</h2>
        <span className="lecture-recap-panel__meta">{pageCount} page{pageCount === 1 ? '' : 's'} covered</span>
      </div>
      <p className="lecture-recap-panel__body">
        Give students what you actually covered — slides and whiteboard pages, with your notes on them, in the order
        you used them — plus this lecture's summary and a 5-question quiz to check their understanding.
      </p>

      <div className="lecture-recap-panel__pages">
        {coveredPages.map((p, i) => (
          <div key={`${p.type}-${p.index}`} className="lecture-recap-panel__page-thumb" title={`${i + 1}. ${p.type === 'slide' ? 'Slide' : 'Whiteboard'}`}>
            {p.type === 'slide' ? (
              <img src={p.imageUrl} alt={`Slide ${p.index + 1}`} />
            ) : (
              <div className="lecture-recap-panel__page-thumb-wb">
                <PenLine size={16} strokeWidth={2} aria-hidden />
              </div>
            )}
            <span className="lecture-recap-panel__page-thumb-badge">
              {p.type === 'slide' ? <Presentation size={10} strokeWidth={2.5} aria-hidden /> : <PenLine size={10} strokeWidth={2.5} aria-hidden />}
              {i + 1}
            </span>
          </div>
        ))}
      </div>

      <div className="lecture-recap-panel__actions">
        <button type="button" className="meeting-summary-btn meeting-summary-btn--secondary" onClick={handleGenerateQuiz} disabled={quizBusy}>
          {quizBusy ? <Loader2 size={16} className="lecture-recap-panel__spin" aria-hidden /> : <Sparkles size={16} strokeWidth={2} aria-hidden />}
          {hasQuiz ? 'Regenerate quiz' : 'Generate 5-question quiz'}
        </button>
        <button type="button" className="meeting-summary-btn meeting-summary-btn--primary" onClick={handleSendRecap} disabled={sendBusy}>
          {sendBusy ? <Loader2 size={16} className="lecture-recap-panel__spin" aria-hidden /> : <Mail size={16} strokeWidth={2} aria-hidden />}
          Send recap to class
        </button>
      </div>
      {hasQuiz && (
        <div className="lecture-recap-panel__quiz-settings">
          <label className="lecture-recap-panel__toggle">
            <input type="checkbox" checked={mandatory} disabled={mandatoryBusy} onChange={handleToggleMandatory} />
            <span>Make this quiz mandatory — students must give their name &amp; email to take it</span>
          </label>
          <button
            type="button"
            className="lecture-recap-panel__results-link"
            onClick={() => navigate('/quiz-results')}
          >
            <BarChart3 size={14} strokeWidth={2} aria-hidden />
            {attemptCount > 0 ? `${attemptCount} attempt${attemptCount === 1 ? '' : 's'} so far` : 'No attempts yet'} — view results
          </button>
        </div>
      )}
      {quizError && <p className="lecture-recap-panel__error">{quizError}</p>}
      {sendNotice && <p className="lecture-recap-panel__notice">{sendNotice}</p>}
      {recapUrl && (
        <a className="lecture-recap-panel__link" href={recapUrl} target="_blank" rel="noreferrer">
          Preview recap page →
        </a>
      )}
    </div>
  );
}

import React, { useState } from 'react';
import axios from 'axios';
import { Sparkles, Mail, Loader2 } from 'lucide-react';
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
  const [quizBusy, setQuizBusy] = useState(false);
  const [quizError, setQuizError] = useState('');
  const [sendBusy, setSendBusy] = useState(false);
  const [sendNotice, setSendNotice] = useState('');
  const [recapUrl, setRecapUrl] = useState('');

  const slideCount = (meeting?.slideDeck?.slides || []).filter((s) => s.shownAt).length;
  const whiteboardCount = (meeting?.whiteboard?.pages || []).filter((p) => p.touchedAt).length;
  const pageCount = slideCount + whiteboardCount;
  const hasQuiz = (meeting?.quiz?.questions || []).length > 0;

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

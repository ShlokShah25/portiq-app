import React, { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';
import * as fabric from 'fabric';
import './LectureRecap.css';

const STAGE_W = 1000;
const STAGE_H = 562;

/**
 * One covered page — a slide (rasterized image) or a whiteboard page (blank) — with
 * the teacher's saved annotations rendered read-only on top. Pages are shown in the
 * order the teacher actually used them during the lecture (see the `pages` timeline
 * server/routes/smartboard.js builds), not grouped by type, so the recap replays the
 * lecture the way it happened — slide, then a blank page to work a problem, then back.
 */
function RecapPage({ page, position }) {
  const canvasElRef = useRef(null);
  const isWhiteboard = page.type === 'whiteboard';

  useEffect(() => {
    if (!canvasElRef.current) return undefined;
    const canvas = new fabric.Canvas(canvasElRef.current, {
      selection: false,
      evented: false,
      width: STAGE_W,
      height: STAGE_H,
    });
    if (page.annotations) {
      canvas.loadFromJSON(page.annotations).then(() => canvas.renderAll());
    }
    return () => canvas.dispose();
  }, [page.annotations]);

  return (
    <figure className={`lecture-recap-slide${isWhiteboard ? ' lecture-recap-slide--whiteboard' : ''}`}>
      <div className="lecture-recap-slide__stage" style={{ aspectRatio: `${STAGE_W} / ${STAGE_H}` }}>
        {isWhiteboard ? (
          <div className="lecture-recap-slide__whiteboard-bg" aria-hidden />
        ) : (
          <img className="lecture-recap-slide__img" src={page.imageUrl} alt={`Slide ${position}`} />
        )}
        <canvas ref={canvasElRef} className="lecture-recap-slide__canvas" />
      </div>
      <figcaption>
        {position}. {isWhiteboard ? 'Whiteboard' : 'Slide'}
      </figcaption>
    </figure>
  );
}

function Quiz({ questions, token, mandatory }) {
  const [answers, setAnswers] = useState(() => Array(questions.length).fill(-1));
  const [submitting, setSubmitting] = useState(false);
  const [results, setResults] = useState(null);
  const [error, setError] = useState('');
  const [studentName, setStudentName] = useState('');
  const [studentEmail, setStudentEmail] = useState('');

  const allAnswered = answers.every((a) => a >= 0);
  const identityOk = !mandatory || (studentName.trim() && studentEmail.trim().includes('@'));

  const submit = async () => {
    setSubmitting(true);
    setError('');
    try {
      const res = await axios.post(`/public/lectures/${token}/quiz-attempt`, {
        answers,
        studentName: studentName.trim(),
        studentEmail: studentEmail.trim(),
      });
      setResults(res.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not submit your answers. Check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (questions.length === 0) return null;

  return (
    <section className="lecture-recap-quiz">
      <h2>Check your understanding</h2>
      {mandatory && !results && (
        <p className="lecture-recap-quiz__mandatory-note">
          Your teacher has made this quiz mandatory — enter your name and email so your attempt is recorded.
        </p>
      )}
      {mandatory && !results && (
        <div className="lecture-recap-quiz__identity">
          <input
            type="text"
            placeholder="Your name"
            value={studentName}
            onChange={(e) => setStudentName(e.target.value)}
            className="lecture-recap-quiz__identity-input"
          />
          <input
            type="email"
            placeholder="Your email"
            value={studentEmail}
            onChange={(e) => setStudentEmail(e.target.value)}
            className="lecture-recap-quiz__identity-input"
          />
        </div>
      )}
      {results && (
        <p className="lecture-recap-quiz__score">
          You scored {results.score} / {results.total}
        </p>
      )}
      {questions.map((q, qi) => {
        const result = results?.results?.[qi];
        return (
          <div key={qi} className="lecture-recap-quiz__question">
            <p className="lecture-recap-quiz__prompt">
              {qi + 1}. {q.question}
            </p>
            <div className="lecture-recap-quiz__options">
              {q.options.map((opt, oi) => {
                const chosen = answers[qi] === oi;
                let stateClass = '';
                if (result) {
                  if (oi === result.correctIndex) stateClass = 'is-correct';
                  else if (chosen && !result.correct) stateClass = 'is-wrong';
                }
                return (
                  <label key={oi} className={`lecture-recap-quiz__option ${stateClass}`}>
                    <input
                      type="radio"
                      name={`q${qi}`}
                      checked={chosen}
                      disabled={!!results}
                      onChange={() =>
                        setAnswers((prev) => {
                          const next = [...prev];
                          next[qi] = oi;
                          return next;
                        })
                      }
                    />
                    {opt}
                  </label>
                );
              })}
            </div>
            {result && result.explanation && (
              <p className="lecture-recap-quiz__explanation">{result.explanation}</p>
            )}
          </div>
        );
      })}
      {!results && (
        <button
          type="button"
          className="lecture-recap-quiz__submit"
          onClick={submit}
          disabled={!allAnswered || !identityOk || submitting}
        >
          {submitting ? 'Submitting…' : 'Submit answers'}
        </button>
      )}
      {error && <p className="lecture-recap-quiz__error">{error}</p>}
    </section>
  );
}

/**
 * Ask-the-AI panel on the student recap page: answers from the lecture summary/
 * transcript only, and — if that answer isn't good enough — a one-click way to
 * send the question straight to the teacher's inbox instead. See
 * POST /:token/ask and /:token/escalate in server/routes/smartboard.js.
 */
function StudentQA({ token, teacherAvailable }) {
  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const [thread, setThread] = useState([]); // [{ question, answer }]
  const [error, setError] = useState('');
  const [escalatingFor, setEscalatingFor] = useState(null);
  const [escalateEmail, setEscalateEmail] = useState('');
  const [escalateStatus, setEscalateStatus] = useState({});

  const ask = async () => {
    const q = question.trim();
    if (!q || asking) return;
    setAsking(true);
    setError('');
    try {
      const res = await axios.post(`/public/lectures/${token}/ask`, { question: q });
      setThread((prev) => [...prev, { question: q, answer: res.data.answer }]);
      setQuestion('');
    } catch (err) {
      setError(err.response?.data?.error || 'Could not get an answer right now.');
    } finally {
      setAsking(false);
    }
  };

  const escalate = async (i) => {
    const item = thread[i];
    try {
      await axios.post(`/public/lectures/${token}/escalate`, {
        question: item.question,
        aiAnswer: item.answer,
        studentEmail: escalateEmail.trim(),
      });
      setEscalateStatus((prev) => ({ ...prev, [i]: 'sent' }));
      setEscalatingFor(null);
    } catch (err) {
      setEscalateStatus((prev) => ({ ...prev, [i]: err.response?.data?.error || 'Could not send this to your teacher.' }));
    }
  };

  return (
    <section className="lecture-recap-qa">
      <h2>Ask a question about this lecture</h2>
      <p className="lecture-recap-qa__hint">
        Get an instant AI answer based on what was actually taught. If it's not helpful, send it straight to your
        teacher.
      </p>

      {thread.map((item, i) => (
        <div key={i} className="lecture-recap-qa__item">
          <p className="lecture-recap-qa__q">{item.question}</p>
          <p className="lecture-recap-qa__a">{item.answer}</p>
          {escalateStatus[i] === 'sent' ? (
            <p className="lecture-recap-qa__escalate-status is-sent">Sent to your teacher.</p>
          ) : escalateStatus[i] ? (
            <p className="lecture-recap-qa__escalate-status is-error">{escalateStatus[i]}</p>
          ) : escalatingFor === i ? (
            <div className="lecture-recap-qa__escalate-form">
              <input
                type="email"
                placeholder="Your email (so your teacher can reply)"
                value={escalateEmail}
                onChange={(e) => setEscalateEmail(e.target.value)}
              />
              <button type="button" onClick={() => escalate(i)}>
                Send to teacher
              </button>
              <button type="button" className="lecture-recap-qa__escalate-cancel" onClick={() => setEscalatingFor(null)}>
                Cancel
              </button>
            </div>
          ) : teacherAvailable ? (
            <button type="button" className="lecture-recap-qa__escalate-btn" onClick={() => setEscalatingFor(i)}>
              Not helpful? Ask your teacher →
            </button>
          ) : null}
        </div>
      ))}

      <div className="lecture-recap-qa__composer">
        <input
          type="text"
          placeholder="e.g. Why does the second example use a different formula?"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && ask()}
          disabled={asking}
        />
        <button type="button" onClick={ask} disabled={asking || !question.trim()}>
          {asking ? 'Asking…' : 'Ask'}
        </button>
      </div>
      {error && <p className="lecture-recap-qa__error">{error}</p>}
    </section>
  );
}

export default function LectureRecap() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await axios.get(`/public/lectures/${token}`);
        if (!cancelled) setData(res.data);
      } catch (err) {
        if (!cancelled) setError(err.response?.data?.error || 'This lecture recap link is invalid or has expired.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (loading) {
    return (
      <div className="lecture-recap-screen">
        <div className="lecture-recap-loading">Loading lecture recap…</div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="lecture-recap-screen">
        <div className="lecture-recap-error">{error || 'Lecture not found.'}</div>
      </div>
    );
  }

  const lectureDate = data.lectureDate ? new Date(data.lectureDate).toLocaleDateString(undefined, { dateStyle: 'medium' }) : '';

  return (
    <div className="lecture-recap-screen">
      <div className="lecture-recap-container">
        <header className="lecture-recap-header">
          <p className="lecture-recap-eyebrow">{data.subject || 'Lecture'} recap</p>
          <h1>{data.title}</h1>
          <p className="lecture-recap-meta">
            {data.teacherName ? `${data.teacherName} · ` : ''}
            {lectureDate}
          </p>
        </header>

        {(data.pages || data.slides || []).length > 0 && (
          <section className="lecture-recap-slides">
            <h2>Covered in class</h2>
            <div className="lecture-recap-slides__grid">
              {(data.pages || data.slides || []).map((p, i) => (
                <RecapPage key={`${p.type || 'slide'}-${p.index}`} page={p} position={i + 1} />
              ))}
            </div>
          </section>
        )}

        {data.summary && (
          <section className="lecture-recap-summary">
            <h2>Lecture summary</h2>
            <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
              {data.summary}
            </ReactMarkdown>
          </section>
        )}

        <StudentQA token={token} teacherAvailable={Boolean(data.teacherContactAvailable)} />

        <Quiz questions={data.quiz || []} token={token} mandatory={Boolean(data.quizMandatory)} />
      </div>
    </div>
  );
}

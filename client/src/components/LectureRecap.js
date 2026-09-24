import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';
import * as fabric from 'fabric';
import Skeleton from './Skeleton';
import './LectureRecap.css';

const STAGE_W = 1000;
const STAGE_H = 562;

/**
 * A short confetti burst, built from plain DOM elements + CSS animation rather than
 * a new dependency (no canvas-confetti in package.json, and this sandbox can't run
 * `npm install` to verify a new package would even resolve). Fires once on a strong
 * quiz score — see Quiz below — and cleans up after itself.
 */
function launchConfetti() {
  const colors = ['#f87171', '#fb923c', '#facc15', '#4ade80', '#60a5fa', '#a78bfa', '#f472b6'];
  const layer = document.createElement('div');
  layer.className = 'lecture-recap-confetti-layer';
  for (let i = 0; i < 60; i += 1) {
    const piece = document.createElement('span');
    piece.className = 'lecture-recap-confetti-piece';
    piece.style.left = `${Math.random() * 100}%`;
    piece.style.background = colors[i % colors.length];
    piece.style.animationDelay = `${(Math.random() * 0.3).toFixed(2)}s`;
    piece.style.animationDuration = `${(1.6 + Math.random() * 0.9).toFixed(2)}s`;
    piece.style.setProperty('--drift', `${Math.round((Math.random() - 0.5) * 160)}px`);
    piece.style.setProperty('--rot', `${Math.round(Math.random() * 720 - 360)}deg`);
    layer.appendChild(piece);
  }
  document.body.appendChild(layer);
  setTimeout(() => layer.remove(), 3000);
}

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
  const [current, setCurrent] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [results, setResults] = useState(null);
  const [error, setError] = useState('');
  const [studentName, setStudentName] = useState('');
  const [studentEmail, setStudentEmail] = useState('');

  const allAnswered = answers.every((a) => a >= 0);
  const identityOk = !mandatory || (studentName.trim() && studentEmail.trim().includes('@'));
  const isLast = current === questions.length - 1;

  // Per-topic score breakdown for the results screen — grouped in the order topics
  // first appear so it reads like the lecture, not alphabetized.
  const topicBreakdown = useMemo(() => {
    if (!results?.results) return [];
    const order = [];
    const byTopic = {};
    questions.forEach((q, qi) => {
      const label = (q.topic || '').trim() || 'General';
      if (!byTopic[label]) {
        byTopic[label] = { label, correct: 0, total: 0 };
        order.push(label);
      }
      byTopic[label].total += 1;
      if (results.results[qi]?.correct) byTopic[label].correct += 1;
    });
    return order.map((label) => byTopic[label]);
  }, [results, questions]);

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
      if (res.data?.total > 0 && res.data.score / res.data.total >= 0.8) {
        launchConfetti();
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Could not submit your answers. Check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (questions.length === 0) return null;

  // Once submitted, show every question with its result so the student can review
  // right/wrong answers at a glance — the one-at-a-time flow is only for answering.
  if (results) {
    return (
      <section className="lecture-recap-quiz">
        <h2>Check your understanding</h2>
        <p className="lecture-recap-quiz__score">
          You scored {results.score} / {results.total}
        </p>
        {topicBreakdown.length > 1 && (
          <div className="lecture-recap-quiz__breakdown">
            {topicBreakdown.map((t) => {
              const pct = t.total > 0 ? Math.round((t.correct / t.total) * 100) : 0;
              return (
                <div key={t.label} className="lecture-recap-quiz__breakdown-row">
                  <div className="lecture-recap-quiz__breakdown-labels">
                    <span>{t.label}</span>
                    <span>
                      {t.correct}/{t.total}
                    </span>
                  </div>
                  <div className="lecture-recap-quiz__breakdown-track">
                    <div
                      className={`lecture-recap-quiz__breakdown-fill${pct < 60 ? ' is-low' : ''}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {questions.map((q, qi) => {
          const result = results.results?.[qi];
          return (
            <div key={qi} className="lecture-recap-quiz__question">
              <p className="lecture-recap-quiz__prompt">
                {qi + 1}. {q.question}
              </p>
              <div className="lecture-recap-quiz__options">
                {q.options.map((opt, oi) => {
                  const chosen = answers[qi] === oi;
                  let stateClass = '';
                  if (oi === result?.correctIndex) stateClass = 'is-correct';
                  else if (chosen && !result?.correct) stateClass = 'is-wrong';
                  return (
                    <label key={oi} className={`lecture-recap-quiz__option ${stateClass}`}>
                      <input type="radio" checked={chosen} disabled readOnly />
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
      </section>
    );
  }

  const q = questions[current];

  return (
    <section className="lecture-recap-quiz">
      <h2>Check your understanding</h2>
      {mandatory && (
        <p className="lecture-recap-quiz__mandatory-note">
          Your teacher has made this quiz mandatory — enter your name and email so your attempt is recorded.
        </p>
      )}
      {mandatory && (
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

      <div className="lecture-recap-quiz__dots" role="tablist" aria-label="Question progress">
        {questions.map((_, qi) => (
          <button
            key={qi}
            type="button"
            role="tab"
            aria-selected={qi === current}
            aria-label={`Question ${qi + 1}${answers[qi] >= 0 ? ', answered' : ''}`}
            className={`lecture-recap-quiz__dot${qi === current ? ' is-current' : ''}${
              answers[qi] >= 0 ? ' is-answered' : ''
            }`}
            onClick={() => setCurrent(qi)}
          />
        ))}
      </div>

      <div className="lecture-recap-quiz__question lecture-recap-quiz__question--single">
        <p className="lecture-recap-quiz__step">
          Question {current + 1} of {questions.length}
        </p>
        <p className="lecture-recap-quiz__prompt">{q.question}</p>
        <div className="lecture-recap-quiz__options">
          {q.options.map((opt, oi) => {
            const chosen = answers[current] === oi;
            return (
              <label key={oi} className={`lecture-recap-quiz__option${chosen ? ' is-selected' : ''}`}>
                <input
                  type="radio"
                  name={`q${current}`}
                  checked={chosen}
                  onChange={() =>
                    setAnswers((prev) => {
                      const next = [...prev];
                      next[current] = oi;
                      return next;
                    })
                  }
                />
                {opt}
              </label>
            );
          })}
        </div>
      </div>

      <div className="lecture-recap-quiz__nav">
        <button
          type="button"
          className="lecture-recap-quiz__nav-btn"
          onClick={() => setCurrent((c) => Math.max(0, c - 1))}
          disabled={current === 0}
        >
          Back
        </button>
        {isLast ? (
          <button
            type="button"
            className="lecture-recap-quiz__submit"
            onClick={submit}
            disabled={!allAnswered || !identityOk || submitting}
          >
            {submitting ? 'Submitting…' : 'Submit answers'}
          </button>
        ) : (
          <button
            type="button"
            className="lecture-recap-quiz__nav-btn lecture-recap-quiz__nav-btn--primary"
            onClick={() => setCurrent((c) => Math.min(questions.length - 1, c + 1))}
          >
            Next
          </button>
        )}
      </div>
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
  const [pendingQuestion, setPendingQuestion] = useState('');
  const [thread, setThread] = useState([]); // [{ question, answer }]
  const [error, setError] = useState('');
  const [escalatingFor, setEscalatingFor] = useState(null);
  const [escalateEmail, setEscalateEmail] = useState('');
  const [escalateStatus, setEscalateStatus] = useState({});

  const ask = async () => {
    const q = question.trim();
    if (!q || asking) return;
    setAsking(true);
    setPendingQuestion(q);
    setError('');
    setQuestion('');
    try {
      const res = await axios.post(`/public/lectures/${token}/ask`, { question: q });
      setThread((prev) => [...prev, { question: q, answer: res.data.answer }]);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not get an answer right now.');
      setQuestion(q);
    } finally {
      setAsking(false);
      setPendingQuestion('');
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

      {asking && (
        <div className="lecture-recap-qa__item lecture-recap-qa__item--pending">
          <p className="lecture-recap-qa__q">{pendingQuestion}</p>
          <p className="lecture-recap-qa__a lecture-recap-qa__thinking" aria-label="Thinking">
            <span />
            <span />
            <span />
          </p>
        </div>
      )}

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
  const [scrollPct, setScrollPct] = useState(0);
  const screenRef = useRef(null);

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

  // Reading-progress bar — gives a student a sense of how much of the recap is left,
  // rather than an unbroken scroll with no landmarks. `.lecture-recap-screen` itself is
  // the scrolling element (overflow-y: auto), not the window, so we track it directly.
  useEffect(() => {
    const el = screenRef.current;
    if (!el) return undefined;
    const onScroll = () => {
      const scrollable = el.scrollHeight - el.clientHeight;
      setScrollPct(scrollable > 0 ? Math.min(100, Math.max(0, (el.scrollTop / scrollable) * 100)) : 0);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => el.removeEventListener('scroll', onScroll);
  }, [data]);

  const readMinutes = useMemo(() => {
    const words = String(data?.summary || '')
      .trim()
      .split(/\s+/)
      .filter(Boolean).length;
    return words > 0 ? Math.max(1, Math.round(words / 200)) : 0;
  }, [data?.summary]);

  if (loading) {
    return (
      <div className="lecture-recap-screen">
        <div className="lecture-recap-container">
          <Skeleton width="40%" height={13} style={{ marginBottom: 10 }} />
          <Skeleton width="70%" height={26} style={{ marginBottom: 20 }} />
          <div className="lecture-recap-slides__grid">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} width="100%" height={140} radius={12} />
            ))}
          </div>
          <Skeleton width="100%" height={12} style={{ marginTop: 28 }} />
          <Skeleton width="90%" height={12} style={{ marginTop: 8 }} />
          <Skeleton width="60%" height={12} style={{ marginTop: 8 }} />
        </div>
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
    <div className="lecture-recap-screen" ref={screenRef}>
      <div className="lecture-recap-progress-track" aria-hidden>
        <div className="lecture-recap-progress-bar" style={{ width: `${scrollPct}%` }} />
      </div>
      <div className="lecture-recap-container">
        <header className="lecture-recap-header">
          <p className="lecture-recap-eyebrow">{data.subject || 'Lecture'} recap</p>
          <h1>{data.title}</h1>
          <p className="lecture-recap-meta">
            {data.teacherName ? `${data.teacherName} · ` : ''}
            {lectureDate}
            {readMinutes > 0 ? ` · ~${readMinutes} min read` : ''}
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

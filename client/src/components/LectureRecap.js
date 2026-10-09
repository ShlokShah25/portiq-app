import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';
import Skeleton from './Skeleton';
import PageCanvas, { hasDrawing } from './LecturePageCanvas';
import { formatLectureNotesMarkdown, splitNumberedItems } from '../utils/lectureNotesFormat';
import './LectureRecap.css';

const IDENTITY_KEY = 'portiq_student_identity_v1';
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function readIdentity() {
  try {
    const raw = window.localStorage.getItem(IDENTITY_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return { name: String(parsed?.name || ''), email: String(parsed?.email || '') };
  } catch {
    return { name: '', email: '' };
  }
}

function saveIdentity(name, email) {
  try {
    window.localStorage.setItem(IDENTITY_KEY, JSON.stringify({ name, email }));
  } catch {
    /* private mode — nothing to remember */
  }
}

/** A short confetti burst built from plain DOM + CSS (no extra dependency). Fires on a strong quiz score. */
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

const pageLabel = (page) => (page.type === 'whiteboard' ? 'Whiteboard' : `Slide ${page.index + 1}`);

/** "Covered in class": one large page at a time, a strip of thumbnails, and a full-screen view. */
function PagesViewer({ pages }) {
  const [active, setActive] = useState(0);
  const [zoomed, setZoomed] = useState(false);
  const stripRef = useRef(null);
  const total = pages.length;
  const safeActive = Math.min(active, total - 1);
  const page = pages[safeActive];

  const go = useCallback(
    (next) => {
      setActive((prev) => {
        const target = typeof next === 'function' ? next(prev) : next;
        return Math.max(0, Math.min(total - 1, target));
      });
    },
    [total]
  );

  useEffect(() => {
    if (!zoomed) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') setZoomed(false);
      else if (e.key === 'ArrowRight') go((p) => p + 1);
      else if (e.key === 'ArrowLeft') go((p) => p - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [zoomed, go]);

  // Keep the selected thumbnail in view without scrolling the whole page.
  useEffect(() => {
    const strip = stripRef.current;
    const thumb = strip?.children?.[safeActive];
    if (!strip || !thumb) return;
    const left = thumb.offsetLeft - strip.clientWidth / 2 + thumb.clientWidth / 2;
    strip.scrollTo({ left: Math.max(0, left), behavior: 'smooth' });
  }, [safeActive]);

  const caption = `${pageLabel(page)}${hasDrawing(page) && page.type !== 'whiteboard' ? " · with your teacher's notes" : ''}`;

  return (
    <div className="lecture-recap-viewer">
      <div className="lecture-recap-viewer__main">
        <button
          type="button"
          className="lecture-recap-viewer__open"
          onClick={() => setZoomed(true)}
          aria-label={`Open ${pageLabel(page)} full screen`}
        >
          <PageCanvas key={`${page.type}-${page.index}`} page={page} alt={pageLabel(page)} />
        </button>
        <div className="lecture-recap-viewer__bar">
          <button
            type="button"
            className="lecture-recap-viewer__nav"
            onClick={() => go(safeActive - 1)}
            disabled={safeActive === 0}
            aria-label="Previous page"
          >
            ‹
          </button>
          <span className="lecture-recap-viewer__caption">
            <strong>
              {safeActive + 1} / {total}
            </strong>
            <span>{caption}</span>
          </span>
          <button
            type="button"
            className="lecture-recap-viewer__nav"
            onClick={() => go(safeActive + 1)}
            disabled={safeActive === total - 1}
            aria-label="Next page"
          >
            ›
          </button>
          <button type="button" className="lecture-recap-viewer__expand" onClick={() => setZoomed(true)}>
            Full screen
          </button>
        </div>
      </div>

      {total > 1 && (
        <div className="lecture-recap-viewer__strip" ref={stripRef}>
          {pages.map((p, i) => (
            <button
              key={`${p.type}-${p.index}`}
              type="button"
              className={`lecture-recap-viewer__thumb${i === safeActive ? ' is-active' : ''}`}
              onClick={() => go(i)}
              aria-label={`Page ${i + 1}: ${pageLabel(p)}`}
              aria-current={i === safeActive ? 'true' : undefined}
            >
              <PageCanvas page={p} alt="" />
              <span className="lecture-recap-viewer__thumb-num">{i + 1}</span>
            </button>
          ))}
        </div>
      )}

      {zoomed && (
        <div className="lecture-recap-lightbox" role="dialog" aria-modal="true" aria-label={pageLabel(page)} onClick={() => setZoomed(false)}>
          <div className="lecture-recap-lightbox__page" onClick={(e) => e.stopPropagation()}>
            <PageCanvas key={`zoom-${page.type}-${page.index}`} page={page} alt={pageLabel(page)} />
          </div>
          <div className="lecture-recap-lightbox__bar" onClick={(e) => e.stopPropagation()}>
            <button type="button" onClick={() => go(safeActive - 1)} disabled={safeActive === 0} aria-label="Previous page">
              ‹
            </button>
            <span>
              {safeActive + 1} / {total} · {pageLabel(page)}
            </span>
            <button type="button" onClick={() => go(safeActive + 1)} disabled={safeActive === total - 1} aria-label="Next page">
              ›
            </button>
            <button type="button" onClick={() => setZoomed(false)}>
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Markdown({ children }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
      {children}
    </ReactMarkdown>
  );
}

function ScoreRing({ score, total }) {
  const pct = total > 0 ? score / total : 0;
  const r = 34;
  const c = 2 * Math.PI * r;
  const tone = pct >= 0.8 ? 'good' : pct >= 0.5 ? 'ok' : 'low';
  return (
    <div className={`lecture-recap-score lecture-recap-score--${tone}`}>
      <svg viewBox="0 0 80 80" width="92" height="92" aria-hidden>
        <circle cx="40" cy="40" r={r} className="lecture-recap-score__track" />
        <circle
          cx="40"
          cy="40"
          r={r}
          className="lecture-recap-score__value"
          strokeDasharray={`${c * pct} ${c}`}
          transform="rotate(-90 40 40)"
        />
      </svg>
      <div className="lecture-recap-score__text">
        <strong>
          {score}/{total}
        </strong>
      </div>
    </div>
  );
}

function Quiz({ questions, token, mandatory }) {
  const saved = useMemo(readIdentity, []);
  const [stage, setStage] = useState('intro'); // intro | answering | results
  const [answers, setAnswers] = useState(() => Array(questions.length).fill(-1));
  const [current, setCurrent] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [results, setResults] = useState(null);
  const [error, setError] = useState('');
  const [studentName, setStudentName] = useState(saved.name);
  const [studentEmail, setStudentEmail] = useState(saved.email);
  const [identityTouched, setIdentityTouched] = useState(false);

  const total = questions.length;
  const answeredCount = answers.filter((a) => a >= 0).length;
  const allAnswered = answeredCount === total;
  const nameOk = Boolean(studentName.trim());
  const emailOk = EMAIL_RE.test(studentEmail.trim());
  const emailGiven = Boolean(studentEmail.trim());
  // Required quiz: both needed. Optional quiz: blank is fine, but a half-typed email is not.
  const identityOk = mandatory ? nameOk && emailOk : !emailGiven || emailOk;
  const isLast = current === total - 1;

  // Per-topic breakdown for the results screen, in the order topics first appear.
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

  if (total === 0) return null;

  const start = () => {
    setIdentityTouched(true);
    if (!identityOk) return;
    saveIdentity(studentName.trim(), studentEmail.trim());
    setStage('answering');
  };

  const choose = (oi) => {
    setAnswers((prev) => {
      const next = [...prev];
      next[current] = oi;
      return next;
    });
  };

  const submit = async () => {
    if (!allAnswered) {
      const firstBlank = answers.findIndex((a) => a < 0);
      if (firstBlank >= 0) setCurrent(firstBlank);
      setError('Answer every question before you submit.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const res = await axios.post(`/public/lectures/${token}/quiz-attempt`, {
        answers,
        studentName: studentName.trim(),
        studentEmail: studentEmail.trim(),
      });
      setResults(res.data);
      setStage('results');
      if (res.data?.total > 0 && res.data.score / res.data.total >= 0.8) launchConfetti();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not submit your answers. Check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const retake = () => {
    setAnswers(Array(total).fill(-1));
    setCurrent(0);
    setResults(null);
    setError('');
    setStage('answering');
  };

  if (stage === 'intro') {
    return (
      <div className="lecture-recap-quiz">
        <div className="lecture-recap-quiz__intro">
          <div>
            <p className="lecture-recap-quiz__intro-title">
              {total} question{total === 1 ? '' : 's'} · about {Math.max(1, Math.round(total * 0.6))} minutes
            </p>
            <p className="lecture-recap-quiz__intro-sub">
              {mandatory
                ? 'Your teacher has made this quiz required. Enter your name and college email so your attempt is recorded.'
                : 'See what stuck and what to revise. Add your name so your teacher can see how you did, or leave it blank.'}
            </p>
          </div>
          <div className="lecture-recap-quiz__identity">
            <label>
              <span>Your name{mandatory ? '' : ' (optional)'}</span>
              <input
                type="text"
                autoComplete="name"
                value={studentName}
                onChange={(e) => setStudentName(e.target.value)}
                placeholder="e.g. Aarav Mehta"
                aria-invalid={identityTouched && mandatory && !nameOk}
              />
            </label>
            <label>
              <span>College email{mandatory ? '' : ' (optional)'}</span>
              <input
                type="email"
                autoComplete="email"
                inputMode="email"
                value={studentEmail}
                onChange={(e) => setStudentEmail(e.target.value)}
                placeholder="you@college.edu"
                aria-invalid={identityTouched && (mandatory ? !emailOk : emailGiven && !emailOk)}
                onKeyDown={(e) => e.key === 'Enter' && start()}
              />
            </label>
          </div>
          {identityTouched && !identityOk && (
            <p className="lecture-recap-quiz__error">
              {mandatory ? 'Enter your name and a valid email to start.' : 'That email does not look right. Fix it or clear it.'}
            </p>
          )}
          <button type="button" className="lecture-recap-btn lecture-recap-btn--primary" onClick={start}>
            Start quiz
          </button>
        </div>
      </div>
    );
  }

  if (stage === 'results' && results) {
    const pct = results.total > 0 ? results.score / results.total : 0;
    const headline =
      pct === 1 ? 'Full marks.' : pct >= 0.8 ? 'Strong work.' : pct >= 0.5 ? 'Good start. A few things to revisit.' : 'Worth another read of the notes.';
    return (
      <div className="lecture-recap-quiz">
        <div className="lecture-recap-quiz__result-head">
          <ScoreRing score={results.score} total={results.total} />
          <div>
            <p className="lecture-recap-quiz__result-title">{headline}</p>
            <p className="lecture-recap-quiz__result-sub">
              You got {results.score} of {results.total} right.
              {studentName.trim() ? ' Your teacher can see this attempt.' : ''}
            </p>
            <button type="button" className="lecture-recap-btn" onClick={retake}>
              Try again
            </button>
          </div>
        </div>

        {topicBreakdown.length > 1 && (
          <div className="lecture-recap-quiz__breakdown">
            {topicBreakdown.map((t) => {
              const topicPct = t.total > 0 ? Math.round((t.correct / t.total) * 100) : 0;
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
                      className={`lecture-recap-quiz__breakdown-fill${topicPct < 60 ? ' is-low' : ''}`}
                      style={{ width: `${Math.max(topicPct, 4)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="lecture-recap-quiz__review">
          {questions.map((q, qi) => {
            const result = results.results?.[qi];
            return (
              <div key={qi} className={`lecture-recap-quiz__review-item${result?.correct ? ' is-right' : ' is-wrong'}`}>
                <p className="lecture-recap-quiz__review-q">
                  <span className="lecture-recap-quiz__review-mark" aria-hidden>
                    {result?.correct ? '✓' : '✕'}
                  </span>
                  {qi + 1}. {q.question}
                </p>
                <ul className="lecture-recap-quiz__review-options">
                  {q.options.map((opt, oi) => {
                    const chosen = answers[qi] === oi;
                    const isAnswer = oi === result?.correctIndex;
                    return (
                      <li
                        key={oi}
                        className={`${isAnswer ? 'is-correct' : ''}${chosen && !isAnswer ? ' is-chosen-wrong' : ''}`.trim()}
                      >
                        <span>{opt}</span>
                        {isAnswer && <em>Correct answer</em>}
                        {chosen && !isAnswer && <em>Your answer</em>}
                      </li>
                    );
                  })}
                </ul>
                {result?.explanation && <p className="lecture-recap-quiz__explanation">{result.explanation}</p>}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  const q = questions[current];

  return (
    <div className="lecture-recap-quiz">
      <div className="lecture-recap-quiz__progress" aria-hidden>
        <div className="lecture-recap-quiz__progress-fill" style={{ width: `${(answeredCount / total) * 100}%` }} />
      </div>
      <div className="lecture-recap-quiz__dots" role="tablist" aria-label="Questions">
        {questions.map((_, qi) => (
          <button
            key={qi}
            type="button"
            role="tab"
            aria-selected={qi === current}
            aria-label={`Question ${qi + 1}${answers[qi] >= 0 ? ', answered' : ''}`}
            className={`lecture-recap-quiz__dot${qi === current ? ' is-current' : ''}${answers[qi] >= 0 ? ' is-answered' : ''}`}
            onClick={() => setCurrent(qi)}
          >
            {qi + 1}
          </button>
        ))}
      </div>

      <div className="lecture-recap-quiz__question" key={current}>
        <p className="lecture-recap-quiz__step">
          Question {current + 1} of {total}
          {q.topic ? <span> · {q.topic}</span> : null}
        </p>
        <p className="lecture-recap-quiz__prompt">{q.question}</p>
        <div className="lecture-recap-quiz__options" role="radiogroup" aria-label={`Question ${current + 1}`}>
          {q.options.map((opt, oi) => {
            const chosen = answers[current] === oi;
            return (
              <button
                key={oi}
                type="button"
                role="radio"
                aria-checked={chosen}
                className={`lecture-recap-quiz__option${chosen ? ' is-selected' : ''}`}
                onClick={() => choose(oi)}
              >
                <span className="lecture-recap-quiz__option-key" aria-hidden>
                  {String.fromCharCode(65 + oi)}
                </span>
                <span className="lecture-recap-quiz__option-text">{opt}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="lecture-recap-quiz__nav">
        <button
          type="button"
          className="lecture-recap-btn"
          onClick={() => setCurrent((c) => Math.max(0, c - 1))}
          disabled={current === 0}
        >
          Back
        </button>
        {isLast ? (
          <button
            type="button"
            className="lecture-recap-btn lecture-recap-btn--primary"
            onClick={submit}
            disabled={submitting}
            data-quiz="submit"
          >
            {submitting ? 'Submitting…' : 'Submit answers'}
          </button>
        ) : (
          <button
            type="button"
            className="lecture-recap-btn lecture-recap-btn--primary"
            onClick={() => setCurrent((c) => Math.min(total - 1, c + 1))}
            data-quiz="next"
          >
            Next
          </button>
        )}
      </div>
      {error && <p className="lecture-recap-quiz__error">{error}</p>}
    </div>
  );
}

const STARTER_QUESTIONS = [
  'Explain the main idea of this lecture simply',
  'Give me an example from this lecture',
  'What should I revise first for the exam?',
];

/**
 * Ask-the-AI panel: answers from this lecture's notes and transcript only, and — if that
 * answer isn't good enough — a one-click way to send the question to the teacher's inbox.
 * See POST /:token/ask and /:token/escalate in server/routes/smartboard.js.
 */
function StudentQA({ token, teacherAvailable, teacherName }) {
  const saved = useMemo(readIdentity, []);
  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const [pendingQuestion, setPendingQuestion] = useState('');
  const [thread, setThread] = useState([]); // [{ question, answer }]
  const [error, setError] = useState('');
  const [escalatingFor, setEscalatingFor] = useState(null);
  const [escalateEmail, setEscalateEmail] = useState(saved.email);
  const [escalateBusy, setEscalateBusy] = useState(false);
  const [escalateStatus, setEscalateStatus] = useState({});

  const ask = async (preset) => {
    const q = String(preset || question).trim();
    if (!q || asking) return;
    setAsking(true);
    setPendingQuestion(q);
    setError('');
    setQuestion('');
    try {
      const res = await axios.post(`/public/lectures/${token}/ask`, { question: q });
      setThread((prev) => [...prev, { question: q, answer: res.data.answer }]);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not get an answer right now. Try again in a moment.');
      setQuestion(q);
    } finally {
      setAsking(false);
      setPendingQuestion('');
    }
  };

  const escalate = async (i) => {
    const item = thread[i];
    if (escalateBusy) return;
    setEscalateBusy(true);
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
    } finally {
      setEscalateBusy(false);
    }
  };

  const teacherLabel = teacherName ? teacherName : 'your teacher';

  return (
    <div className="lecture-recap-qa">
      <p className="lecture-recap-section__hint">
        Answers come only from what was taught in this lecture.
        {teacherAvailable ? ` If one doesn't help, send the question to ${teacherLabel}.` : ''}
      </p>

      {thread.length === 0 && !asking && (
        <div className="lecture-recap-qa__starters">
          {STARTER_QUESTIONS.map((s) => (
            <button key={s} type="button" className="lecture-recap-qa__starter" onClick={() => ask(s)}>
              {s}
            </button>
          ))}
        </div>
      )}

      {thread.map((item, i) => (
        <div key={i} className="lecture-recap-qa__item">
          <p className="lecture-recap-qa__q">{item.question}</p>
          <p className="lecture-recap-qa__a">{item.answer}</p>
          {escalateStatus[i] === 'sent' ? (
            <p className="lecture-recap-qa__escalate-status is-sent">Sent to {teacherLabel}.</p>
          ) : escalatingFor === i ? (
            <div className="lecture-recap-qa__escalate-form">
              <input
                type="email"
                inputMode="email"
                placeholder="Your email, so they can reply"
                value={escalateEmail}
                onChange={(e) => setEscalateEmail(e.target.value)}
              />
              <button type="button" className="lecture-recap-btn lecture-recap-btn--primary" onClick={() => escalate(i)} disabled={escalateBusy}>
                {escalateBusy ? 'Sending…' : 'Send'}
              </button>
              <button type="button" className="lecture-recap-btn" onClick={() => setEscalatingFor(null)}>
                Cancel
              </button>
              {escalateStatus[i] && <p className="lecture-recap-qa__escalate-status is-error">{escalateStatus[i]}</p>}
            </div>
          ) : teacherAvailable ? (
            <button type="button" className="lecture-recap-qa__escalate-btn" onClick={() => setEscalatingFor(i)}>
              Not what you needed? Ask {teacherLabel} →
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
          placeholder="Ask anything about this lecture"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && ask()}
          disabled={asking}
          maxLength={1000}
        />
        <button type="button" className="lecture-recap-btn lecture-recap-btn--primary" onClick={() => ask()} disabled={asking || !question.trim()}>
          {asking ? 'Asking…' : 'Ask'}
        </button>
      </div>
      {error && <p className="lecture-recap-qa__error">{error}</p>}
    </div>
  );
}

function Section({ id, title, badge, children }) {
  return (
    <section className="lecture-recap-section" id={`recap-${id}`} data-section={id}>
      <div className="lecture-recap-section__head">
        <h2>{title}</h2>
        {badge ? <span className="lecture-recap-section__badge">{badge}</span> : null}
      </div>
      {children}
    </section>
  );
}

export default function LectureRecap() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [scrollPct, setScrollPct] = useState(0);
  const [activeSection, setActiveSection] = useState('');
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

  useEffect(() => {
    if (data?.title) document.title = `${data.title} · Lecture recap`;
  }, [data?.title]);

  // `.lecture-recap-screen` is the scrolling element (not the window): track it for the
  // progress bar and to highlight the section the student is in.
  useEffect(() => {
    const el = screenRef.current;
    if (!el) return undefined;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const scrollable = el.scrollHeight - el.clientHeight;
      setScrollPct(scrollable > 0 ? Math.min(100, Math.max(0, (el.scrollTop / scrollable) * 100)) : 0);
      const sections = Array.from(el.querySelectorAll('[data-section]'));
      const line = el.getBoundingClientRect().top + 140;
      let currentId = sections.length ? sections[0].getAttribute('data-section') : '';
      sections.forEach((s) => {
        if (s.getBoundingClientRect().top <= line) currentId = s.getAttribute('data-section');
      });
      if (scrollable > 0 && el.scrollTop >= scrollable - 4 && sections.length) {
        currentId = sections[sections.length - 1].getAttribute('data-section');
      }
      setActiveSection(currentId || '');
    };
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(measure);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    measure();
    return () => {
      el.removeEventListener('scroll', onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [data]);

  const notes = useMemo(() => formatLectureNotesMarkdown(data?.summary), [data?.summary]);
  const revisionItems = useMemo(() => splitNumberedItems(data?.revisionQuestions), [data?.revisionQuestions]);
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
        <div className="lecture-recap-container lecture-recap-container--loading">
          <Skeleton width="40%" height={13} style={{ marginBottom: 10 }} />
          <Skeleton width="70%" height={28} style={{ marginBottom: 24 }} />
          <Skeleton width="100%" height={300} radius={16} />
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
        <div className="lecture-recap-error">
          <strong>We couldn't open this recap.</strong>
          <span>{error || 'Lecture not found.'}</span>
          <span>Ask your teacher to send the link again.</span>
        </div>
      </div>
    );
  }

  const pages = Array.isArray(data.pages) ? data.pages : Array.isArray(data.slides) ? data.slides.map((s) => ({ type: 'slide', ...s })) : [];
  const keyPoints = Array.isArray(data.keyPoints) ? data.keyPoints.map((k) => String(k || '').trim()).filter(Boolean) : [];
  const quiz = Array.isArray(data.quiz) ? data.quiz : [];
  const quizMandatory = Boolean(data.quizMandatory);
  const lectureDate = data.lectureDate ? new Date(data.lectureDate).toLocaleDateString(undefined, { dateStyle: 'medium' }) : '';
  const eyebrow = [data.subject, data.courseName].map((x) => String(x || '').trim()).filter(Boolean).join(' · ') || 'Lecture recap';
  const metaBits = [data.teacherName, lectureDate, readMinutes > 0 ? `${readMinutes} min read` : ''].filter(Boolean);

  const nav = [
    pages.length > 0 && { id: 'board', label: 'In class' },
    keyPoints.length > 0 && { id: 'revision', label: 'Quick revision' },
    (notes || data.notesPending) && { id: 'notes', label: 'Notes' },
    revisionItems.length > 0 && { id: 'questions', label: 'Practice' },
    { id: 'ask', label: 'Ask' },
    quiz.length > 0 && { id: 'quiz', label: quizMandatory ? 'Quiz · required' : 'Quiz' },
  ].filter(Boolean);

  const jumpTo = (id) => {
    const el = screenRef.current;
    const target = el?.querySelector(`#recap-${id}`);
    if (!el || !target) return;
    const top = target.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop - 64;
    el.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
  };

  return (
    <div className="lecture-recap-screen" ref={screenRef}>
      <div className="lecture-recap-topbar">
        <div className="lecture-recap-progress-track" aria-hidden>
          <div className="lecture-recap-progress-bar" style={{ width: `${scrollPct}%` }} />
        </div>
        <nav className="lecture-recap-nav" aria-label="Sections">
          {nav.map((n) => (
            <button
              key={n.id}
              type="button"
              className={`lecture-recap-nav__item${activeSection === n.id ? ' is-active' : ''}${n.id === 'quiz' && quizMandatory ? ' is-required' : ''}`}
              onClick={() => jumpTo(n.id)}
            >
              {n.label}
            </button>
          ))}
        </nav>
      </div>

      <div className="lecture-recap-container">
        <header className="lecture-recap-header">
          <p className="lecture-recap-eyebrow">{eyebrow}</p>
          <h1>{data.title}</h1>
          {metaBits.length > 0 && <p className="lecture-recap-meta">{metaBits.join(' · ')}</p>}
          {quiz.length > 0 && quizMandatory && (
            <button type="button" className="lecture-recap-required" onClick={() => jumpTo('quiz')}>
              Your teacher has set a required quiz for this lecture. Take it →
            </button>
          )}
        </header>

        {pages.length > 0 && (
          <Section id="board" title="Covered in class" badge={`${pages.length} page${pages.length === 1 ? '' : 's'}`}>
            <p className="lecture-recap-section__hint">
              The slides and whiteboard pages your teacher used, in order, with what was written on them.
            </p>
            <PagesViewer pages={pages} />
          </Section>
        )}

        {keyPoints.length > 0 && (
          <Section id="revision" title="Quick revision" badge="30-second scan">
            <ol className="lecture-recap-keypoints">
              {keyPoints.map((k, i) => (
                <li key={i}>
                  <span className="lecture-recap-keypoints__num" aria-hidden>
                    {i + 1}
                  </span>
                  <div className="lecture-recap-keypoints__text">
                    <Markdown>{k}</Markdown>
                  </div>
                </li>
              ))}
            </ol>
          </Section>
        )}

        {notes ? (
          <Section id="notes" title="Lecture notes">
            <div className="lecture-recap-notes">
              <Markdown>{notes}</Markdown>
            </div>
          </Section>
        ) : data.notesPending ? (
          <Section id="notes" title="Lecture notes">
            <p className="lecture-recap-pending">
              Your teacher is still reviewing the notes for this lecture. They will appear here once published.
            </p>
          </Section>
        ) : null}

        {revisionItems.length > 0 && (
          <Section id="questions" title="Practice questions" badge="Exam style">
            <p className="lecture-recap-section__hint">Try answering these in your own words before the next class.</p>
            <ol className="lecture-recap-practice">
              {revisionItems.map((item, i) => (
                <li key={i}>
                  <Markdown>{item}</Markdown>
                </li>
              ))}
            </ol>
          </Section>
        )}

        <Section id="ask" title="Ask about this lecture">
          <StudentQA token={token} teacherAvailable={Boolean(data.teacherContactAvailable)} teacherName={data.teacherName} />
        </Section>

        {quiz.length > 0 && (
          <Section id="quiz" title="Check your understanding" badge={quizMandatory ? 'Required' : null}>
            <Quiz questions={quiz} token={token} mandatory={quizMandatory} />
          </Section>
        )}

        <footer className="lecture-recap-footer">
          Lecture recap by <span className="portiq-wordmark">Port<b>IQ</b></span>
        </footer>
      </div>
    </div>
  );
}

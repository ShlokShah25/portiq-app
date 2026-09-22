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

/** One covered slide: the rasterized image with the teacher's saved annotations rendered read-only on top. */
function RecapSlide({ slide, index }) {
  const canvasElRef = useRef(null);

  useEffect(() => {
    if (!canvasElRef.current) return undefined;
    const canvas = new fabric.Canvas(canvasElRef.current, {
      selection: false,
      evented: false,
      width: STAGE_W,
      height: STAGE_H,
    });
    if (slide.annotations) {
      canvas.loadFromJSON(slide.annotations).then(() => canvas.renderAll());
    }
    return () => canvas.dispose();
  }, [slide.annotations]);

  return (
    <figure className="lecture-recap-slide">
      <div className="lecture-recap-slide__stage" style={{ aspectRatio: `${STAGE_W} / ${STAGE_H}` }}>
        <img className="lecture-recap-slide__img" src={slide.imageUrl} alt={`Slide ${index + 1}`} />
        <canvas ref={canvasElRef} className="lecture-recap-slide__canvas" />
      </div>
      <figcaption>Slide {index + 1}</figcaption>
    </figure>
  );
}

function Quiz({ questions, token }) {
  const [answers, setAnswers] = useState(() => Array(questions.length).fill(-1));
  const [submitting, setSubmitting] = useState(false);
  const [results, setResults] = useState(null);
  const [error, setError] = useState('');

  const allAnswered = answers.every((a) => a >= 0);

  const submit = async () => {
    setSubmitting(true);
    setError('');
    try {
      const res = await axios.post(`/public/lectures/${token}/quiz-attempt`, { answers });
      setResults(res.data);
    } catch {
      setError('Could not submit your answers. Check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (questions.length === 0) return null;

  return (
    <section className="lecture-recap-quiz">
      <h2>Check your understanding</h2>
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
        <button type="button" className="lecture-recap-quiz__submit" onClick={submit} disabled={!allAnswered || submitting}>
          {submitting ? 'Submitting…' : 'Submit answers'}
        </button>
      )}
      {error && <p className="lecture-recap-quiz__error">{error}</p>}
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

        {data.slides.length > 0 && (
          <section className="lecture-recap-slides">
            <h2>Slides covered in class</h2>
            <div className="lecture-recap-slides__grid">
              {data.slides.map((s, i) => (
                <RecapSlide key={s.index} slide={s} index={i} />
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

        <Quiz questions={data.quiz || []} token={token} />
      </div>
    </div>
  );
}

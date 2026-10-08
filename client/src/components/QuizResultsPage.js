import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { BarChart3, ChevronDown, Download, RefreshCw } from 'lucide-react';
import Skeleton from './Skeleton';
import './QuizResultsPage.css';

const pctOf = (score, total) => (total > 0 ? Math.round((score / total) * 100) : 0);

/** Class-level numbers for one lecture: average, who attempted, who has not. */
function summarizeLecture(lec) {
  const attempts = Array.isArray(lec.attempts) ? lec.attempts : [];
  const roster = Array.isArray(lec.roster) ? lec.roster : [];
  let scoreSum = 0;
  let totalSum = 0;
  attempts.forEach((a) => {
    if (a.total > 0) {
      scoreSum += a.score;
      totalSum += a.total;
    }
  });
  const attemptedEmails = new Set(attempts.map((a) => String(a.studentEmail || '').toLowerCase()).filter(Boolean));
  const missing = roster.filter((s) => !attemptedEmails.has(String(s.email || '').toLowerCase()));
  const rosterAttempted = roster.length - missing.length;
  return {
    attempts,
    roster,
    missing,
    rosterAttempted,
    avgPct: totalSum > 0 ? Math.round((scoreSum / totalSum) * 100) : null,
  };
}

function csvCell(value) {
  const s = String(value == null ? '' : value);
  // Stop spreadsheet apps treating a student-typed name as a formula.
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}

function downloadCsv(lec, summary) {
  const rows = [['Student', 'Email', 'Score', 'Out of', 'Percent', 'Submitted', 'Status']];
  summary.attempts.forEach((a) => {
    rows.push([
      a.studentName || 'Anonymous',
      a.studentEmail || '',
      a.score,
      a.total,
      pctOf(a.score, a.total),
      a.submittedAt ? new Date(a.submittedAt).toLocaleString() : '',
      'Attempted',
    ]);
  });
  summary.missing.forEach((s) => rows.push([s.name || '', s.email || '', '', '', '', '', 'Not attempted']));
  const csv = rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
  const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${String(lec.title || 'quiz').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'quiz'}-results.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Teacher-facing quiz results: every attempt on every lecture, required or not, with the class
 * average, who has not attempted yet, and which questions the class got wrong. Its own sidebar
 * page rather than a dashboard widget — a teacher checks it on demand.
 * See GET /api/meetings/quiz-results/summary in server/routes/smartboard.js.
 */
export default function QuizResultsPage() {
  const [lectures, setLectures] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [openId, setOpenId] = useState(null);

  const load = async (initial) => {
    if (initial) setLoading(true);
    else setRefreshing(true);
    setError('');
    try {
      const res = await axios.get('/meetings/quiz-results/summary');
      const list = Array.isArray(res.data?.lectures) ? res.data.lectures : [];
      setLectures(list);
      if (initial && list.length) setOpenId(list[0].id);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not load quiz results. Check your connection and try again.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    load(true);
    // Load once on mount; the Refresh button re-runs it.
  }, []);

  const summaries = useMemo(() => {
    const map = {};
    lectures.forEach((lec) => {
      map[lec.id] = summarizeLecture(lec);
    });
    return map;
  }, [lectures]);

  const overall = useMemo(() => {
    let scoreSum = 0;
    let totalSum = 0;
    let attempts = 0;
    let pendingRequired = 0;
    lectures.forEach((lec) => {
      const s = summaries[lec.id];
      attempts += s.attempts.length;
      s.attempts.forEach((a) => {
        if (a.total > 0) {
          scoreSum += a.score;
          totalSum += a.total;
        }
      });
      if (lec.mandatory) pendingRequired += s.roster.length ? s.missing.length : s.attempts.length === 0 ? 1 : 0;
    });
    return {
      lectures: lectures.length,
      attempts,
      avgPct: totalSum > 0 ? Math.round((scoreSum / totalSum) * 100) : null,
      pendingRequired,
    };
  }, [lectures, summaries]);

  return (
    <div className="quiz-results-page">
      <div className="quiz-results-wrap">
        <div className="quiz-results-header">
          <div>
            <h1>Quiz results</h1>
            <p>Every attempt on your lecture quizzes, required or not: who took it, how the class did and what they got wrong.</p>
          </div>
          <button type="button" className="quiz-results__refresh" onClick={() => load(false)} disabled={loading || refreshing}>
            <RefreshCw size={15} strokeWidth={2} aria-hidden className={refreshing ? 'quiz-results__spin' : ''} />
            Refresh
          </button>
        </div>

        {!loading && !error && lectures.length > 0 && (
          <div className="quiz-results__stats">
            <div className="quiz-results__stat">
              <strong>{overall.lectures}</strong>
              <span>Lecture{overall.lectures === 1 ? '' : 's'} with a quiz</span>
            </div>
            <div className="quiz-results__stat">
              <strong>{overall.attempts}</strong>
              <span>Attempt{overall.attempts === 1 ? '' : 's'}</span>
            </div>
            <div className="quiz-results__stat">
              <strong>{overall.avgPct === null ? '—' : `${overall.avgPct}%`}</strong>
              <span>Average score</span>
            </div>
            <div className={`quiz-results__stat${overall.pendingRequired > 0 ? ' is-alert' : ''}`}>
              <strong>{overall.pendingRequired}</strong>
              <span>Still to take a required quiz</span>
            </div>
          </div>
        )}

        {loading && (
          <div className="quiz-results__list" aria-label="Loading quiz results">
            {[0, 1, 2].map((i) => (
              <div key={i} className="quiz-results__lecture quiz-results__skeleton-row">
                <div style={{ flex: 1 }}>
                  <Skeleton width="45%" height={14} style={{ marginBottom: 8 }} />
                  <Skeleton width="30%" height={11} />
                </div>
                <Skeleton width={72} height={22} radius={999} />
              </div>
            ))}
          </div>
        )}

        {error && <p className="quiz-results__error">{error}</p>}

        {!loading && !error && lectures.length === 0 && (
          <div className="quiz-results__empty">
            <div className="quiz-results__empty-icon" aria-hidden>
              <BarChart3 size={26} strokeWidth={1.75} />
            </div>
            <strong>No quiz attempts yet</strong>
            <p>
              After a lecture, open its notes, generate the quiz and send the recap to your class. Scores appear here as
              students take it.
            </p>
          </div>
        )}

        <div className="quiz-results__list">
          {lectures.map((lec) => {
            const isOpen = openId === lec.id;
            const s = summaries[lec.id];
            const hasRoster = s.roster.length > 0;
            const hardest = [...(lec.questionStats || [])]
              .filter((q) => q.answered > 0)
              .map((q) => ({ ...q, pct: pctOf(q.correct, q.answered) }));
            const lowestPct = hardest.length ? Math.min(...hardest.map((q) => q.pct)) : null;
            return (
              <div key={lec.id} className={`quiz-results__lecture${isOpen ? ' is-open' : ''}`}>
                <button
                  type="button"
                  className="quiz-results__lecture-head"
                  onClick={() => setOpenId(isOpen ? null : lec.id)}
                  aria-expanded={isOpen}
                >
                  <div className="quiz-results__lecture-main">
                    <div className="quiz-results__lecture-title">
                      <span>{lec.title || 'Untitled lecture'}</span>
                      {lec.mandatory && <span className="quiz-results__badge">Required</span>}
                    </div>
                    <div className="quiz-results__lecture-meta">
                      {[lec.subject, lec.courseName, lec.lectureDate ? new Date(lec.lectureDate).toLocaleDateString(undefined, { dateStyle: 'medium' }) : '']
                        .filter(Boolean)
                        .join(' · ')}
                    </div>
                  </div>
                  <div className="quiz-results__lecture-nums">
                    <span className="quiz-results__lecture-count">
                      {hasRoster
                        ? `${s.rosterAttempted} of ${s.roster.length} students`
                        : `${s.attempts.length} attempt${s.attempts.length === 1 ? '' : 's'}`}
                    </span>
                    {s.avgPct !== null && (
                      <span className={`quiz-results__avg${s.avgPct >= 60 ? ' is-good' : ' is-low'}`}>{s.avgPct}% avg</span>
                    )}
                    <ChevronDown size={18} strokeWidth={2} aria-hidden className="quiz-results__chevron" />
                  </div>
                </button>

                {isOpen && (
                  <div className="quiz-results__body">
                    {hasRoster && s.missing.length > 0 && (
                      <div className={`quiz-results__missing${lec.mandatory ? ' is-required' : ''}`}>
                        <p>
                          <strong>
                            {s.missing.length} student{s.missing.length === 1 ? ' has' : 's have'} not attempted
                            {lec.mandatory ? ' this required quiz' : ''} yet
                          </strong>
                        </p>
                        <div className="quiz-results__chips">
                          {s.missing.map((st) => (
                            <span key={st.email} title={st.email}>
                              {st.name || st.email}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                    {hasRoster && s.missing.length === 0 && s.attempts.length > 0 && (
                      <p className="quiz-results__all-done">Everyone on the class list has attempted this quiz.</p>
                    )}

                    {hardest.length > 0 && (
                      <div className="quiz-results__questions">
                        <h3>How the class did on each question</h3>
                        {hardest.map((q) => (
                          <div key={q.index} className="quiz-results__question">
                            <div className="quiz-results__question-top">
                              <span className="quiz-results__question-text">
                                {q.index + 1}. {q.question}
                              </span>
                              <span className={`quiz-results__question-pct${q.pct < 60 ? ' is-low' : ''}`}>
                                {q.pct}% correct
                              </span>
                            </div>
                            <div className="quiz-results__bar">
                              <div
                                className={`quiz-results__bar-fill${q.pct < 60 ? ' is-low' : ''}`}
                                style={{ width: `${Math.max(q.pct, 3)}%` }}
                              />
                            </div>
                            {q.pct === lowestPct && q.pct < 60 && (
                              <p className="quiz-results__question-note">
                                Most missed{q.topic ? ` — worth revisiting ${q.topic} next class` : ' — worth revisiting next class'}.
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="quiz-results__table-head">
                      <h3>Attempts</h3>
                      {(s.attempts.length > 0 || s.missing.length > 0) && (
                        <button type="button" className="quiz-results__refresh" onClick={() => downloadCsv(lec, s)}>
                          <Download size={15} strokeWidth={2} aria-hidden />
                          Download CSV
                        </button>
                      )}
                    </div>
                    <div className="quiz-results__table-scroll">
                      <table className="quiz-results__table">
                        <thead>
                          <tr>
                            <th>Student</th>
                            <th>Email</th>
                            <th>Score</th>
                            <th>Submitted</th>
                          </tr>
                        </thead>
                        <tbody>
                          {s.attempts.map((a, i) => {
                            const pct = pctOf(a.score, a.total);
                            return (
                              <tr key={i}>
                                <td>{a.studentName || <span className="quiz-results__anon">Anonymous</span>}</td>
                                <td>{a.studentEmail || '—'}</td>
                                <td>
                                  {a.score} / {a.total}
                                  <span className={`quiz-results__pct${pct >= 60 ? ' is-good' : ' is-low'}`}>{pct}%</span>
                                </td>
                                <td>{a.submittedAt ? new Date(a.submittedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—'}</td>
                              </tr>
                            );
                          })}
                          {s.attempts.length === 0 && (
                            <tr>
                              <td colSpan={4} className="quiz-results__empty-row">
                                No attempts yet.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { BarChart3, CheckCircle2, Circle } from 'lucide-react';
import './QuizResultsPage.css';

/**
 * Teacher-facing "who took the quiz" drill-down — every quiz attempt across every
 * one of this teacher's lectures, grouped by lecture. Deliberately its own sidebar
 * page rather than a dashboard widget: a teacher checks this on demand (did
 * everyone attempt the mandatory quiz?), it isn't a headline metric. See
 * GET /api/meetings/quiz-results/summary in server/routes/smartboard.js.
 */
export default function QuizResultsPage() {
  const [lectures, setLectures] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [openId, setOpenId] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const res = await axios.get('/meetings/quiz-results/summary');
        if (!cancelled) {
          const list = Array.isArray(res.data?.lectures) ? res.data.lectures : [];
          setLectures(list);
          if (list.length) setOpenId(list[0].id);
        }
      } catch (err) {
        if (!cancelled) setError(err.response?.data?.error || 'Could not load quiz results.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="classes-page">
      <div className="classes-wrapper">
        <div className="classes-header">
          <h1>
            <BarChart3 size={22} strokeWidth={2} aria-hidden style={{ verticalAlign: 'text-bottom', marginRight: 8 }} />
            Quiz results
          </h1>
          <p>Every quiz attempt across your lectures — who took it, their score, and whether it was mandatory.</p>
        </div>

        {loading && <p className="quiz-results__status">Loading…</p>}
        {error && <p className="classes-error">{error}</p>}

        {!loading && !error && lectures.length === 0 && (
          <div className="edu-empty">
            <div className="edu-empty__title">No quiz attempts yet</div>
            <p className="edu-empty__desc">
              Once a lecture has a quiz and a student attempts it, results will show up here.
            </p>
          </div>
        )}

        <div className="quiz-results__list">
          {lectures.map((lec) => {
            const isOpen = openId === lec.id;
            return (
              <div key={lec.id} className="edu-card quiz-results__lecture">
                <button
                  type="button"
                  className="quiz-results__lecture-head"
                  onClick={() => setOpenId(isOpen ? null : lec.id)}
                >
                  <div>
                    <div className="quiz-results__lecture-title">
                      {lec.title || 'Untitled lecture'}
                      {lec.mandatory && <span className="quiz-results__badge">Mandatory</span>}
                    </div>
                    <div className="quiz-results__lecture-meta">
                      {lec.subject ? `${lec.subject} · ` : ''}
                      {lec.teacherName ? `${lec.teacherName} · ` : ''}
                      {lec.lectureDate ? new Date(lec.lectureDate).toLocaleDateString() : ''}
                    </div>
                  </div>
                  <div className="quiz-results__lecture-count">
                    {lec.attempts.length} attempt{lec.attempts.length === 1 ? '' : 's'}
                  </div>
                </button>

                {isOpen && (
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
                      {lec.attempts.map((a, i) => {
                        const pct = a.total > 0 ? Math.round((a.score / a.total) * 100) : 0;
                        return (
                          <tr key={i}>
                            <td>{a.studentName || '—'}</td>
                            <td>{a.studentEmail || '—'}</td>
                            <td>
                              {a.score} / {a.total}{' '}
                              <span className={`quiz-results__pct${pct >= 60 ? ' is-good' : ' is-low'}`}>
                                {pct >= 60 ? <CheckCircle2 size={13} aria-hidden /> : <Circle size={13} aria-hidden />}
                                {pct}%
                              </span>
                            </td>
                            <td>{a.submittedAt ? new Date(a.submittedAt).toLocaleString() : '—'}</td>
                          </tr>
                        );
                      })}
                      {lec.attempts.length === 0 && (
                        <tr>
                          <td colSpan={4} className="quiz-results__empty-row">
                            No attempts yet.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

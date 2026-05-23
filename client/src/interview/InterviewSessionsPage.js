import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import InterviewSessionList from './InterviewSessionList';
import { fetchInterviewMeetings, isInterviewDecisionPending } from './interviewUtils';
import './InterviewMode.css';

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'live', label: 'Live' },
  { id: 'pending', label: 'Pending decision' },
  { id: 'finalized', label: 'Finalized' },
];

function isLiveInterview(m) {
  return m.status === 'In Progress' || m.transcriptionStatus === 'Recording';
}

export default function InterviewSessionsPage() {
  const [meetings, setMeetings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const list = await fetchInterviewMeetings();
      if (!cancelled) {
        setMeetings(list);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    let rows = meetings;
    if (filter === 'live') {
      rows = rows.filter(isLiveInterview);
    } else if (filter === 'pending') {
      rows = rows.filter(isInterviewDecisionPending);
    } else if (filter === 'finalized') {
      rows = rows.filter((m) => m.summaryStatus === 'Sent');
    }
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((m) => {
      const title = String(m.title || '').toLowerCase();
      const agenda = String(m.agenda || '').toLowerCase();
      const candidates = (Array.isArray(m.interviewCandidates) ? m.interviewCandidates : [])
        .map((c) => `${c?.name || ''} ${c?.role || ''}`)
        .join(' ')
        .toLowerCase();
      return title.includes(q) || agenda.includes(q) || candidates.includes(q);
    });
  }, [meetings, filter, query]);

  return (
    <div className="interview-page">
      <div className="interview-page__nav">
        <Link to="/interview" className="interview-btn interview-btn--ghost">
          <ArrowLeft size={16} aria-hidden />
          Dashboard
        </Link>
      </div>

      <header className="interview-page__hero">
        <h1 className="interview-page__title">All interview sessions</h1>
        <p className="interview-page__subtitle">
          {loading
            ? 'Loading sessions…'
            : `${meetings.length} session${meetings.length === 1 ? '' : 's'} in your workspace.`}
        </p>
      </header>

      <div className="interview-sessions-toolbar">
        <div className="interview-sessions-filters" role="tablist" aria-label="Filter sessions">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              role="tab"
              aria-selected={filter === f.id}
              className={`interview-sessions-filter${filter === f.id ? ' interview-sessions-filter--active' : ''}`}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>
        <label className="interview-sessions-search">
          <input
            type="search"
            placeholder="Search by title or candidate…"
            aria-label="Search sessions"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoComplete="off"
          />
        </label>
      </div>

      <section className="interview-card interview-card--sessions" aria-labelledby="iv-all-sessions">
        <div className="interview-card__head">
          <h2 id="iv-all-sessions" className="interview-card__title">
            Sessions
          </h2>
          {!loading ? <span className="interview-card__count">{filtered.length}</span> : null}
        </div>

        {loading ? (
          <div className="interview-loading" role="status">
            Loading interview sessions…
          </div>
        ) : (
          <InterviewSessionList
            meetings={filtered}
            emptyMessage={
              filter === 'all' && !query.trim()
                ? 'No interviews yet. Start one from the dashboard.'
                : 'No sessions match this filter.'
            }
          />
        )}
      </section>
    </div>
  );
}

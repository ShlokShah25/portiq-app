import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import axios from 'axios';
import MeetingInProgress from '../components/MeetingInProgress';
import {
  interviewRosterRows,
  interviewerLabel,
  interviewContextText,
  isInterviewMeetingRecord,
} from './interviewUtils';
import './InterviewMode.css';

function SessionRail({ meeting, side }) {
  const roster = interviewRosterRows(meeting);
  const primary = roster[0];
  const interviewer = interviewerLabel(meeting);
  const context = interviewContextText(meeting);

  return (
    <aside
      className={`interview-session-rail interview-session-rail--${side}`}
      aria-label={side === 'left' ? 'Candidate context' : 'Evaluation workspace'}
    >
      {side === 'left' ? (
        <>
          <p className="interview-session-rail__label">Candidate</p>
          <h2 className="interview-session-rail__candidate">{primary?.name || 'Candidate'}</h2>
          <p className="interview-session-rail__role">{primary?.role || 'Role not specified'}</p>
          {interviewer ? (
            <p className="interview-session-rail__meta">
              <strong style={{ color: 'var(--interview-text)' }}>Interviewer</strong>
              <br />
              {interviewer}
            </p>
          ) : null}
          {context ? (
            <div className="interview-session-rail__panel">
              <h3 className="interview-session-rail__panel-title">Interview brief</h3>
              <p className="interview-session-rail__hint">{context}</p>
            </div>
          ) : null}
          {roster.length > 1 ? (
            <div className="interview-session-rail__panel">
              <h3 className="interview-session-rail__panel-title">Panel roster</h3>
              <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, color: 'var(--interview-text-muted)' }}>
                {roster.map((r) => (
                  <li key={`${r.name}-${r.role}`}>
                    {r.name}
                    {r.role ? ` · ${r.role}` : ''}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      ) : (
        <>
          <p className="interview-session-rail__label">Evaluation</p>
          <div className="interview-session-rail__panel">
            <h3 className="interview-session-rail__panel-title">Response analysis</h3>
            <p className="interview-session-rail__hint">
              Live signals appear after the session ends. PortIQ analyzes communication clarity, technical depth,
              and ownership from the full transcript.
            </p>
          </div>
          <div className="interview-session-rail__panel">
            <h3 className="interview-session-rail__panel-title">Hiring recommendation</h3>
            <p className="interview-session-rail__hint">
              A draft verdict (Strong Hire · Hire · Neutral · No Hire) is generated when transcription completes. Long interviews use the same 10+ minute chunk pipeline as meetings.
              Finalize on the report screen.
            </p>
          </div>
          <div className="interview-session-rail__panel">
            <h3 className="interview-session-rail__panel-title">Notes & red flags</h3>
            <p className="interview-session-rail__hint">
              Concerns and strengths are captured in the interview report. Use the live transcript panel to track
              follow-up questions in real time.
            </p>
          </div>
        </>
      )}
    </aside>
  );
}

export default function InterviewSessionPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [meeting, setMeeting] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await axios.get(`/meetings/${id}`);
        const m = res.data?.meeting;
        if (!cancelled) {
          if (!isInterviewMeetingRecord(m)) {
            navigate(`/meetings/${id}/room`, { replace: true });
            return;
          }
          setMeeting(m);
        }
      } catch (_) {
        if (!cancelled) setMeeting(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, navigate]);

  if (loading) {
    return (
      <div className="interview-session-layout">
        <div className="interview-loading" style={{ gridColumn: '1 / -1', padding: 48 }}>
          Preparing interview workspace…
        </div>
      </div>
    );
  }

  return (
    <div className="interview-session-layout">
      {meeting ? <SessionRail meeting={meeting} side="left" /> : null}
      <div className="interview-session-main">
        <MeetingInProgress />
      </div>
      {meeting ? <SessionRail meeting={meeting} side="right" /> : null}
    </div>
  );
}

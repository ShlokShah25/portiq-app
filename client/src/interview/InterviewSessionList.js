import React from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { interviewPaths } from './useInterviewRoutes';
import {
  interviewCandidateSubtitle,
  interviewStatusLabel,
  hiringVerdictShort,
  hiringVerdictClass,
  meetingIdStr,
} from './interviewUtils';

/**
 * Shared row list for interview dashboard and All sessions page.
 */
export default function InterviewSessionList({ meetings, emptyMessage }) {
  if (!meetings.length) {
    return (
      <p className="interview-sessions-empty-inline" role="status">
        {emptyMessage || 'No interview sessions match this view.'}
      </p>
    );
  }

  return (
    <ul className="interview-list interview-list--sessions">
      {meetings.map((m) => {
        const id = meetingIdStr(m);
        const paths = interviewPaths(id);
        const status = interviewStatusLabel(m);
        const verdict = hiringVerdictShort(m);
        const href =
          status === 'Live'
            ? paths.session
            : status === 'Needs decision' || status === 'Draft ready'
              ? paths.report
              : paths.detail;

        return (
          <li key={id}>
            <Link to={href} className="interview-list__row">
              <span className="interview-list__row-main">
                <span className="interview-list__row-title">{m.title || 'Interview'}</span>
                <span className="interview-list__row-meta">{interviewCandidateSubtitle(m)}</span>
              </span>
              {verdict ? (
                <span className={`interview-verdict ${hiringVerdictClass(m)}`}>{verdict}</span>
              ) : (
                <span
                  className={`interview-status-pill${
                    status === 'Live'
                      ? ' interview-status-pill--live'
                      : status === 'Needs decision'
                        ? ' interview-status-pill--pending'
                        : ''
                  }`}
                >
                  {status}
                </span>
              )}
              <ChevronRight size={16} aria-hidden />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

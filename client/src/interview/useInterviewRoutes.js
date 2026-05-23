import { useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { FEATURE_INTERVIEW_UI } from '../config/featureFlags';
import { isInterviewMeetingRecord } from './interviewUtils';

export const INTERVIEW_BASE = '/interview';

export function interviewPaths(id) {
  const idStr = id != null ? String(id) : '';
  return {
    dashboard: INTERVIEW_BASE,
    sessions: `${INTERVIEW_BASE}/sessions`,
    create: `${INTERVIEW_BASE}/new`,
    detail: idStr ? `${INTERVIEW_BASE}/${idStr}` : INTERVIEW_BASE,
    session: idStr ? `${INTERVIEW_BASE}/${idStr}/session` : INTERVIEW_BASE,
    report: idStr ? `${INTERVIEW_BASE}/${idStr}/report` : INTERVIEW_BASE,
  };
}

/** Route targets for a meeting row — interview meetings use /interview when UI is on. */
export function meetingPaths(meeting) {
  const id = meeting?._id ?? meeting?.id;
  const idStr = id != null ? String(id) : '';
  const isInterviewMeeting = FEATURE_INTERVIEW_UI && isInterviewMeetingRecord(meeting);
  if (isInterviewMeeting) {
    return interviewPaths(idStr);
  }
  return {
    dashboard: '/meetings',
    create: '/meetings',
    detail: idStr ? `/meetings/${idStr}` : '/meetings',
    session: idStr ? `/meetings/${idStr}/room` : '/meetings',
    report: idStr ? `/meetings/${idStr}/summary` : '/meetings',
  };
}

export default function useInterviewRoutes() {
  const location = useLocation();
  const pathname = location?.pathname || '';

  return useMemo(() => {
    const isInterviewSurface =
      FEATURE_INTERVIEW_UI && pathname.startsWith(INTERVIEW_BASE);
    return {
      isInterviewSurface,
      paths: interviewPaths,
      meetingPaths,
      dashboard: INTERVIEW_BASE,
      create: `${INTERVIEW_BASE}/new`,
    };
  }, [pathname]);
}

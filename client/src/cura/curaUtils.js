import { FEATURE_CURA_UI } from '../config/featureFlags';
import { CURA_BASE, curaPaths } from './useCuraRoutes';

export function isCuraConsultationMeeting(meeting) {
  if (!meeting || typeof meeting !== 'object') return false;
  if (!FEATURE_CURA_UI) return false;
  if (meeting.patientId || meeting.clinicId) return true;
  return String(meeting.summaryMode || '').toLowerCase() === 'clinical';
}

export function curaMeetingPaths(meeting) {
  const id = meeting?._id ?? meeting?.id;
  const idStr = id != null ? String(id) : '';
  const paths = curaPaths(idStr);
  return {
    dashboard: CURA_BASE,
    create: paths.consultationNew,
    detail: paths.consultation,
    session: paths.consultationSession,
    report: paths.consultationReport,
    patient: meeting?.patientId ? curaPaths(meeting.patientId).patient : paths.patients,
  };
}

export function consultationStatusMeta(meeting) {
  const status = String(meeting?.status || 'Scheduled');
  const tx = String(meeting?.transcriptionStatus || '');
  const reviewed = !!meeting?.clinicalSummaryReviewedAt;
  const sent = meeting?.summaryStatus === 'Sent';

  if (sent) return { label: 'Finalized', tone: 'success', action: 'report' };
  if (tx === 'Completed' && !reviewed) return { label: 'Review SOAP', tone: 'warning', action: 'report' };
  if (tx === 'Recording' || status === 'In Progress') return { label: 'In session', tone: 'live', action: 'session' };
  if (status === 'Completed') return { label: 'Processing', tone: 'muted', action: 'report' };
  return { label: 'Scheduled', tone: 'default', action: 'session' };
}

export function clinicalPrepBadge(meeting) {
  const status = String(meeting?.clinicalPrepStatus || 'pending');
  if (status === 'pre_notes_provided') {
    return { label: 'Pre-notes provided', tone: 'success' };
  }
  if (status === 'prep_sent') {
    return { label: 'Prep sent', tone: 'muted' };
  }
  if (status === 'not_required') {
    return { label: 'N/A', tone: 'muted' };
  }
  return { label: 'Pending', tone: 'warning' };
}

export function patientInitials(name) {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

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

export function clinicalNoteToPlainText(note, fallbackSummary = '') {
  const summary = String(fallbackSummary || '').trim();
  if (summary) return summary;

  if (!note || typeof note !== 'object') return '';

  const lines = ["Here's your visit summary.", ''];
  const s = String(note.subjective || '').trim();
  const o = String(note.objective || '').trim();
  const a = String(note.assessment || '').trim();
  const p = String(note.plan || '').trim();
  if (s) lines.push(`The patient told you: ${s}`);
  if (o && !/^not documented/i.test(o)) lines.push(`On exam / what you noted: ${o}`);
  if (a) lines.push(`Your read: ${a}`);
  if (p) lines.push(`Plan: ${p}`);
  const meds = Array.isArray(note.medications) ? note.medications.filter(Boolean) : [];
  if (meds.length) lines.push(`Meds discussed: ${meds.join('; ')}`);
  return lines.join('\n\n').trim();
}

export function formatAppointmentTime(d) {
  if (!d) return 'later today';
  return new Date(d).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** Conversational line for doctor dashboard — especially WhatsApp bookings */
export function appointmentBriefing(consultation) {
  const name = consultation?.patientId?.name || 'a patient';
  const at = consultation?.scheduledTime || consultation?.startTime;
  const timeLabel = formatAppointmentTime(at);
  const complaint = String(
    consultation?.preVisitNotes || consultation?.chiefComplaint || ''
  ).trim();
  const viaWhatsApp = String(consultation?.bookingSource || '').toLowerCase() === 'whatsapp';

  if (viaWhatsApp && complaint) {
    return `You have ${name} at ${timeLabel} — booked on WhatsApp. They said: “${complaint.length > 160 ? `${complaint.slice(0, 157)}…` : complaint}”`;
  }
  if (viaWhatsApp) {
    return `You have ${name} at ${timeLabel} — booked on WhatsApp.`;
  }
  if (complaint) {
    return `${name} at ${timeLabel}. Chief concern: ${complaint.length > 120 ? `${complaint.slice(0, 117)}…` : complaint}`;
  }
  return `${name} at ${timeLabel}.`;
}

export function plainTextToClinicalNote(text, prev = {}) {
  const t = String(text || '').trim();
  return {
    subjective: t,
    objective: prev.objective || '',
    assessment: prev.assessment || '',
    plan: prev.plan || '',
    medications: prev.medications || [],
    followUpInstructions: prev.followUpInstructions || '',
    patientCounseling: prev.patientCounseling || '',
    redFlags: prev.redFlags || [],
  };
}

export function consultationStatusMeta(meeting) {
  const status = String(meeting?.status || 'Scheduled');
  const tx = String(meeting?.transcriptionStatus || '');
  const reviewed = !!meeting?.clinicalSummaryReviewedAt;
  const sent = meeting?.summaryStatus === 'Sent';

  if (sent) return { label: 'Finalized', tone: 'success', action: 'report' };
  if (tx === 'Completed' && !reviewed) return { label: 'Review notes', tone: 'warning', action: 'report' };
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

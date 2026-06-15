/**
 * PII masking for Cura — sensitive fields redacted until doctor toggles full view.
 */

const PHONE_RE = /(\+?\d[\d\s\-()]{8,}\d)/g;
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const MRN_RE = /\b(MRN|CURA-)[\w-]+\b/gi;

export function maskPhone(value) {
  const s = String(value || '').trim();
  if (!s) return '';
  const digits = s.replace(/\D/g, '');
  if (digits.length < 4) return '••••';
  return `•••• ${digits.slice(-4)}`;
}

export function maskEmail(value) {
  const s = String(value || '').trim();
  if (!s || !s.includes('@')) return s ? '•••@•••' : '';
  const [local, domain] = s.split('@');
  return `${local.slice(0, 1)}•••@${domain}`;
}

export function maskText(value, visibleChars = 2) {
  const s = String(value || '').trim();
  if (!s) return '';
  if (s.length <= visibleChars) return '•'.repeat(s.length);
  return `${s.slice(0, visibleChars)}${'•'.repeat(Math.min(8, s.length - visibleChars))}`;
}

/**
 * Apply masking rules to arbitrary display string.
 */
export function maskPiiString(text) {
  return String(text || '')
    .replace(EMAIL_RE, (m) => maskEmail(m))
    .replace(PHONE_RE, (m) => maskPhone(m))
    .replace(MRN_RE, 'MRN ••••');
}

/**
 * Mask patient record fields for list/card views.
 */
export function maskPatient(patient, unmasked = false) {
  if (!patient || unmasked) return patient;
  return {
    ...patient,
    phone: patient.phone ? maskPhone(patient.phone) : '',
    email: patient.email ? maskEmail(patient.email) : '',
    medicalRecordNumber: patient.medicalRecordNumber ? 'MRN ••••' : '',
  };
}

export function maskPatientName(name, unmasked = false) {
  if (unmasked) return name;
  const parts = String(name || '').trim().split(/\s+/);
  if (!parts.length) return '';
  if (parts.length === 1) return maskText(parts[0], 1);
  return `${parts[0]} ${parts[parts.length - 1].slice(0, 1)}.`;
}

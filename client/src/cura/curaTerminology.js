/**
 * Cura vertical terminology — replaces workplace labels when product_type === 'cura'.
 */
export const CURA_TERMINOLOGY = {
  workspace: 'Clinic',
  meeting: 'Consultation',
  meetings: 'Consultations',
  participant: 'Patient',
  participants: 'Patients',
  dashboard: 'Today',
  transcript: 'Clinical transcript',
  summary: 'Clinical note',
  organizer: 'Clinician',
  settings: 'Clinic settings',
  search: 'Clinical search',
  billing: 'Billing',
};

export function tCura(key, fallback = key) {
  return CURA_TERMINOLOGY[key] || fallback;
}

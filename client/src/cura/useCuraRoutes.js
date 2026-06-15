import { useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { FEATURE_CURA_UI } from '../config/featureFlags';

export const CURA_BASE = '/cura';

export function curaPaths(id) {
  const idStr = id != null ? String(id) : '';
  return {
    dashboard: CURA_BASE,
    login: `${CURA_BASE}/login`,
    onboarding: `${CURA_BASE}/onboarding`,
    patients: `${CURA_BASE}/patients`,
    calendar: `${CURA_BASE}/calendar`,
    prescriptions: `${CURA_BASE}/prescriptions`,
    followUps: `${CURA_BASE}/follow-ups`,
    settings: `${CURA_BASE}/settings`,
    search: `${CURA_BASE}/search`,
    consultationNew: `${CURA_BASE}/consultations/new`,
    consultation: idStr ? `${CURA_BASE}/consultations/${idStr}` : CURA_BASE,
    consultationSession: idStr ? `${CURA_BASE}/consultations/${idStr}/session` : CURA_BASE,
    consultationReport: idStr ? `${CURA_BASE}/consultations/${idStr}/report` : CURA_BASE,
    patient: idStr ? `${CURA_BASE}/patients/${idStr}` : `${CURA_BASE}/patients`,
  };
}

export default function useCuraRoutes() {
  const location = useLocation();
  const pathname = location?.pathname || '';

  return useMemo(() => {
    const isCuraSurface = FEATURE_CURA_UI && pathname.startsWith(CURA_BASE);
    return {
      isCuraSurface,
      paths: curaPaths,
      dashboard: CURA_BASE,
      login: `${CURA_BASE}/login`,
    };
  }, [pathname]);
}

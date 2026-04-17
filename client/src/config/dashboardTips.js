import { FEATURE_INTERVIEW_UI } from './featureFlags';

const DASHBOARD_TIPS_ALL = [
  'Tip: Add participants from Settings → Workspace or directly while creating a meeting.',
  'Tip: Use optional details to adjust date, time, and location before you start.',
  'Tip: Review action items regularly so nothing slips through.',
  'Tip: Pending summaries need a quick review before they go out.',
  'Tip: Interview meetings leave your decision queue once you finalize the decision.',
];

/** Workplace dashboard (main `Dashboard.js`). */
export const WORKSPACE_TIPS = FEATURE_INTERVIEW_UI
  ? DASHBOARD_TIPS_ALL
  : DASHBOARD_TIPS_ALL.filter((t) => !t.includes('Interview'));

/** Education org admin dashboard (`Dashboard.js` when not faculty). */
export const EDUCATION_ADMIN_TIPS = [
  'Tip: Create classrooms first, then add students directly inside each classroom.',
  'Tip: Mention assignments and presentation deadlines clearly so reminders trigger correctly.',
  'Tip: Use specific lesson titles to keep revision notes easy for students.',
  'Tip: Review lesson notes before sharing with students.',
];

/** Education teacher dashboard (`TeacherDashboard.js`) — same rotation UX as workspace. */
export const TEACHER_FACULTY_TIPS = [
  'Tip: When a student asks a question, briefly repeat or rephrase it before you answer so the summary captures both sides.',
  'Tip: Say key terms, names, and spellings clearly once for better transcripts and lecture notes.',
  "Tip: Use a clear lecture title before you start so today's list and follow-up emails stay easy to recognise.",
  'Tip: Mention assignments and presentation deadlines clearly so reminders stay accurate.',
  'Tip: Review lesson notes before sharing them with students.',
];

export const TIP_ROTATION_MS = 6500;

/**
 * Stable starting index per tab (sessionStorage). Use a distinct key per surface
 * (e.g. `portiq_dashboard_tip_idx` vs `portiq_teacher_tip_idx`).
 */
export function pickTipIndex(storageKey, tipsLength) {
  if (!tipsLength || tipsLength < 1) return 0;
  try {
    const raw = sessionStorage.getItem(storageKey);
    if (raw != null) {
      const n = parseInt(raw, 10);
      if (!Number.isNaN(n)) return n % tipsLength;
    }
    const idx = Math.floor(Math.random() * tipsLength);
    sessionStorage.setItem(storageKey, String(idx));
    return idx;
  } catch {
    return 0;
  }
}

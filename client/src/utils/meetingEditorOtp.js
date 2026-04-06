const STORAGE_PREFIX = 'portiq_meeting_editor_otp_';

export function editorOtpStorageKey(meetingId) {
  if (meetingId == null) return '';
  return `${STORAGE_PREFIX}${String(meetingId)}`;
}

export function getStoredEditorOtp(meetingId) {
  if (meetingId == null) return '';
  try {
    return sessionStorage.getItem(editorOtpStorageKey(meetingId)) || '';
  } catch {
    return '';
  }
}

export function setStoredEditorOtp(meetingId, code) {
  if (meetingId == null || !code) return;
  try {
    sessionStorage.setItem(editorOtpStorageKey(meetingId), String(code).trim());
  } catch {
    /* ignore quota / private mode */
  }
}

export function clearStoredEditorOtp(meetingId) {
  if (meetingId == null) return;
  try {
    sessionStorage.removeItem(editorOtpStorageKey(meetingId));
  } catch {
    /* ignore */
  }
}

/** Headers for GET/PUT/POST when editor verification is required */
export function editorOtpHeaders(meetingId) {
  const code = getStoredEditorOtp(meetingId);
  return code ? { 'X-Editor-Verification-Code': code } : {};
}

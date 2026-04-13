/**
 * Join API `error` and `details` for user-visible messages (workspace rule: show both).
 * @param {unknown} err - axios error or similar
 * @param {string} [fallback]
 */
export function formatApiError(err, fallback = 'Something went wrong.') {
  const d = err && err.response && err.response.data;
  const parts = [d && d.error, d && d.details].filter(Boolean);
  if (parts.length) return parts.join(' — ');
  if (err && err.message) return err.message;
  return fallback;
}

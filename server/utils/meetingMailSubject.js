/**
 * Human-readable date for email subjects (e.g. "18 Apr 2026").
 * Uses startTime, scheduledTime, endTime, then createdAt.
 */
function formatMeetingSubjectDate(meeting, fallbackDate) {
  const raw =
    meeting?.startTime ||
    meeting?.scheduledTime ||
    meeting?.endTime ||
    meeting?.createdAt;
  let d = raw ? new Date(raw) : null;
  if (!d || Number.isNaN(d.getTime())) {
    const fb =
      fallbackDate instanceof Date && !Number.isNaN(fallbackDate.getTime())
        ? fallbackDate
        : new Date();
    d = fb;
  }
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

module.exports = { formatMeetingSubjectDate };

/**
 * Shared Google / Outlook calendar URLs and .ics for meetings (schedule + summary emails).
 */

const MAX_GCAL_DETAILS_CHARS = 6000;

function toGoogleDateTimeUtc(d) {
  const iso = new Date(d).toISOString();
  return iso.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function buildGoogleCalendarUrlForMeeting({ title, details, location, startDate, endDate }) {
  if (!startDate || !endDate) return null;
  const start = new Date(startDate);
  const end = new Date(endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  const startStr = toGoogleDateTimeUtc(start);
  const endStr = toGoogleDateTimeUtc(end);
  const safeDetails = String(details || '').slice(0, MAX_GCAL_DETAILS_CHARS);
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: title || 'Meeting',
    details: safeDetails,
    location: location || '',
    dates: `${startStr}/${endStr}`,
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

function buildOutlookCalendarUrlForMeeting({ title, details, location, startDate, endDate }) {
  if (!startDate || !endDate) return null;
  const start = new Date(startDate);
  const end = new Date(endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  const startdt = start.toISOString();
  const enddt = end.toISOString();
  const params = new URLSearchParams({
    path: '/calendar/action/compose',
    subject: title || 'Meeting',
    body: String(details || '').slice(0, MAX_GCAL_DETAILS_CHARS),
    location: location || '',
    startdt,
    enddt,
  });
  return `https://outlook.office.com/calendar/0/deeplink/compose?${params.toString()}`;
}

function buildMeetingIcs({ meetingId, title, description, location, startDate, endDate }) {
  if (!startDate || !endDate) return null;
  const start = new Date(startDate);
  const end = new Date(endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  const uid = `${meetingId}-${Date.now()}@portiq`;
  const dtStamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const toUtc = (d) => new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const esc = (s) =>
    String(s || '')
      .replace(/\\/g, '\\\\')
      .replace(/\n/g, '\\n')
      .replace(/,/g, '\\,')
      .replace(/;/g, '\\;');

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//PortIQ//Meeting Assistant//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${dtStamp}`,
    `DTSTART:${toUtc(startDate)}`,
    `DTEND:${toUtc(endDate)}`,
    `SUMMARY:${esc(title || 'Meeting')}`,
    location ? `LOCATION:${esc(location)}` : null,
    description ? `DESCRIPTION:${esc(description)}` : null,
    'END:VEVENT',
    'END:VCALENDAR',
  ]
    .filter(Boolean)
    .join('\r\n');
}

module.exports = {
  buildGoogleCalendarUrlForMeeting,
  buildOutlookCalendarUrlForMeeting,
  buildMeetingIcs,
};

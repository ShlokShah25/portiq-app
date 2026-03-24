/** Google / Outlook / .ics links for action-item due dates (shared by MeetingSummary + MeetingsScreen). */

export function buildGoogleCalendarUrl({ title, details, dueDate }) {
  if (!dueDate) return null;
  const d = new Date(dueDate);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const start = `${y}${m}${day}`;
  const endDate = new Date(d.getTime() + 24 * 60 * 60 * 1000);
  const ey = endDate.getFullYear();
  const em = String(endDate.getMonth() + 1).padStart(2, '0');
  const ed = String(endDate.getDate()).padStart(2, '0');
  const end = `${ey}${em}${ed}`;

  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: title || 'Action item',
    details: details || '',
    dates: `${start}/${end}`,
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

export function buildOutlookCalendarUrl({ title, details, dueDate }) {
  if (!dueDate) return null;
  const d = new Date(dueDate);
  if (Number.isNaN(d.getTime())) return null;

  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');

  const startdt = `${y}-${m}-${day}`;
  const endDate = new Date(d.getTime() + 24 * 60 * 60 * 1000);
  const ey = endDate.getFullYear();
  const em = String(endDate.getMonth() + 1).padStart(2, '0');
  const ed = String(endDate.getDate()).padStart(2, '0');
  const enddt = `${ey}-${em}-${ed}`;

  const params = new URLSearchParams({
    path: '/calendar/action/compose',
    subject: title || 'Action item',
    body: details || '',
    startdt,
    enddt,
    allday: 'true',
  });

  return `https://outlook.office.com/calendar/0/deeplink/compose?${params.toString()}`;
}

export function buildIcsContent({ title, description, dueDate }) {
  const d = new Date(dueDate);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const dtStart = `${y}${m}${day}`;
  const endDate = new Date(d.getTime() + 24 * 60 * 60 * 1000);
  const ey = endDate.getFullYear();
  const em = String(endDate.getMonth() + 1).padStart(2, '0');
  const ed = String(endDate.getDate()).padStart(2, '0');
  const dtEnd = `${ey}${em}${ed}`;

  const uid = `${Date.now()}-${Math.random().toString(16).slice(2)}@portiq`;
  const dtStamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');

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
    `DTSTART;VALUE=DATE:${dtStart}`,
    `DTEND;VALUE=DATE:${dtEnd}`,
    `SUMMARY:${esc(title || 'Action item')}`,
    description ? `DESCRIPTION:${esc(description)}` : null,
    'END:VEVENT',
    'END:VCALENDAR',
  ]
    .filter(Boolean)
    .join('\r\n');
}

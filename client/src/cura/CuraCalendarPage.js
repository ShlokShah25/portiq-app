import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { fetchCuraCalendar, curaApiError } from './curaApi';
import { consultationStatusMeta, curaMeetingPaths, patientInitials } from './curaUtils';
import './CuraCore.css';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function pad(n) {
  return String(n).padStart(2, '0');
}

function dateKeyFromParts(year, month, day) {
  return `${year}-${pad(month)}-${pad(day)}`;
}

function dateKeyFromValue(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return dateKeyFromParts(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

function eventTime(value) {
  if (!value) return '';
  return new Date(value).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
}

function monthLabel(year, month) {
  return new Date(year, month - 1, 1).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  });
}

export default function CuraCalendarPage() {
  const today = new Date();
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth() + 1);
  const [selectedDay, setSelectedDay] = useState(today.getDate());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetchCuraCalendar(viewYear, viewMonth);
      setData(res);
    } catch (err) {
      setError(curaApiError(err, 'Could not load calendar.'));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [viewYear, viewMonth]);

  useEffect(() => {
    load();
  }, [load]);

  const eventsByDay = useMemo(() => {
    const map = {};
    const add = (key, item) => {
      if (!key) return;
      if (!map[key]) map[key] = { visits: [], followUps: [] };
      if (item.type === 'visit') map[key].visits.push(item);
      else map[key].followUps.push(item);
    };

    (data?.consultations || []).forEach((c) => {
      const at = c.scheduledTime || c.startTime || c.createdAt;
      add(dateKeyFromValue(at), {
        type: 'visit',
        id: c._id,
        at,
        name: c.patientId?.name || 'Patient',
        detail: c.chiefComplaint || c.preVisitNotes || 'Consultation',
        consultation: c,
      });
    });

    (data?.followUps || []).forEach((f) => {
      const at = f.scheduledAt || f.sentAt || f.createdAt;
      add(dateKeyFromValue(at), {
        type: 'followUp',
        id: f._id,
        at,
        name: f.patientId?.name || 'Patient',
        detail: f.messageType === 'check_in' ? 'Follow-up check-in' : 'Follow-up',
        status: f.status,
      });
    });

    return map;
  }, [data]);

  const daysInMonth = new Date(viewYear, viewMonth, 0).getDate();
  const firstWeekday = new Date(viewYear, viewMonth - 1, 1).getDay();
  const selectedKey = dateKeyFromParts(viewYear, viewMonth, selectedDay);
  const selectedEvents = eventsByDay[selectedKey] || { visits: [], followUps: [] };
  const isToday =
    viewYear === today.getFullYear() &&
    viewMonth === today.getMonth() + 1 &&
    selectedDay === today.getDate();

  const shiftMonth = (delta) => {
    let y = viewYear;
    let m = viewMonth + delta;
    if (m < 1) {
      m = 12;
      y -= 1;
    } else if (m > 12) {
      m = 1;
      y += 1;
    }
    setViewYear(y);
    setViewMonth(m);
    setSelectedDay(1);
  };

  const gridCells = [];
  for (let i = 0; i < firstWeekday; i += 1) gridCells.push(null);
  for (let d = 1; d <= daysInMonth; d += 1) gridCells.push(d);

  const selectedDateLabel = new Date(viewYear, viewMonth - 1, selectedDay).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  return (
    <div className="cura-home cura-home--wide">
      <header className="cura-cal-header">
        <div>
          <h1 className="cura-home-hero__title" style={{ fontSize: 26, marginBottom: 4 }}>
            Calendar
          </h1>
          <p className="cura-muted">All visits and follow-ups for your clinic</p>
        </div>
        <div className="cura-cal-nav">
          <button type="button" className="cura-cal-nav__btn" onClick={() => shiftMonth(-1)} aria-label="Previous month">
            <ChevronLeft size={18} />
          </button>
          <span className="cura-cal-nav__label">{monthLabel(viewYear, viewMonth)}</span>
          <button type="button" className="cura-cal-nav__btn" onClick={() => shiftMonth(1)} aria-label="Next month">
            <ChevronRight size={18} />
          </button>
        </div>
      </header>

      {error ? (
        <p className="cura-login__error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="cura-cal-layout">
        <section className="cura-cal-grid-wrap" aria-label="Month view">
          <div className="cura-cal-weekdays">
            {WEEKDAYS.map((w) => (
              <span key={w} className="cura-cal-weekday">
                {w}
              </span>
            ))}
          </div>
          <div className="cura-cal-grid">
            {gridCells.map((day, idx) => {
              if (day == null) {
                return <span key={`empty-${idx}`} className="cura-cal-day cura-cal-day--empty" />;
              }
              const key = dateKeyFromParts(viewYear, viewMonth, day);
              const bucket = eventsByDay[key];
              const visitCount = bucket?.visits?.length || 0;
              const followCount = bucket?.followUps?.length || 0;
              const isSelected = selectedDay === day;
              const isTodayCell =
                viewYear === today.getFullYear() &&
                viewMonth === today.getMonth() + 1 &&
                day === today.getDate();

              return (
                <button
                  key={key}
                  type="button"
                  className={`cura-cal-day${isSelected ? ' is-selected' : ''}${isTodayCell ? ' is-today' : ''}`}
                  onClick={() => setSelectedDay(day)}
                >
                  <span className="cura-cal-day__num">{day}</span>
                  {visitCount || followCount ? (
                    <span className="cura-cal-day__dots" aria-hidden>
                      {visitCount > 0 ? <span className="cura-cal-day__dot cura-cal-day__dot--visit" /> : null}
                      {followCount > 0 ? <span className="cura-cal-day__dot cura-cal-day__dot--follow" /> : null}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </section>

        <section className="cura-cal-agenda" aria-label="Day schedule">
          <h2 className="cura-cal-agenda__title">
            {selectedDateLabel}
            {isToday ? <span className="cura-cal-agenda__today">Today</span> : null}
          </h2>

          {loading ? (
            <p className="cura-muted">Loading appointments…</p>
          ) : selectedEvents.visits.length === 0 && selectedEvents.followUps.length === 0 ? (
            <div className="cura-empty-card">
              <p className="cura-empty-card__title">Nothing scheduled</p>
              <p className="cura-muted">No visits or follow-ups on this day.</p>
            </div>
          ) : (
            <ul className="cura-visit-list">
              {selectedEvents.visits
                .sort((a, b) => new Date(a.at) - new Date(b.at))
                .map((ev) => {
                  const meta = consultationStatusMeta(ev.consultation);
                  const paths = curaMeetingPaths(ev.consultation);
                  const href = meta.action === 'report' ? paths.report : paths.session;
                  return (
                    <li key={ev.id}>
                      <Link to={href} className="cura-visit-row">
                        <span className="cura-visit-row__avatar" aria-hidden>
                          {patientInitials(ev.name)}
                        </span>
                        <span className="cura-visit-row__body">
                          <strong>{ev.name}</strong>
                          <span className="cura-muted">
                            {eventTime(ev.at)}
                            {ev.detail ? ` · ${ev.detail}` : ''}
                          </span>
                        </span>
                        <span className={`cura-visit-row__badge cura-visit-row__badge--${meta.tone}`}>
                          {meta.label}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              {selectedEvents.followUps
                .sort((a, b) => new Date(a.at) - new Date(b.at))
                .map((ev) => (
                  <li key={ev.id}>
                    <div className="cura-visit-row cura-visit-row--static">
                      <span className="cura-visit-row__avatar cura-visit-row__avatar--follow" aria-hidden>
                        {patientInitials(ev.name)}
                      </span>
                      <span className="cura-visit-row__body">
                        <strong>{ev.name}</strong>
                        <span className="cura-muted">
                          {eventTime(ev.at)} · {ev.detail}
                        </span>
                      </span>
                      <span className="cura-visit-row__badge">{ev.status || 'scheduled'}</span>
                    </div>
                  </li>
                ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

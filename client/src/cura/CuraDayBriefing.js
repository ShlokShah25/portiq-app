import React from 'react';
import { Link } from 'react-router-dom';
import { MessageCircle, ChevronRight } from 'lucide-react';
import { appointmentBriefing, consultationStatusMeta, curaMeetingPaths, patientInitials } from './curaUtils';

function visitPath(consultation) {
  const meta = consultationStatusMeta(consultation);
  const paths = curaMeetingPaths(consultation);
  return meta.action === 'report' ? paths.report : paths.session;
}

export default function CuraDayBriefing({ appointments = [] }) {
  if (!appointments.length) {
    return (
      <section className="cura-briefing cura-briefing--empty">
        <p className="cura-briefing__intro">Nothing on your schedule today yet.</p>
        <p className="cura-muted">When patients book on WhatsApp, they&apos;ll show up here with what they told us.</p>
      </section>
    );
  }

  const whatsappCount = appointments.filter(
    (a) => String(a.bookingSource || '').toLowerCase() === 'whatsapp'
  ).length;

  return (
    <section className="cura-briefing" aria-label="Today's appointments">
      <p className="cura-briefing__intro">
        {appointments.length === 1
          ? 'You have 1 appointment today'
          : `You have ${appointments.length} appointments today`}
        {whatsappCount > 0
          ? ` — ${whatsappCount} from WhatsApp`
          : ''}
        .
      </p>
      <ul className="cura-briefing__list">
        {appointments.map((c) => {
          const name = c.patientId?.name || 'Patient';
          const viaWa = String(c.bookingSource || '').toLowerCase() === 'whatsapp';
          const meta = consultationStatusMeta(c);
          return (
            <li key={c._id}>
              <Link to={visitPath(c)} className="cura-briefing__card">
                <span className="cura-briefing__avatar" aria-hidden>
                  {patientInitials(name)}
                </span>
                <span className="cura-briefing__body">
                  <span className="cura-briefing__line">{appointmentBriefing(c)}</span>
                  {viaWa ? (
                    <span className="cura-briefing__tag">
                      <MessageCircle size={12} aria-hidden />
                      WhatsApp booking
                    </span>
                  ) : null}
                </span>
                <span className={`cura-visit-row__badge cura-visit-row__badge--${meta.tone}`}>
                  {meta.label}
                </span>
                <ChevronRight size={18} className="cura-visit-row__chev" aria-hidden />
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

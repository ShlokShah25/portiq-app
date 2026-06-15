import React from 'react';
import { Link } from 'react-router-dom';
import { Mic, FileText, MessageCircle, Activity } from 'lucide-react';
import './CuraMode.css';
import './CuraLandingPage.css';

export default function CuraLandingPage() {
  React.useEffect(() => {
    document.title = 'Cura — The AI Clinical Assistant That Never Forgets';
  }, []);

  return (
    <div className="cura-landing">
      <header className="cura-landing__nav">
        <div className="cura-landing__brand">
          <span className="cura-landing__logo" aria-hidden>
            C
          </span>
          <span>Cura</span>
        </div>
        <div className="cura-landing__nav-actions">
          <Link to="/cura/login" className="cura-landing__link">
            Sign in
          </Link>
          <Link to="/cura/login" className="cura-btn cura-btn--primary">
            Request demo
          </Link>
        </div>
      </header>

      <section className="cura-landing__hero">
        <p className="cura-landing__eyebrow">Clinical intelligence</p>
        <h1 className="cura-landing__headline">The AI Clinical Assistant That Never Forgets</h1>
        <p className="cura-landing__lead">
          Record consultations, generate structured visit summaries, draft prescriptions, and keep patients
          engaged through WhatsApp follow-ups — all in one calm, focused workspace.
        </p>
        <div className="cura-landing__hero-cta">
          <Link to="/cura/login" className="cura-btn cura-btn--primary">
            Start with Cura
          </Link>
          <a href="#how-it-works" className="cura-btn cura-btn--secondary">
            See how it works
          </a>
        </div>
      </section>

      <section id="how-it-works" className="cura-landing__section">
        <h2 className="cura-landing__section-title">How it works</h2>
        <div className="cura-landing__flow" aria-hidden>
          <div className="cura-landing__flow-step">
            <Mic size={20} />
            <span>Record</span>
          </div>
          <div className="cura-landing__flow-arrow" />
          <div className="cura-landing__flow-step">
            <FileText size={20} />
            <span>Summarize</span>
          </div>
          <div className="cura-landing__flow-arrow" />
          <div className="cura-landing__flow-step">
            <Activity size={20} />
            <span>Approve</span>
          </div>
          <div className="cura-landing__flow-arrow" />
          <div className="cura-landing__flow-step">
            <MessageCircle size={20} />
            <span>Follow up</span>
          </div>
        </div>
        <p className="cura-landing__section-text">
          Doctors speak naturally. Cura transcribes, structures clinical notes, and waits for your approval before
          anything reaches the patient.
        </p>
      </section>

      <section className="cura-landing__section">
        <h2 className="cura-landing__section-title">Built for clinical practice</h2>
        <div className="cura-landing__features">
          <article className="cura-landing__feature">
            <h3>Clinical intelligence</h3>
            <p>Structured visit summaries, assessment, and plan — grounded in the conversation, not guesswork.</p>
          </article>
          <article className="cura-landing__feature">
            <h3>WhatsApp continuity</h3>
            <p>Send approved summaries and follow-up check-ins where patients already are.</p>
          </article>
          <article className="cura-landing__feature">
            <h3>Patient timeline</h3>
            <p>Every consultation, prescription, and follow-up on one chronological record.</p>
          </article>
        </div>
      </section>

      <section className="cura-landing__cta-band">
        <h2>Ready to modernize your clinic?</h2>
        <Link to="/cura/login" className="cura-btn cura-btn--primary">
          Join the waitlist
        </Link>
      </section>

      <footer className="cura-landing__footer">
        <span>© {new Date().getFullYear()} Cura</span>
        <span>Powered by PortIQ engine</span>
      </footer>
    </div>
  );
}

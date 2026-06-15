import React from 'react';
import { Mic, FileText } from 'lucide-react';
import './CuraCore.css';

/**
 * Split-screen consultation editor shell.
 * Left: live transcript / audio context. Right: AI-structured clinical notes. Bottom: approval actions.
 *
 * @param {object} props
 * @param {string} [props.transcript] — raw or formatted transcript text
 * @param {boolean} [props.transcriptLoading]
 * @param {React.ReactNode} props.notesPanel — editable SOAP / AI note sections
 * @param {React.ReactNode} props.actionBar — approve & send controls
 * @param {string} [props.patientName]
 */
export default function CuraConsultationView({
  transcript = '',
  transcriptLoading = false,
  notesPanel,
  actionBar,
  patientName = '',
}) {
  const transcriptBody = transcriptLoading
    ? 'Transcribing consultation…'
    : transcript?.trim()
      ? transcript
      : 'Transcript will appear here once the session is recorded and processed.';

  return (
    <div className="cura-consult-view">
      <div className="cura-consult-view__split">
        <section className="cura-consult-view__pane cura-consult-view__pane--transcript" aria-label="Transcript">
          <header className="cura-consult-view__pane-head">
            <Mic size={14} aria-hidden />
            <span>Audio / transcript</span>
            {patientName ? <span className="cura-consult-view__patient">{patientName}</span> : null}
          </header>
          <div className={`cura-consult-view__transcript${transcriptLoading ? ' is-loading' : ''}`}>
            {transcriptBody}
          </div>
        </section>
        <section className="cura-consult-view__pane cura-consult-view__pane--notes" aria-label="Clinical notes">
          <header className="cura-consult-view__pane-head">
            <FileText size={14} aria-hidden />
            <span>AI-structured notes</span>
          </header>
          <div className="cura-consult-view__notes">{notesPanel}</div>
        </section>
      </div>
      {actionBar ? <footer className="cura-consult-view__action-bar">{actionBar}</footer> : null}
    </div>
  );
}

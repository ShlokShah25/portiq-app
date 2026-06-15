import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import axios from 'axios';
import { CheckCircle2, Save, Send } from 'lucide-react';
import { curaPaths } from './useCuraRoutes';
import { curaApiError } from './curaApi';
import { isCuraConsultationMeeting } from './curaUtils';
import { formatApiError } from '../utils/apiErrorMessage';
import CuraConsultationView from './CuraConsultationView';
import './CuraMode.css';
import './CuraSession.css';
import './CuraCore.css';

const SOAP_SECTIONS = [
  { key: 'subjective', letter: 'S', title: 'Subjective', hint: 'Patient-reported history & symptoms', mod: 's' },
  { key: 'objective', letter: 'O', title: 'Objective', hint: 'Exam findings & vitals', mod: 'o' },
  { key: 'assessment', letter: 'A', title: 'Assessment', hint: 'Diagnoses & clinical impression', mod: 'a' },
  { key: 'plan', letter: 'P', title: 'Plan', hint: 'Treatment, meds & follow-up', mod: 'p' },
];

function emptyNote() {
  return {
    subjective: '',
    objective: '',
    assessment: '',
    plan: '',
    medications: [],
    followUpInstructions: '',
    patientCounseling: '',
    redFlags: [],
  };
}

function noteFromMeeting(meeting) {
  const raw = meeting?.pendingClinicalNote || meeting?.clinicalNote;
  if (raw && typeof raw === 'object') {
    return { ...emptyNote(), ...raw };
  }
  return emptyNote();
}

export default function CuraClinicalReport() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [meeting, setMeeting] = useState(null);
  const [note, setNote] = useState(emptyNote());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const res = await axios.get(`/meetings/${id}`);
      const m = res.data?.meeting;
      if (!isCuraConsultationMeeting(m)) {
        navigate(`/meetings/${id}/summary`, { replace: true });
        return;
      }
      setMeeting(m);
      setNote(noteFromMeeting(m));
    } catch (err) {
      setError(formatApiError(err, 'Could not load consultation.'));
    } finally {
      setLoading(false);
    }
  }, [id, navigate]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const poll = setInterval(() => {
      load();
    }, 8000);
    return () => clearInterval(poll);
  }, [load]);

  const reviewed = !!meeting?.clinicalSummaryReviewedAt;
  const processing =
    meeting?.transcriptionStatus === 'Recording' ||
    (meeting?.status === 'Completed' && meeting?.transcriptionStatus !== 'Completed' && meeting?.transcriptionStatus !== 'Failed');

  const handleSave = async (markReview = false) => {
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      await axios.put(`/meetings/${id}/pending-summary`, {
        clinicalNote: note,
        followUpPlan: note.followUpInstructions,
        markClinicalReviewComplete: markReview,
      });
      setSuccess(markReview ? 'Clinical note approved.' : 'Draft saved.');
      await load();
    } catch (err) {
      setError(curaApiError(err, 'Could not save clinical note.'));
    } finally {
      setSaving(false);
    }
  };

  const handleFinalize = async () => {
    setSaving(true);
    setError('');
    try {
      if (!reviewed) {
        await axios.put(`/meetings/${id}/pending-summary`, {
          clinicalNote: note,
          followUpPlan: note.followUpInstructions,
          markClinicalReviewComplete: true,
        });
      }
      await axios.post(`/meetings/${id}/approve-and-send`, {});
      setSuccess('Consultation record finalized.');
      navigate(curaPaths().dashboard, { replace: true });
    } catch (err) {
      setError(curaApiError(err, 'Could not finalize consultation.'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="cura-loading">Loading clinical note…</div>;
  }

  if (!meeting) {
    return <p className="cura-login__error">Consultation not found.</p>;
  }

  const patientName =
    meeting.participants?.find((p) => String(p.role || '').toLowerCase() === 'patient')?.name || '';
  const transcriptText = String(meeting.transcription || meeting.liveTranscript || '').trim();

  const notesPanel = (
    <>
      {error ? (
        <div className="cura-login__error" role="alert">
          {error}
        </div>
      ) : null}
      {success ? (
        <div className="cura-report-reviewed" role="status">
          <CheckCircle2 size={16} aria-hidden />
          {success}
        </div>
      ) : null}

      {processing ? (
        <div className="cura-card" style={{ padding: 20 }}>
          <p className="cura-empty__title">Generating SOAP note…</p>
          <p style={{ fontSize: 13, color: 'var(--cura-text-secondary)', margin: 0 }}>
            Cura is transcribing and structuring your consultation. This page refreshes automatically.
          </p>
        </div>
      ) : null}

      {SOAP_SECTIONS.map((sec) => (
        <section key={sec.key} className={`cura-soap-card cura-soap-card--${sec.mod}`}>
          <div className="cura-soap-card__head">
            <span className="cura-soap-card__letter" aria-hidden>
              {sec.letter}
            </span>
            <div>
              <h2 className="cura-soap-card__title">{sec.title}</h2>
              <p className="cura-soap-card__hint">{sec.hint}</p>
            </div>
          </div>
          <div className="cura-soap-card__body">
            <textarea
              className="cura-soap-card__textarea"
              value={note[sec.key] || ''}
              onChange={(e) => setNote((n) => ({ ...n, [sec.key]: e.target.value }))}
              placeholder={`Enter ${sec.title.toLowerCase()}…`}
              disabled={saving}
            />
          </div>
        </section>
      ))}

      <section className="cura-soap-card">
        <div className="cura-soap-card__head">
          <span className="cura-soap-card__letter" style={{ background: '#f4f4f5', color: '#18181b' }}>
            Rx
          </span>
          <div>
            <h2 className="cura-soap-card__title">Medications</h2>
            <p className="cura-soap-card__hint">One per line — verify before approving</p>
          </div>
        </div>
        <div className="cura-soap-card__body">
          <textarea
            className="cura-soap-card__textarea"
            style={{ minHeight: 80 }}
            value={(note.medications || []).join('\n')}
            onChange={(e) =>
              setNote((n) => ({
                ...n,
                medications: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean),
              }))
            }
            placeholder="e.g. Amoxicillin 500mg TID × 5 days"
            disabled={saving}
          />
        </div>
      </section>

      <section className="cura-soap-card">
        <div className="cura-soap-card__head">
          <span className="cura-soap-card__letter" style={{ background: '#f4f4f5', color: '#a16207' }}>
            !
          </span>
          <div>
            <h2 className="cura-soap-card__title">Safety flags</h2>
            <p className="cura-soap-card__hint">Allergies & contraindications from encounter</p>
          </div>
        </div>
        <div className="cura-soap-card__body">
          <textarea
            className="cura-soap-card__textarea"
            style={{ minHeight: 72 }}
            value={(note.redFlags || []).join('\n')}
            onChange={(e) =>
              setNote((n) => ({
                ...n,
                redFlags: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean),
              }))
            }
            placeholder="Document safety concerns…"
            disabled={saving}
          />
        </div>
      </section>
    </>
  );

  const actionBar = (
    <>
      {reviewed ? (
        <span className="cura-report-reviewed">
          <CheckCircle2 size={16} aria-hidden />
          Reviewed &amp; approved
        </span>
      ) : (
        <button
          type="button"
          className="cura-btn cura-btn--secondary"
          onClick={() => handleSave(true)}
          disabled={saving || processing}
        >
          <CheckCircle2 size={16} aria-hidden />
          Mark reviewed
        </button>
      )}
      <button type="button" className="cura-btn cura-btn--secondary" onClick={() => handleSave(false)} disabled={saving}>
        <Save size={16} aria-hidden />
        {saving ? 'Saving…' : 'Save draft'}
      </button>
      <button
        type="button"
        className="cura-btn cura-btn--primary"
        onClick={handleFinalize}
        disabled={saving || processing}
      >
        <Send size={16} aria-hidden />
        Approve &amp; send to WhatsApp
      </button>
    </>
  );

  return (
    <CuraConsultationView
      transcript={transcriptText}
      transcriptLoading={processing}
      patientName={patientName}
      notesPanel={notesPanel}
      actionBar={actionBar}
    />
  );
}

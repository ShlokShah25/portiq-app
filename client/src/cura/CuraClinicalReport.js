import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import axios from 'axios';
import { ArrowLeft, ChevronDown, ChevronUp, Save } from 'lucide-react';
import { curaPaths } from './useCuraRoutes';
import { curaApiError } from './curaApi';
import { formatApiError } from '../utils/apiErrorMessage';
import {
  isCuraConsultationMeeting,
  clinicalNoteToPlainText,
  plainTextToClinicalNote,
} from './curaUtils';
import './CuraCore.css';

function noteFromMeeting(meeting) {
  const raw = meeting?.pendingClinicalNote || meeting?.clinicalNote;
  return clinicalNoteToPlainText(raw, meeting?.pendingSummary || meeting?.summary || '');
}

export default function CuraClinicalReport() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [meeting, setMeeting] = useState(null);
  const [noteText, setNoteText] = useState('');
  const [showTranscript, setShowTranscript] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

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
      setNoteText(noteFromMeeting(m));
    } catch (err) {
      setError(formatApiError(err, 'Could not load visit.'));
    } finally {
      setLoading(false);
    }
  }, [id, navigate]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const poll = setInterval(load, 8000);
    return () => clearInterval(poll);
  }, [load]);

  const processing =
    meeting?.transcriptionStatus === 'Recording' ||
    (meeting?.status === 'Completed' &&
      meeting?.transcriptionStatus !== 'Completed' &&
      meeting?.transcriptionStatus !== 'Failed');

  const buildClinicalNote = () => {
    const prev = meeting?.pendingClinicalNote || meeting?.clinicalNote || {};
    return plainTextToClinicalNote(noteText, prev);
  };

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      await axios.put(`/meetings/${id}/pending-summary`, { clinicalNote: buildClinicalNote() });
      await load();
    } catch (err) {
      setError(curaApiError(err, 'Could not save.'));
    } finally {
      setSaving(false);
    }
  };

  const handleDone = async () => {
    setSaving(true);
    setError('');
    try {
      const clinicalNote = buildClinicalNote();
      await axios.put(`/meetings/${id}/pending-summary`, {
        clinicalNote,
        markClinicalReviewComplete: true,
      });
      await axios.post(`/meetings/${id}/approve-and-send`, {});
      navigate(curaPaths().dashboard, { replace: true });
    } catch (err) {
      setError(curaApiError(err, 'Could not finish visit.'));
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="cura-notes-page">
        <div className="cura-loading">Loading notes…</div>
      </div>
    );
  }

  if (!meeting) {
    return (
      <div className="cura-notes-page">
        <p className="cura-login__error">Visit not found.</p>
      </div>
    );
  }

  const patientName =
    meeting.participants?.find((p) => String(p.role || '').toLowerCase() === 'patient')?.name || 'Patient';
  const transcriptText = String(meeting.transcription || meeting.liveTranscript || '').trim();

  return (
    <div className="cura-notes-page">
      <header className="cura-notes-header">
        <button type="button" className="cura-notes-header__back" onClick={() => navigate(curaPaths().dashboard)}>
          <ArrowLeft size={14} aria-hidden />
          Back
        </button>
        <div>
          <h1 className="cura-notes-header__title">{patientName}</h1>
          <p className="cura-muted" style={{ margin: '4px 0 0', fontSize: 13 }}>
            Here&apos;s your visit summary — edit anything that looks off, then tap Done.
          </p>
        </div>
      </header>

      {error ? (
        <p className="cura-login__error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="cura-notes-card">
        {processing ? (
          <p className="cura-muted" style={{ margin: '0 0 12px' }}>
            Writing your visit summary from the recording…
          </p>
        ) : null}
        <textarea
          className="cura-simple-note"
          value={noteText}
          onChange={(e) => setNoteText(e.target.value)}
          placeholder="Here's your visit summary…"
          disabled={saving || processing}
          aria-label="Visit notes"
        />
      </div>

      {transcriptText ? (
        <>
          <button
            type="button"
            className="cura-transcript-toggle"
            onClick={() => setShowTranscript((v) => !v)}
            aria-expanded={showTranscript}
          >
            Transcript
            {showTranscript ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
          {showTranscript ? <div className="cura-transcript-panel">{transcriptText}</div> : null}
        </>
      ) : null}

      <footer className="cura-notes-footer">
        <div className="cura-notes-footer__inner">
          <button type="button" className="cura-btn cura-btn--secondary" onClick={handleSave} disabled={saving || processing}>
            <Save size={16} aria-hidden />
            Save
          </button>
          <button type="button" className="cura-btn cura-btn--primary" onClick={handleDone} disabled={saving || processing}>
            {saving ? 'Saving…' : 'Done'}
          </button>
        </div>
      </footer>
    </div>
  );
}

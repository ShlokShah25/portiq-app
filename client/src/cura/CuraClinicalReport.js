import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import axios from 'axios';
import { CheckCircle2, Save } from 'lucide-react';
import { curaPaths } from './useCuraRoutes';
import { curaApiError } from './curaApi';
import {
  isCuraConsultationMeeting,
  clinicalNoteToPlainText,
  plainTextToClinicalNote,
} from './curaUtils';
import { formatApiError } from '../utils/apiErrorMessage';
import CuraConsultationView from './CuraConsultationView';
import './CuraMode.css';
import './CuraSession.css';
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
    setSuccess('');
    try {
      const clinicalNote = buildClinicalNote();
      await axios.put(`/meetings/${id}/pending-summary`, { clinicalNote });
      setSuccess('Saved.');
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
    return <div className="cura-loading">Loading notes…</div>;
  }

  if (!meeting) {
    return <p className="cura-login__error">Visit not found.</p>;
  }

  const patientName =
    meeting.participants?.find((p) => String(p.role || '').toLowerCase() === 'patient')?.name || '';
  const transcriptText = String(meeting.transcription || meeting.liveTranscript || '').trim();
  const reviewed = !!meeting?.clinicalSummaryReviewedAt;

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
        <p style={{ fontSize: 13, color: 'var(--cura-text-muted)', margin: '0 0 12px' }}>
          Writing notes from the recording… refreshes automatically.
        </p>
      ) : null}

      <textarea
        className="cura-simple-note"
        value={noteText}
        onChange={(e) => setNoteText(e.target.value)}
        placeholder="Visit summary appears here after the recording. Edit anything that looks off."
        disabled={saving || processing}
        rows={16}
      />
    </>
  );

  const actionBar = (
    <>
      {reviewed ? (
        <span className="cura-report-reviewed">
          <CheckCircle2 size={16} aria-hidden />
          Saved
        </span>
      ) : null}
      <button type="button" className="cura-btn cura-btn--secondary" onClick={handleSave} disabled={saving || processing}>
        <Save size={16} aria-hidden />
        {saving ? 'Saving…' : 'Save'}
      </button>
      <button type="button" className="cura-btn cura-btn--primary" onClick={handleDone} disabled={saving || processing}>
        Done
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

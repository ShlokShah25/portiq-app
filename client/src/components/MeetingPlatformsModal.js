import React, { useState } from 'react';
import axios from 'axios';
import { X, Video } from 'lucide-react';
import './StartMeetingModal.css';
import './DashboardIntegrations.css';

export default function MeetingPlatformsModal({ open, onClose, onSaved }) {
  const [loading, setLoading] = useState(null);
  const [error, setError] = useState('');

  if (!open) return null;

  const startZoom = async () => {
    setError('');
    setLoading('zoom');
    try {
      const { data } = await axios.get('/integrations/oauth/zoom/start');
      if (!data?.url) {
        setError('Zoom OAuth URL not returned.');
        setLoading(null);
        return;
      }
      window.location.assign(data.url);
    } catch (e) {
      const hint = e.response?.data?.hint ? ` ${e.response.data.hint}` : '';
      setError((e.response?.data?.error || e.message || 'Zoom OAuth failed.') + hint);
      setLoading(null);
    }
  };

  const startTeams = async () => {
    setError('');
    setLoading('teams');
    try {
      const { data } = await axios.get('/integrations/oauth/teams/start');
      if (!data?.url) {
        setError('Microsoft OAuth URL not returned.');
        setLoading(null);
        return;
      }
      window.location.assign(data.url);
    } catch (e) {
      const hint = e.response?.data?.hint ? ` ${e.response.data.hint}` : '';
      setError((e.response?.data?.error || e.message || 'Microsoft OAuth failed.') + hint);
      setLoading(null);
    }
  };

  const markManual = async (zoom, teams) => {
    setError('');
    setLoading('manual');
    try {
      const res = await axios.patch('/admin/meeting-platforms', {
        ...(zoom ? { zoom: true } : {}),
        ...(teams ? { teams: true } : {}),
      });
      onSaved?.(res.data?.meetingPlatforms);
      onClose();
    } catch (e) {
      setError(e.response?.data?.error || 'Could not save.');
    } finally {
      setLoading(null);
    }
  };

  return (
    <div
      className="start-meeting-overlay"
      role="presentation"
      onMouseDown={(e) => e.target === e.currentTarget && !loading && onClose()}
    >
      <div
        className="start-meeting-modal dashboard-int-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="mp-connect-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="start-meeting-modal__head">
          <h2 id="mp-connect-title" className="start-meeting-modal__title">
            Connect Zoom / Teams
          </h2>
          <button
            type="button"
            className="start-meeting-modal__close"
            onClick={() => !loading && onClose()}
            aria-label="Close"
          >
            <X size={18} strokeWidth={2} />
          </button>
        </div>
        <p className="dashboard-int-modal__desc">
          Sign in with Zoom or Microsoft to link your account. You will return to the dashboard when done.
        </p>
        <div className="start-meeting-actions" style={{ marginTop: 8 }}>
          <button
            type="button"
            className="start-meeting-btn start-meeting-btn--primary"
            onClick={startZoom}
            disabled={!!loading}
          >
            Connect Zoom
          </button>
          <button
            type="button"
            className="start-meeting-btn start-meeting-btn--primary"
            onClick={startTeams}
            disabled={!!loading}
          >
            <Video size={18} strokeWidth={1.75} aria-hidden />
            Connect Microsoft Teams
          </button>
        </div>
        <p className="dashboard-int-modal__fineprint">
          If OAuth is not configured on the server yet, use manual flags for demos only.
        </p>
        <div className="dashboard-int-modal__manual">
          <button
            type="button"
            className="start-meeting-btn start-meeting-btn--ghost"
            disabled={!!loading}
            onClick={() => markManual(true, false)}
          >
            Mark Zoom connected (manual)
          </button>
          <button
            type="button"
            className="start-meeting-btn start-meeting-btn--ghost"
            disabled={!!loading}
            onClick={() => markManual(false, true)}
          >
            Mark Teams connected (manual)
          </button>
        </div>
        {error && <div className="start-meeting-error" style={{ marginTop: 12 }}>{error}</div>}
        <div className="start-meeting-actions" style={{ marginTop: 16 }}>
          <button type="button" className="start-meeting-btn start-meeting-btn--ghost" onClick={onClose} disabled={!!loading}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

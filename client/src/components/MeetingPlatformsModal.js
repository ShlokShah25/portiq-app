import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { X } from 'lucide-react';
import './StartMeetingModal.css';
import './MeetingPlatformsModal.css';

export default function MeetingPlatformsModal({ open, onClose, onSaved }) {
  const [loading, setLoading] = useState(null);
  const [error, setError] = useState('');
  const [allowManual, setAllowManual] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError('');
    (async () => {
      try {
        const { data } = await axios.get('/integrations/status');
        setAllowManual(!!data?.allowManualMeetingPlatforms);
      } catch {
        setAllowManual(false);
      }
    })();
  }, [open]);

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
        className="start-meeting-modal mp-shell"
        role="dialog"
        aria-modal="true"
        aria-labelledby="mp-connect-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="start-meeting-modal__head">
          <h2 id="mp-connect-title" className="start-meeting-modal__title">
            Meeting platforms
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

        <p className="mp-lead">
          Connect once so PortIQ can work with your Zoom or Microsoft account. You’ll return here after
          signing in.
        </p>

        <div className="mp-cards">
          <button
            type="button"
            className="mp-connect-card mp-connect-card--zoom"
            onClick={startZoom}
            disabled={!!loading}
          >
            <span className="mp-connect-card__badge" aria-hidden>
              Zm
            </span>
            <span className="mp-connect-card__title">Zoom</span>
            <p className="mp-connect-card__sub">Continue with Zoom</p>
            {loading === 'zoom' && <span className="mp-connect-card__busy">Redirecting…</span>}
          </button>

          <button
            type="button"
            className="mp-connect-card mp-connect-card--teams"
            onClick={startTeams}
            disabled={!!loading}
          >
            <span className="mp-connect-card__badge" aria-hidden>
              Ms
            </span>
            <span className="mp-connect-card__title">Microsoft Teams</span>
            <p className="mp-connect-card__sub">Continue with Microsoft</p>
            {loading === 'teams' && <span className="mp-connect-card__busy">Redirecting…</span>}
          </button>
        </div>

        <div className="mp-scope-hint" role="note">
          If Zoom shows <strong>Invalid scope</strong>: open your app in the Zoom Marketplace →{' '}
          <strong>Scopes</strong> → add <code>user:read:user</code> (same scopes the server requests). Optional:
          set Railway <code>ZOOM_OAUTH_SCOPES</code> to match exactly what you enabled.
        </div>

        {allowManual && (
          <div className="mp-manual">
            <p className="mp-manual__label">Developer demo only</p>
            <div className="mp-manual__row">
              <button
                type="button"
                className="start-meeting-btn start-meeting-btn--ghost"
                disabled={!!loading}
                onClick={() => markManual(true, false)}
              >
                Mark Zoom connected
              </button>
              <button
                type="button"
                className="start-meeting-btn start-meeting-btn--ghost"
                disabled={!!loading}
                onClick={() => markManual(false, true)}
              >
                Mark Teams connected
              </button>
            </div>
          </div>
        )}

        {error && <div className="mp-error">{error}</div>}

        <button type="button" className="mp-dismiss" onClick={() => !loading && onClose()} disabled={!!loading}>
          Not now
        </button>
      </div>
    </div>
  );
}

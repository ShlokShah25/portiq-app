import React from 'react';

function formatClock(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`;
}

/**
 * Final transcript, speaker by speaker (names come from enrolled voiceprints; "Speaker N" is a
 * voice nobody enrolled). Collapsed by default so it does not push the summary down.
 */
export default function SpeakerTranscript({ segments }) {
  const turns = Array.isArray(segments) ? segments.filter((t) => t && String(t.text || '').trim()) : [];
  if (!turns.length) return null;
  const named = new Set(turns.filter((t) => t.email).map((t) => t.speaker));
  return (
    <details className="speaker-transcript">
      <summary className="speaker-transcript__summary">
        Transcript · speaker by speaker
        <span className="speaker-transcript__meta">
          {turns.length} turns{named.size ? ` · ${named.size} recognised by voice` : ''}
        </span>
      </summary>
      <ol className="speaker-transcript__list">
        {turns.map((t, i) => (
          <li key={`${t.start}-${i}`} className="speaker-transcript__turn">
            <div className="speaker-transcript__head">
              <span
                className={`speaker-transcript__name${t.email ? '' : ' speaker-transcript__name--unknown'}`}
              >
                {t.speaker || 'Unidentified speaker'}
              </span>
              <span className="speaker-transcript__time">{formatClock(t.start)}</span>
            </div>
            <p className="speaker-transcript__text">{t.text}</p>
          </li>
        ))}
      </ol>
    </details>
  );
}

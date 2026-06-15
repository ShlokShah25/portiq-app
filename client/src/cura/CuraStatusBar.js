import React from 'react';
import { MessageCircle, Sparkles, Shield } from 'lucide-react';
import { useCuraProduct } from './CuraProductContext';
import './CuraCore.css';

function dotClass(status) {
  if (status === 'synced' || status === 'ready') return 'cura-status-bar__dot--ok';
  if (status === 'disabled' || status === 'checking') return 'cura-status-bar__dot--warn';
  return 'cura-status-bar__dot--err';
}

export default function CuraStatusBar() {
  const {
    whatsappStatus,
    aiEngineStatus,
    piiUnmasked,
    togglePii,
    openCommandPalette,
  } = useCuraProduct();

  const waLabel =
    whatsappStatus === 'synced'
      ? 'WhatsApp synced'
      : whatsappStatus === 'disabled'
        ? 'WhatsApp off'
        : whatsappStatus === 'checking'
          ? 'WhatsApp…'
          : 'WhatsApp offline';

  return (
    <header className="cura-status-bar" aria-label="Cura system status">
      <div className="cura-status-bar__group">
        <span className="cura-status-bar__item">
          <span className={`cura-status-bar__dot ${dotClass(whatsappStatus)}`} aria-hidden />
          <MessageCircle size={12} aria-hidden />
          {waLabel}
        </span>
        <span className="cura-status-bar__item">
          <span className={`cura-status-bar__dot ${dotClass(aiEngineStatus)}`} aria-hidden />
          <Sparkles size={12} aria-hidden />
          AI engine {aiEngineStatus === 'ready' ? 'ready' : aiEngineStatus}
        </span>
        <label className="cura-pii-toggle">
          <input type="checkbox" checked={piiUnmasked} onChange={togglePii} />
          <Shield size={12} aria-hidden />
          {piiUnmasked ? 'Full data' : 'Masked PII'}
        </label>
      </div>
      <button type="button" className="cura-status-bar__cmd" onClick={openCommandPalette}>
        Clinical search <kbd>⌘K</kbd>
      </button>
    </header>
  );
}

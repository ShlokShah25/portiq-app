import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { isCura as isCuraBuild, PRODUCT } from '../config/product';
import { CURA_TERMINOLOGY, tCura } from './curaTerminology';

const CuraProductContext = createContext(null);

/**
 * ProductProvider for Cura vertical — branding, terminology, PII toggle, system status.
 * @param {object} props
 * @param {React.ReactNode} props.children
 * @param {string} [props.productType]
 * @param {object} [props.adminProfile]
 */
export function CuraProductProvider({ children, productType, adminProfile = null }) {
  const [piiUnmasked, setPiiUnmasked] = useState(false);
  const [whatsappStatus, setWhatsappStatus] = useState('checking');
  const [aiEngineStatus, setAiEngineStatus] = useState('ready');
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);

  const value = useMemo(() => {
    const server = String(productType || adminProfile?.productType || '').toLowerCase();
    const active = server === 'cura' || isCuraBuild || PRODUCT === 'cura';
    return {
      isCuraProduct: active,
      productType: active ? 'cura' : server || PRODUCT,
      themeClass: active ? 'theme-cura-core' : '',
      terminology: CURA_TERMINOLOGY,
      t: tCura,
      piiUnmasked,
      setPiiUnmasked,
      togglePii: () => setPiiUnmasked((v) => !v),
      whatsappStatus,
      aiEngineStatus,
      commandPaletteOpen,
      openCommandPalette: () => setCommandPaletteOpen(true),
      closeCommandPalette: () => setCommandPaletteOpen(false),
      adminProfile,
    };
  }, [
    productType,
    adminProfile,
    piiUnmasked,
    whatsappStatus,
    aiEngineStatus,
    commandPaletteOpen,
  ]);

  useEffect(() => {
    if (!value.isCuraProduct) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await axios.get('/cura/clinic');
        if (cancelled) return;
        const enabled = res.data?.clinic?.settings?.whatsappEnabled;
        setWhatsappStatus(enabled ? 'synced' : 'disabled');
      } catch (_) {
        if (!cancelled) setWhatsappStatus('offline');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [value.isCuraProduct]);

  const onKeyDown = useCallback(
    (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCommandPaletteOpen((o) => !o);
      }
      if (e.key === 'Escape') setCommandPaletteOpen(false);
    },
    []
  );

  useEffect(() => {
    if (!value.isCuraProduct) return;
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [value.isCuraProduct, onKeyDown]);

  return <CuraProductContext.Provider value={value}>{children}</CuraProductContext.Provider>;
}

export function useCuraProduct() {
  const ctx = useContext(CuraProductContext);
  if (!ctx) {
    return {
      isCuraProduct: isCuraBuild,
      productType: PRODUCT,
      themeClass: isCuraBuild ? 'theme-cura-core' : '',
      terminology: CURA_TERMINOLOGY,
      t: tCura,
      piiUnmasked: false,
      togglePii: () => {},
      whatsappStatus: 'unknown',
      aiEngineStatus: 'ready',
      commandPaletteOpen: false,
      openCommandPalette: () => {},
      closeCommandPalette: () => {},
    };
  }
  return ctx;
}

/** @deprecated use CuraProductProvider */
export { CuraProductProvider as ProductProvider };

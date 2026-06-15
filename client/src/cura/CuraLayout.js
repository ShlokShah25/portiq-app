import React, { useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import { CuraProductProvider } from './CuraProductContext';
import './CuraMode.css';

const CURA_TITLE = 'Cura — Clinical Intelligence';
const CURA_FAVICON_SVG =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="%23059669"/><text x="16" y="22" text-anchor="middle" fill="white" font-family="system-ui,sans-serif" font-size="16" font-weight="700">C</text></svg>'
  );

function useCuraBranding() {
  useEffect(() => {
    const prevTitle = document.title;
    document.title = CURA_TITLE;

    let link = document.querySelector("link[rel='icon']");
    const prevHref = link?.getAttribute('href') || '';
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }
    link.href = CURA_FAVICON_SVG;

    document.documentElement.setAttribute('data-cura', 'true');

    return () => {
      document.title = prevTitle;
      if (link) link.href = prevHref;
      document.documentElement.removeAttribute('data-cura');
    };
  }, []);
}

/**
 * Inner layout for authenticated Cura routes — branding + product context + outlet.
 * Sidebar is rendered by ProtectedLayout (app-shell--cura).
 */
export default function CuraLayout() {
  useCuraBranding();

  return (
    <CuraProductProvider productType="cura">
      <div className="cura-layout">
        <Outlet />
      </div>
    </CuraProductProvider>
  );
}

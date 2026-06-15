import React, { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { CuraProductProvider, useCuraProduct } from './CuraProductContext';
import CuraIconSidebar from './CuraIconSidebar';
import CuraStatusBar from './CuraStatusBar';
import CuraCommandPalette from './CuraCommandPalette';
import './CuraCore.css';
import './CuraMode.css';
import './CuraSession.css';

const CURA_TITLE = 'Cura — Clinical Intelligence';
const CURA_FAVICON_SVG =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="%2318181b"/><text x="16" y="22" text-anchor="middle" fill="#fafafa" font-family="Inter,system-ui,sans-serif" font-size="16" font-weight="650">C</text></svg>'
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

function CuraShellInner() {
  const location = useLocation();
  const { themeClass } = useCuraProduct();

  const immersive =
    location.pathname.includes('/consultations/') &&
    (location.pathname.endsWith('/session') || location.pathname.endsWith('/report'));

  return (
    <div className={`cura-shell${immersive ? ' cura-shell--immersive' : ''} ${themeClass}`.trim()}>
      {!immersive ? <CuraIconSidebar /> : null}
      <div className="cura-shell__main">
        {!immersive ? <CuraStatusBar /> : null}
        <div className="cura-shell__content">
          <AnimatePresence mode="wait">
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
            >
              <Outlet />
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
      <CuraCommandPalette />
    </div>
  );
}

/**
 * Primary shell for authenticated Cura routes — product context, icon nav, status bar, Cmd+K.
 */
export default function CuraLayout() {
  useCuraBranding();

  return (
    <CuraProductProvider productType="cura">
      <CuraShellInner />
    </CuraProductProvider>
  );
}

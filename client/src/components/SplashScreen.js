import React, { useState, useEffect } from 'react';
import { isEducation } from '../config/product';
import './SplashScreen.css';

/**
 * Apple-style boot screen: logo, title, subtitle, loading bar.
 * Runs for LOAD_DURATION_MS then calls onComplete (no tap required).
 */
const LOAD_DURATION_MS = 2600;

const SplashScreen = ({ onComplete }) => {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const start = Date.now();
    const tick = () => {
      const elapsed = Date.now() - start;
      const p = Math.min(1, elapsed / LOAD_DURATION_MS);
      setProgress(p);
      if (p < 1) {
        requestAnimationFrame(tick);
      } else {
        onComplete();
      }
    };
    const id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [onComplete]);

  return (
    <div className="splash-screen boot-screen">
      <div className="boot-content">
        <div className="boot-logo-wrapper">
          <img
            src="/assets/portiq-logo.png"
            alt="Portiq"
            className="boot-logo"
            onError={(e) => {
              e.target.style.display = 'none';
              if (e.target.nextSibling) e.target.nextSibling.style.display = 'block';
            }}
          />
          <div className="boot-logo-fallback" style={{ display: 'none' }}>
            Portiq
          </div>
        </div>
        <h1 className="boot-title">Portiq</h1>
        <p className="boot-subtitle">{isEducation ? 'Portiq Education' : 'AI Meeting Assistant'}</p>
        <div className="boot-progress-wrap">
          <div className="boot-progress-bar" style={{ width: `${progress * 100}%` }} />
        </div>
      </div>
    </div>
  );
};

export default SplashScreen;

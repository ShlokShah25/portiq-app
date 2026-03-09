import React, { useEffect, useState } from 'react';
import './SplashScreen.css';

const SplashScreen = ({ onComplete }) => {
  const [progress, setProgress] = useState(0);
  const [isExiting, setIsExiting] = useState(false);

  useEffect(() => {
    const progressTimer = setTimeout(() => {
      setProgress(100);
    }, 30); // kick off CSS transition

    const progressDuration = 3400; // ms
    const fadeDuration = 400; // ms

    const exitTimer = setTimeout(() => {
      setIsExiting(true);
    }, progressDuration);

    const completeTimer = setTimeout(() => {
      if (onComplete) onComplete();
    }, progressDuration + fadeDuration);

    return () => {
      clearTimeout(progressTimer);
      clearTimeout(exitTimer);
      clearTimeout(completeTimer);
    };
  }, [onComplete]);

  return (
    <div className={`splash-screen ${isExiting ? 'splash-exit' : ''}`}>
      <div className="boot-inner">
        <div className="boot-logo-wrapper">
          <img
            src="/assets/portiq-icon.png"
            alt="Portiq"
            className="boot-logo"
          />
        </div>
        <div className="boot-title">Portiq</div>
        <div className="boot-subtitle">AI Meeting Assistant</div>
        <div className="boot-progress">
          <div className="boot-progress-track">
            <div
              className="boot-progress-fill"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default SplashScreen;

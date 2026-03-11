import React, { useState, useEffect } from 'react';
import './BootupScreen.css';

const BootupScreen = ({ onComplete }) => {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    // Simple eased progress animation
    let startTime = null;
    const duration = 2600;

    const animate = (timestamp) => {
      if (!startTime) startTime = timestamp;
      const elapsed = timestamp - startTime;
      const progressPercent = Math.min((elapsed / duration) * 100, 100);

      const eased = 1 - Math.pow(1 - progressPercent / 100, 3);
      setProgress(eased * 100);

      if (progressPercent < 100) {
        requestAnimationFrame(animate);
      } else {
        setTimeout(() => {
          onComplete();
        }, 500);
      }
    };

    requestAnimationFrame(animate);
  }, [onComplete]);

  return (
    <div className="bootup-screen">
      <div className="bootup-content">
        <div className="bootup-logo-block">
          <img
            src="/assets/portiq-icon.png"
            alt="Portiq"
            className="bootup-logo-img"
            onError={(e) => {
              e.target.style.display = 'none';
            }}
          />
          <h1 className="bootup-title">Portiq</h1>
          <p className="bootup-tagline">AI Meeting Assistant</p>
        </div>

        <div className="bootup-progress">
          <div className="bootup-progress-bar">
            <div
              className="bootup-progress-fill"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default BootupScreen;

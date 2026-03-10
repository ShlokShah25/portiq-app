import React, { useState, useEffect } from 'react';
import './SplashScreen.css';

const SplashScreen = ({ onComplete }) => {
  const [showButton, setShowButton] = useState(false);
  const [showLoading, setShowLoading] = useState(false);

  useEffect(() => {
    // Show button after animation completes (4.5 seconds)
    const timer = setTimeout(() => {
      setShowButton(true);
    }, 4500);

    return () => clearTimeout(timer);
  }, []);

  const handleBegin = () => {
    setShowLoading(true);
    // Show loading for 2 seconds, then proceed
    setTimeout(() => {
      onComplete();
    }, 2000);
  };

  if (showLoading) {
    return (
      <div className="splash-screen loading-screen">
        <div className="loading-content">
          <div className="logo-container">
            <img 
              src="/assets/portiq-logo.png" 
              alt="PortIQ Technologies" 
              className="loading-logo"
              onError={(e) => {
                e.target.style.display = 'none';
                e.target.nextSibling.style.display = 'block';
              }}
            />
            <div className="logo-text-fallback" style={{ display: 'none' }}>
              <div className="portiq-text">PortIQ</div>
            </div>
          </div>
          <p className="loading-message">Please wait while we redirect you...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="splash-screen">
      {/* AI-style expanding rings */}
      <div className="ai-rings-container">
        <div className="ai-ring ring-1"></div>
        <div className="ai-ring ring-2"></div>
        <div className="ai-ring ring-3"></div>
        <div className="ai-ring ring-4"></div>
        <div className="ai-ring ring-5"></div>
        <div className="ai-ring ring-6"></div>
      </div>
      
      {/* Neural network particles */}
      <div className="neural-particles">
        {[...Array(20)].map((_, i) => (
          <div key={i} className={`particle particle-${i + 1}`}></div>
        ))}
      </div>

      <div className="splash-content">
        <div className="logo-container">
          <div className="logo-glow-wrapper">
            <img 
              src="/assets/portiq-logo.png" 
              alt="PortIQ Technologies" 
              className="splash-logo"
              onError={(e) => {
                // Fallback if logo doesn't exist
                e.target.style.display = 'none';
                e.target.nextSibling.style.display = 'block';
              }}
            />
          </div>
          <div className="logo-text-fallback" style={{ display: 'none' }}>
            <div className="portiq-text">PortIQ</div>
          </div>
        </div>
        <div className="splash-title">AI-Powered Meeting Assistant</div>
        {showButton && (
          <button 
            className="tap-to-begin-btn"
            onClick={handleBegin}
          >
            Tap to Begin
          </button>
        )}
      </div>
    </div>
  );
};

export default SplashScreen;

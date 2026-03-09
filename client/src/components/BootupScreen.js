import React, { useState, useEffect } from 'react';
import './BootupScreen.css';

const BootupScreen = ({ onComplete }) => {
  const [progress, setProgress] = useState(0);
  const [showLogo, setShowLogo] = useState(false);
  const [particles, setParticles] = useState([]);

  useEffect(() => {
    // Create floating particles
    const particleArray = Array.from({ length: 20 }, (_, i) => ({
      id: i,
      x: Math.random() * 100,
      y: Math.random() * 100,
      delay: Math.random() * 2,
      duration: 3 + Math.random() * 2
    }));
    setParticles(particleArray);

    // Show logo after brief delay
    const logoTimer = setTimeout(() => {
      setShowLogo(true);
    }, 300);

    // Simulate bootup progress with easing
    let startTime = null;
    const duration = 2000; // 2 seconds total

    const animate = (timestamp) => {
      if (!startTime) startTime = timestamp;
      const elapsed = timestamp - startTime;
      const progressPercent = Math.min((elapsed / duration) * 100, 100);
      
      // Easing function (ease-out)
      const eased = 1 - Math.pow(1 - progressPercent / 100, 3);
      setProgress(eased * 100);

      if (progressPercent < 100) {
        requestAnimationFrame(animate);
      } else {
        setTimeout(() => {
          onComplete();
        }, 400);
      }
    };

    requestAnimationFrame(animate);

    return () => {
      clearTimeout(logoTimer);
    };
  }, [onComplete]);

  return (
    <div className="bootup-screen">
      <div className="bootup-particles">
        {particles.map(particle => (
          <div
            key={particle.id}
            className="bootup-particle"
            style={{
              left: `${particle.x}%`,
              top: `${particle.y}%`,
              animationDelay: `${particle.delay}s`,
              animationDuration: `${particle.duration}s`
            }}
          />
        ))}
      </div>
      
      <div className="bootup-content">
        {showLogo && (
          <div className="bootup-logo">
            <div className="bootup-logo-glow"></div>
            <img 
              src="/assets/portiq-logo.png" 
              alt="PortIQ Technologies" 
              className="bootup-logo-img"
              onError={(e) => {
                e.target.style.display = 'none';
              }}
            />
          </div>
        )}
        
        <div className="bootup-progress">
          <div className="bootup-progress-bar">
            <div 
              className="bootup-progress-fill" 
              style={{ width: `${progress}%` }}
            >
              <div className="bootup-progress-shine"></div>
            </div>
          </div>
          <div className="bootup-progress-text">{Math.round(progress)}%</div>
        </div>
      </div>
    </div>
  );
};

export default BootupScreen;

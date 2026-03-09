import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import BootupScreen from './BootupScreen';
import Dashboard from './Dashboard';

const WelcomeScreen = ({ config }) => {
  const navigate = useNavigate();
  const [showBootup, setShowBootup] = useState(true);

  const handleBootupComplete = () => {
    setShowBootup(false);
    navigate('/dashboard', { replace: true });
  };

  if (showBootup) {
    return <BootupScreen onComplete={handleBootupComplete} />;
  }

  return <Dashboard config={config} />;
};

export default WelcomeScreen;

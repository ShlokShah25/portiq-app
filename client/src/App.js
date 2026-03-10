import React, { useState, useEffect, lazy, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import axios from 'axios';
import './App.css';

// Lazy load components for better performance
const WelcomeScreen = lazy(() => import('./components/WelcomeScreen'));
const Dashboard = lazy(() => import('./components/Dashboard'));
const MeetingsScreen = lazy(() => import('./components/MeetingsScreen'));
const Transcripts = lazy(() => import('./components/Transcripts'));
const Participants = lazy(() => import('./components/Participants'));
const Insights = lazy(() => import('./components/Insights'));
const Settings = lazy(() => import('./components/Settings'));
const MeetingInProgress = lazy(() => import('./components/MeetingInProgress'));
const ClientAdmin = lazy(() => import('./components/ClientAdmin'));
const SplashScreen = lazy(() => import('./components/SplashScreen'));
const ClientAdminLogin = lazy(() => import('./components/ClientAdminLogin'));
const Onboarding = lazy(() => import('./components/Onboarding'));

// Set base URL for API - connects to workplace server on port 5001
axios.defaults.baseURL = process.env.REACT_APP_API_URL || 'http://localhost:5001/api';

// Add response interceptor for error handling
axios.interceptors.response.use(
  response => response,
  error => {
    console.error('API Error:', error.response?.status, error.response?.data || error.message);
    if (error.code === 'ECONNREFUSED') {
      console.error('❌ Cannot connect to backend. Make sure the workplace server is running on port 5001');
    }
    return Promise.reject(error);
  }
);

function AppContent({ config, configLoaded, showSplash, setShowSplash }) {
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <>
      {/* Splash overlay on top of whatever route is loaded */}
      {showSplash && (
        <Suspense fallback={null}>
          <SplashScreen onComplete={() => setShowSplash(false)} />
        </Suspense>
      )}

      {!configLoaded ? (
        <div className="app-loading">
          <div className="loading-spinner"></div>
          <p>Loading...</p>
        </div>
      ) : (
        <Suspense fallback={<div className="app-loading"><div className="loading-spinner"></div><p>Loading...</p></div>}>
          <Routes>
            <Route path="/" element={<Dashboard config={config} />} />
            <Route path="/dashboard" element={<Dashboard config={config} />} />
            <Route path="/admin-login" element={<ClientAdminLogin />} />
            <Route path="/onboarding" element={<Onboarding />} />
            <Route path="/meetings" element={<MeetingsScreen config={config} />} />
            <Route path="/meetings/:meetingId" element={<MeetingInProgress />} />
            <Route path="/transcripts" element={<Transcripts />} />
            <Route path="/participants" element={<Participants />} />
            <Route path="/insights" element={<Insights />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/admin" element={<ClientAdmin />} />
            <Route path="*" element={<Dashboard config={config} />} />
          </Routes>
        </Suspense>
      )}
    </>
  );
}

function App() {
  const [config, setConfig] = useState(null);
  const [configLoaded, setConfigLoaded] = useState(false);
  const [showSplash, setShowSplash] = useState(true);

  useEffect(() => {
    // Fetch configuration (if you add a config endpoint later)
    // For now, use defaults
    setConfig({
      companyName: process.env.REACT_APP_COMPANY_NAME || 'Your Company',
      logoUrl: '/assets/logo.png',
      welcomeMessage: 'Welcome'
    });
    setConfigLoaded(true);
  }, []);

  return (
    <Router>
      <div className="App">
        <AppContent config={config} configLoaded={configLoaded} showSplash={showSplash} setShowSplash={setShowSplash} />
      </div>
    </Router>
  );
}

export default App;

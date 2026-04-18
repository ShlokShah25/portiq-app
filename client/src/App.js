import React, { useState, useEffect, lazy, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import axios from 'axios';
import ProtectedLayout from './components/ProtectedLayout';
import MeetingsAccessGate from './components/MeetingsAccessGate';
import './App.css';
import './styles/saas-premium-overrides.css';

const lazyWithRetry = (importer, key) =>
  lazy(() =>
    importer().catch((error) => {
      const msg = String(error?.message || '');
      const chunkFailed =
        /ChunkLoadError/i.test(msg) ||
        /Loading chunk [\w-]+ failed/i.test(msg) ||
        /dynamically imported module/i.test(msg);
      if (!chunkFailed || typeof window === 'undefined') {
        throw error;
      }
      const retryKey = `portiq_chunk_retry_${key}`;
      try {
        const alreadyRetried = window.sessionStorage.getItem(retryKey) === '1';
        if (!alreadyRetried) {
          window.sessionStorage.setItem(retryKey, '1');
          window.location.reload();
          return new Promise(() => {});
        }
        window.sessionStorage.removeItem(retryKey);
      } catch (_) {
        window.location.reload();
        return new Promise(() => {});
      }
      throw error;
    })
  );

// Lazy load components for better performance
const Dashboard = lazyWithRetry(() => import('./components/Dashboard'), 'dashboard');
const MeetingsScreen = lazyWithRetry(() => import('./components/MeetingsScreen'), 'meetings');
const Transcripts = lazyWithRetry(() => import('./components/Transcripts'), 'transcripts');
const Participants = lazyWithRetry(() => import('./components/Participants'), 'participants');
const Insights = lazyWithRetry(() => import('./components/Insights'), 'insights');
const ClassesPage = lazyWithRetry(() => import('./components/ClassesPage'), 'classes');
const ClassroomDetailPage = lazyWithRetry(() => import('./components/ClassroomDetailPage'), 'classroom-detail');
const TeachersPage = lazyWithRetry(() => import('./components/TeachersPage'), 'teachers');
const Settings = lazyWithRetry(() => import('./components/Settings'), 'settings');
const MeetingInProgress = lazyWithRetry(() => import('./components/MeetingInProgress'), 'meeting-room');
const MeetingDetail = lazyWithRetry(() => import('./components/MeetingDetail'), 'meeting-detail');
const MeetingSummary = lazyWithRetry(() => import('./components/MeetingSummary'), 'meeting-summary');
const ClientAdmin = lazyWithRetry(() => import('./components/ClientAdmin'), 'client-admin');
const BootupScreen = lazyWithRetry(() => import('./components/BootupScreen'), 'bootup');
const AdminLogin = lazyWithRetry(() => import('./components/AdminLogin'), 'admin-login');
const ResetPassword = lazyWithRetry(() => import('./components/ResetPassword'), 'reset-password');
// Set base URL for API.
// - In local dev: use explicit REACT_APP_API_URL or localhost:5001
// - In production (Railway): use same-origin `/api` so CORS is not needed.
const isBrowser = typeof window !== 'undefined';
const isLocalhost = isBrowser && window.location.hostname === 'localhost';
const WEBSITE_URL = process.env.REACT_APP_WEBSITE_URL || 'https://portiqtechnologies.com';

axios.defaults.baseURL = isLocalhost
  ? (process.env.REACT_APP_API_URL || 'http://localhost:5001/api')
  : '/api';

// Add response interceptor: 403 NO_SUBSCRIPTION → redirect to website pricing
axios.interceptors.response.use(
  response => response,
  error => {
    if (error.response?.status === 403 && error.response?.data?.code === 'NO_SUBSCRIPTION') {
      try {
        window.localStorage.removeItem('clientAdminToken');
        window.localStorage.removeItem('portiq_has_subscription');
      } catch (e) {}
      window.location.href = WEBSITE_URL + '/#pricing';
      return Promise.reject(error);
    }
    if (error.response?.status === 403 && error.response?.data?.code === 'TRIAL_LIMIT_REACHED') {
      try {
        window.sessionStorage.setItem('portiq_trial_limit_modal_v1', '1');
        window.dispatchEvent(new CustomEvent('portiq-trial-limit'));
      } catch (e) {
        /* ignore */
      }
      return Promise.reject(error);
    }
    console.error('API Error:', error.response?.status, error.response?.data || error.message);
    if (error.code === 'ECONNREFUSED') {
      console.error('❌ Cannot connect to backend. Make sure the workplace server is running on port 5001');
    }
    return Promise.reject(error);
  }
);

function App() {
  const [config, setConfig] = useState(null);
  const [configLoaded, setConfigLoaded] = useState(false);
  const [showBootup, setShowBootup] = useState(true);

  useEffect(() => {
    const href = `${process.env.PUBLIC_URL || ''}/assets/portiq-icon.png`;
    ['icon', 'shortcut icon'].forEach(rel => {
      let el = document.querySelector(`link[rel="${rel}"]`);
      if (!el) {
        el = document.createElement('link');
        el.rel = rel;
        el.type = 'image/png';
        document.head.appendChild(el);
      }
      el.href = href;
    });
  }, []);

  useEffect(() => {
    // For now, use static defaults
    setConfig({
      companyName: process.env.REACT_APP_COMPANY_NAME || 'Your Company',
      logoUrl: '/assets/logo.png',
      welcomeMessage: 'Welcome'
    });
    setConfigLoaded(true);
  }, []);

  if (!configLoaded) {
    return (
      <div className="app-loading">
        <div className="loading-spinner"></div>
        <p>Loading...</p>
      </div>
    );
  }

  if (showBootup) {
    return (
      <Suspense fallback={<div className="app-loading"><div className="loading-spinner"></div><p>Loading...</p></div>}>
        <BootupScreen onComplete={() => setShowBootup(false)} />
      </Suspense>
    );
  }

  return (
    <Router>
      <div className="App">
        <Suspense fallback={<div className="app-loading"><div className="loading-spinner"></div><p>Loading...</p></div>}>
          <Routes>
            <Route path="/admin-login" element={<AdminLogin />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/" element={<ProtectedLayout config={config} />}>
              <Route index element={<Dashboard />} />
              <Route path="dashboard" element={<Dashboard />} />
              <Route path="dashboard/tasks/:bucket" element={<Navigate to="/insights" replace />} />
              <Route path="meetings" element={<MeetingsAccessGate />}>
                <Route index element={<MeetingsScreen />} />
                <Route path=":id/summary" element={<MeetingSummary />} />
                <Route path=":id/room" element={<MeetingInProgress />} />
                <Route path=":id" element={<MeetingDetail />} />
              </Route>
              <Route path="transcripts" element={<Transcripts />} />
              <Route path="participants" element={<Participants />} />
              <Route path="insights" element={<Insights />} />
              <Route path="classes/:classroomId" element={<ClassroomDetailPage />} />
              <Route path="classes" element={<ClassesPage />} />
              <Route path="teachers" element={<TeachersPage />} />
              <Route path="settings" element={<Settings />} />
              <Route path="profile" element={<Navigate to="/settings" replace />} />
              <Route path="admin" element={<ClientAdmin />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </div>
    </Router>
  );
}

export default App;

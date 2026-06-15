import React, { useState, useEffect, lazy, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import axios from 'axios';
import ProtectedLayout from './components/ProtectedLayout';
import MeetingsAccessGate from './components/MeetingsAccessGate';
import {
  CuraCalendarPage,
  CuraPrescriptionsPage,
  CuraFollowUpsPage,
  CuraSettingsPage,
} from './cura/CuraStubPages';
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
const InterviewDashboard = lazyWithRetry(() => import('./interview/InterviewDashboard'), 'interview-dashboard');
const InterviewCreatePage = lazyWithRetry(() => import('./interview/InterviewCreatePage'), 'interview-create');
const InterviewDetailPage = lazyWithRetry(() => import('./interview/InterviewDetailPage'), 'interview-detail');
const InterviewSessionPage = lazyWithRetry(() => import('./interview/InterviewSessionPage'), 'interview-session');
const InterviewReportPage = lazyWithRetry(() => import('./interview/InterviewReportPage'), 'interview-report');
const InterviewSessionsPage = lazyWithRetry(() => import('./interview/InterviewSessionsPage'), 'interview-sessions');
const InterviewGate = lazyWithRetry(() => import('./interview/InterviewGate'), 'interview-gate');
const CuraLogin = lazyWithRetry(() => import('./cura/CuraLogin'), 'cura-login');
const CuraLandingPage = lazyWithRetry(() => import('./cura/CuraLandingPage'), 'cura-landing');
const CuraGate = lazyWithRetry(() => import('./cura/CuraGate'), 'cura-gate');
const CuraLayout = lazyWithRetry(() => import('./cura/CuraLayout'), 'cura-layout');
const CuraDashboard = lazyWithRetry(() => import('./cura/CuraDashboard'), 'cura-dashboard');
const CuraOnboarding = lazyWithRetry(() => import('./cura/CuraOnboarding'), 'cura-onboarding');
const CuraPatientsPage = lazyWithRetry(() => import('./cura/CuraPatientsPage'), 'cura-patients');
const CuraPatientDetailPage = lazyWithRetry(() => import('./cura/CuraPatientDetailPage'), 'cura-patient-detail');
const CuraConsultationNewPage = lazyWithRetry(() => import('./cura/CuraConsultationNewPage'), 'cura-consultation-new');
const CuraConsultationSessionPage = lazyWithRetry(() => import('./cura/CuraConsultationSessionPage'), 'cura-consultation-session');
const CuraConsultationReportPage = lazyWithRetry(() => import('./cura/CuraConsultationReportPage'), 'cura-consultation-report');
const CuraSearchPage = lazyWithRetry(() => import('./cura/CuraSearchPage'), 'cura-search');
const ClientAdmin = lazyWithRetry(() => import('./components/ClientAdmin'), 'client-admin');
const BootupScreen = lazyWithRetry(() => import('./components/BootupScreen'), 'bootup');
const AdminLogin = lazyWithRetry(() => import('./components/AdminLogin'), 'admin-login');
const ResetPassword = lazyWithRetry(() => import('./components/ResetPassword'), 'reset-password');
// Set base URL for API.
// - In local dev: use explicit REACT_APP_API_URL or localhost:5001
// - In production (Railway): use same-origin `/api` so CORS is not needed.
const isBrowser = typeof window !== 'undefined';
const isLocalhost = isBrowser && window.location.hostname === 'localhost';
axios.defaults.baseURL = isLocalhost
  ? (process.env.REACT_APP_API_URL || 'http://localhost:5001/api')
  : '/api';

// Add response interceptor: expired / no subscription → sign-in screen
function pathIsAuthLogin() {
  if (typeof window === 'undefined') return false;
  const p = window.location.pathname || '';
  return (
    p.endsWith('/admin-login') ||
    p.includes('/admin-login') ||
    p.includes('/cura/login')
  );
}

axios.interceptors.response.use(
  response => response,
  error => {
    const reqUrl = String(error.config?.url || '');
    const isPreAuthRequest =
      reqUrl.includes('/admin/login') ||
      reqUrl.includes('/saas/login') ||
      reqUrl.includes('/saas/signup') ||
      reqUrl.includes('/auth/forgot') ||
      reqUrl.includes('/auth/reset');

    if (error.response?.status === 401 && !isPreAuthRequest) {
      try {
        window.localStorage.removeItem('clientAdminToken');
        window.localStorage.removeItem('portiq_has_subscription');
      } catch (e) {
        /* ignore */
      }
      if (!pathIsAuthLogin()) {
        const base = process.env.PUBLIC_URL || '';
        if (window.location.pathname.startsWith('/cura')) {
          window.location.assign(`${base}/cura/login?reason=session_expired`);
        } else {
          window.location.assign(`${base}/admin-login?reason=session_expired`);
        }
      }
      return Promise.reject(error);
    }

    if (error.response?.status === 403 && error.response?.data?.code === 'NO_SUBSCRIPTION') {
      try {
        window.localStorage.removeItem('clientAdminToken');
        window.localStorage.removeItem('portiq_has_subscription');
      } catch (e) {
        /* ignore */
      }
      const base = process.env.PUBLIC_URL || '';
      window.location.href = `${base}/admin-login?reason=no_subscription`;
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
  const [showBootup, setShowBootup] = useState(() => {
    if (typeof window === 'undefined') return true;
    const path = window.location.pathname || '';
    return !(path.includes('landing-cura') || path.includes('/cura/login') || path.startsWith('/cura'));
  });

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
            <Route path="/landing-cura" element={<CuraLandingPage />} />
            <Route path="/cura/login" element={<CuraLogin />} />
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
              <Route path="interview" element={<InterviewGate />}>
                <Route index element={<InterviewDashboard />} />
                <Route path="sessions" element={<InterviewSessionsPage />} />
                <Route path="new" element={<InterviewCreatePage />} />
                <Route path=":id" element={<InterviewDetailPage />} />
                <Route path=":id/session" element={<InterviewSessionPage />} />
                <Route path=":id/report" element={<InterviewReportPage />} />
              </Route>
              <Route path="cura" element={<CuraGate />}>
                <Route element={<CuraLayout />}>
                  <Route index element={<CuraDashboard />} />
                  <Route path="onboarding" element={<CuraOnboarding />} />
                  <Route path="patients" element={<CuraPatientsPage />} />
                  <Route path="patients/:id" element={<CuraPatientDetailPage />} />
                  <Route path="search" element={<CuraSearchPage />} />
                  <Route path="calendar" element={<CuraCalendarPage />} />
                  <Route path="prescriptions" element={<CuraPrescriptionsPage />} />
                  <Route path="follow-ups" element={<CuraFollowUpsPage />} />
                  <Route path="settings" element={<CuraSettingsPage />} />
                  <Route path="consultations/new" element={<CuraConsultationNewPage />} />
                  <Route path="consultations/:id/session" element={<CuraConsultationSessionPage />} />
                  <Route path="consultations/:id/report" element={<CuraConsultationReportPage />} />
                </Route>
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

import React, { useState, useEffect, lazy, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import axios from 'axios';
import './App.css';

// Lazy load components for better performance
const Dashboard = lazy(() => import('./components/Dashboard'));
const DashboardTasksPage = lazy(() => import('./components/DashboardTasksPage'));
const MeetingsScreen = lazy(() => import('./components/MeetingsScreen'));
const Transcripts = lazy(() => import('./components/Transcripts'));
const Participants = lazy(() => import('./components/Participants'));
const Insights = lazy(() => import('./components/Insights'));
const Settings = lazy(() => import('./components/Settings'));
const MeetingInProgress = lazy(() => import('./components/MeetingInProgress'));
const MeetingDetail = lazy(() => import('./components/MeetingDetail'));
const MeetingSummary = lazy(() => import('./components/MeetingSummary'));
const ClientAdmin = lazy(() => import('./components/ClientAdmin'));
const BootupScreen = lazy(() => import('./components/BootupScreen'));
const AdminLogin = lazy(() => import('./components/AdminLogin'));
const ResetPassword = lazy(() => import('./components/ResetPassword'));
const Profile = lazy(() => import('./components/Profile'));

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

  const RequireAuth = ({ children }) => {
    if (!isBrowser) return null;
    const token = window.localStorage.getItem('clientAdminToken');
    if (!token) {
      return <Navigate to="/admin-login" replace />;
    }
    axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
    return children;
  };

  return (
    <Router>
      <div className="App">
        <Suspense fallback={<div className="app-loading"><div className="loading-spinner"></div><p>Loading...</p></div>}>
          <Routes>
            <Route
              path="/admin-login"
              element={<AdminLogin />}
            />
            <Route
              path="/reset-password"
              element={<ResetPassword />}
            />
            <Route
              path="/"
              element={
                <RequireAuth>
                  <Dashboard config={config} />
                </RequireAuth>
              }
            />
            <Route
              path="/dashboard/tasks/:bucket"
              element={
                <RequireAuth>
                  <DashboardTasksPage />
                </RequireAuth>
              }
            />
            <Route
              path="/dashboard"
              element={
                <RequireAuth>
                  <Dashboard config={config} />
                </RequireAuth>
              }
            />
            <Route
              path="/meetings"
              element={
                <RequireAuth>
                  <MeetingsScreen config={config} />
                </RequireAuth>
              }
            />
            <Route
              path="/meetings/:id/summary"
              element={
                <RequireAuth>
                  <MeetingSummary />
                </RequireAuth>
              }
            />
            <Route
              path="/meetings/:id/room"
              element={
                <RequireAuth>
                  <MeetingInProgress />
                </RequireAuth>
              }
            />
            <Route
              path="/meetings/:id"
              element={
                <RequireAuth>
                  <MeetingDetail />
                </RequireAuth>
              }
            />
            <Route
              path="/transcripts"
              element={
                <RequireAuth>
                  <Transcripts />
                </RequireAuth>
              }
            />
            <Route
              path="/participants"
              element={
                <RequireAuth>
                  <Participants />
                </RequireAuth>
              }
            />
            <Route
              path="/insights"
              element={
                <RequireAuth>
                  <Insights />
                </RequireAuth>
              }
            />
            <Route
              path="/settings"
              element={
                <RequireAuth>
                  <Settings />
                </RequireAuth>
              }
            />
            <Route
              path="/profile"
              element={
                <RequireAuth>
                  <Profile />
                </RequireAuth>
              }
            />
            <Route
              path="/admin"
              element={
                <RequireAuth>
                  <ClientAdmin />
                </RequireAuth>
              }
            />
            <Route
              path="*"
              element={<Navigate to="/" replace />}
            />
          </Routes>
        </Suspense>
      </div>
    </Router>
  );
}

export default App;

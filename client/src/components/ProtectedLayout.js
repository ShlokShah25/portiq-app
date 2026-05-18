import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Outlet, Navigate, useLocation } from 'react-router-dom';
import axios from 'axios';
import Sidebar from './Sidebar';
import TrialExperienceProvider from './TrialExperienceProvider';
import { FEATURE_INTERVIEW_UI } from '../config/featureFlags';
import InterviewSidebar from '../interview/InterviewSidebar';
import '../interview/InterviewMode.css';
import './AppShell.css';

/**
 * Auth gate + persistent left sidebar for the main product shell.
 */
export default function ProtectedLayout({ config }) {
  const location = useLocation();
  const mainRef = useRef(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [sessionDenied, setSessionDenied] = useState(false);
  const token =
    typeof window !== 'undefined' ? window.localStorage.getItem('clientAdminToken') : null;

  useEffect(() => {
    if (!token) {
      setSessionReady(false);
      setSessionDenied(false);
      return;
    }
    let cancelled = false;
    setSessionReady(false);
    setSessionDenied(false);
    axios.defaults.headers.common.Authorization = `Bearer ${token}`;
    (async () => {
      try {
        const res = await axios.get('/admin/profile');
        const dash = res.data?.admin?.hasDashboardAccess;
        if (cancelled) return;
        if (!dash) {
          try {
            window.localStorage.removeItem('clientAdminToken');
            window.localStorage.removeItem('portiq_has_subscription');
          } catch (_) {
            /* ignore */
          }
          setSessionDenied(true);
          return;
        }
        setSessionReady(true);
      } catch (err) {
        if (cancelled) return;
        try {
          window.localStorage.removeItem('clientAdminToken');
          window.localStorage.removeItem('portiq_has_subscription');
        } catch (_) {
          /* ignore */
        }
        setSessionDenied(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const getFocusableFields = useCallback(() => {
    const root = mainRef.current;
    if (!root) return [];
    const selector =
      'input:not([type="hidden"]), select, textarea, button:not([type="button"]):not([data-no-enter-next])';
    return Array.from(root.querySelectorAll(selector)).filter((el) => {
      if (!el || el.disabled) return false;
      if (el.getAttribute('aria-hidden') === 'true') return false;
      return el.offsetParent !== null;
    });
  }, []);

  useEffect(() => {
    if (!token || !sessionReady || sessionDenied) return;
    const id = window.requestAnimationFrame(() => {
      const [first] = getFocusableFields();
      if (first && typeof first.focus === 'function') {
        first.focus();
      }
    });
    return () => window.cancelAnimationFrame(id);
  }, [location.pathname, getFocusableFields, token, sessionReady, sessionDenied]);

  const onMainKeyDown = useCallback(
    (event) => {
      if (event.key !== 'Enter' || event.defaultPrevented) return;
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (target.tagName.toLowerCase() === 'textarea') return;
      if (target.getAttribute('data-no-enter-next') === 'true') return;

      const fields = getFocusableFields();
      if (!fields.length) return;
      const idx = fields.indexOf(target);
      if (idx < 0 || idx >= fields.length - 1) return;

      const nextField = fields[idx + 1];
      if (nextField && typeof nextField.focus === 'function') {
        event.preventDefault();
        nextField.focus();
      }
    },
    [getFocusableFields]
  );

  if (!token) {
    return <Navigate to="/admin-login" replace />;
  }
  axios.defaults.headers.common.Authorization = `Bearer ${token}`;

  if (sessionDenied) {
    return <Navigate to="/admin-login?reason=no_access" replace />;
  }
  if (!sessionReady) {
    return (
      <div className="app-loading" role="status" aria-live="polite">
        <div className="loading-spinner" />
        <p>Checking your session…</p>
      </div>
    );
  }

  const isInterviewRoute =
    FEATURE_INTERVIEW_UI && (location.pathname === '/interview' || location.pathname.startsWith('/interview/'));

  return (
    <TrialExperienceProvider>
      <div className={`app-shell${isInterviewRoute ? ' app-shell--interview' : ''}`}>
        {isInterviewRoute ? <InterviewSidebar /> : <Sidebar />}
        <main className="app-shell__main" id="app-main" ref={mainRef} onKeyDown={onMainKeyDown}>
          <Outlet context={{ config }} />
        </main>
      </div>
    </TrialExperienceProvider>
  );
}

import React from 'react';
import { Outlet, Navigate } from 'react-router-dom';
import axios from 'axios';
import Sidebar from './Sidebar';
import './AppShell.css';

/**
 * Auth gate + persistent left sidebar for the main product shell.
 */
export default function ProtectedLayout({ config }) {
  const token =
    typeof window !== 'undefined' ? window.localStorage.getItem('clientAdminToken') : null;
  if (!token) {
    return <Navigate to="/admin-login" replace />;
  }
  axios.defaults.headers.common.Authorization = `Bearer ${token}`;
  return (
    <div className="app-shell">
      <Sidebar />
      <main className="app-shell__main" id="app-main">
        <Outlet context={{ config }} />
      </main>
    </div>
  );
}

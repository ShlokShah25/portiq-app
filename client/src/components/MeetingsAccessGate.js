import React from 'react';
import { Outlet, Navigate } from 'react-router-dom';
import { isEducation } from '../config/product';
import { useTrialExperience } from './TrialExperienceProvider';

/**
 * Education org admins manage classrooms/teachers only; lectures live under faculty accounts.
 * Faculty/super_admin must always reach /meetings even if client `portiq_product` lags the server.
 */
export default function MeetingsAccessGate() {
  const { profile, loading } = useTrialExperience();
  const role = String(profile?.role || '').toLowerCase();
  const serverEducation = String(profile?.productType || '').toLowerCase() === 'education';
  const educationTenant = isEducation || serverEducation;

  if (role === 'faculty' || role === 'super_admin') {
    return <Outlet />;
  }

  if (educationTenant && loading) {
    return (
      <div className="app-loading" role="status" aria-live="polite">
        <div className="loading-spinner" />
        <p>Loading...</p>
      </div>
    );
  }

  if (educationTenant && role !== 'faculty') {
    return <Navigate to="/classes" replace />;
  }

  return <Outlet />;
}

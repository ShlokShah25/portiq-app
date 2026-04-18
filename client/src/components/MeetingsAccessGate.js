import React from 'react';
import { Outlet, Navigate } from 'react-router-dom';
import { isEducation } from '../config/product';
import { useTrialExperience } from './TrialExperienceProvider';

/**
 * Education org admins manage classrooms/teachers only; lectures live under faculty accounts.
 */
export default function MeetingsAccessGate() {
  const { profile, loading } = useTrialExperience();

  if (isEducation && loading) {
    return (
      <div className="app-loading" role="status" aria-live="polite">
        <div className="loading-spinner" />
        <p>Loading...</p>
      </div>
    );
  }

  const role = String(profile?.role || '').toLowerCase();
  if (isEducation && role !== 'faculty') {
    return <Navigate to="/classes" replace />;
  }

  return <Outlet />;
}

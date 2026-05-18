import React, { useEffect } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { isEducation } from '../config/product';
import { FEATURE_INTERVIEW_UI } from '../config/featureFlags';

/** Workplace-only surface; redirects education tenants to the main dashboard. */
export default function InterviewGate() {
  const navigate = useNavigate();
  const blocked = isEducation || !FEATURE_INTERVIEW_UI;

  useEffect(() => {
    if (blocked) {
      navigate('/dashboard', { replace: true });
    }
  }, [blocked, navigate]);

  if (blocked) {
    return (
      <div className="interview-page">
        <div className="interview-loading" role="status">
          Redirecting…
        </div>
      </div>
    );
  }

  return <Outlet />;
}

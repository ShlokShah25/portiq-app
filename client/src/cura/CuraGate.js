import React, { useEffect, useState } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { isCura } from '../config/product';
import { FEATURE_CURA_UI } from '../config/featureFlags';
import { defaultHomePath } from '../config/product';
import './CuraMode.css';

const ONBOARDING_KEY = 'cura_onboarding_complete';

export function isCuraOnboardingComplete() {
  try {
    return window.localStorage.getItem(ONBOARDING_KEY) === '1';
  } catch (_) {
    return false;
  }
}

export function markCuraOnboardingComplete() {
  try {
    window.localStorage.setItem(ONBOARDING_KEY, '1');
  } catch (_) {
    /* ignore */
  }
}

/** Cura-only surface; redirects other product tenants to their home. */
export default function CuraGate() {
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);
  const blocked = !FEATURE_CURA_UI;

  useEffect(() => {
    if (blocked) {
      navigate('/dashboard', { replace: true });
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const res = await axios.get('/admin/profile');
        const pt = String(res.data?.admin?.productType || '').toLowerCase();
        if (cancelled) return;
        if (pt !== 'cura' && !isCura) {
          navigate(defaultHomePath(pt), { replace: true });
          return;
        }
        if (!isCuraOnboardingComplete() && !window.location.pathname.includes('/onboarding')) {
          navigate('/cura/onboarding', { replace: true });
          return;
        }
      } catch (_) {
        if (!cancelled) navigate('/cura/login', { replace: true });
        return;
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [blocked, navigate]);

  if (blocked || checking) {
    return (
      <div className="cura-page">
        <div className="cura-loading" role="status">
          Loading Cura…
        </div>
      </div>
    );
  }

  return <Outlet />;
}

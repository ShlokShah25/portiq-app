import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import axios from 'axios';
import './AdminLogin.css';

const WEBSITE_URL = process.env.REACT_APP_WEBSITE_URL || 'https://portiqtechnologies.com';
const PRODUCT_KEY = 'portiq_product';
const PRODUCT_SYNC_FLAG_KEY = 'portiq_product_sync_once';

const AdminLogin = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [authMode, setAuthMode] = useState('signin');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [signupEmail, setSignupEmail] = useState('');
  const [signupOrg, setSignupOrg] = useState('');
  const [productType, setProductType] = useState('workplace');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [rememberMe, setRememberMe] = useState(false);

  const syncProductAndMaybeReload = (nextPath, serverProduct) => {
    const prevProduct = window.localStorage.getItem(PRODUCT_KEY) || 'workplace';
    window.localStorage.setItem(PRODUCT_KEY, serverProduct);
    if (prevProduct === serverProduct) return false;
    try {
      const marker = `${prevProduct}->${serverProduct}`;
      const seen = window.sessionStorage.getItem(PRODUCT_SYNC_FLAG_KEY);
      if (seen === marker) {
        return false;
      }
      window.sessionStorage.setItem(PRODUCT_SYNC_FLAG_KEY, marker);
    } catch (_) {
      // If sessionStorage is unavailable, continue with a single best-effort hard nav.
    }
    window.location.replace(nextPath);
    return true;
  };

  const syncWebsiteSession = async () => {
    try {
      const res = await axios.get('/admin/profile');
      const admin = res.data?.admin || {};
      const payload = {
        email: admin.email || identifier.trim() || '',
        plan: (admin.plan || 'starter').toLowerCase(),
        productType: (admin.productType || 'workplace').toLowerCase(),
      };
      var domain = window.location.hostname;
      if (domain.endsWith('portiqtechnologies.com')) {
        domain = '.portiqtechnologies.com';
      }
      document.cookie =
        'portiq_site_session=' +
        encodeURIComponent(JSON.stringify(payload)) +
        ';domain=' +
        domain +
        ';path=/;max-age=' +
        60 * 60 * 24 * 7 +
        ';secure;samesite=lax';
    } catch (e) {
      // best-effort only
    }
  };

  // Handle social / auto-login tokens from query string
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const urlToken = params.get('token') || params.get('social_token');
    const next = params.get('next') || '/dashboard';

    if (!urlToken) {
      const reason = params.get('reason');
      if (reason === 'no_access') {
        setError(
          'Your plan or trial is not active for this workspace. Sign in again after renewing on the Portiq website.'
        );
      } else if (reason === 'session_expired') {
        setError('Your session expired. Please sign in again.');
      } else if (reason === 'no_subscription') {
        setError(
          'You need an active subscription or trial to use the app. Please sign in after subscribing.'
        );
      }
    }

    if (urlToken) {
      window.localStorage.setItem('clientAdminToken', urlToken);
      axios.defaults.headers.common['Authorization'] = `Bearer ${urlToken}`;
      (async () => {
        try {
          const profileRes = await axios.get('/admin/profile');
          const admin = profileRes.data?.admin || {};
          if (!admin.hasDashboardAccess) {
            try {
              window.localStorage.removeItem('clientAdminToken');
              window.localStorage.removeItem('portiq_has_subscription');
            } catch (_) {
              /* ignore */
            }
            delete axios.defaults.headers.common.Authorization;
            setError(
              'Your plan or trial is not active for this workspace. Sign in again after renewing on the Portiq website.'
            );
            navigate('/admin-login?reason=no_access', { replace: true });
            return;
          }
          const serverProduct = String(admin.productType || 'workplace').toLowerCase();
          if (syncProductAndMaybeReload(next, serverProduct)) {
            return;
          }
        } catch (err) {
          try {
            window.localStorage.removeItem('clientAdminToken');
            window.localStorage.removeItem('portiq_has_subscription');
          } catch (_) {
            /* ignore */
          }
          delete axios.defaults.headers.common.Authorization;
          const msg =
            err.response?.data?.error ||
            'Your session is invalid or expired. Please sign in again.';
          const details = err.response?.data?.details;
          setError([msg, details].filter(Boolean).join(' '));
          navigate('/admin-login', { replace: true });
          return;
        }
        navigate(next, { replace: true });
      })();
    }
  }, [location, navigate]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);

    try {
      if (authMode === 'signup') {
        const username = identifier.trim();
        const email = signupEmail.trim().toLowerCase();
        const organizationName = signupOrg.trim();
        if (!username || !email || !organizationName) {
          throw new Error('Username, email, and organization are required.');
        }
        const signupRes = await axios.post('/saas/signup', {
          username,
          email,
          password,
          organizationName,
          productType,
        });
        const token = signupRes.data?.token;
        const serverUser = signupRes.data?.user || {};
        if (!token) {
          throw new Error('Signup succeeded but login token was not returned.');
        }
        const serverProduct = String(serverUser.productType || productType || 'workplace').toLowerCase();
        window.localStorage.setItem('clientAdminToken', token);
        const subscribed =
          !!serverUser.hasActiveSubscription || !!serverUser.complimentaryAccess;
        window.localStorage.setItem('portiq_has_subscription', subscribed ? 'true' : 'false');
        axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
        const didHardNav = syncProductAndMaybeReload('/dashboard', serverProduct);
        if (didHardNav) return;
        await syncWebsiteSession();
        setSuccess('Account created. Starting your trial…');
        navigate('/dashboard', { replace: true });
        return;
      }
      // Accept either email or username; backend always expects "username"
        const trimmed = identifier.trim();
        const payload = trimmed ? { username: trimmed, password } : { password };

        const res = await axios.post('/admin/login', { ...payload, rememberMe });
      const token = res.data?.token;
      const serverAdmin = res.data?.admin || {};
      if (!token) {
        throw new Error('Login failed. Please try again.');
      }

      // Use server productType (Education/Workplace) so signup choice is respected.
      const serverProduct = (serverAdmin.productType || 'workplace').toLowerCase();
      window.localStorage.setItem('clientAdminToken', token);
      const subscribed =
        !!serverAdmin.hasActiveSubscription || !!serverAdmin.complimentaryAccess;
      window.localStorage.setItem('portiq_has_subscription', subscribed ? 'true' : 'false');
      axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
      const didHardNav = syncProductAndMaybeReload('/dashboard', serverProduct);
      if (didHardNav) return;
      await syncWebsiteSession();
      if (!window.localStorage.getItem('clientAdminToken')) {
        window.location.href = WEBSITE_URL + '/#pricing';
        return;
      }
      navigate('/dashboard', { replace: true });
    } catch (err) {
      const code = err.response?.data?.code;
      const details = err.response?.data?.details;
      if (err.response?.status === 403 && code === 'NO_APP_ACCESS') {
        setError([err.response?.data?.error, details].filter(Boolean).join(' '));
        return;
      }
      if (err.response?.status === 403 && /subscription/i.test(err.response?.data?.error || '')) {
        setError(
          [err.response?.data?.error, details].filter(Boolean).join(' ') ||
            'No active subscription. Please subscribe on the Portiq website, then sign in again.'
        );
        return;
      }
      console.error('Admin login error', err);
      const msg =
        err.response?.data?.error ||
        err.message ||
        'Invalid credentials. Please try again.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="admin-login-root">
      <div className="admin-login-card">
        <div className="admin-login-header">
          <div className="admin-login-logo-circle">
            <img
              src="/assets/portiq-icon.png"
              alt="Portiq"
              className="admin-login-logo"
              onError={(e) => {
                e.target.style.display = 'none';
              }}
            />
          </div>
          <div className="admin-login-title-block">
            <h1>Login to your Port</h1>
            <p>Sign in to your dashboard</p>
          </div>
        </div>

        <form className="admin-login-form" onSubmit={handleSubmit}>
          <div className="admin-login-auth-toggle" role="tablist" aria-label="Authentication mode">
            <button
              type="button"
              role="tab"
              aria-selected={authMode === 'signin'}
              className={authMode === 'signin' ? 'admin-login-auth-option active' : 'admin-login-auth-option'}
              onClick={() => {
                setAuthMode('signin');
                setError('');
                setSuccess('');
              }}
            >
              Sign in
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={authMode === 'signup'}
              className={authMode === 'signup' ? 'admin-login-auth-option active' : 'admin-login-auth-option'}
              onClick={() => {
                setAuthMode('signup');
                setError('');
                setSuccess('');
              }}
            >
              Create account
            </button>
          </div>

          <div className="admin-login-product-toggle">
            <span className="admin-login-product-label">Product</span>
            <div className="admin-login-product-options">
              <button
                type="button"
                className={
                  productType === 'workplace'
                    ? 'admin-login-product-option active'
                    : 'admin-login-product-option'
                }
                onClick={() => setProductType('workplace')}
              >
                Workplace
              </button>
              <button
                type="button"
                className={
                  productType === 'education'
                    ? 'admin-login-product-option active'
                    : 'admin-login-product-option'
                }
                onClick={() => setProductType('education')}
              >
                Education
              </button>
            </div>
          </div>

          <label className="admin-login-label">
            {authMode === 'signup' ? 'Username' : 'Email or Username'}
            <input
              type="text"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              className="admin-login-input"
              placeholder={authMode === 'signup' ? 'Choose a username' : 'you@company.com or admin'}
              required
            />
          </label>

          {authMode === 'signup' && (
            <>
              <label className="admin-login-label">
                Email
                <input
                  type="email"
                  value={signupEmail}
                  onChange={(e) => setSignupEmail(e.target.value)}
                  className="admin-login-input"
                  placeholder="you@school.edu"
                  required
                />
              </label>
              <label className="admin-login-label">
                Organization / School
                <input
                  type="text"
                  value={signupOrg}
                  onChange={(e) => setSignupOrg(e.target.value)}
                  className="admin-login-input"
                  placeholder="Your school name"
                  required
                />
              </label>
            </>
          )}

          <label className="admin-login-label">
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="admin-login-input"
              placeholder={authMode === 'signup' ? 'Create password (min 6 chars)' : 'Enter admin password'}
              required
            />
          </label>

          {authMode === 'signin' && (
            <label className="admin-login-remember">
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
              />
              <span>Stay signed in for 30 days on this device</span>
            </label>
          )}

          {error && <div className="admin-login-error">{error}</div>}
          {success && <div className="admin-login-success">{success}</div>}

          <button
            type="submit"
            className="admin-login-button"
            disabled={loading}
          >
            {loading
              ? authMode === 'signup'
                ? 'Creating account…'
                : 'Signing in…'
              : authMode === 'signup'
                ? 'Create account'
                : 'Sign In'}
          </button>

          {authMode === 'signin' ? (
            <div className="admin-login-footer">
              <button
                type="button"
                className="admin-login-link"
                onClick={() => {
                  const base =
                    process.env.REACT_APP_MARKETING_URL ||
                    'https://www.portiqtechnologies.com';
                  window.location.href = `${base}#pricing`;
                }}
              >
                Get a subscription
              </button>
              <button
                type="button"
                className="admin-login-link"
                onClick={async () => {
                  const identifierValue = identifier.trim();
                  if (!identifierValue) {
                    setError('Enter your email / username above first.');
                    return;
                  }
                  try {
                    setLoading(true);
                    setError('');
                    await axios.post('/auth/forgot', {
                      username: identifierValue,
                    });
                    setError(
                      'If an account exists, a reset link has been sent to your email.'
                    );
                  } catch (err) {
                    console.error('Forgot password error', err);
                    setError(
                      'Unable to start password reset. Please try again in a moment.'
                    );
                  } finally {
                    setLoading(false);
                  }
                }}
              >
                Forgot password?
              </button>
            </div>
          ) : (
            <div className="admin-login-footer admin-login-footer--single">
              <span className="admin-login-muted-copy">
                Free trial starts immediately after account creation.
              </span>
            </div>
          )}

          <div className="admin-login-divider">
            <span>or</span>
          </div>

          <button
            type="button"
            className="admin-login-oauth admin-login-oauth-google"
            onClick={() => {
              const base =
                process.env.REACT_APP_APP_BASE_URL ||
                window.location.origin;
              const next = '/dashboard';
              const qs = new URLSearchParams();
              qs.set('next', next);
              if (authMode === 'signin' && rememberMe) {
                qs.set('rememberMe', '1');
              }
              window.location.href = `${base.replace(/\/$/, '')}/api/auth/google?${qs.toString()}`;
            }}
          >
            <span className="admin-login-oauth-icon">
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  fill="#EA4335"
                  d="M12 10.2v3.7h5.2c-.2 1.2-.9 2.3-2 3.1l3.3 2.6c1.9-1.8 3-4.4 3-7.5 0-.7-.1-1.4-.2-2H12z"
                />
                <path
                  fill="#34A853"
                  d="M5.3 14.3 4.4 15.1 1.8 17C3.3 19.9 6.4 22 10 22c2.7 0 5-0.9 6.7-2.5l-3.3-2.6C12.5 17.7 11.4 18 10 18c-2.6 0-4.8-1.7-5.7-4.1z"
                />
                <path
                  fill="#FBBC05"
                  d="M1.8 7c-.6 1.2-.9 2.5-.9 4s.3 2.8.9 4l3.5-2.7C5.1 11.8 5 11.4 5 11s.1-.8.3-1.3L1.8 7z"
                />
                <path
                  fill="#4285F4"
                  d="M10 6c1.4 0 2.6.5 3.6 1.4l2.7-2.7C14.9 3.5 12.7 2.6 10 2.6 6.4 2.6 3.3 4.7 1.8 7l3.5 2.7C6.2 7.7 8.4 6 10 6z"
                />
              </svg>
            </span>
            <span>Continue with Google</span>
          </button>
        </form>
      </div>
    </div>
  );
};

export default AdminLogin;


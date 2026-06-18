import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { defaultHomePath } from '../config/product';
import './CuraLogin.css';

const PRODUCT_KEY = 'portiq_product';

export default function CuraLogin() {
  const navigate = useNavigate();
  const [authMode, setAuthMode] = useState('signin');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [signupEmail, setSignupEmail] = useState('');
  const [signupOrg, setSignupOrg] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    document.title = 'Sign in — Cura';
    window.localStorage.setItem(PRODUCT_KEY, 'cura');
  }, []);

  useEffect(() => {
    const token = window.localStorage.getItem('clientAdminToken');
    if (!token) return;
    axios.defaults.headers.common.Authorization = `Bearer ${token}`;
    axios
      .get('/admin/profile')
      .then((res) => {
        const pt = String(res.data?.admin?.productType || 'cura').toLowerCase();
        if (pt === 'cura') {
          navigate('/cura', { replace: true });
        }
      })
      .catch(() => {
        /* stay on login */
      });
  }, [navigate]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    window.localStorage.setItem(PRODUCT_KEY, 'cura');

    try {
      if (authMode === 'signup') {
        const username = identifier.trim();
        const email = signupEmail.trim().toLowerCase();
        const organizationName = signupOrg.trim();
        if (!username || !email || !organizationName || !password) {
          throw new Error('All fields are required.');
        }
        const signupRes = await axios.post('/saas/signup', {
          username,
          email,
          password,
          organizationName,
          productType: 'cura',
        });
        const token = signupRes.data?.token;
        if (!token) throw new Error('Signup succeeded but no token returned.');
        window.localStorage.setItem('clientAdminToken', token);
        axios.defaults.headers.common.Authorization = `Bearer ${token}`;
        window.location.href = '/cura/onboarding';
        return;
      }

      const trimmed = identifier.trim();
      const payload = trimmed ? { username: trimmed, password, rememberMe } : { password, rememberMe };
      const res = await axios.post('/admin/login', payload);
      const token = res.data?.token;
      const serverAdmin = res.data?.admin || {};
      if (!token) throw new Error('Login failed.');

      const serverProduct = String(serverAdmin.productType || 'cura').toLowerCase();
      window.localStorage.setItem(PRODUCT_KEY, 'cura');
      window.localStorage.setItem('clientAdminToken', token);
      axios.defaults.headers.common.Authorization = `Bearer ${token}`;

      if (serverProduct !== 'cura') {
        setError(
          'This account belongs to another PortIQ product. Use the PortIQ sign-in page, or create a Cura clinic account.'
        );
        return;
      }

      navigate(defaultHomePath('cura'), { replace: true });
    } catch (err) {
      const msg =
        err.response?.data?.error ||
        err.message ||
        'Could not sign in. Check your credentials and try again.';
      const details = err.response?.data?.details;
      setError([msg, details].filter(Boolean).join(' — '));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="cura-login">
      <aside className="cura-login__aside" aria-hidden="true">
        <h1>Your clinic, on your terms.</h1>
        <p>
          Patients book on WhatsApp. You get a plain-language briefing before each visit — and after, I&apos;ll summarize
          what happened in words you can actually use.
        </p>
      </aside>
      <div className="cura-login__main">
      <div className="cura-login__panel">
        <Link to="/landing-cura" className="cura-login__logo-link">
          <span className="cura-login__logo" aria-hidden>
            C
          </span>
          <span className="cura-login__wordmark">Cura</span>
        </Link>
        <p className="cura-login__tagline">Sign in to your clinic</p>

        <div className="cura-login__tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={authMode === 'signin'}
            className={authMode === 'signin' ? 'cura-login__tab is-active' : 'cura-login__tab'}
            onClick={() => {
              setAuthMode('signin');
              setError('');
            }}
          >
            Sign in
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={authMode === 'signup'}
            className={authMode === 'signup' ? 'cura-login__tab is-active' : 'cura-login__tab'}
            onClick={() => {
              setAuthMode('signup');
              setError('');
            }}
          >
            Create clinic
          </button>
        </div>

        <form className="cura-login__form" onSubmit={handleSubmit}>
          <label className="cura-login__label">
            {authMode === 'signup' ? 'Username' : 'Email or username'}
            <input
              type="text"
              className="cura-login__input"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              autoComplete={authMode === 'signup' ? 'username' : 'username email'}
              required
            />
          </label>

          {authMode === 'signup' ? (
            <>
              <label className="cura-login__label">
                Work email
                <input
                  type="email"
                  className="cura-login__input"
                  value={signupEmail}
                  onChange={(e) => setSignupEmail(e.target.value)}
                  autoComplete="email"
                  required
                />
              </label>
              <label className="cura-login__label">
                Clinic / organization name
                <input
                  type="text"
                  className="cura-login__input"
                  value={signupOrg}
                  onChange={(e) => setSignupOrg(e.target.value)
                  }
                  required
                />
              </label>
            </>
          ) : null}

          <label className="cura-login__label">
            Password
            <input
              type="password"
              className="cura-login__input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={authMode === 'signup' ? 'new-password' : 'current-password'}
              required
            />
          </label>

          {authMode === 'signin' ? (
            <label className="cura-login__remember">
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
              />
              Stay signed in
            </label>
          ) : null}

          {error ? (
            <div className="cura-login__error" role="alert">
              {error}
            </div>
          ) : null}

          <button type="submit" className="cura-btn cura-btn--primary cura-login__submit" disabled={loading}>
            {loading ? 'Please wait…' : authMode === 'signup' ? 'Create clinic account' : 'Sign in to Cura'}
          </button>
        </form>

        <p className="cura-login__footer">
          <Link to="/landing-cura">← Back to Cura home</Link>
        </p>
      </div>
      </div>
    </div>
  );
}

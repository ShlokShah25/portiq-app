import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { MARKETING_URL, MARKETING_CTA_HASH } from '../config/urls';
import { setProduct, PRODUCT } from '../config/product';
import './ClientAdminLogin.css';

const ClientAdminLogin = () => {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!email.trim() || !password.trim()) {
      setError('Please enter your email and password.');
      return;
    }

    try {
      setLoading(true);
      const res = await axios.post('/admin/login', {
        username: email.trim().toLowerCase(),
        password
      });

      const { token } = res.data || {};
      if (!token) {
        throw new Error('Invalid login response from server.');
      }

      localStorage.setItem('clientAdminToken', token);
      axios.defaults.headers.common.Authorization = `Bearer ${token}`;

      navigate('/dashboard', { replace: true });
    } catch (err) {
      const msg =
        err.response?.data?.error ||
        err.message ||
        'Login failed. Please check your details and try again.';
      setError(msg);
      setLoading(false);
    }
  };

  return (
    <div className="client-admin-login-screen">
      <div className="client-admin-login-card">
        <div className="client-admin-login-header">
          <img
            src="/assets/portiq-logo.png"
            alt="PortIQ"
            className="client-admin-login-logo"
            onError={(e) => {
              e.target.style.display = 'none';
              e.target.nextSibling.style.display = 'block';
            }}
          />
          <div className="client-admin-login-logo-fallback" style={{ display: 'none' }}>
            PortIQ
          </div>
          <h1>Sign in to PortIQ</h1>
          <p>Access your AI meeting assistant dashboard.</p>
        </div>

        {error && <div className="client-admin-login-error">{error}</div>}

        <form className="client-admin-login-form" onSubmit={handleSubmit}>
          <label>
            Email or username
            <input
              type="text"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com or admin"
              autoComplete="username"
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
            />
          </label>
          <button type="submit" disabled={loading}>
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <div className="client-admin-login-footer">
          <span>Don&apos;t have an account?</span>
          <a
            href={`${MARKETING_URL}${MARKETING_CTA_HASH}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            Start free trial
          </a>
        </div>

        <div className="client-admin-login-product">
          <span>Product:</span>
          <button type="button" className={PRODUCT === 'workplace' ? 'active' : ''} onClick={() => setProduct('workplace')}>
            Portiq Workplace
          </button>
          <button type="button" className={PRODUCT === 'education' ? 'active' : ''} onClick={() => setProduct('education')}>
            Portiq Education
          </button>
        </div>
      </div>
    </div>
  );
};

export default ClientAdminLogin;


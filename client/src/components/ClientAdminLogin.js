import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
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
            Work email
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              autoComplete="email"
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
            href="https://portiqtechnologies.com/#cta"
            target="_blank"
            rel="noopener noreferrer"
          >
            Start free trial
          </a>
        </div>
      </div>
    </div>
  );
};

export default ClientAdminLogin;


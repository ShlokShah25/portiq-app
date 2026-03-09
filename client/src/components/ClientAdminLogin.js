import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import './ClientAdminLogin.css';

const ClientAdminLogin = () => {
  const navigate = useNavigate();
  const [credentials, setCredentials] = useState({ username: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await axios.post('/admin/login', credentials);
      const token = res.data?.token;
      if (!token) {
        setError('Login failed: no token returned');
        setLoading(false);
        return;
      }
      localStorage.setItem('clientAdminToken', token);
      axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
      navigate('/admin', { replace: true });
    } catch (err) {
      const msg =
        err.response?.data?.error ||
        err.message ||
        'Login failed';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="client-admin-login-screen">
      <div className="client-admin-login-card">
        <div className="client-admin-login-header">
        <img
          src="/assets/portiq-icon.png"
          alt="Portiq"
          className="client-admin-login-logo"
        />
          <div className="client-admin-login-title">Admin Console</div>
          <div className="client-admin-login-subtitle">Portiq AI Meeting Assistant</div>
        </div>
        {error && <div className="client-admin-login-error">{error}</div>}
        <form onSubmit={handleSubmit} className="client-admin-login-form">
          <div className="client-admin-login-field">
            <label>Username</label>
            <input
              type="text"
              value={credentials.username}
              onChange={(e) =>
                setCredentials({ ...credentials, username: e.target.value })
              }
              autoComplete="username"
              required
            />
          </div>
          <div className="client-admin-login-field">
            <label>Password</label>
            <input
              type="password"
              value={credentials.password}
              onChange={(e) =>
                setCredentials({ ...credentials, password: e.target.value })
              }
              autoComplete="current-password"
              required
            />
          </div>
          <button
            type="submit"
            className="client-admin-login-submit"
            disabled={loading}
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        <button
          type="button"
          className="client-admin-login-cancel"
          onClick={() => navigate('/dashboard')}
        >
          Back to dashboard
        </button>
      </div>
    </div>
  );
};

export default ClientAdminLogin;


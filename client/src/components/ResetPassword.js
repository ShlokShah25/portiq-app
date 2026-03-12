import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import axios from 'axios';
import './AdminLogin.css';

const ResetPassword = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [token, setToken] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const t = params.get('token') || '';
    setToken(t);
  }, [location.search]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setMessage('');

    if (!token) {
      setError('Reset link is invalid or has expired.');
      return;
    }
    if (!password || password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }

    try {
      setLoading(true);
      await axios.post('/auth/reset', { token, password });
      setMessage('Password updated. You can now sign in.');
      setTimeout(() => {
        navigate('/admin-login', { replace: true });
      }, 1500);
    } catch (err) {
      console.error('Reset password error', err);
      const msg =
        err.response?.data?.error ||
        'Failed to reset password. The link may have expired.';
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
            <h1>Reset password</h1>
            <p>Choose a new password for your account</p>
          </div>
        </div>

        <form className="admin-login-form" onSubmit={handleSubmit}>
          <label className="admin-login-label">
            New password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="admin-login-input"
              placeholder="Enter new password"
              required
            />
          </label>

          <label className="admin-login-label">
            Confirm password
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="admin-login-input"
              placeholder="Re-enter new password"
              required
            />
          </label>

          {error && <div className="admin-login-error">{error}</div>}
          {message && <div className="admin-login-success">{message}</div>}

          <button
            type="submit"
            className="admin-login-button"
            disabled={loading}
          >
            {loading ? 'Updating…' : 'Update password'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default ResetPassword;


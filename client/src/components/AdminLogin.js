import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { setProduct } from '../config/product';
import './AdminLogin.css';

const AdminLogin = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [productType, setProductType] = useState('workplace');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Handle social / auto-login tokens from query string
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const socialToken = params.get('social_token');
    const next = params.get('next') || '/dashboard';

    if (socialToken) {
      window.localStorage.setItem('clientAdminToken', socialToken);
      axios.defaults.headers.common['Authorization'] = `Bearer ${socialToken}`;
      navigate(next, { replace: true });
    }
  }, [location, navigate]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
        // Accept either email or username; backend always expects "username"
        const trimmed = identifier.trim();
        const payload = trimmed ? { username: trimmed, password } : { password };

      const res = await axios.post('/admin/login', payload);
      const token = res.data?.token;
      if (!token) {
        throw new Error('Login failed. Please try again.');
      }

      // Set product mode based on selection (Workplace default, Education optional)
      setProduct(productType);

      window.localStorage.setItem('clientAdminToken', token);
      axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
      navigate('/dashboard', { replace: true });
    } catch (err) {
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
            <h1>Admin Login</h1>
            <p>Sign in to access your dashboard</p>
          </div>
        </div>

        <form className="admin-login-form" onSubmit={handleSubmit}>
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
            Email or Username
            <input
              type="text"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              className="admin-login-input"
              placeholder="you@company.com or admin"
              required
            />
          </label>

          <label className="admin-login-label">
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="admin-login-input"
              placeholder="Enter admin password"
              required
            />
          </label>

          {error && <div className="admin-login-error">{error}</div>}

          <button
            type="submit"
            className="admin-login-button"
            disabled={loading}
          >
            {loading ? 'Signing in…' : 'Sign In'}
          </button>

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
              window.location.href = `${base.replace(
                /\/$/,
                ''
              )}/api/auth/google?next=${encodeURIComponent(next)}`;
            }}
          >
            Continue with Google
          </button>
        </form>
      </div>
    </div>
  );
};

export default AdminLogin;


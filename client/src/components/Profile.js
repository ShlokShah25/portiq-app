import React from 'react';
import TopNav from './TopNav';
import './Profile.css';

const decodeToken = (token) => {
  try {
    const [, payload] = token.split('.');
    return JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
  } catch {
    return null;
  }
};

const Profile = () => {
  const token = typeof window !== 'undefined'
    ? window.localStorage.getItem('clientAdminToken')
    : null;

  const payload = token ? decodeToken(token) : null;
  const username = payload?.username || payload?.email || 'Unknown user';

  const product =
    (typeof window !== 'undefined' &&
      window.localStorage.getItem('portiq_product')) ||
    'workplace';

  const productLabel =
    product === 'education' ? 'Portiq Education' : 'Portiq Workplace';

  return (
    <div className="profile-screen">
      <TopNav />
      <div className="profile-content">
        <div className="profile-card">
          <div className="profile-header">
            <div className="profile-avatar">
              <span>{username.charAt(0).toUpperCase()}</span>
            </div>
            <div>
              <h1>Profile</h1>
              <p>Manage your account and subscription</p>
            </div>
          </div>

          <div className="profile-section">
            <h2>Account</h2>
            <div className="profile-row">
              <span className="label">User</span>
              <span className="value">{username}</span>
            </div>
          </div>

          <div className="profile-section">
            <h2>Subscription</h2>
            <div className="profile-row">
              <span className="label">Product</span>
              <span className="value">{productLabel}</span>
            </div>
            <div className="profile-row">
              <span className="label">Status</span>
              <span className="value status-pill">Active (test mode)</span>
            </div>
            <button
              className="profile-manage-btn"
              onClick={() => {
                const marketing =
                  process.env.REACT_APP_MARKETING_URL ||
                  'https://www.portiqtechnologies.com';
                window.location.href = `${marketing}#pricing`;
              }}
            >
              Manage subscription
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Profile;


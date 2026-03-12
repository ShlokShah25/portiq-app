import React, { useEffect, useState } from 'react';
import TopNav from './TopNav';
import axios from 'axios';
import './Profile.css';

const Profile = () => {
  const [username, setUsername] = useState('Unknown user');
  const [productLabel, setProductLabel] = useState('Portiq Workplace');
  const [planLabel, setPlanLabel] = useState('Starter');

  useEffect(() => {
    const loadProfile = async () => {
      try {
        const res = await axios.get('/admin/profile');
        const admin = res.data?.admin || {};
        const uname = admin.username || 'Unknown user';
        const product =
          (admin.productType || '').toLowerCase() ||
          (typeof window !== 'undefined' &&
            window.localStorage.getItem('portiq_product')) ||
          'workplace';
        const plan = (admin.plan || 'starter').toLowerCase();

        setUsername(uname);
        setProductLabel(
          product === 'education' ? 'Portiq Education' : 'Portiq Workplace'
        );

        let planText = 'Starter';
        if (plan === 'professional') planText = 'Professional';
        else if (plan === 'business') planText = 'Business';
        setPlanLabel(planText);
      } catch (e) {
        // Fallback: best-effort from localStorage if API fails
        const product =
          (typeof window !== 'undefined' &&
            window.localStorage.getItem('portiq_product')) ||
          'workplace';
        setProductLabel(
          product === 'education' ? 'Portiq Education' : 'Portiq Workplace'
        );
      }
    };
    loadProfile();
  }, []);

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
              <span className="label">Plan</span>
              <span className="value">{planLabel}</span>
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


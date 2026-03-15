import React, { useEffect, useState } from 'react';
import TopNav from './TopNav';
import axios from 'axios';
import './Profile.css';

const Profile = () => {
  const [username, setUsername] = useState('Unknown user');
  const [email, setEmail] = useState('');
  const [productLabel, setProductLabel] = useState('Portiq Workplace');
  const [planLabel, setPlanLabel] = useState('Starter');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordMessage, setPasswordMessage] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);
  const [cancellingSubscription, setCancellingSubscription] = useState(false);
  const [cancelMessage, setCancelMessage] = useState('');
  const [cancelError, setCancelError] = useState('');

  useEffect(() => {
    const loadProfile = async () => {
      try {
        const res = await axios.get('/admin/profile');
        const admin = res.data?.admin || {};
        const uname = admin.username || 'Unknown user';
        const mail = admin.email || '';
        const product =
          (admin.productType || '').toLowerCase() ||
          (typeof window !== 'undefined' &&
            window.localStorage.getItem('portiq_product')) ||
          'workplace';
        const plan = (admin.plan || 'starter').toLowerCase();

        setUsername(uname);
        setEmail(mail);
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

  const handleChangePassword = async (e) => {
    e.preventDefault();
    setPasswordMessage('');
    setPasswordError('');

    if (!currentPassword || !newPassword || !confirmPassword) {
      setPasswordError('Fill in all password fields.');
      return;
    }
    if (newPassword.length < 6) {
      setPasswordError('New password must be at least 6 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('New passwords do not match.');
      return;
    }

    try {
      setChangingPassword(true);
      await axios.put('/admin/password', {
        currentPassword,
        newPassword,
      });
      setPasswordMessage('Password updated successfully.');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      const msg =
        err.response?.data?.error ||
        'Unable to change password. Please try again.';
      setPasswordError(msg);
    } finally {
      setChangingPassword(false);
    }
  };

  const handleCancelSubscription = async () => {
    if (!window.confirm('Cancel your subscription? You will lose dashboard access and no further payments will be taken.')) return;
    setCancelError('');
    setCancelMessage('');
    setCancellingSubscription(true);
    try {
      await axios.post('/cancel-subscription');
      setCancelMessage('Subscription cancelled. No further charges. Logging out…');
      setTimeout(() => {
        window.localStorage.removeItem('clientAdminToken');
        window.localStorage.removeItem('portiq_has_subscription');
        window.location.href = '/admin-login';
      }, 2000);
    } catch (err) {
      setCancelError(err.response?.data?.error || 'Failed to cancel subscription.');
    } finally {
      setCancellingSubscription(false);
    }
  };

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
            {email && (
              <div className="profile-row">
                <span className="label">Email</span>
                <span className="value">{email}</span>
              </div>
            )}
          </div>

          <div className="profile-section">
            <h2>Subscription</h2>
            <div className="profile-row">
              <span className="label">Product</span>
              <span className="value">
                {productLabel} &nbsp;–&nbsp; {planLabel} plan
              </span>
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
            <button
              type="button"
              className="profile-cancel-sub-btn"
              onClick={handleCancelSubscription}
              disabled={cancellingSubscription}
            >
              {cancellingSubscription ? 'Cancelling…' : 'Cancel subscription'}
            </button>
            {cancelMessage && <p className="profile-cancel-msg">{cancelMessage}</p>}
            {cancelError && <p className="profile-cancel-err">{cancelError}</p>}
          </div>

          <div className="profile-section">
            <h2>Security</h2>
            <form className="profile-password-form" onSubmit={handleChangePassword}>
              <div className="profile-field-group">
                <label>Current password</label>
                <input
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="Enter current password"
                />
              </div>
              <div className="profile-field-group">
                <label>New password</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Enter new password"
                />
              </div>
              <div className="profile-field-group">
                <label>Confirm new password</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter new password"
                />
              </div>
              {passwordError && (
                <div className="profile-password-error">{passwordError}</div>
              )}
              {passwordMessage && (
                <div className="profile-password-success">{passwordMessage}</div>
              )}
              <button
                type="submit"
                className="profile-save-password-btn"
                disabled={changingPassword}
              >
                {changingPassword ? 'Updating…' : 'Change password'}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Profile;


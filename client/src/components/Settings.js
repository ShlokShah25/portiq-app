import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import axios from 'axios';
import { useTheme } from '../contexts/ThemeContext';
import TopNav from './TopNav';
import { L, SUPPORTED_UI_LANGUAGES, getUiLanguage, setUiLanguage } from '../config/uiLanguage';
import './Settings.css';
import './Profile.css';

const VALID_TABS = [
  'account',
  'password',
  'subscription',
  'workspace',
  'display',
  'notifications',
  'general',
];

const Settings = () => {
  const { theme, toggleTheme } = useTheme();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();

  const [username, setUsername] = useState('Unknown user');
  const [email, setEmail] = useState('');
  const [productLabel, setProductLabel] = useState('Portiq Workplace');
  const [planLabel, setPlanLabel] = useState('Starter');
  const [paidSubscription, setPaidSubscription] = useState(false);
  const [complimentaryAccess, setComplimentaryAccess] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordMessage, setPasswordMessage] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);
  const [cancellingSubscription, setCancellingSubscription] = useState(false);
  const [cancelMessage, setCancelMessage] = useState('');
  const [cancelError, setCancelError] = useState('');
  const [uiLanguage, setUiLanguageState] = useState('en');

  const tabFromUrl = searchParams.get('tab');
  const activeTab = VALID_TABS.includes(tabFromUrl) ? tabFromUrl : 'account';

  const setTab = (id) => {
    setSearchParams({ tab: id }, { replace: true });
  };

  const navItems = useMemo(
    () => [
      { id: 'account', labelKey: 'settings.tabAccount' },
      { id: 'password', labelKey: 'settings.tabPassword' },
      { id: 'subscription', labelKey: 'settings.tabSubscription' },
      { id: 'workspace', labelKey: 'settings.tabWorkspace' },
      { id: 'display', labelKey: 'settings.tabDisplay' },
      { id: 'notifications', labelKey: 'settings.tabNotifications' },
      { id: 'general', labelKey: 'settings.tabGeneral' },
    ],
    []
  );

  useEffect(() => {
    if (location.hash === '#settings-participant-book') {
      setSearchParams({ tab: 'workspace' }, { replace: true });
    }
  }, [location.hash, setSearchParams]);

  useEffect(() => {
    const loadProfile = async () => {
      try {
        const res = await axios.get('/admin/profile');
        const admin = res.data?.admin || {};
        const uname = admin.username || 'Unknown user';
        const mail = admin.email || '';
        const product =
          (admin.productType || '').toLowerCase() ||
          (typeof window !== 'undefined' && window.localStorage.getItem('portiq_product')) ||
          'workplace';
        const plan = (admin.plan || 'starter').toLowerCase();

        setUsername(uname);
        setEmail(mail);
        setProductLabel(product === 'education' ? 'Portiq Education' : 'Portiq Workplace');

        let planText = 'Starter';
        if (plan === 'professional') planText = 'Professional';
        else if (plan === 'business') planText = 'Business';
        else if (plan === 'institutional') planText = 'Institutional';
        setPlanLabel(planText);
        setPaidSubscription(!!admin.hasActiveSubscription);
        setComplimentaryAccess(!!admin.complimentaryAccess);
      } catch (e) {
        const product =
          (typeof window !== 'undefined' && window.localStorage.getItem('portiq_product')) || 'workplace';
        setProductLabel(product === 'education' ? 'Portiq Education' : 'Portiq Workplace');
      }
    };
    loadProfile();
    setUiLanguageState(getUiLanguage());
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
      const msg = err.response?.data?.error || 'Unable to change password. Please try again.';
      setPasswordError(msg);
    } finally {
      setChangingPassword(false);
    }
  };

  const handleCancelSubscription = async () => {
    if (!window.confirm('Cancel your subscription? You will lose dashboard access and no further payments will be taken.'))
      return;
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

  const handleUiLanguageChange = (e) => {
    const code = e.target.value || 'en';
    setUiLanguageState(code);
    setUiLanguage(code);
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  };

  return (
    <div className="settings-screen">
      <TopNav />
      <div className="settings-body">
        <aside className="settings-sidebar" aria-label={L('settings.menu')}>
          <p className="settings-sidebar__heading">{L('settings.menu')}</p>
          <nav className="settings-sidebar__nav">
            {navItems.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`settings-sidebar__link${activeTab === item.id ? ' settings-sidebar__link--active' : ''}`}
                onClick={() => setTab(item.id)}
              >
                {L(item.labelKey)}
              </button>
            ))}
          </nav>
        </aside>

        <div className="settings-main">
          <header className="settings-page-header">
            <h1 className="settings-page-title">{L('nav.settings')}</h1>
            <p className="settings-page-subtitle">{L('settings.subtitle')}</p>
          </header>

          <div className="settings-tabs" role="tablist" aria-label={L('nav.settings')}>
            {navItems.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={activeTab === item.id}
                className={`settings-tab${activeTab === item.id ? ' settings-tab--active' : ''}`}
                onClick={() => setTab(item.id)}
              >
                {L(item.labelKey)}
              </button>
            ))}
          </div>

          <div className="settings-panels">
            {activeTab === 'account' && (
              <div className="settings-panel" role="tabpanel">
                <div className="settings-identity settings-identity--inline">
                  <div className="profile-avatar-ring">
                    <span className="profile-avatar-initials">{(username || '?').trim().charAt(0).toUpperCase()}</span>
                  </div>
                  <div className="profile-identity-text">
                    <h2 className="profile-display-name settings-identity__name">{username}</h2>
                    {email ? <p className="profile-display-email">{email}</p> : null}
                    <p className="profile-display-tagline">{L('settings.accountTagline')}</p>
                  </div>
                </div>

                <div className="settings-divider" />

                <div className="settings-panel-row">
                  <div className="settings-panel-row__meta">
                    <h3 className="settings-panel-row__title">{L('settings.accountDetailsTitle')}</h3>
                    <p className="settings-panel-row__desc">{L('settings.accountDetailsDesc')}</p>
                  </div>
                  <div className="settings-panel-row__control">
                    <div className="settings-readonly-block">
                      <div className="settings-readonly-row">
                        <span className="settings-readonly-label">{L('settings.labelUser')}</span>
                        <span className="settings-readonly-value">{username}</span>
                      </div>
                      {email ? (
                        <div className="settings-readonly-row">
                          <span className="settings-readonly-label">{L('settings.labelEmail')}</span>
                          <span className="settings-readonly-value">{email}</span>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'password' && (
              <div className="settings-panel" role="tabpanel">
                <div className="settings-panel-row settings-panel-row--stack">
                  <div className="settings-panel-row__meta">
                    <h3 className="settings-panel-row__title">{L('settings.passwordTitle')}</h3>
                    <p className="settings-panel-row__desc">{L('settings.passwordDesc')}</p>
                  </div>
                  <div className="settings-panel-row__control">
                    <form className="profile-password-form" onSubmit={handleChangePassword}>
                      <div className="profile-field-group">
                        <label>{L('settings.currentPassword')}</label>
                        <input
                          type="password"
                          value={currentPassword}
                          onChange={(e) => setCurrentPassword(e.target.value)}
                          placeholder={L('settings.currentPasswordPh')}
                        />
                      </div>
                      <div className="profile-field-group">
                        <label>{L('settings.newPassword')}</label>
                        <input
                          type="password"
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          placeholder={L('settings.newPasswordPh')}
                        />
                      </div>
                      <div className="profile-field-group">
                        <label>{L('settings.confirmPassword')}</label>
                        <input
                          type="password"
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                          placeholder={L('settings.confirmPasswordPh')}
                        />
                      </div>
                      {passwordError && <div className="profile-password-error">{passwordError}</div>}
                      {passwordMessage && <div className="profile-password-success">{passwordMessage}</div>}
                      <button type="submit" className="profile-save-password-btn" disabled={changingPassword}>
                        {changingPassword ? L('settings.updating') : L('settings.changePassword')}
                      </button>
                    </form>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'subscription' && (
              <div className="settings-panel" role="tabpanel">
                <div className="settings-panel-row settings-panel-row--stack">
                  <div className="settings-panel-row__meta">
                    <h3 className="settings-panel-row__title">{L('settings.subscriptionTitle')}</h3>
                    <p className="settings-panel-row__desc">{L('settings.subscriptionDesc')}</p>
                  </div>
                  <div className="settings-panel-row__control">
                    <div className="settings-readonly-block">
                      <div className="settings-readonly-row">
                        <span className="settings-readonly-label">{L('settings.labelProduct')}</span>
                        <span className="settings-readonly-value">
                          {productLabel} – {planLabel}
                        </span>
                      </div>
                      <div className="settings-readonly-row">
                        <span className="settings-readonly-label">{L('settings.labelStatus')}</span>
                        <span
                          className={`settings-readonly-value status-pill status-${
                            complimentaryAccess || paidSubscription ? 'active' : 'inactive'
                          }`}
                        >
                          {complimentaryAccess && !paidSubscription
                            ? L('settings.statusComplimentary')
                            : paidSubscription
                              ? L('settings.statusActive')
                              : L('settings.statusInactive')}
                        </span>
                      </div>
                    </div>
                    <div className="settings-actions-inline">
                      <button
                        type="button"
                        className="profile-manage-btn"
                        onClick={() => {
                          const marketing =
                            process.env.REACT_APP_MARKETING_URL || 'https://www.portiqtechnologies.com';
                          window.location.href = `${marketing}#pricing`;
                        }}
                      >
                        {L('settings.manageSubscription')}
                      </button>
                      {paidSubscription && (
                        <button
                          type="button"
                          className="profile-cancel-sub-btn"
                          onClick={handleCancelSubscription}
                          disabled={cancellingSubscription}
                        >
                          {cancellingSubscription ? L('settings.cancelling') : L('settings.cancelSubscription')}
                        </button>
                      )}
                    </div>
                    {cancelMessage && <p className="profile-cancel-msg">{cancelMessage}</p>}
                    {cancelError && <p className="profile-cancel-err">{cancelError}</p>}
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'workspace' && (
              <div className="settings-panel" role="tabpanel" id="settings-participant-book">
                <div className="settings-panel-row settings-panel-row--stack">
                  <div className="settings-panel-row__meta">
                    <h3 className="settings-panel-row__title">{L('settings.workspaceTitle')}</h3>
                    <p className="settings-panel-row__desc">{L('settings.workspaceDesc')}</p>
                  </div>
                </div>
                <div className="settings-workspace-embed">
                  <ParticipantBookPanel embedded />
                </div>
              </div>
            )}

            {activeTab === 'display' && (
              <div className="settings-panel" role="tabpanel">
                <div className="settings-panel-row">
                  <div className="settings-panel-row__meta">
                    <h3 className="settings-panel-row__title">{L('settings.themeTitle')}</h3>
                    <p className="settings-panel-row__desc">{L('settings.themeDesc')}</p>
                  </div>
                  <div className="settings-panel-row__control">
                    <div className="theme-toggle-container">
                      <button
                        type="button"
                        className={`theme-option ${theme === 'light' ? 'active' : ''}`}
                        onClick={() => theme !== 'light' && toggleTheme()}
                      >
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                          <circle cx="12" cy="12" r="5" />
                          <line x1="12" y1="1" x2="12" y2="3" />
                          <line x1="12" y1="21" x2="12" y2="23" />
                          <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                          <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                          <line x1="1" y1="12" x2="3" y2="12" />
                          <line x1="21" y1="12" x2="23" y2="12" />
                          <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                          <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
                        </svg>
                        <span>{L('settings.themeLight')}</span>
                      </button>
                      <button
                        type="button"
                        className={`theme-option ${theme === 'dark' ? 'active' : ''}`}
                        onClick={() => theme !== 'dark' && toggleTheme()}
                      >
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                        </svg>
                        <span>{L('settings.themeDark')}</span>
                      </button>
                    </div>
                  </div>
                </div>

                <div className="settings-divider" />

                <div className="settings-panel-row">
                  <div className="settings-panel-row__meta">
                    <h3 className="settings-panel-row__title">{L('settings.languageTitle')}</h3>
                    <p className="settings-panel-row__desc">{L('settings.languageDesc')}</p>
                  </div>
                  <div className="settings-panel-row__control">
                    <select
                      value={uiLanguage}
                      onChange={handleUiLanguageChange}
                      className="profile-language-select settings-language-select"
                    >
                      {SUPPORTED_UI_LANGUAGES.map((lang) => (
                        <option key={lang.code} value={lang.code}>
                          {lang.label}
                        </option>
                      ))}
                    </select>
                    <p className="profile-language-hint settings-language-hint">{L('settings.languageHint')}</p>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'notifications' && (
              <div className="settings-panel" role="tabpanel">
                <div className="settings-panel-row settings-panel-row--stack">
                  <div className="settings-panel-row__meta">
                    <h3 className="settings-panel-row__title">{L('settings.notificationsTitle')}</h3>
                    <p className="settings-panel-row__desc">{L('settings.notificationsDesc')}</p>
                  </div>
                  <div className="settings-panel-row__control">
                    <label className="settings-checkbox-label">
                      <input type="checkbox" defaultChecked />
                      <span>{L('settings.notifyEmail')}</span>
                    </label>
                    <label className="settings-checkbox-label">
                      <input type="checkbox" defaultChecked />
                      <span>{L('settings.notifySummary')}</span>
                    </label>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'general' && (
              <div className="settings-panel" role="tabpanel">
                <div className="settings-panel-row">
                  <div className="settings-panel-row__meta">
                    <h3 className="settings-panel-row__title">{L('settings.generalCompanyTitle')}</h3>
                    <p className="settings-panel-row__desc">{L('settings.generalCompanyDesc')}</p>
                  </div>
                  <div className="settings-panel-row__control">
                    <input type="text" className="settings-input" placeholder={L('settings.companyPh')} />
                  </div>
                </div>
                <div className="settings-divider" />
                <div className="settings-panel-row">
                  <div className="settings-panel-row__meta">
                    <h3 className="settings-panel-row__title">{L('settings.generalDurationTitle')}</h3>
                    <p className="settings-panel-row__desc">{L('settings.generalDurationDesc')}</p>
                  </div>
                  <div className="settings-panel-row__control">
                    <input type="number" className="settings-input" placeholder="60" />
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Settings;

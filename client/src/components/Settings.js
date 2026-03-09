import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { useTheme } from '../contexts/ThemeContext';
import TopNav from './TopNav';
import './Settings.css';

const Settings = () => {
  const { theme, toggleTheme } = useTheme();
  const [companyName, setCompanyName] = useState('');
  const [companyLogoUrl, setCompanyLogoUrl] = useState('');
  const [logoFile, setLogoFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');

  useEffect(() => {
    let isMounted = true;
    axios
      .get('/config')
      .then((res) => {
        if (!isMounted) return;
        const cfg = res.data || {};
        setCompanyName(cfg.companyName || '');
        setCompanyLogoUrl(cfg.companyLogo || '');
      })
      .catch((err) => {
        console.error('Failed to load config in Settings:', err.message);
      });
    return () => {
      isMounted = false;
    };
  }, []);

  const handleSaveGeneral = async () => {
    try {
      setSaving(true);
      setSaveMessage('');

      // Update basic config fields
      await axios.put('/config', {
        companyName
      });

      // Upload logo if a new file was selected
      if (logoFile) {
        const formData = new FormData();
        formData.append('logo', logoFile);
        const res = await axios.post('/config/logo', formData, {
          headers: { 'Content-Type': 'multipart/form-data' }
        });
        if (res.data?.logoUrl) {
          setCompanyLogoUrl(res.data.logoUrl);
        }
      }

      setSaveMessage('Settings saved');
    } catch (error) {
      console.error('Failed to save settings:', error);
      setSaveMessage('Failed to save settings');
    } finally {
      setSaving(false);
      setTimeout(() => setSaveMessage(''), 3000);
    }
  };

  return (
    <div className="settings-screen">
      <TopNav />
      <div className="settings-wrapper">
        <div className="settings-top-bar">
          <h1 className="settings-title">Settings</h1>
        </div>
        
        <div className="settings-content">
          <div className="settings-section">
            <h2>Appearance</h2>
            <div className="settings-item">
              <div className="settings-item-header">
                <div className="settings-item-label">Theme</div>
                <div className="settings-item-description">Choose between light and dark mode</div>
              </div>
              <div className="theme-toggle-container">
                <button
                  className={`theme-option ${theme === 'light' ? 'active' : ''}`}
                  onClick={() => theme !== 'light' && toggleTheme()}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <circle cx="12" cy="12" r="5"></circle>
                    <line x1="12" y1="1" x2="12" y2="3"></line>
                    <line x1="12" y1="21" x2="12" y2="23"></line>
                    <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
                    <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
                    <line x1="1" y1="12" x2="3" y2="12"></line>
                    <line x1="21" y1="12" x2="23" y2="12"></line>
                    <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
                    <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
                  </svg>
                  <span>Light</span>
                </button>
                <button
                  className={`theme-option ${theme === 'dark' ? 'active' : ''}`}
                  onClick={() => theme !== 'dark' && toggleTheme()}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
                  </svg>
                  <span>Dark</span>
                </button>
              </div>
            </div>
          </div>

          <div className="settings-section">
            <h2>General</h2>
            <div className="settings-item">
              <div className="settings-item-label">Company Name</div>
              <input
                type="text"
                className="settings-input"
                placeholder="Your Company"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
              />
            </div>
            <div className="settings-item">
              <div className="settings-item-label">Company Logo</div>
              <input
                type="file"
                accept="image/*"
                className="settings-input"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    setLogoFile(file);
                  }
                }}
              />
              {companyLogoUrl && (
                <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Current logo:</div>
                  <img
                    src={companyLogoUrl}
                    alt="Company logo"
                    style={{ height: 32, width: 'auto', borderRadius: 6, border: '1px solid var(--border-color)' }}
                  />
                </div>
              )}
            </div>
            <div className="settings-item">
              <button
                type="button"
                onClick={handleSaveGeneral}
                style={{
                  padding: '10px 18px',
                  borderRadius: 10,
                  border: 'none',
                  background: 'var(--accent-blue)',
                  color: '#ffffff',
                  fontSize: 14,
                  fontWeight: 500,
                  cursor: 'pointer'
                }}
                disabled={saving}
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
              {saveMessage && (
                <span style={{ marginLeft: 12, fontSize: 12, color: 'var(--text-secondary)' }}>
                  {saveMessage}
                </span>
              )}
            </div>
          </div>

          <div className="settings-section">
            <h2>Notifications</h2>
            <div className="settings-item">
              <label className="settings-checkbox-label">
                <input type="checkbox" defaultChecked />
                <span>Email notifications</span>
              </label>
            </div>
            <div className="settings-item">
              <label className="settings-checkbox-label">
                <input type="checkbox" defaultChecked />
                <span>Summary reminders</span>
              </label>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Settings;

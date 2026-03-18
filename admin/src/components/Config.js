import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import LiveEditor from './LiveEditor';
import './Config.css';

const Config = () => {
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [activeTab, setActiveTab] = useState('settings');

  useEffect(() => {
    fetchConfig();
  }, []);

  const fetchConfig = async () => {
    try {
      const response = await axios.get('/config');
      const data = response.data;
      if (!data.alwaysOnDisplay) {
        data.alwaysOnDisplay = {
          enabled: true,
          idleTimeout: 30,
          rotationInterval: 10,
          backgroundColor: '#0a1929',
          textColor: '#ffffff',
          accentColor: '#4fc3f7'
        };
      }
      if (!data.pageCustomization) {
        data.pageCustomization = {};
      }
      setConfig(data);
    } catch (error) {
      console.error('Error fetching config:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setMessage('');
    try {
      await axios.put('/config', {
        companyName: config.companyName,
        completedMeetingDisplayHours: config.completedMeetingDisplayHours,
        actionItemReminderTime: config.actionItemReminderTime,
        actionItemRemindersEnabled: config.actionItemRemindersEnabled,
      });
      setMessage('Configuration saved successfully!');
      setTimeout(() => setMessage(''), 3000);
    } catch (error) {
      setMessage('Error saving configuration: ' + (error.response?.data?.error || error.message));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="admin-container">
        <div className="main-content" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
          <div>Loading...</div>
        </div>
      </div>
    );
  }

  if (!config) {
    return (
      <div className="admin-container">
        <div className="main-content">
          <div className="card">
            <p>No configuration found.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-container">
      <div className="sidebar">
        <h2>Admin Panel</h2>
        <nav>
          <ul>
            <li><Link to="/dashboard">Dashboard</Link></li>
            <li><Link to="/meetings">Meetings</Link></li>
            <li><Link to="/visitors">Visitors</Link></li>
            <li><Link to="/config" className="active">Configuration</Link></li>
          </ul>
        </nav>
      </div>
      <div className="main-content">
        <div className="content-header">
          <h1>Configuration</h1>
          <p style={{ color: '#666', marginTop: '10px' }}>
            Manage system settings and preferences
          </p>
        </div>

        <div className="config-tabs">
          <button
            className={`tab-btn ${activeTab === 'settings' ? 'active' : ''}`}
            onClick={() => setActiveTab('settings')}
          >
            Settings
          </button>
          <button
            className={`tab-btn ${activeTab === 'alwaysOn' ? 'active' : ''}`}
            onClick={() => setActiveTab('alwaysOn')}
          >
            Always-On Display
          </button>
        </div>

        {activeTab === 'settings' && (
          <>
            {message && (
              <div className={message.includes('Error') ? 'error-message' : 'success-message'}>
                {message}
              </div>
            )}

            <div className="card">
              <h2>Company Settings</h2>
              <div className="form-group">
                <label>Company Name</label>
                <input
                  type="text"
                  value={config.companyName || ''}
                  onChange={(e) => setConfig({ ...config, companyName: e.target.value })}
                  placeholder="Your Company Name"
                />
              </div>
            </div>

            <div className="card">
              <h2>Meeting & Reminder Settings</h2>
              <div className="form-group">
                <label>Completed Meeting Display Duration (Hours)</label>
                <input
                  type="number"
                  min="0"
                  max="168"
                  value={config.completedMeetingDisplayHours || 24}
                  onChange={(e) => setConfig({ ...config, completedMeetingDisplayHours: parseInt(e.target.value) || 0 })}
                />
                <small style={{ color: '#666', marginTop: '5px', display: 'block' }}>
                  How long completed meetings should remain visible on the kiosk (0 = hide immediately, max 168 hours = 1 week).
                  All meetings are permanently stored in the admin panel regardless of this setting.
                </small>
              </div>
              <div className="form-group">
                <label>Action-Item Reminder Time (HH:MM, 24-hour)</label>
                <input
                  type="time"
                  value={config.actionItemReminderTime || '08:00'}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      actionItemReminderTime: e.target.value || '08:00',
                    })
                  }
                />
                <small style={{ color: '#666', marginTop: '5px', display: 'block' }}>
                  Time of day (server local time) when AI-based action-item review reminders should be emailed.
                </small>
              </div>
              <div className="form-group">
                <label style={{ display: 'block', marginBottom: '8px' }}>Action-Item Reminders</label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <input
                    type="checkbox"
                    checked={config.actionItemRemindersEnabled !== false}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        actionItemRemindersEnabled: e.target.checked,
                      })
                    }
                  />
                  <span>Enable reminder emails</span>
                </label>
                <small style={{ color: '#666', marginTop: '5px', display: 'block' }}>
                  Turn off to stop all automated action-item reminder emails.
                </small>
              </div>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? 'Saving...' : 'Save Configuration'}
              </button>
            </div>
          </>
        )}

        {activeTab === 'alwaysOn' && config && (
          <LiveEditor config={config} setConfig={setConfig} />
        )}
      </div>
    </div>
  );
};

export default Config;

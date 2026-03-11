import React, { useEffect, useState } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import TopNav from './TopNav';
import { isEducation } from '../config/product';
import { T } from '../config/terminology';
import { getClassrooms } from '../utils/classroomsStorage';
import './Settings.css';

const Settings = () => {
  const { theme, toggleTheme } = useTheme();
  const [classroomCount, setClassroomCount] = useState(0);

  useEffect(() => {
    if (isEducation) {
      setClassroomCount(getClassrooms().length || 0);
    }
  }, []);

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
              <div className="settings-item-label">{T.companyName()}</div>
              <input type="text" className="settings-input" placeholder={isEducation ? 'Your School' : 'Your Company'} />
            </div>
            <div className="settings-item">
              <div className="settings-item-label">{T.companyLogo()}</div>
              <input type="file" accept="image/*" className="settings-input" />
              <small style={{ color: '#9ca3af', fontSize: '12px', marginTop: '4px' }}>Used in lecture emails and PDF exports</small>
            </div>
            {!isEducation && (
            <div className="settings-item">
              <div className="settings-item-label">Default Meeting Duration</div>
              <input type="number" className="settings-input" placeholder="60" />
            </div>
            )}
          </div>

          {isEducation && (
            <div className="settings-section">
              <h2>Subscription</h2>
              <div className="settings-item">
                <div className="settings-item-label">Plan type</div>
                <p className="settings-item-description">
                  Portiq Education (licensed per classroom).
                </p>
              </div>
              <div className="settings-item">
                <div className="settings-item-label">Classroom licenses</div>
                <p className="settings-item-description">
                  Each classroom license allows 1 active lecture at a time. Current classrooms configured:{' '}
                  <strong>{classroomCount}</strong>
                </p>
              </div>
            </div>
          )}

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

import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { T } from '../config/terminology';
import { L } from '../config/uiLanguage';
import './TopNav.css';

const TopNav = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [showMenu, setShowMenu] = useState(false);

  const menuItems = [
    {
      id: 'dashboard',
      labelKey: 'nav.dashboard',
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="3" y="3" width="7" height="7"></rect>
          <rect x="14" y="3" width="7" height="7"></rect>
          <rect x="14" y="14" width="7" height="7"></rect>
          <rect x="3" y="14" width="7" height="7"></rect>
        </svg>
      ),
      path: '/dashboard'
    },
    {
      id: 'tasks',
      labelKey: 'nav.tasks',
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <line x1="18" y1="20" x2="18" y2="10"></line>
          <line x1="12" y1="20" x2="12" y2="4"></line>
          <line x1="6" y1="20" x2="6" y2="14"></line>
        </svg>
      ),
      path: '/insights'
    }
  ];

  const isActive = (path) => {
    if (path === '/dashboard') {
      return location.pathname === '/' || location.pathname === '/dashboard';
    }
    return location.pathname.startsWith(path);
  };

  return (
    <nav className="top-nav">
      <div className="top-nav-container">
        <div className="top-nav-brand" onClick={() => navigate('/dashboard')}>
          <img 
            src="/assets/portiq-icon.png" 
            alt="PortIQ" 
            className="top-nav-logo"
            onError={(e) => {
              e.target.style.display = 'none';
            }}
          />
          <span className="top-nav-brand-text">PortIQ</span>
        </div>

        <div className="top-nav-menu">
          {menuItems.map(item => (
            <button
              key={item.id}
              className={`top-nav-item ${isActive(item.path) ? 'active' : ''}`}
              onClick={() => navigate(item.path)}
            >
              {item.icon}
              <span>{L(item.labelKey)}</span>
            </button>
          ))}
        </div>

        <div className="top-nav-actions">
          <button 
            className="top-nav-admin"
            onClick={() => navigate('/admin')}
            title={L('nav.admin')}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M12 2L2 7l10 5 10-5-10-5z"></path>
              <path d="M2 17l10 5 10-5"></path>
              <path d="M2 12l10 5 10-5"></path>
            </svg>
            {L('nav.admin')}
          </button>
          <button 
            className="top-nav-settings"
            onClick={() => navigate('/settings')}
            title={L('nav.settings')}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"></path>
              <circle cx="12" cy="12" r="3"></circle>
            </svg>
          </button>
          <button
            className="top-nav-logout"
            onClick={() => {
              localStorage.removeItem('clientAdminToken');
              try {
                delete window.axios?.defaults?.headers?.common?.Authorization;
              } catch (e) {
                // ignore
              }
              navigate('/admin-login', { replace: true });
            }}
            title={L('nav.logout')}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
              <polyline points="16 17 21 12 16 7"></polyline>
              <line x1="21" y1="12" x2="9" y2="12"></line>
            </svg>
            {L('nav.logout')}
          </button>
        </div>
      </div>
    </nav>
  );
};

export default TopNav;

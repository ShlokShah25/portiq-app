import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import axios from 'axios';
import { T } from '../config/terminology';
import './Sidebar.css';

const Sidebar = () => {
  const navigate = useNavigate();
  const location = useLocation();

  const menuItems = [
    {
      id: 'dashboard',
      label: 'Dashboard',
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="14" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
        </svg>
      ),
      path: '/dashboard',
    },
    {
      id: 'meetings',
      label: T.meetings(),
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
          <line x1="16" y1="2" x2="16" y2="6" />
          <line x1="8" y1="2" x2="8" y2="6" />
          <line x1="3" y1="10" x2="21" y2="10" />
        </svg>
      ),
      path: '/meetings',
    },
    {
      id: 'tasks',
      label: 'Tasks',
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <line x1="18" y1="20" x2="18" y2="10" />
          <line x1="12" y1="20" x2="12" y2="4" />
          <line x1="6" y1="20" x2="6" y2="14" />
        </svg>
      ),
      path: '/insights',
    },
    {
      id: 'settings',
      label: 'Settings',
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="12" cy="12" r="3" />
          <path d="M12 1v2m0 18v2M4.22 4.22l1.42 1.42m12.72 12.72l1.42 1.42M1 12h2m18 0h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
        </svg>
      ),
      path: '/settings',
    },
  ];

  const isActive = (path) => {
    if (path === '/dashboard') {
      return location.pathname === '/' || location.pathname === '/dashboard';
    }
    return location.pathname === path || location.pathname.startsWith(`${path}/`);
  };

  const logout = () => {
    try {
      window.localStorage.removeItem('clientAdminToken');
    } catch (e) {
      /* ignore */
    }
    try {
      delete axios.defaults.headers.common.Authorization;
    } catch (e) {
      /* ignore */
    }
    navigate('/admin-login', { replace: true });
  };

  return (
    <aside className="sidebar" aria-label="Main navigation">
      <div className="sidebar__brand">
        <button type="button" className="sidebar__brand-btn" onClick={() => navigate('/dashboard')}>
          <img
            src="/assets/portiq-icon.png"
            alt=""
            className="sidebar__brand-mark"
            onError={(e) => {
              e.target.style.display = 'none';
            }}
          />
          <span className="sidebar__brand-name">PortIQ</span>
        </button>
      </div>

      <nav className="sidebar__nav">
        {menuItems.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`sidebar-item${isActive(item.path) ? ' active' : ''}`}
            onClick={() => navigate(item.path)}
          >
            {item.icon}
            <span>{item.label}</span>
          </button>
        ))}
      </nav>

      <div className="sidebar__footer">
        <button type="button" className="sidebar-footer-btn" onClick={() => navigate('/admin')}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M12 2L2 7l10 5 10-5-10-5z" />
            <path d="M2 17l10 5 10-5" />
            <path d="M2 12l10 5 10-5" />
          </svg>
          Admin
        </button>
        <button type="button" className="sidebar-footer-btn sidebar-footer-btn--logout" onClick={logout}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
          Log out
        </button>
      </div>
    </aside>
  );
};

export default Sidebar;

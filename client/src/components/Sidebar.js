import React, { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import axios from 'axios';
import { T } from '../config/terminology';
import { isEducation } from '../config/product';
import { FEATURE_INTERVIEW_UI } from '../config/featureFlags';
import { useTrialExperience } from './TrialExperienceProvider';
import './Sidebar.css';

const SIDEBAR_COLLAPSED_KEY = 'portiq_sidebar_collapsed';
const SIDEBAR_WIDTH_EXPANDED = '260px';
const SIDEBAR_WIDTH_COLLAPSED = '72px';

function readSidebarCollapsedPref() {
  try {
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

const Sidebar = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const trial = useTrialExperience();
  const profileLoading = Boolean(trial?.loading);
  const role = String(trial?.profile?.role || '').toLowerCase();
  const isEducationAdmin = isEducation && role !== 'faculty';
  /** Hide Lectures for org admins; keep visible while profile loads so faculty are not mis-routed. */
  const showLecturesNav = !isEducation || profileLoading || role === 'faculty';

  const isWorkplace = !isEducation;
  const [collapsed, setCollapsed] = useState(readSidebarCollapsedPref);

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--sidebar-width', collapsed ? SIDEBAR_WIDTH_COLLAPSED : SIDEBAR_WIDTH_EXPANDED);
    if (collapsed) {
      root.setAttribute('data-sidebar-collapsed', 'true');
    } else {
      root.removeAttribute('data-sidebar-collapsed');
    }
    try {
      window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? '1' : '0');
    } catch {
      /* ignore */
    }
    return () => {
      root.style.setProperty('--sidebar-width', SIDEBAR_WIDTH_EXPANDED);
      root.removeAttribute('data-sidebar-collapsed');
    };
  }, [collapsed]);

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
    ...(showLecturesNav
      ? [
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
        ]
      : []),
    ...(isWorkplace
      ? [
          {
            id: 'tasks',
            label: 'Tasks',
            icon: (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M9 11l3 3L22 4" />
                <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
              </svg>
            ),
            path: '/insights',
          },
          {
            id: 'insights',
            label: 'Insights',
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
            id: 'search',
            label: 'Search',
            icon: (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            ),
            path: '/transcripts',
          },
          {
            id: 'calendar',
            label: 'Calendar',
            icon: (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="3" y="4" width="18" height="18" rx="2" />
                <line x1="16" y1="2" x2="16" y2="6" />
                <line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
              </svg>
            ),
            path: '/meetings',
          },
          {
            id: 'integrations',
            label: 'Integrations',
            icon: (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M12 2v4" />
                <path d="M12 18v4" />
                <path d="M4.93 4.93l2.83 2.83" />
                <path d="M16.24 16.24l2.83 2.83" />
                <path d="M2 12h4" />
                <path d="M18 12h4" />
                <path d="M4.93 19.07l2.83-2.83" />
                <path d="M16.24 7.76l2.83-2.83" />
              </svg>
            ),
            path: '/settings',
          },
        ]
      : []),
    ...(isEducationAdmin
      ? [
          {
            id: 'classrooms',
            label: 'Classrooms',
            icon: (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M3 7.5L12 3l9 4.5-9 4.5-9-4.5z" />
                <path d="M7 10.5V15c0 1.8 2.2 3.2 5 3.2s5-1.4 5-3.2v-4.5" />
              </svg>
            ),
            path: '/classes',
          },
        ]
      : []),
    ...(isEducationAdmin
      ? [
          {
            id: 'teachers',
            label: 'Teachers',
            icon: (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="8.5" cy="7" r="4" />
                <path d="M20 8v6" />
                <path d="M23 11h-6" />
              </svg>
            ),
            path: '/teachers',
          },
        ]
      : []),
    {
      id: 'settings',
      label: 'Settings',
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
          <circle cx="12" cy="12" r="3" />
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
    <aside
      className={`sidebar${collapsed ? ' sidebar--collapsed' : ''}`}
      aria-label="Main navigation"
      data-collapsed={collapsed ? 'true' : 'false'}
    >
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
          <span className="sidebar__brand-name sidebar__label">PortIQ</span>
        </button>
        <button
          type="button"
          className="sidebar__collapse-btn"
          onClick={() => setCollapsed((value) => !value)}
          aria-label={collapsed ? 'Pin sidebar open' : 'Collapse sidebar to icons'}
          aria-expanded={!collapsed}
          title={collapsed ? 'Pin sidebar open' : 'Collapse sidebar'}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
            {collapsed ? (
              <>
                <rect x="3" y="3" width="18" height="18" rx="3" />
                <path d="M9 3v18" />
                <path d="m14 9 3 3-3 3" />
              </>
            ) : (
              <>
                <rect x="3" y="3" width="18" height="18" rx="3" />
                <path d="M9 3v18" />
                <path d="m13 9-3 3 3 3" />
              </>
            )}
          </svg>
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
            <span className="sidebar__label">{item.label}</span>
          </button>
        ))}
      </nav>

      {isWorkplace && FEATURE_INTERVIEW_UI ? (
        <button
          type="button"
          className="sidebar-promo"
          onClick={() => navigate('/interview')}
          title="Interview Mode"
        >
          <span className="sidebar-promo__icon" aria-hidden>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M22 11h-6" />
              <path d="M19 8v6" />
            </svg>
          </span>
          <span className="sidebar-promo__body">
            <strong>Interview Mode</strong>
            <span>Structured hiring evaluations from recordings.</span>
            <em>Explore →</em>
          </span>
        </button>
      ) : null}

      <div className="sidebar__footer">
        {role !== 'faculty' && (
          <button type="button" className="sidebar-footer-btn" onClick={() => navigate('/admin')}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M12 2L2 7l10 5 10-5-10-5z" />
              <path d="M2 17l10 5 10-5" />
              <path d="M2 12l10 5 10-5" />
            </svg>
            <span className="sidebar__label">Admin</span>
          </button>
        )}
        <button type="button" className="sidebar-footer-btn sidebar-footer-btn--logout" onClick={logout}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
          <span className="sidebar__label">Log out</span>
        </button>
      </div>
    </aside>
  );
};

export default Sidebar;

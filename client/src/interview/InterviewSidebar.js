import React from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Briefcase, LayoutDashboard, PlusCircle, Users, ArrowLeft } from 'lucide-react';
import './InterviewMode.css';

const NAV = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    path: '/interview',
    icon: LayoutDashboard,
    end: true,
  },
  {
    id: 'new',
    label: 'Start interview',
    path: '/interview/new',
    icon: PlusCircle,
  },
  {
    id: 'candidates',
    label: 'All sessions',
    path: '/interview',
    icon: Users,
    hash: '#sessions',
  },
];

export default function InterviewSidebar() {
  const location = useLocation();
  const navigate = useNavigate();

  const isActive = (item) => {
    if (item.id === 'new') {
      return location.pathname === '/interview/new';
    }
    if (item.end) {
      return location.pathname === '/interview' || location.pathname === '/interview/';
    }
    return false;
  };

  return (
    <aside className="interview-sidebar" aria-label="Interview Mode navigation">
      <div className="interview-sidebar__brand">
        <div className="interview-sidebar__brand-icon" aria-hidden>
          <Briefcase size={18} strokeWidth={1.75} />
        </div>
        <div className="interview-sidebar__brand-text">
          <span className="interview-sidebar__brand-kicker">PortIQ</span>
          <span className="interview-sidebar__brand-title">Interview Mode</span>
        </div>
      </div>

      <nav className="interview-sidebar__nav">
        {NAV.map((item) => {
          const Icon = item.icon;
          const active = isActive(item);
          const to = item.hash ? { pathname: item.path, hash: item.hash } : item.path;
          return (
            <Link
              key={item.id}
              to={to}
              className={`interview-sidebar__link${active ? ' is-active' : ''}`}
            >
              <Icon size={18} strokeWidth={1.5} aria-hidden />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="interview-sidebar__footer">
        <button
          type="button"
          className="interview-sidebar__back"
          onClick={() => navigate('/meetings')}
        >
          <ArrowLeft size={16} strokeWidth={1.5} aria-hidden />
          Back to meetings
        </button>
      </div>
    </aside>
  );
}

import React from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  Users,
  Calendar,
  Pill,
  MessageCircle,
  Settings,
  Stethoscope,
} from 'lucide-react';
import { curaPaths } from './useCuraRoutes';
import './CuraMode.css';

const NAV = [
  { id: 'dashboard', label: 'Dashboard', path: curaPaths().dashboard, icon: LayoutDashboard, end: true },
  { id: 'patients', label: 'Patients', path: curaPaths().patients, icon: Users },
  { id: 'calendar', label: 'Calendar', path: curaPaths().calendar, icon: Calendar },
  { id: 'prescriptions', label: 'Prescriptions', path: curaPaths().prescriptions, icon: Pill },
  { id: 'follow-ups', label: 'Follow-ups', path: curaPaths().followUps, icon: MessageCircle },
  { id: 'settings', label: 'Settings', path: curaPaths().settings, icon: Settings },
];

export default function CuraSidebar() {
  const location = useLocation();
  const navigate = useNavigate();

  const isActive = (item) => {
    if (item.end) {
      return location.pathname === item.path || location.pathname === `${item.path}/`;
    }
    return location.pathname === item.path || location.pathname.startsWith(`${item.path}/`);
  };

  return (
    <aside className="cura-sidebar" aria-label="Cura navigation">
      <div className="cura-sidebar__brand">
        <div className="cura-sidebar__logo" aria-hidden>
          C
        </div>
        <div className="cura-sidebar__brand-text">
          <span className="cura-sidebar__brand-kicker">Clinical intelligence</span>
          <span className="cura-sidebar__brand-title">Cura</span>
        </div>
      </div>

      <nav className="cura-sidebar__nav">
        {NAV.map((item) => {
          const Icon = item.icon;
          const active = isActive(item);
          return (
            <Link
              key={item.id}
              to={item.path}
              className={`cura-sidebar__link${active ? ' is-active' : ''}`}
            >
              <Icon size={18} strokeWidth={1.5} aria-hidden />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="cura-sidebar__footer">
        <Link to={curaPaths().consultationNew} className="cura-btn cura-btn--primary" style={{ width: '100%', marginBottom: 8 }}>
          <Stethoscope size={16} aria-hidden />
          Start consultation
        </Link>
        <button type="button" className="cura-sidebar__back" onClick={() => navigate('/landing-cura')}>
          About Cura
        </button>
      </div>
    </aside>
  );
}

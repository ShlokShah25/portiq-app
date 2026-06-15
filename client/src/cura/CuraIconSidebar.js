import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { CalendarDays, Users, Search, CreditCard, Settings, Stethoscope } from 'lucide-react';
import { curaPaths } from './useCuraRoutes';
import { useCuraProduct } from './CuraProductContext';
import './CuraCore.css';

const NAV = [
  { id: 'today', label: 'Today', path: curaPaths().dashboard, icon: CalendarDays, end: true },
  { id: 'patients', label: 'Patients', path: curaPaths().patients, icon: Users },
  { id: 'search', label: 'Search', path: curaPaths().search, icon: Search },
  { id: 'billing', label: 'Billing', path: curaPaths().prescriptions, icon: CreditCard },
  { id: 'settings', label: 'Settings', path: curaPaths().settings, icon: Settings },
];

export default function CuraIconSidebar() {
  const location = useLocation();
  const { openCommandPalette } = useCuraProduct();

  const isActive = (item) => {
    if (item.id === 'search') return location.pathname.includes('/search');
    if (item.end) {
      return location.pathname === item.path || location.pathname === `${item.path}/`;
    }
    return location.pathname === item.path || location.pathname.startsWith(`${item.path}/`);
  };

  return (
    <nav className="cura-shell__nav" aria-label="Cura navigation">
      <Link to={curaPaths().dashboard} className="cura-shell__nav-link" title="Cura" style={{ marginBottom: 8 }}>
        <Stethoscope size={18} strokeWidth={1.75} aria-hidden />
      </Link>
      {NAV.map((item) => {
        const Icon = item.icon;
        if (item.id === 'search') {
          return (
            <button
              key={item.id}
              type="button"
              className={`cura-shell__nav-link${isActive(item) ? ' is-active' : ''}`}
              title={`${item.label} (⌘K)`}
              onClick={openCommandPalette}
            >
              <Icon size={18} strokeWidth={1.5} aria-hidden />
            </button>
          );
        }
        return (
          <Link
            key={item.id}
            to={item.path}
            className={`cura-shell__nav-link${isActive(item) ? ' is-active' : ''}`}
            title={item.label}
          >
            <Icon size={18} strokeWidth={1.5} aria-hidden />
          </Link>
        );
      })}
    </nav>
  );
}

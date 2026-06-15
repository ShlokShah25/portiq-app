import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Search } from 'lucide-react';
import { curaPaths } from './useCuraRoutes';
import { useCuraProduct } from './CuraProductContext';
import './CuraCore.css';

const TABS = [
  { id: 'today', label: 'Today', path: curaPaths().dashboard, end: true },
  { id: 'calendar', label: 'Calendar', path: curaPaths().calendar },
  { id: 'patients', label: 'Patients', path: curaPaths().patients },
];

export default function CuraNav() {
  const location = useLocation();
  const { openCommandPalette } = useCuraProduct();

  const isActive = (item) => {
    if (item.end) {
      return location.pathname === item.path || location.pathname === `${item.path}/`;
    }
    return location.pathname === item.path || location.pathname.startsWith(`${item.path}/`);
  };

  return (
    <header className="cura-nav" aria-label="Cura">
      <Link to={curaPaths().dashboard} className="cura-nav__brand">
        <span className="cura-nav__mark" aria-hidden>
          C
        </span>
        <span className="cura-nav__name">Cura</span>
      </Link>
      <nav className="cura-nav__tabs" aria-label="Main">
        {TABS.map((tab) => (
          <Link
            key={tab.id}
            to={tab.path}
            className={`cura-nav__tab${isActive(tab) ? ' is-active' : ''}`}
          >
            {tab.label}
          </Link>
        ))}
      </nav>
      <div className="cura-nav__actions">
        <button type="button" className="cura-nav__search" onClick={openCommandPalette} aria-label="Search">
          <Search size={16} strokeWidth={1.75} />
        </button>
        <Link to={curaPaths().settings} className="cura-nav__settings">
          Settings
        </Link>
      </div>
    </header>
  );
}

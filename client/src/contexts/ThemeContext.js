import React, { createContext, useContext, useState, useEffect } from 'react';

/** One-time: existing installs often had `app-theme=dark`; light SaaS is now default. Users can switch back in Settings. */
const PORTIQ_LIGHT_DEFAULT_MIGRATION_KEY = 'portiq-light-default-v1';

function readStoredTheme() {
  if (typeof window === 'undefined') return 'light';
  try {
    if (!localStorage.getItem(PORTIQ_LIGHT_DEFAULT_MIGRATION_KEY)) {
      localStorage.setItem(PORTIQ_LIGHT_DEFAULT_MIGRATION_KEY, '1');
      localStorage.setItem('app-theme', 'light');
      return 'light';
    }
    const saved = localStorage.getItem('app-theme');
    return saved === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

const ThemeContext = createContext();

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within ThemeProvider');
  }
  return context;
};

export const ThemeProvider = ({ children }) => {
  const [theme, setTheme] = useState(() => readStoredTheme());

  useEffect(() => {
    localStorage.setItem('app-theme', theme);
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prev => prev === 'dark' ? 'light' : 'dark');
  };

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

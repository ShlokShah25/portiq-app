import React, { createContext, useContext, useState, useEffect } from 'react';

const THEME_STORAGE_KEY = 'app-theme';
/** One-time: default the whole app to light (sidebar + live session + cards). */
const LIGHT_DEFAULT_MIGRATION_KEY = 'portiq_light_default_v1';

function readStoredTheme() {
  if (typeof window === 'undefined') return 'light';
  try {
    if (!localStorage.getItem(LIGHT_DEFAULT_MIGRATION_KEY)) {
      localStorage.setItem(LIGHT_DEFAULT_MIGRATION_KEY, '1');
      localStorage.setItem(THEME_STORAGE_KEY, 'light');
      return 'light';
    }
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
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
    localStorage.setItem(THEME_STORAGE_KEY, theme);
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prev => (prev === 'dark' ? 'light' : 'dark'));
  };

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

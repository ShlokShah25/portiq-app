import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import './styles/design-system.css';
import './styles/theme.css';
import './styles/premium-apple.css';
import './tablet-fix.css';
import { ThemeProvider } from './contexts/ThemeContext';
import App from './App';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </React.StrictMode>
);

// Disable existing service workers to avoid stale cached bundles in production
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .getRegistrations()
      .then((registrations) => {
        registrations.forEach((registration) => {
          registration.unregister();
        });
      })
      .catch((err) => {
        console.log('SW unregister failed: ', err);
      });
  });
}

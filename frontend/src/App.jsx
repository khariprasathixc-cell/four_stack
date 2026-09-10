import React, { useState, useEffect } from 'react';
import Dashboard from './Dashboard';
import SosLogsPage from './SosLogsPage';
import './App.css';

export default function App() {
  const [currentPath, setCurrentPath] = useState(() => {
    return window.location.pathname || '/';
  });

  useEffect(() => {
    const handleLocationChange = () => {
      setCurrentPath(window.location.pathname || '/');
    };

    window.addEventListener('popstate', handleLocationChange);
    return () => {
      window.removeEventListener('popstate', handleLocationChange);
    };
  }, []);

  const navigateTo = (path) => {
    if (window.location.pathname !== path) {
      window.history.pushState({}, '', path);
      setCurrentPath(path);
    }
  };

  if (currentPath === '/sos-logs' || currentPath.startsWith('/sos-logs')) {
    return (
      <SosLogsPage
        onNavigateToDashboard={() => navigateTo('/')}
      />
    );
  }

  return (
    <Dashboard
      onNavigateToSosLogs={() => navigateTo('/sos-logs')}
    />
  );
}

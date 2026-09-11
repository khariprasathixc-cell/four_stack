import React, { useState, useEffect } from 'react';
import Dashboard from './Dashboard';
import SosLogsPage from './SosLogsPage';
import CitizenView from './components/CitizenView';
import RangerLoginGate from './components/RangerLoginGate';
import './App.css';

export default function App() {
  const [currentPath, setCurrentPath] = useState(() => {
    return window.location.pathname || '/';
  });

  const [isRangerAuth, setIsRangerAuth] = useState(() => {
    try {
      return sessionStorage.getItem('slope_ranger_auth') === 'true';
    } catch {
      return false;
    }
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

  const handleRangerAuthenticated = () => {
    try {
      sessionStorage.setItem('slope_ranger_auth', 'true');
    } catch {}
    setIsRangerAuth(true);
    navigateTo('/ranger');
  };

  // Route 1: SOS Logs Audit Page
  if (currentPath === '/sos-logs' || currentPath.startsWith('/sos-logs')) {
    return (
      <SosLogsPage
        onNavigateToDashboard={() => navigateTo(isRangerAuth ? '/ranger' : '/')}
      />
    );
  }

  // Route 2: Ranger Command View (/ranger or /command)
  if (currentPath === '/ranger' || currentPath === '/command' || currentPath.startsWith('/ranger')) {
    if (!isRangerAuth) {
      return (
        <RangerLoginGate
          onAuthenticated={handleRangerAuthenticated}
          onCancel={() => navigateTo('/')}
        />
      );
    }

    return (
      <Dashboard
        onNavigateToSosLogs={() => navigateTo('/sos-logs')}
        onNavigateToCitizen={() => navigateTo('/')}
      />
    );
  }

  // Route 3: Default Root (/) -> Citizen View (Mobile-First Minimal Panic Interface)
  return (
    <CitizenView
      onNavigateToRanger={() => navigateTo('/ranger')}
    />
  );
}


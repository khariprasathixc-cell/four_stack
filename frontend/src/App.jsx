import React, { useState, useEffect, useRef } from 'react';
import Header from './components/Header';
import ApiKeyBanner from './components/ApiKeyBanner';
import ControlBar from './components/ControlBar';
import RiskMap from './components/RiskMap';
import SidePanel from './components/SidePanel';
import './App.css';

const DEFAULT_API_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8001';

export default function App() {
  const [lat, setLat] = useState('11.5540');
  const [lon, setLon] = useState('76.1306');
  const [radius, setRadius] = useState('3.0');

  const [riskData, setRiskData] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);

  const [health, setHealth] = useState(null);
  const [isBackendConnected, setIsBackendConnected] = useState(false);
  const [activeApiUrl, setActiveApiUrl] = useState(DEFAULT_API_URL);
  const activeApiUrlRef = useRef(DEFAULT_API_URL);

  // Probe backend and load initial assessment on mount
  useEffect(() => {
    discoverBackendAndInit();
  }, []);

  const discoverBackendAndInit = async () => {
    const candidates = Array.from(
      new Set([
        DEFAULT_API_URL,
        'http://localhost:8001',
        'http://127.0.0.1:8001',
        'http://localhost:8000',
        'http://127.0.0.1:8000',
      ])
    ).filter(Boolean);

    let workingUrl = null;

    for (const candidate of candidates) {
      try {
        const res = await fetch(`${candidate}/api/health`, { method: 'GET' });
        if (res.ok) {
          const data = await res.json();
          setHealth(data);
          setIsBackendConnected(true);
          workingUrl = candidate;
          setActiveApiUrl(candidate);
          activeApiUrlRef.current = candidate;
          console.log(`[Slope-to-Rescue] Connected to backend at ${candidate}`);
          break;
        }
      } catch (e) {
        // Candidate not responding, try next
      }
    }

    if (workingUrl) {
      analyzeRisk(parseFloat(lat), parseFloat(lon), parseFloat(radius), workingUrl);
    } else {
      setIsBackendConnected(false);
      setErrorMessage(
        `Backend not reachable at ${DEFAULT_API_URL}. Ensure FastAPI backend is running on port 8001 (or 8000).`
      );
    }
  };

  const analyzeRisk = async (targetLat, targetLon, targetRadius, overrideUrl = null) => {
    setIsLoading(true);
    setErrorMessage(null);
    const baseUrl = overrideUrl || activeApiUrlRef.current || DEFAULT_API_URL;

    try {
      const url = `${baseUrl}/api/risk?lat=${targetLat}&lon=${targetLon}&radius_km=${targetRadius}`;
      const res = await fetch(url);

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.detail || `Server returned error status ${res.status}`);
      }

      const data = await res.json();
      setRiskData(data);
      setIsBackendConnected(true);
    } catch (err) {
      console.error('Error fetching risk analysis:', err);
      setErrorMessage(
        err.message || `Failed to fetch risk analysis from ${baseUrl}. Ensure backend is running on port 8001.`
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="app-layout">
      <Header health={health} isBackendConnected={isBackendConnected} />

      <ApiKeyBanner terrainInfo={riskData?.terrain} />

      <main className="dashboard-content">
        <ControlBar
          lat={lat}
          lon={lon}
          radius={radius}
          setLat={setLat}
          setLon={setLon}
          setRadius={setRadius}
          onAnalyze={(tLat, tLon, tRad) => analyzeRisk(tLat, tLon, tRad)}
          isLoading={isLoading}
        />

        {errorMessage && (
          <div className="error-alert">
            <span className="error-icon">⚠️</span>
            <div className="error-text">
              <strong>Connection Notice:</strong> {errorMessage}
            </div>
            <button
              className="error-retry-btn"
              onClick={() => discoverBackendAndInit()}
            >
              Reconnect
            </button>
          </div>
        )}

        <div className="main-workspace-grid">
          <section className="map-panel-area">
            <RiskMap
              geojsonData={riskData?.geojson}
              centerLat={parseFloat(lat)}
              centerLon={parseFloat(lon)}
              radiusKm={parseFloat(radius)}
            />
          </section>

          <section className="side-panel-area">
            <SidePanel riskData={riskData} isLoading={isLoading} />
          </section>
        </div>
      </main>
    </div>
  );
}

import React, { useState, useEffect, useRef } from 'react';
import Header from './components/Header';
import StatusBar from './components/StatusBar';
import ApiKeyBanner from './components/ApiKeyBanner';
import ControlBar from './components/ControlBar';
import RiskMap from './components/RiskMap';
import SidePanel from './components/SidePanel';
import SosPanel from './components/SosPanel';
import AssistPanel from './components/AssistPanel';
import DispatchLogPanel from './components/DispatchLogPanel';
import PiezoPanel from './components/PiezoPanel';
import CitizenPanicFeed from './components/CitizenPanicFeed';
import BulkBroadcastModal from './components/BulkBroadcastModal';

import { API_BASE } from './config';

const PRESET_NAMES_MAP = {
  '11.5540,76.1306': 'Wayanad, Kerala (High Hazard Zone)',
  '10.0889,77.0595': 'Munnar, Western Ghats',
  '27.0410,88.2663': 'Darjeeling, Himalayas',
};

// Scaling geofence radius according to risk level
function computeGeofenceRadius(riskLevel) {
  if (riskLevel === 'High') return 5.0;
  if (riskLevel === 'Medium') return 3.0;
  return 1.0; // Low
}

export default function Dashboard({ onNavigateToSosLogs, onNavigateToCitizen }) {
  // Navigation tabs: 'predict' | 'sos' | 'assist' | 'dispatch_log' | 'unified'
  const [activeTab, setActiveTab] = useState('predict');
  const [isBulkBroadcastOpen, setIsBulkBroadcastOpen] = useState(false);

  // Coordinates & target zone state (Predict is single source of truth)
  const [lat, setLat] = useState('11.5540');
  const [lon, setLon] = useState('76.1306');
  const [radius, setRadius] = useState('3.0');
  const [currentZoneName, setCurrentZoneName] = useState('Wayanad, Kerala (High Hazard Zone)');

  // Risk data & loading state
  const [riskData, setRiskData] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);

  // Persistent SOS Dispatch Log State (loaded from localStorage)
  const [sosLogs, setSosLogs] = useState(() => {
    try {
      const saved = localStorage.getItem('slope_to_rescue_sos_logs');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const handleAddSosLog = (newEntry) => {
    setSosLogs((prev) => {
      const updated = [newEntry, ...prev];
      try {
        localStorage.setItem('slope_to_rescue_sos_logs', JSON.stringify(updated));
      } catch (e) {
        console.warn('Could not persist logs to localStorage:', e);
      }
      return updated;
    });
  };

  const handleClearSosLogs = () => {
    setSosLogs([]);
    try {
      localStorage.removeItem('slope_to_rescue_sos_logs');
    } catch (e) {}
  };

  // Cross-panel states
  const [userGps, setUserGps] = useState(null);
  const [sosState, setSosState] = useState('armed'); // 'armed' | 'dispatched' | 'standby'
  const [cameraState, setCameraState] = useState('monitoring'); // 'monitoring' | 'alert' | 'standby'
  const [cameraMotionLevel, setCameraMotionLevel] = useState(0);
  const [piezoState, setPiezoState] = useState('standby'); // 'standby' | 'monitoring' | 'alert'

  // Backend connectivity
  const [health, setHealth] = useState(null);
  const [isBackendConnected, setIsBackendConnected] = useState(false);
  const activeApiUrl = API_BASE;

  // Fused risk level and derived geofence radius
  const overallRisk = riskData?.overall_risk || 'High';
  const geofenceRadiusKm = computeGeofenceRadius(overallRisk);

  // Discover backend and load initial assessment on mount
  useEffect(() => {
    discoverBackendAndInit();
  }, []);

  const fetchServerLogs = async () => {
    try {
      const res = await fetch(`${API_BASE}/sos-logs`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
          setSosLogs((prev) => {
            const idMap = new Map();
            data.forEach((d) => idMap.set(d.id || d.message_id || d.messageId, d));
            prev.forEach((p) => {
              const k = p.id || p.message_id || p.messageId;
              if (!idMap.has(k)) idMap.set(k, p);
            });
            const merged = Array.from(idMap.values()).sort(
              (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
            );
            try {
              localStorage.setItem('slope_to_rescue_sos_logs', JSON.stringify(merged));
            } catch {}
            return merged;
          });
        }
      }
    } catch (e) {
      console.warn('Failed to fetch initial server logs:', e);
    }
  };

  const discoverBackendAndInit = async () => {
    try {
      const res = await fetch(`${API_BASE}/health`);
      if (res.ok) {
        const data = await res.json();
        setHealth(data);
        setIsBackendConnected(true);
        console.log(`[Slope-to-Rescue] Connected to backend API at ${API_BASE}`);
        analyzeRisk(parseFloat(lat), parseFloat(lon), parseFloat(radius));
        fetchServerLogs();
        return;
      }
    } catch (e) {
      console.warn(`Health check at ${API_BASE} failed:`, e);
    }

    // Try risk analysis directly even if health check had a transient issue
    try {
      await analyzeRisk(parseFloat(lat), parseFloat(lon), parseFloat(radius));
      setIsBackendConnected(true);
      fetchServerLogs();
    } catch (err) {
      setIsBackendConnected(false);
      setErrorMessage(
        `Backend API not reachable at ${API_BASE}. Ensure backend service is running.`
      );
    }
  };

  // Single source of truth for risk assessment
  const analyzeRisk = async (targetLat, targetLon, targetRadius) => {
    setIsLoading(true);
    setErrorMessage(null);

    // Detect if preset
    const key = `${targetLat.toFixed(4)},${targetLon.toFixed(4)}`;
    const matchedName = PRESET_NAMES_MAP[key] || `Zone ${targetLat.toFixed(2)}°, ${targetLon.toFixed(2)}°`;
    setCurrentZoneName(matchedName);

    try {
      const url = `${API_BASE}/risk?lat=${targetLat}&lon=${targetLon}&radius_km=${targetRadius}`;
      const res = await fetch(url);

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.detail || `Server returned error status ${res.status}`);
      }

      const data = await res.json();
      setRiskData(data);
      setIsBackendConnected(true);
      // Reset SOS dispatched state on new analysis
      setSosState('armed');
    } catch (err) {
      console.error('Error fetching risk analysis:', err);
      setErrorMessage(
        err.message || `Failed to fetch risk analysis from ${API_BASE}/risk.`
      );
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  const handleCameraStateChange = (status, motionPct) => {
    setCameraState(status);
    setCameraMotionLevel(motionPct);
  };

  return (
    <div className="app-layout unified-dashboard-layout">
      {/* 1. Master Header with Live Connectivity */}
      <Header
        health={health}
        isBackendConnected={isBackendConnected}
        piezoState={piezoState}
        cameraState={cameraState}
        onOpenBulkBroadcast={() => setIsBulkBroadcastOpen(true)}
        onNavigateToCitizen={onNavigateToCitizen}
      />

      {/* Bulk Broadcast Modal (Ranger Command Tool) */}
      <BulkBroadcastModal
        isOpen={isBulkBroadcastOpen}
        onClose={() => setIsBulkBroadcastOpen(false)}
        activeZoneName={currentZoneName}
        riskLevel={overallRisk}
        geofenceRadiusKm={geofenceRadiusKm}
        onBroadcastSuccess={fetchServerLogs}
      />

      {/* 2. Persistent Top-Level Combined System Status Bar */}
      <StatusBar
        activePanel={activeTab}
        zoneName={currentZoneName}
        lat={parseFloat(lat)}
        lon={parseFloat(lon)}
        riskLevel={overallRisk}
        geofenceRadius={geofenceRadiusKm}
        sosState={sosState}
        cameraState={cameraState}
        motionLevel={cameraMotionLevel}
        piezoState={piezoState}
        isBackendConnected={isBackendConnected}
      />

      {/* 3. API Key / Mock Notice Banner */}
      <ApiKeyBanner isMock={riskData?.is_mock} terrainInfo={riskData?.terrain} />

      {/* 4. Unified Tab Navigation Header */}
      <nav className="dashboard-nav-tabs" aria-label="Command Panels">
        <button
          className={`nav-tab-btn ${activeTab === 'predict' ? 'active' : ''}`}
          onClick={() => setActiveTab('predict')}
        >
          <span className="tab-icon">🛰️</span>
          <span className="tab-text">1. Predict Panel</span>
          <span className="tab-pill">Risk Engine</span>
        </button>

        <button
          className={`nav-tab-btn ${activeTab === 'detect' ? 'active' : ''}`}
          onClick={() => setActiveTab('detect')}
        >
          <span className="tab-icon">⚡</span>
          <span className="tab-text">2. Detect Panel</span>
          <span className={`tab-pill ${piezoState === 'alert' ? 'alert' : ''}`}>
            {piezoState === 'alert' ? 'CRACK DETECTED' : 'Piezo Mic-In'}
          </span>
        </button>

        <button
          className={`nav-tab-btn ${activeTab === 'sos' ? 'active' : ''}`}
          onClick={() => setActiveTab('sos')}
        >
          <span className="tab-icon">🚨</span>
          <span className="tab-text">3. SOS Panel</span>
          <span className="tab-pill danger">Geofence ({geofenceRadiusKm}km)</span>
        </button>

        <button
          className={`nav-tab-btn ${activeTab === 'assist' ? 'active' : ''}`}
          onClick={() => setActiveTab('assist')}
        >
          <span className="tab-icon">📹</span>
          <span className="tab-text">4. Assist Panel</span>
          <span className={`tab-pill ${cameraState === 'alert' ? 'alert' : ''}`}>
            Camera Vision
          </span>
        </button>

        <button
          className={`nav-tab-btn ${activeTab === 'dispatch_log' ? 'active' : ''}`}
          onClick={() => setActiveTab('dispatch_log')}
        >
          <span className="tab-icon">📋</span>
          <span className="tab-text">5. SOS Audit Log</span>
          <span className="tab-pill">{sosLogs.length}</span>
        </button>

        <button
          className={`nav-tab-btn unified-tab-btn ${activeTab === 'unified' ? 'active' : ''}`}
          onClick={() => setActiveTab('unified')}
        >
          <span className="tab-icon">🎛️</span>
          <span className="tab-text">Unified View</span>
        </button>
      </nav>

      {/* 5. Main Content Area */}
      <main className="dashboard-content">
        {/* Preset & Coordinate Controls always accessible */}
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

        {/* Panel 1: Predict (Map + Gauges & Terrain Metrics + Citizen Panic Feed) */}
        {activeTab === 'predict' && (
          <div className="main-workspace-grid predict-view">
            <section className="map-panel-area">
              <RiskMap
                geojsonData={riskData?.geojson}
                sensors={riskData?.sensors}
                piezoState={piezoState}
                rainfallData={riskData?.rainfall}
                centerLat={parseFloat(lat)}
                centerLon={parseFloat(lon)}
                radiusKm={parseFloat(radius)}
                geofenceRadiusKm={geofenceRadiusKm}
                showGeofence={false}
                riskLevel={overallRisk}
                userGps={userGps}
                zoneName={currentZoneName}
              />
            </section>

            <section className="side-panel-area" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <SidePanel riskData={riskData} isLoading={isLoading} piezoState={piezoState} />
              <CitizenPanicFeed
                onSelectCoordinates={(pLat, pLon, pName) => {
                  setUserGps({
                    lat: pLat,
                    lon: pLon,
                    isInside: true,
                    distanceKm: 0.35,
                    accuracyM: 10,
                  });
                }}
              />
            </section>
          </div>
        )}

        {/* Panel 2: Detect (27mm Piezo Contact Sensor via 3.5mm Mic Jack) */}
        {activeTab === 'detect' && (
          <div className="detect-view-container">
            <PiezoPanel
              zoneName={currentZoneName}
              onPiezoStateChange={setPiezoState}
            />
          </div>
        )}

        {/* Panel 3: SOS (Shared Map with Geofence Danger Circle + SOS Dispatcher) */}
        {activeTab === 'sos' && (
          <div className="main-workspace-grid sos-view">
            <section className="map-panel-area">
              <RiskMap
                geojsonData={riskData?.geojson}
                sensors={riskData?.sensors}
                piezoState={piezoState}
                rainfallData={riskData?.rainfall}
                centerLat={parseFloat(lat)}
                centerLon={parseFloat(lon)}
                radiusKm={parseFloat(radius)}
                geofenceRadiusKm={geofenceRadiusKm}
                showGeofence={true}
                riskLevel={overallRisk}
                userGps={userGps}
                zoneName={currentZoneName}
              />
            </section>

            <section className="side-panel-area">
              <SosPanel
                zoneName={currentZoneName}
                centerLat={parseFloat(lat)}
                centerLon={parseFloat(lon)}
                riskLevel={overallRisk}
                geofenceRadiusKm={geofenceRadiusKm}
                activeApiUrl={activeApiUrl}
                onUserGpsUpdate={setUserGps}
                onSosStateChange={setSosState}
                onAddLog={handleAddSosLog}
                onNavigateToLog={() => setActiveTab('dispatch_log')}
              />
            </section>
          </div>
        )}

        {/* Panel 4: Assist (Rear Camera Continuous Optical Displacement Differencing) */}
        {activeTab === 'assist' && (
          <div className="assist-view-container">
            <AssistPanel
              zoneName={currentZoneName}
              centerLat={parseFloat(lat)}
              centerLon={parseFloat(lon)}
              riskLevel={overallRisk}
              activeApiUrl={activeApiUrl}
              onCameraStateChange={handleCameraStateChange}
            />
          </div>
        )}

        {/* Panel 5: SOS Dispatch Log History */}
        {activeTab === 'dispatch_log' && (
          <div className="dispatch-log-view-container">
            <div className="dispatch-log-dedicated-banner">
              <div className="banner-text">
                <span className="banner-icon">🔗</span>
                <span>Direct judge & audit ledger route available at <code>/sos-logs</code></span>
              </div>
              <button
                type="button"
                className="btn-open-dedicated"
                onClick={() => onNavigateToSosLogs ? onNavigateToSosLogs() : (window.location.href = '/sos-logs')}
              >
                Open Dedicated /sos-logs Page ↗
              </button>
            </div>
            <DispatchLogPanel
              logs={sosLogs}
              onClearLogs={handleClearSosLogs}
              onNavigateToSos={() => setActiveTab('sos')}
            />
          </div>
        )}

        {/* Panel 6: Unified Command View (Side-by-Side Map + SOS & Detect & Assist) */}
        {activeTab === 'unified' && (
          <div className="unified-grid-all">
            <div className="unified-map-column">
              <RiskMap
                geojsonData={riskData?.geojson}
                sensors={riskData?.sensors}
                piezoState={piezoState}
                rainfallData={riskData?.rainfall}
                centerLat={parseFloat(lat)}
                centerLon={parseFloat(lon)}
                radiusKm={parseFloat(radius)}
                geofenceRadiusKm={geofenceRadiusKm}
                showGeofence={true}
                riskLevel={overallRisk}
                userGps={userGps}
                zoneName={currentZoneName}
              />
            </div>

            <div className="unified-companion-column">
              <PiezoPanel
                zoneName={currentZoneName}
                onPiezoStateChange={setPiezoState}
              />

              <SosPanel
                zoneName={currentZoneName}
                centerLat={parseFloat(lat)}
                centerLon={parseFloat(lon)}
                riskLevel={overallRisk}
                geofenceRadiusKm={geofenceRadiusKm}
                activeApiUrl={activeApiUrl}
                onUserGpsUpdate={setUserGps}
                onSosStateChange={setSosState}
                onAddLog={handleAddSosLog}
                onNavigateToLog={() => setActiveTab('dispatch_log')}
              />

              <AssistPanel
                zoneName={currentZoneName}
                centerLat={parseFloat(lat)}
                centerLon={parseFloat(lon)}
                riskLevel={overallRisk}
                activeApiUrl={activeApiUrl}
                onCameraStateChange={handleCameraStateChange}
              />
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

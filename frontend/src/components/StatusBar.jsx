import React from 'react';

export default function StatusBar({
  activePanel,
  zoneName,
  lat,
  lon,
  riskLevel,
  geofenceRadius,
  sosState,
  cameraState,
  motionLevel,
  isBackendConnected,
}) {
  const riskClass =
    riskLevel === 'High' ? 'pill-high' : riskLevel === 'Medium' ? 'pill-med' : 'pill-low';

  const sosClass =
    sosState === 'dispatched'
      ? 'pill-dispatched'
      : sosState === 'armed'
      ? 'pill-armed'
      : 'pill-standby';

  const cameraClass =
    cameraState === 'alert'
      ? 'pill-motion-alert'
      : cameraState === 'monitoring'
      ? 'pill-monitoring'
      : 'pill-standby';

  return (
    <div className="persistent-status-bar" id="system-status-bar">
      <div className="status-bar-container">
        {/* System Active Badge */}
        <div className="status-bar-section active-panel-indicator">
          <span className="status-indicator-dot online"></span>
          <span className="status-section-label">SYSTEM STATE:</span>
          <span className="status-active-badge">
            {activePanel === 'predict' && '🛰️ Phase 1: Predict (Active)'}
            {activePanel === 'sos' && '🚨 Phase 2: SOS Geofence (Active)'}
            {activePanel === 'assist' && '📹 Phase 3: Assist Vision (Active)'}
            {activePanel === 'unified' && '🎛️ Unified Command (All Active)'}
          </span>
        </div>

        {/* Combined Telemetry Metrics */}
        <div className="status-bar-telemetry">
          {/* 1. Zone & Risk */}
          <div className="telemetry-item" title="Target Zone & Fused Risk">
            <span className="telemetry-label">Zone:</span>
            <span className={`telemetry-value ${riskClass}`}>
              {zoneName || 'Custom'} ({riskLevel || 'Evaluating...'})
            </span>
          </div>

          {/* 2. SOS Geofence */}
          <div className="telemetry-item" title="SOS Geofence Hazard Perimeter">
            <span className="telemetry-label">SOS:</span>
            <span className={`telemetry-value ${sosClass}`}>
              {sosState === 'dispatched'
                ? '⚡ Alert Dispatched'
                : `🛡️ Armed (${geofenceRadius}km Geofence)`}
            </span>
          </div>

          {/* 3. Camera Assist */}
          <div className="telemetry-item" title="Optical Displacement Detection">
            <span className="telemetry-label">Camera:</span>
            <span className={`telemetry-value ${cameraClass}`}>
              {cameraState === 'alert'
                ? `⚠️ DISPLACEMENT (${motionLevel}%)`
                : cameraState === 'monitoring'
                ? '🟢 Monitoring'
                : '⚪ Standby'}
            </span>
          </div>

          {/* 4. Engine Connectivity */}
          <div className="telemetry-item engine-item">
            <span className="telemetry-label">Engine:</span>
            <span className="telemetry-value">
              {isBackendConnected ? (
                <span className="engine-online">🟢 Online</span>
              ) : (
                <span className="engine-offline">🔴 Offline</span>
              )}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

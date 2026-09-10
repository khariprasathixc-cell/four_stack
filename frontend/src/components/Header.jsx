import React from 'react';

export default function Header({ health, isBackendConnected }) {
  return (
    <header className="app-header">
      <div className="brand-group">
        <div className="brand-logo">⛰️</div>
        <div>
          <div className="brand-title-row">
            <h1 className="brand-title">Slope-to-Rescue</h1>
            <span className="phase-pill">Phase 1: Predict</span>
          </div>
          <p className="brand-subtitle">
            Early Warning Landslide Intelligence • Terrain Topography & Precipitation Fusion
          </p>
        </div>
      </div>

      <div className="header-actions">
        <div className="status-indicators">
          <div className="status-item">
            <span
              className={`status-dot ${isBackendConnected ? 'online' : 'offline'}`}
            ></span>
            <span className="status-label">
              {isBackendConnected ? 'Engine Live' : 'Backend Offline'}
            </span>
          </div>

          <div className="module-badges">
            <span className="module-tag active" title="Phase 1 Active">
              Predict: Active
            </span>
            <span className="module-tag standby" title="Phase 2 Planned: Piezoelectric Edge Telemetry">
              Detect: Standby
            </span>
            <span className="module-tag standby" title="Phase 3 Planned: Thermal & CV Rescue Assist">
              Assist: Standby
            </span>
          </div>
        </div>
      </div>
    </header>
  );
}

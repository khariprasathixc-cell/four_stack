import React from 'react';

export default function Header({
  health,
  isBackendConnected,
  piezoState = 'standby',
  cameraState = 'standby',
}) {
  return (
    <header className="app-header">
      <div className="brand-group">
        <div className="brand-logo">⛰️</div>
        <div>
          <div className="brand-title-row">
            <h1 className="brand-title">Slope-to-Rescue</h1>
            <span className="phase-pill">End-to-End Early Warning System</span>
          </div>
          <p className="brand-subtitle">
            Early Warning Landslide Intelligence • Acoustic Micro-Crack Detection & Rapid SOS Rescue
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
            <span className="module-tag active" title="Phase 1: Risk Engine Active">
              Predict: Active
            </span>
            <span
              className={`module-tag ${piezoState === 'alert' ? 'alert' : piezoState === 'monitoring' ? 'active' : 'standby'}`}
              title="Phase 2: 27mm Piezoelectric Contact Acoustic Telemetry (3.5mm Mic-In)"
            >
              Detect: {piezoState === 'alert' ? 'Crack Alert!' : piezoState === 'monitoring' ? 'Monitoring' : 'Standby'}
            </span>
            <span
              className={`module-tag ${cameraState === 'alert' ? 'alert' : cameraState === 'monitoring' ? 'active' : 'standby'}`}
              title="Phase 4: Optical Displacement Rescue Assist"
            >
              Assist: {cameraState === 'alert' ? 'Motion Alert!' : cameraState === 'monitoring' ? 'Active' : 'Standby'}
            </span>
          </div>
        </div>
      </div>
    </header>
  );
}

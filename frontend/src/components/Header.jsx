import React from 'react';

export default function Header({
  health,
  isBackendConnected,
  piezoState = 'standby',
  cameraState = 'standby',
  onOpenBulkBroadcast,
  onNavigateToCitizen,
}) {
  return (
    <header className="app-header">
      <div className="brand-group">
        <div className="brand-logo">⛰️</div>
        <div>
          <div className="brand-title-row">
            <h1 className="brand-title">Slope-to-Rescue</h1>
            <span className="phase-pill">Ranger Command Center</span>
          </div>
          <p className="brand-subtitle">
            Early Warning Landslide Intelligence • Distributed Sensor Grid • Citizen Rescue Dispatch
          </p>
        </div>
      </div>

      <div className="header-actions">
        {onOpenBulkBroadcast && (
          <button
            type="button"
            className="btn-cam-action danger"
            onClick={onOpenBulkBroadcast}
            style={{ fontWeight: 700, padding: '7px 14px', borderRadius: '8px' }}
            title="Dispatch emergency bulk SMS evacuation broadcast to all citizens in danger zone"
          >
            📢 Bulk SMS Broadcast
          </button>
        )}

        {onNavigateToCitizen && (
          <button
            type="button"
            className="role-switch-header-btn"
            onClick={onNavigateToCitizen}
            title="Switch to Mobile-First Citizen Safety View"
          >
            📱 Citizen Mobile Portal
          </button>
        )}

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

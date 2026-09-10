import React, { useState } from 'react';

// Haversine formula to compute great-circle distance in km
function calculateHaversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export default function SosPanel({
  zoneName,
  centerLat,
  centerLon,
  riskLevel = 'High',
  geofenceRadiusKm = 5.0,
  activeApiUrl,
  onUserGpsUpdate,
  onSosStateChange,
  onAddLog,
  onNavigateToLog,
}) {
  const [phoneNumber, setPhoneNumber] = useState('+91 98765 43210');
  const [gpsStatus, setGpsStatus] = useState(null); // { lat, lon, distanceKm, isInside }
  const [gpsError, setGpsError] = useState(null);
  const [isVerifyingGps, setIsVerifyingGps] = useState(false);

  const [isSendingAlert, setIsSendingAlert] = useState(false);
  const [alertResult, setAlertResult] = useState(null);
  const [alertError, setAlertError] = useState(null);

  // Trigger GPS verification
  const handleVerifyGps = () => {
    setIsVerifyingGps(true);
    setGpsError(null);

    if (!navigator.geolocation) {
      setGpsError('Geolocation is not supported by this browser. Try the simulation buttons.');
      setIsVerifyingGps(false);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const uLat = position.coords.latitude;
        const uLon = position.coords.longitude;
        const dist = calculateHaversineDistance(uLat, uLon, centerLat, centerLon);
        const inside = dist <= geofenceRadiusKm;

        const res = {
          lat: uLat,
          lon: uLon,
          distanceKm: dist,
          isInside: inside,
          verifiedAt: new Date().toLocaleTimeString(),
        };
        setGpsStatus(res);
        setIsVerifyingGps(false);
        if (onUserGpsUpdate) onUserGpsUpdate(res);
      },
      (err) => {
        console.warn('Geolocation failed, offering fallback simulation:', err);
        setGpsError(`GPS Access Notice: ${err.message || 'Permission denied'}. You can use "Simulate Inside Zone" for evaluation.`);
        setIsVerifyingGps(false);
      },
      { timeout: 10000, enableHighAccuracy: true }
    );
  };

  // Simulation helpers for testing without GPS hardware
  const handleSimulateInside = () => {
    // 0.8 km offset from epicenter
    const simLat = centerLat + 0.005;
    const simLon = centerLon + 0.005;
    const dist = calculateHaversineDistance(simLat, simLon, centerLat, centerLon);
    const res = {
      lat: simLat,
      lon: simLon,
      distanceKm: dist,
      isInside: true,
      isSimulated: true,
      verifiedAt: new Date().toLocaleTimeString(),
    };
    setGpsStatus(res);
    setGpsError(null);
    if (onUserGpsUpdate) onUserGpsUpdate(res);
  };

  const handleSimulateOutside = () => {
    // 15 km offset from epicenter
    const simLat = centerLat + 0.12;
    const simLon = centerLon + 0.12;
    const dist = calculateHaversineDistance(simLat, simLon, centerLat, centerLon);
    const res = {
      lat: simLat,
      lon: simLon,
      distanceKm: dist,
      isInside: false,
      isSimulated: true,
      verifiedAt: new Date().toLocaleTimeString(),
    };
    setGpsStatus(res);
    setGpsError(null);
    if (onUserGpsUpdate) onUserGpsUpdate(res);
  };

  // Dispatch SOS Alert to /api/send-alert
  const handleSendAlert = async () => {
    if (!phoneNumber || phoneNumber.trim().length < 8) {
      setAlertError('Please provide a valid recipient telephone number.');
      return;
    }

    setIsSendingAlert(true);
    setAlertError(null);
    setAlertResult(null);

    try {
      const payload = {
        phone: phoneNumber.trim(),
        zoneName: zoneName || 'Current Zone',
        riskLevel: riskLevel || 'High',
        lat: centerLat,
        lon: centerLon,
        geofenceRadiusKm: geofenceRadiusKm,
        userDistanceKm: gpsStatus ? gpsStatus.distanceKm : null,
      };

      const res = await fetch(`${activeApiUrl}/api/send-alert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || `Server responded with status ${res.status}`);
      }

      if (data.success === false) {
        setAlertError(data.error || 'Failed to dispatch SMS through MSG91');
        return;
      }

      setAlertResult(data);
      if (onSosStateChange) onSosStateChange('dispatched');

      // Record entry in SOS Dispatch Log
      if (onAddLog) {
        onAddLog({
          id: `log_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
          timestamp: data.timestamp || new Date().toISOString(),
          phone: data.phone || phoneNumber.trim(),
          zoneName: data.zoneName || zoneName,
          riskLevel: data.riskLevel || riskLevel,
          geofenceRadiusKm: Number(data.geofenceRadiusKm || geofenceRadiusKm),
          userDistanceKm: gpsStatus ? gpsStatus.distanceKm : null,
          mode: data.mode || 'mock',
          messageId: data.messageId || 'MSG91-CONFIRMED',
          alertBody: data.alertBody,
        });
      }
    } catch (err) {
      console.error('Failed to send SOS alert:', err);
      setAlertError(err.message || 'Network error dispatching SOS alert. Ensure backend is running.');
    } finally {
      setIsSendingAlert(false);
    }
  };

  const isDangerActive = riskLevel === 'High' || (gpsStatus && gpsStatus.isInside);

  return (
    <div className="sos-panel-wrapper" id="sos-panel-section">
      {/* 1. Geofence Perimeter Overview */}
      <section className="sos-hero-card">
        <div className="sos-header-row">
          <div className="sos-title-group">
            <span className="sos-icon">🛡️</span>
            <div>
              <h3>Automated Hazard Geofence</h3>
              <p className="sos-sub">Dynamic safety perimeter scaled to active terrain risk</p>
            </div>
          </div>
          <div className="geofence-badge-pill">
            <span className="geofence-radius-num">{geofenceRadiusKm.toFixed(1)} km</span>
            <span className="geofence-radius-label">Perimeter Radius</span>
          </div>
        </div>

        <div className="geofence-params-grid">
          <div className="param-item">
            <span className="param-label">Geofence Center</span>
            <span className="param-val">{zoneName || 'Target Center'}</span>
          </div>
          <div className="param-item">
            <span className="param-label">Coordinates</span>
            <span className="param-val">
              {centerLat.toFixed(4)}°, {centerLon.toFixed(4)}°
            </span>
          </div>
          <div className="param-item">
            <span className="param-label">Risk Severity Scale</span>
            <span className={`param-val risk-tag-${riskLevel.toLowerCase()}`}>
              {riskLevel} Risk ({geofenceRadiusKm}km)
            </span>
          </div>
        </div>
      </section>

      {/* 2. Critical Danger Banner & Clickable Emergency Helplines */}
      {isDangerActive && (
        <section className="danger-alert-banner">
          <div className="banner-alert-header">
            <span className="alert-pulse-icon">🚨</span>
            <div>
              <h4>CRITICAL HAZARD ZONE: IMMEDIATE EVACUATION RECOMMENDED</h4>
              <p>
                {gpsStatus && gpsStatus.isInside
                  ? `Your verified position is inside the ${geofenceRadiusKm}km danger perimeter (${gpsStatus.distanceKm.toFixed(2)}km from epicenter).`
                  : `Zone "${zoneName}" is evaluated at High Landslide Hazard. Armed geofence active.`}
              </p>
            </div>
          </div>

          <div className="emergency-links-bar">
            <span className="emergency-links-title">Tap to Call Emergency Services:</span>
            <div className="emergency-buttons-row">
              <a href="tel:112" className="emergency-link-btn primary" title="Unified Emergency">
                📞 112 (National Emergency)
              </a>
              <a href="tel:1078" className="emergency-link-btn ndrf" title="NDRF Disaster Management">
                🚒 1078 (Disaster / NDRF)
              </a>
              <a href="tel:108" className="emergency-link-btn ambulance" title="Medical Rescue">
                🚑 108 (Ambulance)
              </a>
              <a href="tel:100" className="emergency-link-btn police" title="Police Emergency">
                👮 100 (Police)
              </a>
            </div>
          </div>
        </section>
      )}

      {/* 3. Real-Time GPS Verification Section */}
      <section className="sos-card gps-verification-card">
        <div className="card-header-compact">
          <h4>📍 Real-Time GPS Verification</h4>
          <span className="card-sub-hint">Determine proximity to landslide epicenter</span>
        </div>

        <div className="gps-actions-row">
          <button
            type="button"
            className="btn-gps-verify"
            onClick={handleVerifyGps}
            disabled={isVerifyingGps}
          >
            {isVerifyingGps ? '📡 Interrogating Device GPS...' : '📍 Verify My GPS Location'}
          </button>

          <div className="gps-simulation-group">
            <span className="sim-hint">Simulate for evaluation:</span>
            <button
              type="button"
              className="btn-sim-toggle inside"
              onClick={handleSimulateInside}
              title="Test user inside danger zone"
            >
              Simulate Inside (&lt;1km)
            </button>
            <button
              type="button"
              className="btn-sim-toggle outside"
              onClick={handleSimulateOutside}
              title="Test user safe outside zone"
            >
              Simulate Outside (15km)
            </button>
          </div>
        </div>

        {gpsError && <div className="gps-error-notice">⚠️ {gpsError}</div>}

        {gpsStatus && (
          <div className={`gps-result-box ${gpsStatus.isInside ? 'breach' : 'safe'}`}>
            <div className="result-header">
              <span className="result-badge">
                {gpsStatus.isInside ? '⚠️ HAZARD BREACH' : '✅ SAFE PERIMETER'}
              </span>
              <span className="result-time">Verified at {gpsStatus.verifiedAt}</span>
            </div>
            <div className="result-metrics">
              <div>
                Device Location: <strong>{gpsStatus.lat.toFixed(4)}°, {gpsStatus.lon.toFixed(4)}°</strong>
              </div>
              <div>
                Distance from Epicenter:{' '}
                <strong>{gpsStatus.distanceKm.toFixed(2)} km</strong> (Geofence Threshold: {geofenceRadiusKm} km)
              </div>
            </div>
          </div>
        )}
      </section>

      {/* 4. SOS Emergency SMS Dispatcher */}
      <section className="sos-card sms-dispatch-card">
        <div className="card-header-compact">
          <h4>📱 Emergency SOS Broadcast Trigger</h4>
          <span className="card-sub-hint">Dispatches SMS alert via /api/send-alert (MSG91 / Mock)</span>
        </div>

        <div className="phone-input-group">
          <label htmlFor="sos-phone-input">Recipient Emergency Mobile Number:</label>
          <div className="phone-input-wrapper">
            <input
              id="sos-phone-input"
              type="tel"
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
              placeholder="e.g. +91 98765 43210"
              className="phone-input-field"
            />
            <button
              type="button"
              className="btn-dispatch-sos"
              onClick={handleSendAlert}
              disabled={isSendingAlert}
            >
              {isSendingAlert ? '⚡ Dispatched SMS...' : '🚨 Trigger /api/send-alert'}
            </button>
          </div>

          <div className="phone-presets-row">
            <span className="phone-presets-label">Quick Contacts:</span>
            <button
              type="button"
              className="phone-chip"
              onClick={() => setPhoneNumber('+91 98765 43210')}
            >
              Responder Team 1
            </button>
            <button
              type="button"
              className="phone-chip"
              onClick={() => setPhoneNumber('+91 94471 23456')}
            >
              District Warden
            </button>
            <button
              type="button"
              className="phone-chip"
              onClick={() => setPhoneNumber('+1 206 555 0199')}
            >
              Emergency Command
            </button>
          </div>
        </div>

        {alertError && <div className="alert-error-box">❌ {alertError}</div>}

        {alertResult && (
          <div className="alert-success-receipt">
            <div className="receipt-header">
              <span className="receipt-icon">✅</span>
              <div>
                <strong>SOS Alert Successfully Dispatched</strong>
                <div className="receipt-sub">
                  Mode: <code>{alertResult.mode}</code> | Message ID: <code>{alertResult.messageId || 'MSG91-CONFIRMED'}</code>
                </div>
              </div>
            </div>

            <div className="receipt-body">
              <div className="sms-preview-label">SMS Content Transmitted:</div>
              <blockquote className="sms-preview-text">{alertResult.alertBody}</blockquote>
              <div className="receipt-meta">
                <span>Recipient: <strong>{alertResult.phone}</strong></span>
                <span>Time: <strong>{new Date(alertResult.timestamp).toLocaleString()}</strong></span>
              </div>
              {alertResult.mockNote && (
                <div className="mock-note-badge">ℹ️ {alertResult.mockNote}</div>
              )}
              {onNavigateToLog && (
                <div className="receipt-action-row">
                  <button
                    type="button"
                    className="btn-view-log-shortcut"
                    onClick={onNavigateToLog}
                  >
                    📋 View All Dispatches in Log ➔
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

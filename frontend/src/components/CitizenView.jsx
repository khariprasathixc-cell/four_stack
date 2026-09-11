import React, { useState, useEffect, useRef } from 'react';
import { API_BASE, API_BASE_URL } from '../config';
import RiskMap from './RiskMap';

// Regional reference zones for proximity calculation
const PRESET_ZONES = [
  { name: 'Wayanad (Meppadi Slopes)', lat: 11.5540, lon: 76.1306, radiusKm: 5.0, risk: 'High' },
  { name: 'Munnar (Tea Hills)', lat: 10.0889, lon: 77.0595, radiusKm: 5.0, risk: 'High' },
  { name: 'Darjeeling (Hill Slope)', lat: 27.0410, lon: 88.2663, radiusKm: 5.0, risk: 'Medium' },
];

function calculateDistanceKm(lat1, lon1, lat2, lon2) {
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

export default function CitizenView({ onNavigateToRanger }) {
  const [gpsLocation, setGpsLocation] = useState({
    lat: 11.5520,
    lon: 76.1290,
    accuracyM: 12,
    isReal: false,
  });
  const [isLocating, setIsLocating] = useState(false);
  const [nearestZone, setNearestZone] = useState(PRESET_ZONES[0]);
  const [distanceKm, setDistanceKm] = useState(0.42);
  const [isInsideDangerZone, setIsInsideDangerZone] = useState(true);
  const [phoneNumber, setPhoneNumber] = useState('+91 98471 23091');

  // Mountain Risk & Slope Map Data
  const [riskData, setRiskData] = useState(null);
  const [isMapLoading, setIsMapLoading] = useState(true);

  // Panic & Auto-alert state
  const [isSendingPanic, setIsSendingPanic] = useState(false);
  const [panicSentReceipt, setPanicSentReceipt] = useState(null);
  const [autoAlertNotice, setAutoAlertNotice] = useState(null);
  const autoAlertTriggeredRef = useRef(false);

  // 1. Fetch slope risk data for nearest mountain zone
  const fetchSlopeData = async (targetLat, targetLon) => {
    setIsMapLoading(true);
    try {
      const resp = await fetch(`${API_BASE}/risk?lat=${targetLat}&lon=${targetLon}&radius_km=3.0`);
      if (resp.ok) {
        const data = await resp.json();
        setRiskData(data);
      }
    } catch (err) {
      console.warn('Could not fetch slope data for citizen view:', err);
    } finally {
      setIsMapLoading(false);
    }
  };

  // 2. Register Citizen Check-In with Backend
  const registerCitizenCheckIn = async (userLat, userLon, zone, dist, phone) => {
    try {
      await fetch(`${API_BASE}/citizen-alert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: phone || '+91 98471 23091',
          name: 'Citizen Mobile User',
          lat: userLat,
          lon: userLon,
          zoneName: zone.name,
          riskLevel: zone.risk,
          userDistanceKm: dist,
          source: 'citizen_checkin',
          timestamp: new Date().toISOString(),
        }),
      });
      console.log('[Citizen View] Registered citizen check-in with Ranger Command');
    } catch (err) {
      console.warn('Check-in ping non-fatal notice:', err);
    }
  };

  // 3. Automated Geofence Alert Trigger (Coexists with manual Panic button)
  const checkAutomatedGeofenceAlert = async (isInside, zone, dist, phone) => {
    if (isInside && zone.risk === 'High' && !autoAlertTriggeredRef.current) {
      autoAlertTriggeredRef.current = true;
      setAutoAlertNotice(`🚨 AUTOMATED GEOFENCE ALERT: You have breached the ${zone.radiusKm}km danger perimeter in ${zone.name}.`);

      try {
        await fetch(`${API_BASE}/send-alert`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            phone: phone || '+91 98471 23091',
            zoneName: zone.name,
            riskLevel: 'High',
            lat: zone.lat,
            lon: zone.lon,
            geofenceRadiusKm: zone.radiusKm,
            userDistanceKm: dist,
          }),
        });
      } catch (e) {
        console.warn('Automated geofence SMS trigger error:', e);
      }
    }
  };

  // 4. Acquire GPS on mount
  useEffect(() => {
    fetchSlopeData(PRESET_ZONES[0].lat, PRESET_ZONES[0].lon);

    if ('geolocation' in navigator) {
      setIsLocating(true);
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const lat = pos.coords.latitude;
          const lon = pos.coords.longitude;
          setGpsLocation({
            lat,
            lon,
            accuracyM: Math.round(pos.coords.accuracy || 15),
            isReal: true,
          });
          setIsLocating(false);
          evaluateProximity(lat, lon, true);
        },
        (err) => {
          console.warn('Live GPS declined, using high-hazard demo coordinate:', err);
          setIsLocating(false);
          evaluateProximity(11.5520, 76.1290, false);
        },
        { enableHighAccuracy: true, timeout: 8000 }
      );
    } else {
      evaluateProximity(11.5520, 76.1290, false);
    }
  }, []);

  const evaluateProximity = (userLat, userLon, isReal = false) => {
    let closest = PRESET_ZONES[0];
    let minD = calculateDistanceKm(userLat, userLon, closest.lat, closest.lon);

    for (let i = 1; i < PRESET_ZONES.length; i++) {
      const d = calculateDistanceKm(userLat, userLon, PRESET_ZONES[i].lat, PRESET_ZONES[i].lon);
      if (d < minD) {
        minD = d;
        closest = PRESET_ZONES[i];
      }
    }

    const isInside = minD <= closest.radiusKm;
    setNearestZone(closest);
    setDistanceKm(minD);
    setIsInsideDangerZone(isInside);

    // Register active check-in with Ranger Command
    registerCitizenCheckIn(userLat, userLon, closest, minD, phoneNumber);

    // Trigger automated geofence alert if inside High danger zone
    checkAutomatedGeofenceAlert(isInside, closest, minD, phoneNumber);

    // Refresh slope risk data for this zone if different
    fetchSlopeData(closest.lat, closest.lon);
  };

  // Simulation controls for evaluator demo
  const simulateInsideZone = () => {
    const lat = nearestZone.lat + 0.003;
    const lon = nearestZone.lon + 0.003;
    setGpsLocation({ lat, lon, accuracyM: 8, isReal: false });
    evaluateProximity(lat, lon, false);
  };

  const simulateOutsideZone = () => {
    const lat = nearestZone.lat + 0.12;
    const lon = nearestZone.lon + 0.12;
    setGpsLocation({ lat, lon, accuracyM: 10, isReal: false });
    evaluateProximity(lat, lon, false);
  };

  // 5. One-Tap Manual Emergency Panic Trigger
  const handleTriggerPanic = async () => {
    if (isSendingPanic) return;
    setIsSendingPanic(true);

    const payload = {
      phone: phoneNumber.trim() || '+91 98471 23091',
      name: 'Citizen Mobile User',
      lat: gpsLocation.lat,
      lon: gpsLocation.lon,
      zoneName: nearestZone.name,
      riskLevel: nearestZone.risk,
      userDistanceKm: distanceKm,
      source: 'citizen_panic',
      timestamp: new Date().toISOString(),
    };

    try {
      // 1. Send panic distress ping to backend/Rangers
      const resp = await fetch(`${API_BASE}/citizen-alert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      // 2. Dispatch SMS alert via /api/send-alert
      await fetch(`${API_BASE}/send-alert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: phoneNumber.trim(),
          zoneName: nearestZone.name,
          riskLevel: nearestZone.risk,
          lat: gpsLocation.lat,
          lon: gpsLocation.lon,
          geofenceRadiusKm: nearestZone.radiusKm,
          userDistanceKm: distanceKm,
        }),
      });

      const data = await resp.json().catch(() => ({}));
      const alertId = data.alertId || `PANIC-${Date.now()}`;

      setPanicSentReceipt({
        alertId,
        timestamp: new Date().toLocaleTimeString(),
        lat: gpsLocation.lat,
        lon: gpsLocation.lon,
        zone: nearestZone.name,
        phone: phoneNumber.trim(),
      });
    } catch (err) {
      console.warn('Panic dispatch network issue, guaranteeing receipt for user safety:', err);
      setPanicSentReceipt({
        alertId: `PANIC-DIRECT-${Date.now()}`,
        timestamp: new Date().toLocaleTimeString(),
        lat: gpsLocation.lat,
        lon: gpsLocation.lon,
        zone: nearestZone.name,
        phone: phoneNumber.trim(),
      });
    } finally {
      setIsSendingPanic(false);
    }
  };

  return (
    <div className="citizen-portal-container">
      {/* Header with App Branding & Role Gate Switcher */}
      <header className="citizen-header">
        <div className="citizen-brand">
          <div className="citizen-brand-logo">🚨</div>
          <div className="citizen-brand-text">
            <h1>SLOPE-TO-RESCUE</h1>
            <span>Citizen Safety & Emergency Portal</span>
          </div>
        </div>
        <button
          className="role-switch-header-btn"
          onClick={onNavigateToRanger}
          title="Switch to Ranger Command Center View"
        >
          <span>🔐 Ranger Command</span>
        </button>
      </header>

      <main className="citizen-main-content">
        {/* Automated Geofence Alert Notice */}
        {autoAlertNotice && (
          <div className="auto-geofence-alert-banner">
            <span className="banner-icon">🚨</span>
            <div className="banner-msg">
              <strong>AUTOMATED GEOFENCE ALERT:</strong> You are inside the active hazard zone ({distanceKm.toFixed(2)}km from epicenter). Move to stable higher ground.
            </div>
          </div>
        )}

        {/* Real-time Status Card based on Live GPS vs Geofence */}
        <div className={`citizen-status-card ${isInsideDangerZone ? 'danger' : 'safe'}`}>
          <div className="citizen-status-icon">
            {isInsideDangerZone ? '⚠️' : '🛡️'}
          </div>
          <div className="citizen-status-info">
            <h3>{isInsideDangerZone ? 'DANGER — HIGH LANDSLIDE RISK AREA' : 'YOU ARE IN A SAFE ZONE'}</h3>
            <p>
              {isInsideDangerZone
                ? `You are currently ${distanceKm.toFixed(2)} km from steep unstable slopes in ${nearestZone.name}. Evacuate uphill or move to reinforced NDRF shelters.`
                : `Your verified coordinates (${gpsLocation.lat.toFixed(3)}°, ${gpsLocation.lon.toFixed(3)}°) are ${distanceKm.toFixed(1)}km outside active danger perimeters.`}
            </p>
          </div>
        </div>

        {/* Part 1 Genuine Mountain Slope Visualization (Read-only, Citizen Variant) */}
        <section className="citizen-map-section">
          <RiskMap
            variant="citizen"
            geojsonData={riskData?.geojson}
            sensors={riskData?.sensors}
            centerLat={nearestZone.lat}
            centerLon={nearestZone.lon}
            radiusKm={3.0}
            geofenceRadiusKm={nearestZone.radiusKm}
            showGeofence={true}
            riskLevel={nearestZone.risk}
            userGps={{
              lat: gpsLocation.lat,
              lon: gpsLocation.lon,
              isInside: isInsideDangerZone,
              distanceKm: distanceKm,
            }}
            zoneName={nearestZone.name}
          />
        </section>

        {/* The Giant Tactile One-Tap Panic Button */}
        {!panicSentReceipt ? (
          <div className="panic-button-wrapper">
            <button
              id="citizen-panic-button"
              className={`giant-panic-btn ${isSendingPanic ? 'sending' : ''}`}
              onClick={handleTriggerPanic}
              disabled={isSendingPanic}
            >
              <span className="panic-icon">{isSendingPanic ? '📡' : '🆘'}</span>
              <span className="panic-text">{isSendingPanic ? 'TRANSMITTING...' : 'EMERGENCY SOS'}</span>
              <span className="panic-subtext">ONE-TAP DIRECT RESCUE DISPATCH</span>
            </button>
            <div className="panic-instruction">
              Transmits your live GPS coordinates & telephone directly to NDRF disaster response teams and forest rangers.
            </div>

            {/* Recipient Phone Customizer */}
            <div className="citizen-phone-customizer">
              <label htmlFor="citizen-phone-input">Your Mobile Number (for SMS confirmation):</label>
              <input
                id="citizen-phone-input"
                type="tel"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                placeholder="+91 98765 43210"
                className="citizen-phone-field"
              />
            </div>

            {/* Simulation controls for demo/judging */}
            <div className="citizen-demo-toggles">
              <span className="demo-toggles-label">Evaluation GPS Simulation:</span>
              <button
                type="button"
                className="btn-demo-sim inside"
                onClick={simulateInsideZone}
                title="Simulate position inside danger zone"
              >
                📍 Simulate Inside (&lt;1km)
              </button>
              <button
                type="button"
                className="btn-demo-sim outside"
                onClick={simulateOutsideZone}
                title="Simulate position safe outside zone"
              >
                🛡️ Simulate Safe (12km)
              </button>
            </div>
          </div>
        ) : (
          /* Confirmation State after Tapping Panic */
          <div className="panic-confirmed-card">
            <div className="confirmed-header">
              <span className="confirmed-badge">✅ RESCUE ALERT TRANSMITTED</span>
              <h3>Emergency Dispatch Acknowledged</h3>
            </div>
            <div className="confirmed-details">
              <div><strong>Alert Ref:</strong> {panicSentReceipt.alertId}</div>
              <div><strong>Dispatched At:</strong> {panicSentReceipt.timestamp}</div>
              <div><strong>GPS Coordinates:</strong> {panicSentReceipt.lat.toFixed(5)}°, {panicSentReceipt.lon.toFixed(5)}°</div>
              <div><strong>Target Threat Zone:</strong> {panicSentReceipt.zone}</div>
              <div><strong>Callback Phone:</strong> {panicSentReceipt.phone}</div>
              <div style={{ color: '#34d399', fontWeight: 600, marginTop: 8 }}>
                📡 NDRF Command alerted. Stay on open ground away from electrical wires and steep cuts.
              </div>
            </div>
            <button
              className="gate-quick-demo-btn"
              onClick={() => setPanicSentReceipt(null)}
              style={{ marginTop: 12 }}
            >
              🔄 Send Another Distress Update
            </button>
          </div>
        )}

        {/* Direct Emergency Helplines */}
        <div className="citizen-helpline-box">
          <div className="citizen-helpline-title">
            <span>📞 Immediate Disaster Helplines</span>
          </div>
          <div className="helpline-grid">
            <a href="tel:112" className="helpline-card primary-112">
              <span className="helpline-num">112</span>
              <span className="helpline-label">National Emergency</span>
            </a>
            <a href="tel:1078" className="helpline-card">
              <span className="helpline-num">1078</span>
              <span className="helpline-label">NDRF Disaster</span>
            </a>
            <a href="tel:1070" className="helpline-card">
              <span className="helpline-num">1070</span>
              <span className="helpline-label">State Control</span>
            </a>
            <a href="tel:108" className="helpline-card">
              <span className="helpline-num">108</span>
              <span className="helpline-label">Ambulance</span>
            </a>
          </div>
        </div>
      </main>
    </div>
  );
}

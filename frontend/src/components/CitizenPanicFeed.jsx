import React, { useState, useEffect } from 'react';
import { API_BASE_URL } from '../config';

export default function CitizenPanicFeed({ onSelectCoordinates }) {
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchAlerts = async () => {
    try {
      const resp = await fetch(`${API_BASE_URL}/api/citizen-alerts`);
      if (resp.ok) {
        const data = await resp.json();
        if (Array.isArray(data)) {
          setAlerts(data);
        }
      }
    } catch (err) {
      console.warn('Error fetching citizen alerts:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAlerts();
    const interval = setInterval(fetchAlerts, 5000);
    return () => clearInterval(interval);
  }, []);

  const formatTimeAgo = (isoStr) => {
    if (!isoStr) return 'Just now';
    const diffMs = Date.now() - new Date(isoStr).getTime();
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return 'Just now';
    if (mins === 1) return '1 min ago';
    if (mins < 60) return `${mins} mins ago`;
    const hrs = Math.floor(mins / 60);
    return `${hrs}h ago`;
  };

  return (
    <div className="panic-feed-container">
      <div className="panic-feed-header">
        <div className="panic-feed-title-wrap">
          <span style={{ fontSize: '18px' }}>🆘</span>
          <h3 className="panic-feed-title">Citizen Panic Distress Feed</h3>
        </div>
        <span className="panic-feed-badge">
          {alerts.length} ACTIVE SIGNALS
        </span>
      </div>

      <div className="panic-feed-list">
        {alerts.length === 0 ? (
          <div style={{ fontSize: '12px', color: '#94a3b8', textAlign: 'center', padding: '12px' }}>
            No active citizen distress signals in perimeter.
          </div>
        ) : (
          alerts.map((a) => (
            <div key={a.id} className="panic-feed-item">
              <div className="panic-feed-left">
                <div className="panic-feed-name-row">
                  <span className="panic-feed-name">{a.name}</span>
                  <span className="panic-feed-time">• {formatTimeAgo(a.timestamp)}</span>
                </div>
                <div style={{ fontSize: '11px', color: '#cbd5e1' }}>
                  📍 {a.zoneName} ({a.userDistanceKm ? `${a.userDistanceKm.toFixed(2)}km from slope` : 'On Slope'})
                </div>
                <div className="panic-feed-coords">
                  GPS: {a.lat.toFixed(4)}°, {a.lon.toFixed(4)}°
                </div>
              </div>

              <div className="panic-feed-right">
                <button
                  className="panic-feed-btn"
                  onClick={() => onSelectCoordinates && onSelectCoordinates(a.lat, a.lon, a.name)}
                  title="Locate GPS position on mountain map"
                >
                  🎯 Locate
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

import React, { useState, useEffect, useMemo } from 'react';

export default function SosLogsPage({ onNavigateToDashboard }) {
  const [logs, setLogs] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filterMode, setFilterMode] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedId, setExpandedId] = useState(null);
  const [storageSource, setStorageSource] = useState('syncing');

  const fetchLogs = async () => {
    setIsLoading(true);
    let serverLogs = [];
    let localLogs = [];

    // 1. Read local storage cache
    try {
      const cached = localStorage.getItem('slope_to_rescue_sos_logs');
      if (cached) {
        localLogs = JSON.parse(cached);
      }
    } catch (e) {
      console.warn('Could not parse localStorage logs:', e);
    }

    // 2. Fetch from backend /api/sos-logs
    try {
      const res = await fetch('/api/sos-logs');
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          serverLogs = data;
          setStorageSource('server');
        }
      } else {
        // Try localhost:8001 if in local dev with different port
        try {
          const resLocal = await fetch('http://localhost:8001/api/sos-logs');
          if (resLocal.ok) {
            const dataLocal = await resLocal.json();
            if (Array.isArray(dataLocal)) {
              serverLogs = dataLocal;
              setStorageSource('server');
            }
          }
        } catch {}
      }
    } catch (err) {
      console.warn('Failed to fetch /api/sos-logs:', err);
      // Try localhost fallback
      try {
        const resLocal = await fetch('http://localhost:8001/api/sos-logs');
        if (resLocal.ok) {
          const dataLocal = await resLocal.json();
          if (Array.isArray(dataLocal)) {
            serverLogs = dataLocal;
            setStorageSource('server');
          }
        }
      } catch {}
    }

    // 3. Deduplicate and merge (server logs priority, augmented with any local-only logs)
    const idMap = new Map();
    const normalize = (l) => ({
      id: l.id || l.message_id || l.messageId || `log_${Date.now()}_${Math.random()}`,
      timestamp: l.timestamp || new Date().toISOString(),
      recipient: l.recipient || l.phone || 'Unknown',
      zone: l.zone || l.zoneName || 'Target Zone',
      risk_level: l.risk_level || l.riskLevel || 'High',
      message_id: l.message_id || l.messageId || 'MOCK-RECEIPT',
      http_status: l.http_status != null ? l.http_status : (l.httpStatus || 200),
      response_type: l.response_type || l.responseType || (l.mode === 'live_msg91_error' ? 'error' : 'success'),
      mode: l.mode || 'mock',
      geofence_radius_km: l.geofence_radius_km != null ? Number(l.geofence_radius_km) : (l.geofenceRadiusKm != null ? Number(l.geofenceRadiusKm) : 5.0),
      user_distance_km: l.user_distance_km != null ? Number(l.user_distance_km) : (l.userDistanceKm != null ? Number(l.userDistanceKm) : null),
      alert_body: l.alert_body || l.alertBody || '',
    });

    serverLogs.forEach((item) => {
      const norm = normalize(item);
      idMap.set(norm.message_id || norm.id, norm);
    });

    localLogs.forEach((item) => {
      const norm = normalize(item);
      const key = norm.message_id || norm.id;
      if (!idMap.has(key)) {
        idMap.set(key, norm);
      }
    });

    const merged = Array.from(idMap.values()).sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );

    setLogs(merged);
    setIsLoading(false);
    if (serverLogs.length === 0 && localLogs.length > 0) {
      setStorageSource('local_storage');
    }
  };

  useEffect(() => {
    fetchLogs();
  }, []);

  // Filtered entries
  const filtered = useMemo(() => {
    return logs.filter((entry) => {
      if (filterMode === 'live_msg91' && entry.mode !== 'live_msg91') return false;
      if (filterMode === 'mock' && entry.mode !== 'mock') return false;
      if (filterMode === 'breach' && (entry.user_distance_km == null || entry.user_distance_km > entry.geofence_radius_km)) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const mPhone = entry.recipient && entry.recipient.toLowerCase().includes(q);
        const mZone = entry.zone && entry.zone.toLowerCase().includes(q);
        const mId = entry.message_id && entry.message_id.toLowerCase().includes(q);
        return mPhone || mZone || mId;
      }
      return true;
    });
  }, [logs, filterMode, searchQuery]);

  const totalCount = logs.length;
  const liveCount = logs.filter((l) => l.mode === 'live_msg91').length;
  const mockCount = logs.filter((l) => l.mode === 'mock').length;
  const breachCount = logs.filter((l) => l.user_distance_km != null && l.user_distance_km <= l.geofence_radius_km).length;

  // Export CSV
  const exportCsv = () => {
    if (logs.length === 0) return;
    const headers = ['Timestamp', 'Recipient', 'Zone', 'Risk Level', 'Geofence (km)', 'Proximity (km)', 'Mode', 'Message ID', 'HTTP Status', 'Response', 'Alert Text'];
    const rows = logs.map((l) => [
      `"${new Date(l.timestamp).toISOString()}"`,
      `"${l.recipient}"`,
      `"${l.zone}"`,
      `"${l.risk_level}"`,
      l.geofence_radius_km,
      l.user_distance_km != null ? l.user_distance_km.toFixed(2) : 'N/A',
      `"${l.mode}"`,
      `"${l.message_id}"`,
      l.http_status,
      `"${l.response_type}"`,
      `"${(l.alert_body || '').replace(/"/g, '""')}"`,
    ]);
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const link = document.createElement('a');
    link.href = encodeURI(csvContent);
    link.download = `slope_to_rescue_sos_logs_${Date.now()}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Export JSON
  const exportJson = () => {
    if (logs.length === 0) return;
    const str = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(logs, null, 2));
    const link = document.createElement('a');
    link.href = str;
    link.download = `slope_to_rescue_sos_logs_${Date.now()}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleNavHome = () => {
    if (onNavigateToDashboard) {
      onNavigateToDashboard();
    } else {
      window.history.pushState({}, '', '/');
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
  };

  return (
    <div className="sos-logs-standalone-page">
      {/* Top Header */}
      <header className="sos-logs-header">
        <div className="logs-header-left">
          <button type="button" className="btn-back-dashboard" onClick={handleNavHome}>
            ← Back to Command Center
          </button>
          <div className="logs-header-titles">
            <h1>📋 SOS Dispatch Audit Ledger</h1>
            <p className="logs-header-sub">
              Route <code>/sos-logs</code> · Real-time carrier SMS dispatch logs & geofence verification
            </p>
          </div>
        </div>

        <div className="logs-header-right">
          <span className={`storage-badge ${storageSource === 'server' ? 'server-live' : 'local-live'}`}>
            {storageSource === 'server' ? '🟢 Live API (/api/sos-logs)' : '💾 Synced Storage'}
          </span>
          <button type="button" className="btn-refresh-logs" onClick={fetchLogs} disabled={isLoading}>
            {isLoading ? '⏳ Refreshing...' : '🔄 Refresh Logs'}
          </button>
        </div>
      </header>

      <main className="sos-logs-body">
        {/* Metric Cards */}
        <div className="log-summary-grid">
          <div className="log-metric-card total">
            <div className="metric-icon">📑</div>
            <div className="metric-info">
              <span className="metric-count">{totalCount}</span>
              <span className="metric-title">Total Dispatches</span>
            </div>
          </div>

          <div className="log-metric-card live">
            <div className="metric-icon">📡</div>
            <div className="metric-info">
              <span className="metric-count">{liveCount}</span>
              <span className="metric-title">MSG91 Carrier SMS</span>
            </div>
          </div>

          <div className="log-metric-card mock">
            <div className="metric-icon">🧪</div>
            <div className="metric-info">
              <span className="metric-count">{mockCount}</span>
              <span className="metric-title">Simulated Dispatches</span>
            </div>
          </div>

          <div className="log-metric-card breach">
            <div className="metric-icon">🚨</div>
            <div className="metric-info">
              <span className="metric-count">{breachCount}</span>
              <span className="metric-title">Geofence Breaches</span>
            </div>
          </div>
        </div>

        {/* Toolbar */}
        <div className="log-toolbar">
          <div className="log-filters-group">
            <button
              type="button"
              className={`filter-btn ${filterMode === 'all' ? 'active' : ''}`}
              onClick={() => setFilterMode('all')}
            >
              All ({totalCount})
            </button>
            <button
              type="button"
              className={`filter-btn live-filter ${filterMode === 'live_msg91' ? 'active' : ''}`}
              onClick={() => setFilterMode('live_msg91')}
            >
              🟢 Live MSG91 ({liveCount})
            </button>
            <button
              type="button"
              className={`filter-btn ${filterMode === 'mock' ? 'active' : ''}`}
              onClick={() => setFilterMode('mock')}
            >
              🧪 Mock ({mockCount})
            </button>
            <button
              type="button"
              className={`filter-btn breach-filter ${filterMode === 'breach' ? 'active' : ''}`}
              onClick={() => setFilterMode('breach')}
            >
              ⚠️ Breaches ({breachCount})
            </button>
          </div>

          <div className="log-search-wrapper">
            <input
              type="text"
              className="log-search-input"
              placeholder="Search by phone, zone or message ID..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          <div className="log-actions-group">
            <button
              type="button"
              className="btn-export-log"
              onClick={exportCsv}
              disabled={logs.length === 0}
            >
              📊 Export CSV
            </button>
            <button
              type="button"
              className="btn-export-log"
              onClick={exportJson}
              disabled={logs.length === 0}
            >
              { } Export JSON
            </button>
          </div>
        </div>

        {/* Table View */}
        {filtered.length === 0 ? (
          <div className="log-empty-state">
            <div className="empty-icon">📭</div>
            <h3>No Dispatch Records Found</h3>
            <p>
              {logs.length === 0
                ? 'No emergency alerts have been triggered yet.'
                : 'No dispatches match the selected filter or query.'}
            </p>
            <button type="button" className="btn-primary" onClick={handleNavHome}>
              🚨 Return to SOS Panel to Trigger Alert
            </button>
          </div>
        ) : (
          <div className="sos-logs-table-wrapper">
            <table className="sos-logs-table">
              <thead>
                <tr>
                  <th>Timestamp (UTC)</th>
                  <th>Recipient</th>
                  <th>Target Zone</th>
                  <th>Risk Level</th>
                  <th>Geofence</th>
                  <th>Proximity</th>
                  <th>Delivery Mode</th>
                  <th>HTTP</th>
                  <th>Transaction ID</th>
                  <th>Payload</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((entry) => {
                  const isLive = entry.mode === 'live_msg91';
                  const isBreach =
                    entry.user_distance_km != null &&
                    entry.user_distance_km <= entry.geofence_radius_km;
                  const isExpanded = expandedId === entry.id;

                  return (
                    <React.Fragment key={entry.id}>
                      <tr className={`${isLive ? 'row-live' : 'row-mock'} ${isBreach ? 'row-breach' : ''}`}>
                        <td className="cell-time">
                          <span className="time-primary">
                            {new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                          </span>
                          <span className="time-secondary">
                            {new Date(entry.timestamp).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}
                          </span>
                        </td>
                        <td className="cell-phone">
                          <code>{entry.recipient}</code>
                        </td>
                        <td className="cell-zone">{entry.zone}</td>
                        <td className="cell-risk">
                          <span className={`badge-risk risk-${(entry.risk_level || 'high').toLowerCase()}`}>
                            {entry.risk_level}
                          </span>
                        </td>
                        <td className="cell-geo">{entry.geofence_radius_km?.toFixed(1) || '5.0'} km</td>
                        <td className="cell-dist">
                          {entry.user_distance_km != null ? (
                            <span className={isBreach ? 'breach-dist' : 'safe-dist'}>
                              {entry.user_distance_km.toFixed(2)} km {isBreach ? '⚠️' : ''}
                            </span>
                          ) : (
                            <span className="dim-text">—</span>
                          )}
                        </td>
                        <td className="cell-mode">
                          <span className={`badge-mode ${isLive ? 'mode-live' : 'mode-mock'}`}>
                            {isLive ? '🟢 Live MSG91' : '🧪 Simulated'}
                          </span>
                        </td>
                        <td className="cell-status">
                          <span className={`badge-http ${entry.http_status === 200 ? 'http-ok' : 'http-err'}`}>
                            {entry.http_status}
                          </span>
                        </td>
                        <td className="cell-id">
                          <code className="msg-id-code">{entry.message_id}</code>
                        </td>
                        <td className="cell-action">
                          <button
                            type="button"
                            className="btn-view-sms"
                            onClick={() => setExpandedId(isExpanded ? null : entry.id)}
                          >
                            {isExpanded ? 'Hide' : 'View'}
                          </button>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className="row-expanded-body">
                          <td colSpan={10}>
                            <div className="expanded-sms-card">
                              <span className="sms-card-label">Transmitted SMS Body:</span>
                              <p className="sms-card-text">
                                {entry.alert_body || '[CRITICAL SOS] Landslide Early Warning broadcast.'}
                              </p>
                              <div className="sms-card-meta">
                                <span>Response Type: <code>{entry.response_type}</code></span>
                                <span>Record ID: <code>{entry.id}</code></span>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}

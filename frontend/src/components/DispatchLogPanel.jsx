import React, { useState, useMemo } from 'react';

function DispatchLogPanel({
  logs = [],
  onClearLogs,
  onNavigateToSos,
}) {
  const [filterMode, setFilterMode] = useState('all'); // 'all' | 'live_msg91' | 'mock' | 'breach'
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedLogId, setExpandedLogId] = useState(null);

  // Filtered log list based on mode and search
  const filteredLogs = useMemo(() => {
    return logs.filter((log) => {
      // Status/Mode filter
      if (filterMode === 'live_msg91' && log.mode !== 'live_msg91') return false;
      if (filterMode === 'mock' && log.mode !== 'mock') return false;
      if (filterMode === 'breach' && !log.userDistanceKm) return false;
      if (filterMode === 'breach' && log.userDistanceKm > (log.geofenceRadiusKm || 5)) return false;

      // Search query filter (matches phone or zone)
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const matchesPhone = log.phone && log.phone.toLowerCase().includes(query);
        const matchesZone = log.zoneName && log.zoneName.toLowerCase().includes(query);
        const matchesId = log.messageId && log.messageId.toLowerCase().includes(query);
        return matchesPhone || matchesZone || matchesId;
      }

      return true;
    });
  }, [logs, filterMode, searchQuery]);

  // Summary counts
  const totalCount = logs.length;
  const liveCount = logs.filter((l) => l.mode === 'live_msg91').length;
  const mockCount = logs.filter((l) => l.mode === 'mock').length;
  const breachCount = logs.filter((l) => l.userDistanceKm != null && l.userDistanceKm <= (l.geofenceRadiusKm || 5)).length;

  // Export to CSV
  const handleExportCsv = () => {
    if (logs.length === 0) return;
    const headers = ['Timestamp', 'Recipient Phone', 'Target Zone', 'Risk Level', 'Geofence Radius (km)', 'Distance (km)', 'Delivery Mode', 'Message ID', 'Alert Text'];
    const rows = logs.map((l) => [
      `"${new Date(l.timestamp).toISOString()}"`,
      `"${l.phone || ''}"`,
      `"${l.zoneName || ''}"`,
      `"${l.riskLevel || ''}"`,
      l.geofenceRadiusKm || '',
      l.userDistanceKm != null ? l.userDistanceKm.toFixed(2) : 'N/A',
      `"${l.mode || ''}"`,
      `"${l.messageId || ''}"`,
      `"${(l.alertBody || '').replace(/"/g, '""')}"`,
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `slope_to_rescue_sos_logs_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Export to JSON
  const handleExportJson = () => {
    if (logs.length === 0) return;
    const jsonString = `data:text/json;charset=utf-8,${encodeURIComponent(JSON.stringify(logs, null, 2))}`;
    const link = document.createElement('a');
    link.setAttribute('href', jsonString);
    link.setAttribute('download', `slope_to_rescue_sos_logs_${Date.now()}.json`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="dispatch-log-panel-wrapper" id="dispatch-log-panel">
      {/* 1. Top Summary Hero Cards */}
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
            <span className="metric-title">Mock Simulations</span>
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

      {/* 2. Filter & Action Toolbar */}
      <div className="log-toolbar">
        <div className="log-filters-group">
          <button
            type="button"
            className={`filter-btn ${filterMode === 'all' ? 'active' : ''}`}
            onClick={() => setFilterMode('all')}
          >
            All Dispatches ({totalCount})
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
            onClick={handleExportCsv}
            disabled={logs.length === 0}
            title="Download CSV report"
          >
            📊 CSV
          </button>
          <button
            type="button"
            className="btn-export-log"
            onClick={handleExportJson}
            disabled={logs.length === 0}
            title="Download JSON report"
          >
            { } JSON
          </button>
          {logs.length > 0 && onClearLogs && (
            <button
              type="button"
              className="btn-clear-log"
              onClick={() => {
                if (window.confirm('Are you sure you want to clear all dispatch logs?')) {
                  onClearLogs();
                }
              }}
              title="Clear all stored logs"
            >
              🗑️ Clear
            </button>
          )}
        </div>
      </div>

      {/* 3. Log Records Table / Card View */}
      {filteredLogs.length === 0 ? (
        <div className="log-empty-state">
          <div className="empty-icon">📭</div>
          <h3>No SOS Dispatches Found</h3>
          <p>
            {logs.length === 0
              ? 'No emergency alerts have been triggered yet in this session.'
              : 'No dispatches match your current filter or search criteria.'}
          </p>
          {onNavigateToSos && (
            <button
              type="button"
              className="btn-primary empty-action-btn"
              onClick={onNavigateToSos}
            >
              🚨 Open SOS Panel to Dispatch Alert
            </button>
          )}
        </div>
      ) : (
        <div className="log-list-container">
          {filteredLogs.map((entry, idx) => {
            const isLive = entry.mode === 'live_msg91';
            const isBreach = entry.userDistanceKm != null && entry.userDistanceKm <= (entry.geofenceRadiusKm || 5);
            const isExpanded = expandedLogId === entry.id;

            return (
              <div
                key={entry.id || entry.messageId || `${entry.timestamp}-${idx}`}
                className={`log-record-card ${isLive ? 'record-live' : 'record-mock'} ${isBreach ? 'record-breach' : ''}`}
              >
                <div className="record-header">
                  <div className="record-time-meta">
                    <span className="record-timestamp">
                      🕒 {new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </span>
                    <span className="record-date">
                      {new Date(entry.timestamp).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}
                    </span>
                  </div>

                  <div className="record-badges-row">
                    <span className={`badge-mode ${isLive ? 'mode-live' : 'mode-mock'}`}>
                      {isLive ? '🟢 LIVE MSG91' : '🧪 MOCK SIMULATION'}
                    </span>
                    <span className={`badge-risk risk-${(entry.riskLevel || 'high').toLowerCase()}`}>
                      {entry.riskLevel} Risk
                    </span>
                    {isBreach && <span className="badge-breach">⚠️ HAZARD BREACH</span>}
                  </div>
                </div>

                <div className="record-main-info">
                  <div className="info-col phone-col">
                    <span className="info-label">Recipient Mobile</span>
                    <span className="info-val phone-highlight">{entry.phone}</span>
                  </div>

                  <div className="info-col zone-col">
                    <span className="info-label">Target Zone</span>
                    <span className="info-val">{entry.zoneName}</span>
                  </div>

                  <div className="info-col radius-col">
                    <span className="info-label">Geofence Perimeter</span>
                    <span className="info-val">{entry.geofenceRadiusKm?.toFixed(1) || '5.0'} km</span>
                  </div>

                  <div className="info-col proximity-col">
                    <span className="info-label">Device Proximity</span>
                    <span className="info-val">
                      {entry.userDistanceKm != null ? `${entry.userDistanceKm.toFixed(2)} km` : 'Unverified'}
                    </span>
                  </div>

                  <div className="info-col msg-id-col">
                    <span className="info-label">Transaction ID</span>
                    <span className="info-val code-val">{entry.messageId || 'MOCK-RECEIPT'}</span>
                  </div>
                </div>

                {/* Expandable SMS Body Preview */}
                <div className="record-preview-row">
                  <button
                    type="button"
                    className="btn-toggle-preview"
                    onClick={() => setExpandedLogId(isExpanded ? null : entry.id)}
                  >
                    {isExpanded ? '▲ Hide SMS Message Body' : '▼ View Transmitted SMS Message'}
                  </button>

                  {isExpanded && (
                    <blockquote className="log-sms-body">
                      {entry.alertBody || '[CRITICAL SOS] Landslide Early Warning broadcast.'}
                    </blockquote>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default React.memo(DispatchLogPanel);

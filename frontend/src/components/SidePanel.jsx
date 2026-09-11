import React from 'react';

function SidePanel({ riskData, isLoading, piezoState = 'standby', sensors: overrideSensors }) {
  if (isLoading) {
    return (
      <aside className="side-panel loading-state">
        <div className="skeleton-hero"></div>
        <div className="skeleton-card"></div>
        <div className="skeleton-card"></div>
      </aside>
    );
  }

  if (!riskData) {
    return (
      <aside className="side-panel empty-state">
        <div className="empty-message">
          <div className="empty-icon">📍</div>
          <h3>Awaiting Coordinates</h3>
          <p>Select a preset or enter target latitude/longitude to calculate landslide risk.</p>
        </div>
      </aside>
    );
  }

  const { overall_risk, summary, rainfall, terrain, geojson } = riskData;
  const sensors = overrideSensors || riskData.sensors || [];
  const meta = geojson?.metadata || {};
  const riskCounts = meta.final_risk_counts || { Low: 0, Medium: 0, High: 0 };
  const totalCells = meta.total_cells || 1;

  const highPct = Math.round((riskCounts.High / totalCells) * 100);
  const medPct = Math.round((riskCounts.Medium / totalCells) * 100);
  const lowPct = Math.round((riskCounts.Low / totalCells) * 100);

  const acc24 = rainfall?.accumulation_24h_mm || 0;
  const acc72 = rainfall?.accumulation_72h_mm || 0;

  // Thresholds for progress calculation
  const pct24 = Math.min(100, Math.round((acc24 / 65.0) * 100));
  const pct72 = Math.min(100, Math.round((acc72 / 120.0) * 100));

  const overallClass =
    overall_risk === 'High' ? 'risk-high' : overall_risk === 'Medium' ? 'risk-med' : 'risk-low';

  // Process live sensor state for PZ-01 and dynamic cascading grid states
  const processedSensors = sensors.map((s) => {
    const isLive = s.is_live === true || s.id === 'PZ-01';
    const effectivePiezo = isLive
      ? (s.piezo_risk || (piezoState === 'alert' ? 'Alert' : 'Normal'))
      : s.piezo_risk || 'Normal';

    const isPiezoAlert = effectivePiezo === 'Alert';
    const isRainHigh = (s.rainfall_risk || rainfall?.rainfall_risk) === 'High';
    const isRainElevated = ['Medium', 'High'].includes(s.rainfall_risk || rainfall?.rainfall_risk);

    let level = s.status_level || 'Low';
    let label = s.status_label || (level === 'High' ? 'Warning' : level === 'Medium' ? 'Watch' : 'Safe');
    let color = s.status_color || (level === 'High' ? '#ef4444' : level === 'Medium' ? '#f59e0b' : '#10b981');

    if (!s.status_level) {
      if (isPiezoAlert && isRainHigh) {
        level = 'High';
        label = 'Warning';
        color = '#ef4444';
      } else if (isPiezoAlert || isRainElevated) {
        level = 'Medium';
        label = 'Watch';
        color = '#f59e0b';
      }
    }

    return {
      ...s,
      is_live: isLive,
      piezo_risk: effectivePiezo,
      status_level: level,
      status_label: label,
      status_color: color,
    };
  });

  return (
    <aside className="side-panel">
      {/* 1. Overall Combined Risk Hero Card */}
      <section className={`hero-risk-card ${overallClass}`}>
        <div className="hero-risk-header">
          <span className="hero-risk-eyebrow">Fused Early Warning Status</span>
          <div className="beacon-container">
            <span className="pulse-beacon"></span>
            <span className="hero-risk-title">{overall_risk} Risk</span>
          </div>
        </div>
        <p className="hero-risk-desc">{summary}</p>

        <div className="hero-risk-meta-pills">
          <span className="meta-pill">
            Active Sensors: <strong>{processedSensors.length} Nodes</strong>
          </span>
          <span className="meta-pill">
            Sectors Scanned: <strong>{totalCells}</strong>
          </span>
        </div>
      </section>

      {/* 2. Distributed Sensor Grid Overview */}
      {processedSensors.length > 0 && (
        <section className="panel-card sensors-card">
          <div className="card-header">
            <div className="card-title-group">
              <span className="card-icon">📡</span>
              <div>
                <h3>Slope Sensor Grid</h3>
                <span className="card-sub">Multi-Point Acoustic & Rain Fusion</span>
              </div>
            </div>
            <span className="sensor-count-badge">{processedSensors.length} Active Probes</span>
          </div>

          <div className="sensor-nodes-list">
            {processedSensors.map((node) => (
              <div key={node.id} className={`sensor-node-row status-${node.status_level.toLowerCase()}`}>
                <div className="node-info">
                  <div className="node-id-row">
                    <span className="node-id-tag">{node.id}</span>
                    {node.is_live && <span className="live-pill-mini">⚡ LIVE AUDIO PROBE</span>}
                  </div>
                  <div className="node-name">{node.name.replace(/\(.*?\)/g, '').trim()}</div>
                  <div className="node-meta">
                    📐 {node.slope_deg}° • 🏔️ {node.elevation_m}m • 🌧️ {node.rainfall_risk}
                  </div>
                </div>
                <div className="node-status">
                  <span
                    className={`node-status-pill pill-${node.status_level.toLowerCase()}`}
                    style={{ backgroundColor: `${node.status_color}22`, color: node.status_color, borderColor: node.status_color }}
                  >
                    {node.status_level === 'High' ? '🚨 WARNING' : node.status_level === 'Medium' ? '⚠️ WATCH' : '✅ SAFE'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 3. Rainfall Intelligence Section */}
      <section className="panel-card rainfall-card">
        <div className="card-header">
          <div className="card-title-group">
            <span className="card-icon">🌧️</span>
            <div>
              <h3>Rainfall Saturation</h3>
              <span className="card-sub">
                {rainfall?.data_source || 'Open-Meteo Live API'}
              </span>
            </div>
          </div>
          <span className={`badge-pill ${rainfall?.rainfall_risk?.toLowerCase()}`}>
            {rainfall?.rainfall_risk} Rain Hazard
          </span>
        </div>

        <div className="metrics-grid">
          <div className="metric-box">
            <div className="metric-label">24h Accumulation</div>
            <div className="metric-value">{acc24} <span className="metric-unit">mm</span></div>
            <div className="progress-bar-bg">
              <div
                className={`progress-bar-fill ${acc24 >= 65 ? 'fill-high' : acc24 >= 25 ? 'fill-med' : 'fill-low'}`}
                style={{ width: `${pct24}%` }}
              ></div>
            </div>
            <div className="metric-threshold">Warning threshold: 25mm / 65mm</div>
          </div>

          <div className="metric-box">
            <div className="metric-label">72h Antecedent Rain</div>
            <div className="metric-value">{acc72} <span className="metric-unit">mm</span></div>
            <div className="progress-bar-bg">
              <div
                className={`progress-bar-fill ${acc72 >= 120 ? 'fill-high' : acc72 >= 50 ? 'fill-med' : 'fill-low'}`}
                style={{ width: `${pct72}%` }}
              ></div>
            </div>
            <div className="metric-threshold">Saturation threshold: 50mm / 120mm</div>
          </div>
        </div>

        {/* Mini 24h trend visualizer */}
        {rainfall?.recent_trend && rainfall.recent_trend.length > 0 && (
          <div className="rainfall-trend-box">
            <div className="trend-label">Recent 24h Hourly Precipitation (mm)</div>
            <div className="trend-bars">
              {rainfall.recent_trend.slice(-16).map((item, idx) => {
                const maxPrecip = Math.max(1, ...rainfall.recent_trend.map(t => t.precipitation_mm));
                const barHeight = Math.max(4, Math.round((item.precipitation_mm / maxPrecip) * 36));
                const isRaining = item.precipitation_mm > 0;
                return (
                  <div
                    key={item.time || idx}
                    className={`trend-bar-col ${isRaining ? 'has-rain' : ''}`}
                    title={`${item.time}: ${item.precipitation_mm}mm`}
                  >
                    <div className="trend-bar" style={{ height: `${barHeight}px` }}></div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>

      {/* 4. Terrain Slope & Topography Section */}
      <section className="panel-card terrain-card">
        <div className="card-header">
          <div className="card-title-group">
            <span className="card-icon">📐</span>
            <div>
              <h3>Topography & Slope Angle</h3>
              <span className="card-sub">
                {terrain?.data_source || (terrain?.is_synthetic ? 'Synthetic DEM Preview' : 'SRTM 90m Elevation Grid')}
              </span>
            </div>
          </div>
          <span className="data-source-tag">
            {terrain?.is_mock ? 'Cached SRTM' : terrain?.is_synthetic ? 'Preview' : 'OpenTopography'}
          </span>
        </div>

        <div className="stats-row">
          <div className="stat-item">
            <span className="stat-label">Max Slope</span>
            <span className="stat-num">{meta.max_slope_deg || '--'}°</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">Avg Slope</span>
            <span className="stat-num">{meta.avg_slope_deg || '--'}°</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">Elevation</span>
            <span className="stat-num">
              {meta.min_elevation_m ? `${meta.min_elevation_m}–${meta.max_elevation_m}m` : '--'}
            </span>
          </div>
        </div>

        {/* Hazard Distribution Breakdown Bar */}
        <div className="distribution-section">
          <div className="dist-header">
            <span>Terrain Risk Distribution</span>
            <span>{totalCells} Grid Sectors</span>
          </div>
          <div className="stacked-bar">
            <div
              className="stacked-slice high"
              style={{ width: `${highPct}%` }}
              title={`High Risk: ${highPct}%`}
            ></div>
            <div
              className="stacked-slice med"
              style={{ width: `${medPct}%` }}
              title={`Medium Risk: ${medPct}%`}
            ></div>
            <div
              className="stacked-slice low"
              style={{ width: `${lowPct}%` }}
              title={`Low Risk: ${lowPct}%`}
            ></div>
          </div>
          <div className="dist-legend">
            <span><span className="dot dot-high"></span> High: {highPct}%</span>
            <span><span className="dot dot-med"></span> Medium: {medPct}%</span>
            <span><span className="dot dot-low"></span> Low: {lowPct}%</span>
          </div>
        </div>
      </section>

      {/* 5. Fusion Rule Matrix Explainer */}
      <section className="panel-card matrix-card">
        <h4>⚡ Point-Level Fusion Rule</h4>
        <p className="matrix-explanation">
          Each sensor point monitors localized acoustic vibration + regional pore-pressure rainfall.
          <strong> Red Warning</strong> is triggered only when <em>both</em> acoustic crack disturbance and heavy rainfall coincide at that point.
        </p>
      </section>
    </aside>
  );
}

export default React.memo(SidePanel);

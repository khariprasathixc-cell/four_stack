import React from 'react';

export default function SidePanel({ riskData, isLoading }) {
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
            High-Risk Zones: <strong>{riskCounts.High}</strong> ({highPct}%)
          </span>
          <span className="meta-pill">
            Sectors Scanned: <strong>{totalCells}</strong>
          </span>
        </div>
      </section>

      {/* 2. Rainfall Intelligence Section */}
      <section className="panel-card rainfall-card">
        <div className="card-header">
          <div className="card-title-group">
            <span className="card-icon">🌧️</span>
            <div>
              <h3>Rainfall Saturation</h3>
              <span className="card-sub">Open-Meteo Live API</span>
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
                    key={idx}
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

      {/* 3. Terrain Slope & Topography Section */}
      <section className="panel-card terrain-card">
        <div className="card-header">
          <div className="card-title-group">
            <span className="card-icon">📐</span>
            <div>
              <h3>Topography & Slope Angle</h3>
              <span className="card-sub">
                {terrain?.is_synthetic ? 'Synthetic DEM Preview' : 'SRTM 90m Elevation Grid'}
              </span>
            </div>
          </div>
          <span className="data-source-tag">
            {terrain?.is_synthetic ? 'Preview' : 'OpenTopography'}
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

      {/* 4. Decision Rule Matrix Explainer */}
      <section className="panel-card matrix-card">
        <h4>⚡ Fusion Decision Matrix</h4>
        <p className="matrix-explanation">
          Slope angle governs gravitational shear stress; antecedent rainfall governs pore-water pressure.
          Slopes &gt;35° or hollow concavity under moderate-to-heavy rainfall trigger critical alert status.
        </p>
      </section>
    </aside>
  );
}

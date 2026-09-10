import React, { useState } from 'react';

export default function ApiKeyBanner({ isMock, terrainInfo }) {
  const [showInfo, setShowInfo] = useState(false);

  // Intentional Demo Mode indicator - replaces intrusive error banner
  return (
    <div className="demo-mode-bar">
      <div className="demo-mode-pill">
        <span className="demo-spark-icon">⚡</span>
        <span className="demo-pill-title">Demo Mode:</span>
        <span className="demo-pill-text">
          {terrainInfo?.data_source
            ? `Using ${terrainInfo.data_source} & calibrated rainfall profiles`
            : 'Using cached regional terrain & rainfall datasets'}
        </span>
        <button
          type="button"
          className="demo-info-btn"
          onClick={() => setShowInfo(!showInfo)}
        >
          {showInfo ? 'Hide Details' : 'Dataset Info'}
        </button>
      </div>

      {showInfo && (
        <div className="demo-info-dropdown">
          <p>
            <strong>Pre-Calibrated Regional Datasets:</strong> For instant responsiveness, zero latency,
            and offline resilience, the dashboard utilizes saved 90m SRTM digital elevation grids and
            calibrated precipitation time-series across all 5 quick presets.
          </p>
          <p className="demo-info-switch">
            To switch to live OpenTopography and Open-Meteo network queries, set <code>USE_MOCK_DATA=false</code> in <code>backend/.env</code>.
          </p>
        </div>
      )}
    </div>
  );
}

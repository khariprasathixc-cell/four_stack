import React from 'react';

const PRESETS = [
  {
    name: 'Wayanad, Kerala (High Hazard Zone)',
    lat: 11.5540,
    lon: 76.1306,
    radius: 3.0,
  },
  {
    name: 'Munnar, Western Ghats',
    lat: 10.0889,
    lon: 77.0595,
    radius: 3.0,
  },
  {
    name: 'Darjeeling, Himalayas',
    lat: 27.0410,
    lon: 88.2663,
    radius: 3.0,
  },
  {
    name: 'Amalfi Coast, Italy',
    lat: 40.6340,
    lon: 14.6027,
    radius: 2.5,
  },
  {
    name: 'Oso, Washington, USA',
    lat: 48.2770,
    lon: -121.9160,
    radius: 3.0,
  },
];

export default function ControlBar({
  lat,
  lon,
  radius,
  setLat,
  setLon,
  setRadius,
  onAnalyze,
  isLoading,
}) {
  const handleSubmit = (e) => {
    e.preventDefault();
    onAnalyze(parseFloat(lat), parseFloat(lon), parseFloat(radius));
  };

  const handlePresetSelect = (preset) => {
    setLat(preset.lat);
    setLon(preset.lon);
    setRadius(preset.radius);
    onAnalyze(preset.lat, preset.lon, preset.radius);
  };

  return (
    <div className="control-bar-container">
      <form className="control-form" onSubmit={handleSubmit}>
        <div className="input-group">
          <label htmlFor="input-lat">Latitude</label>
          <input
            id="input-lat"
            type="number"
            step="0.0001"
            value={lat}
            onChange={(e) => setLat(e.target.value)}
            required
            placeholder="e.g. 11.5540"
          />
        </div>

        <div className="input-group">
          <label htmlFor="input-lon">Longitude</label>
          <input
            id="input-lon"
            type="number"
            step="0.0001"
            value={lon}
            onChange={(e) => setLon(e.target.value)}
            required
            placeholder="e.g. 76.1306"
          />
        </div>

        <div className="input-group radius-group">
          <label htmlFor="input-radius">Radius (km)</label>
          <input
            id="input-radius"
            type="number"
            step="0.5"
            min="0.5"
            max="20"
            value={radius}
            onChange={(e) => setRadius(e.target.value)}
            required
          />
        </div>

        <button
          id="btn-analyze-risk"
          type="submit"
          className="btn-primary"
          disabled={isLoading}
        >
          {isLoading ? (
            <>
              <span className="spinner"></span>
              <span>Evaluating Risk...</span>
            </>
          ) : (
            <>
              <span>⚡ Compute Risk Assessment</span>
            </>
          )}
        </button>
      </form>

      <div className="presets-row">
        <span className="presets-title">Quick Regions:</span>
        <div className="presets-list">
          {PRESETS.map((p) => (
            <button
              key={p.name}
              type="button"
              className="preset-chip"
              onClick={() => handlePresetSelect(p)}
              disabled={isLoading}
            >
              📍 {p.name}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

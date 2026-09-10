import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';

export default function RiskMap({ geojsonData, centerLat, centerLon, radiusKm }) {
  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const geojsonLayerRef = useRef(null);
  const centerMarkerRef = useRef(null);

  const [activeLayerMode, setActiveLayerMode] = useState('final'); // 'final' | 'terrain'

  // Initialize map once
  useEffect(() => {
    if (!mapContainerRef.current) return;

    if (!mapInstanceRef.current) {
      const map = L.map(mapContainerRef.current, {
        center: [centerLat || 11.5540, centerLon || 76.1306],
        zoom: 13,
        zoomControl: false,
      });

      // Add zoom control in top-right
      L.control.zoom({ position: 'topright' }).addTo(map);

      // CartoDB Dark Matter / Positron or standard OpenStreetMap
      // Dark matter base map provides incredible visual contrast for hazard polygons
      L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 19,
      }).addTo(map);

      mapInstanceRef.current = map;
    }

    return () => {
      // Clean up map on unmount
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  // Update GeoJSON layer and bounds when geojsonData or activeLayerMode changes
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    // Remove previous GeoJSON layer if it exists
    if (geojsonLayerRef.current) {
      map.removeLayer(geojsonLayerRef.current);
      geojsonLayerRef.current = null;
    }

    // Remove previous center marker
    if (centerMarkerRef.current) {
      map.removeLayer(centerMarkerRef.current);
      centerMarkerRef.current = null;
    }

    // Add center coordinate circle marker
    if (centerLat && centerLon) {
      const marker = L.circleMarker([centerLat, centerLon], {
        radius: 7,
        fillColor: '#38bdf8',
        color: '#ffffff',
        weight: 2,
        opacity: 1,
        fillOpacity: 0.9,
      }).addTo(map);

      marker.bindPopup(`
        <div style="font-family: sans-serif; font-size: 13px; line-height: 1.4;">
          <strong>Target Center Point</strong><br/>
          Lat: ${centerLat.toFixed(4)}<br/>
          Lon: ${centerLon.toFixed(4)}<br/>
          Radius: ${radiusKm} km
        </div>
      `);
      centerMarkerRef.current = marker;
    }

    if (geojsonData && geojsonData.features && geojsonData.features.length > 0) {
      const layer = L.geoJSON(geojsonData, {
        style: (feature) => {
          const props = feature.properties || {};
          const fillColor =
            activeLayerMode === 'final'
              ? props.final_risk_color || '#10b981'
              : props.terrain_risk_color || '#10b981';

          return {
            fillColor: fillColor,
            weight: 1,
            opacity: 0.65,
            color: '#1e293b',
            dashArray: '',
            fillOpacity: 0.58,
          };
        },
        onEachFeature: (feature, featureLayer) => {
          const p = feature.properties || {};
          const isHigh = p.final_risk === 'High';
          const isMed = p.final_risk === 'Medium';
          const badgeClass = isHigh ? 'badge-high' : isMed ? 'badge-med' : 'badge-low';

          const curvatureDesc =
            p.curvature < -0.002
              ? 'Concave Hollow (Water Concentration)'
              : p.curvature > 0.002
              ? 'Convex Ridge (Divergent)'
              : 'Planar Slope';

          const popupHtml = `
            <div class="map-popup">
              <div class="popup-header">
                <span class="popup-cell-id">${p.cell_id}</span>
                <span class="popup-risk-badge ${badgeClass}">${p.final_risk} Risk</span>
              </div>
              <table class="popup-table">
                <tr><td>Slope Angle:</td><td><strong>${p.slope_deg}°</strong></td></tr>
                <tr><td>Elevation:</td><td>${p.elevation_m} m</td></tr>
                <tr><td>Terrain Hazard:</td><td>${p.terrain_risk}</td></tr>
                <tr><td>Rainfall Risk:</td><td>${p.rainfall_risk}</td></tr>
                <tr><td>24h Rainfall:</td><td>${p.rainfall_24h_mm} mm</td></tr>
                <tr><td>Curvature:</td><td>${curvatureDesc}</td></tr>
              </table>
            </div>
          `;

          featureLayer.bindPopup(popupHtml, { maxWidth: 300 });

          featureLayer.on({
            mouseover: (e) => {
              const l = e.target;
              l.setStyle({
                weight: 2.5,
                color: '#ffffff',
                fillOpacity: 0.82,
              });
              if (!L.Browser.ie && !L.Browser.opera && !L.Browser.edge) {
                l.bringToFront();
              }
            },
            mouseout: (e) => {
              layer.resetStyle(e.target);
            },
          });
        },
      }).addTo(map);

      geojsonLayerRef.current = layer;

      // Fit map to bounds of GeoJSON
      try {
        const bounds = layer.getBounds();
        if (bounds.isValid()) {
          map.fitBounds(bounds, { padding: [30, 30], maxZoom: 15 });
          setTimeout(() => {
            if (mapInstanceRef.current) {
              mapInstanceRef.current.invalidateSize();
            }
          }, 150);
        }
      } catch (err) {
        console.warn('Could not fit bounds:', err);
      }
    }
  }, [geojsonData, activeLayerMode, centerLat, centerLon, radiusKm]);

  return (
    <div className="risk-map-wrapper">
      <div className="map-layer-selector">
        <span className="selector-label">Display Layer:</span>
        <button
          className={`layer-toggle-btn ${activeLayerMode === 'final' ? 'active' : ''}`}
          onClick={() => setActiveLayerMode('final')}
        >
          Combined Risk (Terrain + Rain)
        </button>
        <button
          className={`layer-toggle-btn ${activeLayerMode === 'terrain' ? 'active' : ''}`}
          onClick={() => setActiveLayerMode('terrain')}
        >
          Terrain Slope Risk Only
        </button>
      </div>

      <div id="risk-map-container" ref={mapContainerRef} className="map-container"></div>

      <div className="map-legend">
        <div className="legend-title">Risk Severity</div>
        <div className="legend-items">
          <div className="legend-item">
            <span className="legend-color high"></span>
            <span>High Risk (Steep &gt;35° / Saturated)</span>
          </div>
          <div className="legend-item">
            <span className="legend-color medium"></span>
            <span>Medium Risk (15°–35° Slope / Moderate Rain)</span>
          </div>
          <div className="legend-item">
            <span className="legend-color low"></span>
            <span>Low Risk (&lt;15° Gentle / Saturated Flat)</span>
          </div>
        </div>
      </div>
    </div>
  );
}

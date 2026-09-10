import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';

export default function RiskMap({
  geojsonData,
  centerLat,
  centerLon,
  radiusKm,
  geofenceRadiusKm = 5.0,
  showGeofence = false,
  riskLevel = 'High',
  userGps = null,
  zoneName = '',
}) {
  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const geojsonLayerRef = useRef(null);
  const centerMarkerRef = useRef(null);
  const geofenceCircleRef = useRef(null);
  const userGpsMarkerRef = useRef(null);

  const [activeLayerMode, setActiveLayerMode] = useState('final'); // 'final' | 'terrain'
  const [forceGeofenceVisible, setForceGeofenceVisible] = useState(showGeofence);

  // Sync internal toggle if showGeofence changes from parent
  useEffect(() => {
    setForceGeofenceVisible(showGeofence);
  }, [showGeofence]);

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

      // OpenTopoMap with built-in topographic contours and hillshading (keyless)
      L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
        maxZoom: 17,
        subdomains: 'abc',
        attribution:
          'Map data: &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, <a href="http://viewfinderpanoramas.org">SRTM</a> | Map style: &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (<a href="https://creativecommons.org/licenses/by-sa/3.0/">CC-BY-SA</a>)',
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

  // Update GeoJSON, Geofence, and Markers
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    // 1. Remove previous layers
    if (geojsonLayerRef.current) {
      map.removeLayer(geojsonLayerRef.current);
      geojsonLayerRef.current = null;
    }
    if (centerMarkerRef.current) {
      map.removeLayer(centerMarkerRef.current);
      centerMarkerRef.current = null;
    }
    if (geofenceCircleRef.current) {
      map.removeLayer(geofenceCircleRef.current);
      geofenceCircleRef.current = null;
    }
    if (userGpsMarkerRef.current) {
      map.removeLayer(userGpsMarkerRef.current);
      userGpsMarkerRef.current = null;
    }

    // 2. Add Center Coordinate Marker
    if (centerLat && centerLon) {
      const marker = L.circleMarker([centerLat, centerLon], {
        radius: 8,
        fillColor: '#38bdf8',
        color: '#ffffff',
        weight: 2.5,
        opacity: 1,
        fillOpacity: 0.95,
      }).addTo(map);

      marker.bindPopup(`
        <div class="map-center-popup">
          <strong>🎯 ${zoneName || 'Epicenter Target'}</strong><br/>
          <span>Lat: ${centerLat.toFixed(4)}°, Lon: ${centerLon.toFixed(4)}°</span><br/>
          <span>Risk Level: <strong>${riskLevel}</strong></span><br/>
          <span>Geofence Radius: <strong>${geofenceRadiusKm} km</strong></span>
        </div>
      `);
      centerMarkerRef.current = marker;
    }

    // 3. Render Geofence Circle if enabled
    if (forceGeofenceVisible && centerLat && centerLon && geofenceRadiusKm > 0) {
      const radiusMeters = geofenceRadiusKm * 1000;
      const geofenceColor =
        riskLevel === 'High' ? '#ef4444' : riskLevel === 'Medium' ? '#f59e0b' : '#10b981';

      const circle = L.circle([centerLat, centerLon], {
        radius: radiusMeters,
        color: geofenceColor,
        weight: 2.5,
        opacity: 0.85,
        fillColor: geofenceColor,
        fillOpacity: 0.12,
        dashArray: '6, 6',
        className: 'pulsing-geofence-circle',
      }).addTo(map);

      circle.bindPopup(`
        <div class="map-center-popup">
          <strong style="color: ${geofenceColor}">🚨 SOS Hazard Geofence Perimeter</strong><br/>
          <span>Radius: <strong>${geofenceRadiusKm} km</strong> (${riskLevel} Risk Scale)</span><br/>
          <span>Any verified GPS within this circle triggers automated SOS alert dispatch.</span>
        </div>
      `);
      geofenceCircleRef.current = circle;
    }

    // 4. Render User GPS Marker if verified
    if (userGps && userGps.lat && userGps.lon) {
      const userMarker = L.circleMarker([userGps.lat, userGps.lon], {
        radius: 9,
        fillColor: userGps.isInside ? '#ef4444' : '#06b6d4',
        color: '#ffffff',
        weight: 3,
        opacity: 1,
        fillOpacity: 0.95,
        className: 'user-gps-pulse',
      }).addTo(map);

      userMarker.bindPopup(`
        <div class="map-center-popup">
          <strong>📱 Your Verified GPS Location</strong><br/>
          <span>Lat: ${userGps.lat.toFixed(4)}°, Lon: ${userGps.lon.toFixed(4)}°</span><br/>
          <span>Distance to Epicenter: <strong>${userGps.distanceKm != null ? userGps.distanceKm.toFixed(2) : '--'} km</strong></span><br/>
          <span style="color: ${userGps.isInside ? '#ef4444' : '#10b981'}; font-weight: bold;">
            ${userGps.isInside ? '⚠️ INSIDE HAZARD GEOFENCE' : '✅ Outside Hazard Perimeter'}
          </span>
        </div>
      `);
      userGpsMarkerRef.current = userMarker;
    }

    // 5. Render Terrain Risk GeoJSON
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

      // Fit map to bounds of GeoJSON or Geofence
      try {
        if (forceGeofenceVisible && geofenceCircleRef.current) {
          const circleBounds = geofenceCircleRef.current.getBounds();
          map.fitBounds(circleBounds, { padding: [40, 40], maxZoom: 14 });
        } else {
          const bounds = layer.getBounds();
          if (bounds.isValid()) {
            map.fitBounds(bounds, { padding: [30, 30], maxZoom: 15 });
          }
        }
        setTimeout(() => {
          if (mapInstanceRef.current) {
            mapInstanceRef.current.invalidateSize();
          }
        }, 150);
      } catch (err) {
        console.warn('Could not fit map bounds:', err);
      }
    }
  }, [
    geojsonData,
    activeLayerMode,
    centerLat,
    centerLon,
    radiusKm,
    geofenceRadiusKm,
    forceGeofenceVisible,
    riskLevel,
    userGps,
    zoneName,
  ]);

  return (
    <div className="risk-map-wrapper">
      <div className="map-layer-selector">
        <span className="selector-label">Display Mode:</span>
        <button
          className={`layer-toggle-btn ${activeLayerMode === 'final' ? 'active' : ''}`}
          onClick={() => setActiveLayerMode('final')}
        >
          Combined Risk
        </button>
        <button
          className={`layer-toggle-btn ${activeLayerMode === 'terrain' ? 'active' : ''}`}
          onClick={() => setActiveLayerMode('terrain')}
        >
          Terrain Slope
        </button>
        <button
          className={`layer-toggle-btn geofence-toggle ${forceGeofenceVisible ? 'active' : ''}`}
          onClick={() => setForceGeofenceVisible(!forceGeofenceVisible)}
        >
          {forceGeofenceVisible ? `🛡️ Geofence (${geofenceRadiusKm}km) ON` : '🛡️ Show Geofence'}
        </button>
      </div>

      <div id="risk-map-container" ref={mapContainerRef} className="map-container"></div>

      <div className="map-legend">
        <div className="legend-title">Risk Severity & Geofence</div>
        <div className="legend-items">
          <div className="legend-item">
            <span className="legend-color high"></span>
            <span>High Risk (Steep &gt;35° / Saturated) • 5km Geofence</span>
          </div>
          <div className="legend-item">
            <span className="legend-color medium"></span>
            <span>Medium Risk (15°–35° Slope) • 3km Geofence</span>
          </div>
          <div className="legend-item">
            <span className="legend-color low"></span>
            <span>Low Risk (&lt;15° Gentle) • 1km Geofence</span>
          </div>
        </div>
      </div>
    </div>
  );
}

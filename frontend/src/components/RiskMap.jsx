import React, { useEffect, useRef, useState, useMemo } from 'react';
import L from 'leaflet';

/**
 * Multi-Directional Shaded Relief & Hypsometric Mountain Color Engine.
 * Computes multi-source Lambertian illumination + realistic terrain hypsometric palette + procedural rock/vegetation micro-texture.
 * Pure lightweight Canvas raster rendering (no WebGL / Three.js).
 */
function generateRealisticHillshadeDataUrl(geojsonData) {
  const meta = geojsonData?.metadata || {};
  const elevMatrix = meta.elevation_matrix;
  const slopeMatrix = meta.slope_matrix;

  if (!elevMatrix || !Array.isArray(elevMatrix) || elevMatrix.length === 0) {
    return null;
  }

  const rows = elevMatrix.length;
  const cols = elevMatrix[0].length;

  const canvas = document.createElement('canvas');
  canvas.width = 400;
  canvas.height = 400;
  const ctx = canvas.getContext('2d');
  const imgData = ctx.createImageData(canvas.width, canvas.height);
  const data = imgData.data;

  // Multi-directional illumination sources (Swiss cartographic hillshade standard):
  // 1. Primary NW sun: 315°, altitude 45° (strong directional mountain crest definition)
  // 2. Secondary SW fill light: 225°, altitude 35° (prevents harsh black shadow clipping in gullies)
  // 3. High Zenith ambient fill: 0° N, altitude 65° (overall valley visibility)
  const lightSources = [
    { azimuth: (315.0 * Math.PI) / 180.0, zenith: (45.0 * Math.PI) / 180.0, weight: 0.58 },
    { azimuth: (225.0 * Math.PI) / 180.0, zenith: (55.0 * Math.PI) / 180.0, weight: 0.24 },
    { azimuth: (0.0 * Math.PI) / 180.0, zenith: (25.0 * Math.PI) / 180.0, weight: 0.18 },
  ];
  const ambientLight = 0.09;

  const minElev = meta.min_elevation_m || 500;
  const maxElev = meta.max_elevation_m || 2400;
  const elevRange = Math.max(1, maxElev - minElev);

  // Hypsometric terrain relief color ramp definitions (Real Mountain Topographic Palette)
  // Valley lush greens -> timberline forest -> exposed rock/scree -> dark granite slate -> snowcap peaks
  const colorStops = [
    { t: 0.00, r: 28, g: 68, b: 26 },    // Valley bottom lush montane valley (#1c441a)
    { t: 0.18, r: 45, g: 86, b: 34 },    // Lower slope dense evergreen canopy (#2d5622)
    { t: 0.38, r: 69, g: 99, b: 42 },    // Subalpine mixed coniferous timberline (#45632a)
    { t: 0.58, r: 111, g: 115, b: 68 },  // Timberline alpine scrub / mossy crags (#6f7344)
    { t: 0.72, r: 147, g: 130, b: 104 }, // Exposed scree / warm talus rock slope (#938268)
    { t: 0.85, r: 83, g: 85, b: 92 },    // Craggy metamorphic granite / slate cliffs (#53555c)
    { t: 0.94, r: 138, g: 146, b: 157 }, // High alpine cold rock / frost (#8a929d)
    { t: 1.00, r: 237, g: 244, b: 250 }, // Summit snow-capped crest highlight (#edf4fa)
  ];

  function interpolatePalette(normT) {
    const clamped = Math.max(0, Math.min(1, normT));
    for (let i = 0; i < colorStops.length - 1; i++) {
      if (clamped >= colorStops[i].t && clamped <= colorStops[i + 1].t) {
        const span = colorStops[i + 1].t - colorStops[i].t;
        const f = span > 0 ? (clamped - colorStops[i].t) / span : 0;
        return {
          r: colorStops[i].r + f * (colorStops[i + 1].r - colorStops[i].r),
          g: colorStops[i].g + f * (colorStops[i + 1].g - colorStops[i].g),
          b: colorStops[i].b + f * (colorStops[i + 1].b - colorStops[i].b),
        };
      }
    }
    return { r: colorStops[colorStops.length - 1].r, g: colorStops[colorStops.length - 1].g, b: colorStops[colorStops.length - 1].b };
  }

  // Fast deterministic procedural micro-texture generator (rock fissures, canopy roughness)
  function getProceduralNoise(x, y, elev) {
    const s1 = Math.sin(x * 0.18 + y * 0.12) * Math.cos(x * 0.09 - y * 0.22);
    const s2 = Math.sin((elev / 14.0) + x * 0.06 + y * 0.04);
    const s3 = Math.cos(x * 0.35 - y * 0.15);
    return (s1 * 0.5 + s2 * 0.35 + s3 * 0.15);
  }

  for (let py = 0; py < canvas.height; py++) {
    const gy = (py / (canvas.height - 1)) * (rows - 1);
    const r0 = Math.floor(gy);
    const r1 = Math.min(rows - 1, r0 + 1);
    const ry = gy - r0;

    for (let px = 0; px < canvas.width; px++) {
      const gx = (px / (canvas.width - 1)) * (cols - 1);
      const c0 = Math.floor(gx);
      const c1 = Math.min(cols - 1, c0 + 1);
      const rx = gx - c0;

      // Smooth bilinear interpolation of elevation grid
      const e00 = elevMatrix[r0][c0];
      const e01 = elevMatrix[r0][c1];
      const e10 = elevMatrix[r1][c0];
      const e11 = elevMatrix[r1][c1];
      const elev =
        (1 - ry) * ((1 - rx) * e00 + rx * e01) + ry * ((1 - rx) * e10 + rx * e11);

      // Local topographic gradient
      const dz_dx = (e01 - e00 + (e11 - e10)) / 2.0;
      const dz_dy = (e10 - e00 + (e11 - e01)) / 2.0;

      // Aspect angle
      let aspect = Math.atan2(dz_dy, -dz_dx);
      if (aspect < 0) aspect += 2 * Math.PI;

      // Slope angle (exaggerated slightly for mountain demo drama)
      const gradMag = Math.hypot(dz_dx, dz_dy);
      const slopeRad = Math.atan(gradMag * 0.095);
      const slopeDeg = (slopeRad * 180.0) / Math.PI;

      // Multi-directional Lambertian shaded relief
      let totalIllumination = ambientLight;
      for (const light of lightSources) {
        let shade =
          Math.cos(light.zenith) * Math.cos(slopeRad) +
          Math.sin(light.zenith) * Math.sin(slopeRad) * Math.cos(light.azimuth - aspect);
        shade = Math.max(0.0, shade);
        totalIllumination += light.weight * shade;
      }
      totalIllumination = Math.max(0.0, Math.min(1.0, totalIllumination));

      // Ridgeline / Crest Highlight and Ravine Ambient Occlusion
      const curvature = (e01 + e10 + (r0 > 0 ? elevMatrix[r0 - 1][c0] : e00) + (c0 > 0 ? elevMatrix[r0][c0 - 1] : e00) - 4 * elev);
      const ridgeBoost = curvature < -1.5 ? Math.min(0.28, Math.abs(curvature) * 0.04) : 0;
      const ravineShadow = curvature > 1.5 ? Math.min(0.25, curvature * 0.035) : 0;

      // Hypsometric terrain base color
      const normElev = Math.max(0, Math.min(1, (elev - minElev) / elevRange));
      const baseCol = interpolatePalette(normElev);

      // Blend steep slopes (>20°) toward rugged exposed rock slate & cliffs
      if (slopeDeg > 20) {
        const rockFactor = Math.min(0.72, (slopeDeg - 20) / 26.0);
        baseCol.r = baseCol.r * (1 - rockFactor) + 95 * rockFactor;
        baseCol.g = baseCol.g * (1 - rockFactor) + 92 * rockFactor;
        baseCol.b = baseCol.b * (1 - rockFactor) + 90 * rockFactor;
      }

      // Procedural micro-texture modulation
      const microNoise = getProceduralNoise(px, py, elev);
      const textureMod = 1.0 + microNoise * (normElev > 0.6 ? 0.12 : 0.07);

      // Modulate with multi-directional lighting + ridge boost - ravine shadow
      const lightFactor = Math.max(0.2, (0.32 + 1.35 * totalIllumination + ridgeBoost - ravineShadow) * textureMod);
      let finalR = Math.min(255, Math.floor(baseCol.r * lightFactor));
      let finalG = Math.min(255, Math.floor(baseCol.g * lightFactor));
      let finalB = Math.min(255, Math.floor(baseCol.b * lightFactor));

      // Deep atmospheric ravine shadow tinting (cool blue-gray ambient occlusion)
      if (totalIllumination < 0.40) {
        const shadowTint = (0.40 - totalIllumination) / 0.40;
        finalR = Math.floor(finalR * (1 - shadowTint * 0.38) + 20 * (shadowTint * 0.38));
        finalG = Math.floor(finalG * (1 - shadowTint * 0.38) + 28 * (shadowTint * 0.38));
        finalB = Math.floor(finalB * (1 - shadowTint * 0.38) + 44 * (shadowTint * 0.38));
      }

      // High peak frost rim light on summit ridges
      if (normElev > 0.88 && totalIllumination > 0.65) {
        const snowGlint = (normElev - 0.88) / 0.12;
        finalR = Math.min(255, finalR + Math.floor(40 * snowGlint));
        finalG = Math.min(255, finalG + Math.floor(45 * snowGlint));
        finalB = Math.min(255, finalB + Math.floor(55 * snowGlint));
      }

      const pIdx = (py * canvas.width + px) * 4;
      data[pIdx] = finalR;
      data[pIdx + 1] = finalG;
      data[pIdx + 2] = finalB;
      data[pIdx + 3] = 238; // Crisp, rich relief opacity
    }
  }

  ctx.putImageData(imgData, 0, 0);
  return canvas.toDataURL();
}

/**
 * Generates an integrated, soft-edged Contour Hazard Zone Overlay for Red / High-Risk slopes.
 * Rather than a generic geometric box/circle, this generates a terrain-conforming heat aura
 * that hugs the steep contours around active landslide alert positions.
 */
function generateContourHazardOverlayDataUrl(geojsonData, sensors) {
  const meta = geojsonData?.metadata || {};
  const elevMatrix = meta.elevation_matrix;
  const slopeMatrix = meta.slope_matrix;
  const bounds = meta.bounds;

  if (!elevMatrix || !Array.isArray(elevMatrix) || !bounds) return null;

  const rows = elevMatrix.length;
  const cols = elevMatrix[0].length;

  const canvas = document.createElement('canvas');
  canvas.width = 360;
  canvas.height = 360;
  const ctx = canvas.getContext('2d');
  const imgData = ctx.createImageData(canvas.width, canvas.height);
  const data = imgData.data;

  // Identify all high-risk epicenters from Red sensors + steep hazard sectors
  const alertNodes = (sensors || []).filter((s) => s.status_level === 'High');
  if (alertNodes.length === 0) {
    return null; // No active red alert -> no danger flare
  }

  const alertCenters = alertNodes.map((s) => {
    const u = (s.lon - bounds.west) / (bounds.east - bounds.west);
    const v = (bounds.north - s.lat) / (bounds.north - bounds.south);
    return {
      x: u * canvas.width,
      y: v * canvas.height,
      radius: 80, // Influence radius in pixels
      intensity: 1.0,
    };
  });

  for (let py = 0; py < canvas.height; py++) {
    const gy = (py / (canvas.height - 1)) * (rows - 1);
    const r0 = Math.min(rows - 1, Math.floor(gy));

    for (let px = 0; px < canvas.width; px++) {
      const gx = (px / (canvas.width - 1)) * (cols - 1);
      const c0 = Math.min(cols - 1, Math.floor(gx));

      const slope = slopeMatrix ? slopeMatrix[r0][c0] : 25;
      const elev = elevMatrix[r0][c0];

      // Calculate organic hazard field influence
      let maxHazard = 0.0;
      for (const center of alertCenters) {
        const dist = Math.hypot(px - center.x, py - center.y);
        if (dist < center.radius * 1.5) {
          // Weight hazard expansion along steeper slope contours
          const slopeExpansion = slope >= 28 ? 1.3 : slope >= 18 ? 1.0 : 0.75;
          const effRadius = center.radius * slopeExpansion;
          const falloff = Math.exp(-Math.pow(dist / effRadius, 2));
          maxHazard = Math.max(maxHazard, falloff * center.intensity);
        }
      }

      if (maxHazard > 0.035) {
        const pIdx = (py * canvas.width + px) * 4;

        // Subtle topographic shear contour lines across the hazard face
        const contourWave = Math.sin((elev / 28.0) * Math.PI);
        const isContourLine = Math.abs(contourWave) > 0.88;

        // Crimson alert gradient: Fiery crimson (#ef4444) at core -> Amber (#f59e0b) at edges
        const redVal = 239;
        const greenVal = Math.floor(45 + 110 * (1 - maxHazard));
        const blueVal = 50;

        // Feathered alpha opacity conforming to hazard intensity
        let alpha = Math.floor(maxHazard * 175);
        if (isContourLine) {
          alpha = Math.min(235, alpha + 50);
        }

        data[pIdx] = redVal;
        data[pIdx + 1] = greenVal;
        data[pIdx + 2] = blueVal;
        data[pIdx + 3] = alpha;
      }
    }
  }

  ctx.putImageData(imgData, 0, 0);
  return canvas.toDataURL();
}

/**
 * Multi-Point Sensor Fusion Evaluator
 */
function computePointStatus(rainfallRisk, piezoRisk) {
  const isPiezoAlert = String(piezoRisk).toLowerCase() === 'alert';
  const isRainHigh = String(rainfallRisk).toLowerCase() === 'high';
  const isRainElevated = ['medium', 'high'].includes(String(rainfallRisk).toLowerCase());

  if (isPiezoAlert && isRainHigh) {
    return {
      level: 'High',
      label: 'High Risk / Landslide Warning',
      color: '#ef4444',
      code: 'warning',
      reason: 'CRITICAL: Simultaneous piezo fracture trigger + heavy rainfall saturation.',
    };
  } else if (isPiezoAlert || isRainElevated) {
    return {
      level: 'Medium',
      label: 'Elevated Watch',
      color: '#f59e0b',
      code: 'watch',
      reason: isPiezoAlert
        ? 'WATCH: Localized acoustic crack disturbance detected (Rainfall not yet at cloudburst stage).'
        : 'WATCH: Saturated slope conditions under elevated rainfall (Piezo vibrations nominal).',
    };
  } else {
    return {
      level: 'Low',
      label: 'Safe / Normal',
      color: '#10b981',
      code: 'safe',
      reason: 'NORMAL: Stable micro-acoustic baseline and gentle/minimal rainfall.',
    };
  }
}

export default function RiskMap({
  geojsonData,
  sensors = [],
  piezoState = 'standby',
  rainfallData = null,
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
  const hillshadeLayerRef = useRef(null);
  const hazardContourLayerRef = useRef(null);
  const sensorMarkersGroupRef = useRef(null);
  const centerMarkerRef = useRef(null);
  const geofenceCircleRef = useRef(null);
  const userGpsMarkerRef = useRef(null);

  // Display Modes: 'relief' | 'fused_grid' | 'terrain_slope'
  const [activeLayerMode, setActiveLayerMode] = useState('relief');
  const [forceGeofenceVisible, setForceGeofenceVisible] = useState(showGeofence);
  const [selectedSensorId, setSelectedSensorId] = useState(null);

  // Sync internal toggle if showGeofence changes from parent
  useEffect(() => {
    setForceGeofenceVisible(showGeofence);
  }, [showGeofence]);

  // Initialize Map once
  useEffect(() => {
    if (!mapContainerRef.current) return;

    if (!mapInstanceRef.current) {
      const map = L.map(mapContainerRef.current, {
        center: [centerLat || 11.5540, centerLon || 76.1306],
        zoom: 13,
        zoomControl: false,
      });

      L.control.zoom({ position: 'topright' }).addTo(map);

      // OpenTopoMap with topographic contours & hillshade base
      L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
        maxZoom: 17,
        subdomains: 'abc',
        attribution:
          'Map data: &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, SRTM | Map style: &copy; <a href="https://opentopomap.org">OpenTopoMap</a>',
      }).addTo(map);

      // Dedicated group for sensor point markers
      sensorMarkersGroupRef.current = L.layerGroup().addTo(map);

      mapInstanceRef.current = map;
    }

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  // Compute live updated sensors array (wiring PZ-01 to real live hardware state)
  const computedSensors = useMemo(() => {
    if (!sensors || sensors.length === 0) return [];
    const rainRisk = rainfallData?.rainfall_risk || (riskLevel === 'High' ? 'High' : 'Medium');
    const rain24 = rainfallData?.accumulation_24h_mm || 0;

    return sensors.map((s) => {
      const isLiveNode = s.is_live === true || s.id === 'PZ-01';
      // If live node, bind to live hardware mic/audio detection state
      const effectivePiezo = isLiveNode
        ? piezoState === 'alert'
          ? 'Alert'
          : 'Normal'
        : s.piezo_risk || 'Normal';

      const effectiveRain = s.rainfall_risk || rainRisk;
      const fusion = computePointStatus(effectiveRain, effectivePiezo);

      return {
        ...s,
        is_live: isLiveNode,
        rainfall_risk: effectiveRain,
        rainfall_24h_mm: s.rainfall_24h_mm || rain24,
        piezo_risk: effectivePiezo,
        status_level: fusion.level,
        status_label: fusion.label,
        status_color: fusion.color,
        status_code: fusion.code,
        status_reason: fusion.reason,
      };
    });
  }, [sensors, piezoState, rainfallData, riskLevel]);

  // Sensor stats summary for quick overlay HUD
  const sensorStats = useMemo(() => {
    const counts = { High: 0, Medium: 0, Low: 0 };
    computedSensors.forEach((s) => {
      if (counts[s.status_level] !== undefined) counts[s.status_level]++;
    });
    return counts;
  }, [computedSensors]);

  const hasRedAlert = sensorStats.High > 0;

  // Main Map Layers & Markers Render Loop
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    // 1. Remove previous dynamic layers
    if (hillshadeLayerRef.current) {
      map.removeLayer(hillshadeLayerRef.current);
      hillshadeLayerRef.current = null;
    }
    if (hazardContourLayerRef.current) {
      map.removeLayer(hazardContourLayerRef.current);
      hazardContourLayerRef.current = null;
    }
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
    if (sensorMarkersGroupRef.current) {
      sensorMarkersGroupRef.current.clearLayers();
    }

    // 2. Render Enhanced 2D Mountain Multi-Directional Relief Canvas Layer
    const boundsMeta = geojsonData?.metadata?.bounds;
    if (boundsMeta && (activeLayerMode === 'relief' || activeLayerMode === 'fused_grid')) {
      const hillshadeDataUrl = generateRealisticHillshadeDataUrl(geojsonData);
      if (hillshadeDataUrl) {
        const imageBounds = [
          [boundsMeta.south, boundsMeta.west],
          [boundsMeta.north, boundsMeta.east],
        ];
        const opacity = activeLayerMode === 'relief' ? 0.92 : 0.45;
        const overlay = L.imageOverlay(hillshadeDataUrl, imageBounds, {
          opacity: opacity,
          interactive: false,
          className: 'mountain-hillshade-overlay',
        }).addTo(map);
        hillshadeLayerRef.current = overlay;
      }

      // 2b. Render Distinct Contoured Danger Zone Highlight Layer (Pulsing Red Hazard Aura)
      if (hasRedAlert) {
        const hazardDataUrl = generateContourHazardOverlayDataUrl(geojsonData, computedSensors);
        if (hazardDataUrl) {
          const imageBounds = [
            [boundsMeta.south, boundsMeta.west],
            [boundsMeta.north, boundsMeta.east],
          ];
          const hazardOverlay = L.imageOverlay(hazardDataUrl, imageBounds, {
            opacity: 0.85,
            interactive: false,
            className: 'hazard-zone-pulsing-overlay',
          }).addTo(map);
          hazardContourLayerRef.current = hazardOverlay;
        }
      }
    }

    // 3. Render GeoJSON Hazard Cells
    if (geojsonData && geojsonData.features && geojsonData.features.length > 0) {
      const isReliefMode = activeLayerMode === 'relief';
      const isTerrainMode = activeLayerMode === 'terrain_slope';

      const layer = L.geoJSON(geojsonData, {
        style: (feature) => {
          const props = feature.properties || {};
          const fillColor = isTerrainMode
            ? props.terrain_risk_color || '#10b981'
            : props.final_risk_color || '#10b981';

          return {
            fillColor: fillColor,
            weight: isReliefMode ? 0.75 : 1.2,
            opacity: isReliefMode ? 0.22 : 0.65,
            color: isReliefMode ? '#38bdf8' : '#1e293b',
            dashArray: isReliefMode ? '3, 3' : '',
            fillOpacity: isReliefMode ? 0.1 : 0.58,
          };
        },
        onEachFeature: (feature, featureLayer) => {
          const p = feature.properties || {};
          const isHigh = p.final_risk === 'High';
          const isMed = p.final_risk === 'Medium';
          const badgeClass = isHigh ? 'badge-high' : isMed ? 'badge-med' : 'badge-low';

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
              </table>
            </div>
          `;
          featureLayer.bindPopup(popupHtml, { maxWidth: 300 });
        },
      }).addTo(map);

      geojsonLayerRef.current = layer;
    }

    // 4. Render Distributed Multi-Point Sensor Grid Overlay (3D Grounded Beacon Pins)
    if (computedSensors && computedSensors.length > 0 && sensorMarkersGroupRef.current) {
      // Find min/max elevation across sensors for realistic pseudo-perspective depth scaling
      const elevs = computedSensors.map((s) => s.elevation_m || 1000);
      const minSenElev = Math.min(...elevs);
      const maxSenElev = Math.max(...elevs);
      const elevSpan = Math.max(1, maxSenElev - minSenElev);

      computedSensors.forEach((s) => {
        const isLive = s.is_live;
        const color = s.status_color || '#10b981';
        const isAlert = s.status_level === 'High';
        const isWatch = s.status_level === 'Medium';

        // Normalized elevation: lower elevation = foreground (larger scale), higher elevation = distance (smaller scale)
        const normElev = ((s.elevation_m || 1000) - minSenElev) / elevSpan;
        const depthScale = (1.12 - normElev * 0.26).toFixed(2); // Scales between 0.86 (summit) and 1.12 (valley foreground)

        const pinClass = isLive
          ? 'beacon-pin live-beacon'
          : isAlert
          ? 'beacon-pin alert-beacon'
          : isWatch
          ? 'beacon-pin watch-beacon'
          : 'beacon-pin safe-beacon';

        // 3D Mountain Beacon Pin HTML with grounded drop shadow & beacon pole
        const beaconHtml = `
          <div class="mountain-beacon-wrapper" style="transform: scale(${depthScale});" title="${s.name} (${s.elevation_m}m)">
            <div class="beacon-ground-shadow"></div>
            <div class="${pinClass}">
              <div class="beacon-head" style="background: ${isLive ? '#38bdf8' : color}; box-shadow: 0 0 12px ${isLive ? '#38bdf8' : color};">
                <span class="beacon-dot"></span>
                ${isAlert ? '<span class="beacon-danger-ping"></span>' : ''}
                ${isLive ? '<span class="beacon-live-ping"></span>' : ''}
              </div>
              <div class="beacon-stem"></div>
              <div class="beacon-base"></div>
              <div class="beacon-label-tag ${isLive ? 'live-tag' : ''}">${s.id}</div>
            </div>
          </div>
        `;

        const beaconIcon = L.divIcon({
          className: 'custom-mountain-beacon-icon',
          html: beaconHtml,
          iconSize: [36, 48],
          iconAnchor: [18, 44],
          popupAnchor: [0, -42],
        });

        const beaconMarker = L.marker([s.lat, s.lon], { icon: beaconIcon });

        // Detailed Geotechnical Sensor Node Popup
        const badgeClass =
          s.status_level === 'High'
            ? 'badge-high'
            : s.status_level === 'Medium'
            ? 'badge-med'
            : 'badge-low';

        const piezoBadge =
          s.piezo_risk === 'Alert'
            ? '<span class="status-tag tag-danger">⚡ SPIKE / CRACK ALERT</span>'
            : '<span class="status-tag tag-normal">✅ Normal Vibration</span>';

        const rainBadge =
          s.rainfall_risk === 'High'
            ? '<span class="status-tag tag-danger">🌧️ High Saturation</span>'
            : s.rainfall_risk === 'Medium'
            ? '<span class="status-tag tag-warning">🌧️ Moderate Rain</span>'
            : '<span class="status-tag tag-normal">⛅ Low Rain</span>';

        const popupHtml = `
          <div class="sensor-popup-card">
            <div class="sensor-popup-header">
              <div class="sensor-tag-row">
                <span class="sensor-type-pill ${isLive ? 'live-pill' : 'grid-pill'}">
                  ${isLive ? '⚡ LIVE HARDWARE SENSOR' : '📡 TELEMETRY NODE'}
                </span>
                <span class="popup-risk-badge ${badgeClass}">${s.status_label}</span>
              </div>
              <h4 class="sensor-node-title">${s.name}</h4>
              <div class="sensor-location-desc">📍 ${s.location_desc || 'Mountain Slope Position'}</div>
            </div>

            <div class="sensor-telemetry-body">
              <div class="tel-row">
                <span class="tel-name">Rainfall Risk:</span>
                <span class="tel-value">${rainBadge} (${s.rainfall_24h_mm}mm / 24h)</span>
              </div>
              <div class="tel-row">
                <span class="tel-name">Piezo Acoustic State:</span>
                <span class="tel-value">${piezoBadge}</span>
              </div>
              <div class="tel-row">
                <span class="tel-name">Terrain Topography:</span>
                <span class="tel-value">📐 Slope: <strong>${s.slope_deg}°</strong> • 🏔️ Elev: <strong>${s.elevation_m}m</strong></span>
              </div>
              <div class="tel-fusion-box">
                <div class="fusion-box-title">⚡ Point Fusion Assessment:</div>
                <div class="fusion-box-desc">${s.status_reason}</div>
              </div>
            </div>

            <div class="sensor-popup-footer">
              <span>Coords: ${s.lat.toFixed(4)}°, ${s.lon.toFixed(4)}°</span>
              <span>Updated: ${new Date(s.last_updated).toLocaleTimeString()}</span>
            </div>
          </div>
        `;

        beaconMarker.bindPopup(popupHtml, { maxWidth: 330, className: 'custom-sensor-leaflet-popup' });
        beaconMarker.on('click', () => setSelectedSensorId(s.id));

        sensorMarkersGroupRef.current.addLayer(beaconMarker);
      });
    }

    // 5. Render Center Target Marker
    if (centerLat && centerLon) {
      const marker = L.circleMarker([centerLat, centerLon], {
        radius: 6,
        fillColor: '#38bdf8',
        color: '#ffffff',
        weight: 2,
        opacity: 0.9,
        fillOpacity: 0.9,
      }).addTo(map);

      marker.bindPopup(`
        <div class="map-center-popup">
          <strong>🎯 ${zoneName || 'Regional Center'}</strong><br/>
          <span>Lat: ${centerLat.toFixed(4)}°, Lon: ${centerLon.toFixed(4)}°</span><br/>
          <span>Geofence Radius: <strong>${geofenceRadiusKm} km</strong></span>
        </div>
      `);
      centerMarkerRef.current = marker;
    }

    // 6. Render Geofence Circle if enabled
    if (forceGeofenceVisible && centerLat && centerLon && geofenceRadiusKm > 0) {
      const radiusMeters = geofenceRadiusKm * 1000;
      const geofenceColor =
        riskLevel === 'High' ? '#ef4444' : riskLevel === 'Medium' ? '#f59e0b' : '#10b981';

      const circle = L.circle([centerLat, centerLon], {
        radius: radiusMeters,
        color: geofenceColor,
        weight: 2,
        opacity: 0.85,
        fillColor: geofenceColor,
        fillOpacity: 0.1,
        dashArray: '6, 6',
        className: 'pulsing-geofence-circle',
      }).addTo(map);

      circle.bindPopup(`
        <div class="map-center-popup">
          <strong style="color: ${geofenceColor}">🚨 SOS Hazard Geofence (${geofenceRadiusKm}km)</strong><br/>
          <span>Automatic SMS alert zone under ${riskLevel} landslide danger.</span>
        </div>
      `);
      geofenceCircleRef.current = circle;
    }

    // 7. Render User GPS Marker if verified
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
          <strong>📱 Verified Mobile GPS</strong><br/>
          <span>Lat: ${userGps.lat.toFixed(4)}°, Lon: ${userGps.lon.toFixed(4)}°</span><br/>
          <span>Distance to Slope: <strong>${userGps.distanceKm != null ? userGps.distanceKm.toFixed(2) : '--'} km</strong></span><br/>
          <span style="color: ${userGps.isInside ? '#ef4444' : '#10b981'}; font-weight: bold;">
            ${userGps.isInside ? '⚠️ INSIDE GEOFENCE' : '✅ Outside Hazard Perimeter'}
          </span>
        </div>
      `);
      userGpsMarkerRef.current = userMarker;
    }

    // Fit bounds smoothly
    try {
      if (forceGeofenceVisible && geofenceCircleRef.current) {
        const circleBounds = geofenceCircleRef.current.getBounds();
        map.fitBounds(circleBounds, { padding: [40, 40], maxZoom: 14 });
      } else if (geojsonLayerRef.current) {
        const bounds = geojsonLayerRef.current.getBounds();
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
  }, [
    geojsonData,
    computedSensors,
    activeLayerMode,
    centerLat,
    centerLon,
    radiusKm,
    geofenceRadiusKm,
    forceGeofenceVisible,
    riskLevel,
    userGps,
    zoneName,
    hasRedAlert,
  ]);

  return (
    <div className="risk-map-wrapper">
      {/* 1. Map Layer & Mode Selector Toolbar */}
      <div className="map-layer-selector">
        <span className="selector-label">Mountain View:</span>
        <button
          className={`layer-toggle-btn ${activeLayerMode === 'relief' ? 'active' : ''}`}
          onClick={() => setActiveLayerMode('relief')}
          title="2D Realistic Mountain Relief + Contour Hazard Highlight"
        >
          🏔️ 2D Realistic Relief
        </button>
        <button
          className={`layer-toggle-btn ${activeLayerMode === 'fused_grid' ? 'active' : ''}`}
          onClick={() => setActiveLayerMode('fused_grid')}
          title="Combined Terrain & Rainfall Risk Grid Polygons"
        >
          ⚡ Fused Grid
        </button>
        <button
          className={`layer-toggle-btn ${activeLayerMode === 'terrain_slope' ? 'active' : ''}`}
          onClick={() => setActiveLayerMode('terrain_slope')}
          title="SRTM Slope Angle Hazards"
        >
          📐 Slope Hazards
        </button>
        <button
          className={`layer-toggle-btn geofence-toggle ${forceGeofenceVisible ? 'active' : ''}`}
          onClick={() => setForceGeofenceVisible(!forceGeofenceVisible)}
        >
          {forceGeofenceVisible ? `🛡️ Geofence (${geofenceRadiusKm}km) ON` : '🛡️ Show Geofence'}
        </button>
      </div>

      {/* 2. Sensor Network Status HUD Overlay */}
      <div className="map-sensor-hud">
        <div className="hud-title-row">
          <span className="hud-icon">📡</span>
          <span className="hud-title">Slope Sensor Network ({computedSensors.length} Nodes)</span>
        </div>
        <div className="hud-counts-row">
          <div className={`hud-stat warning ${hasRedAlert ? 'pulse-alert-hud' : ''}`}>
            <span className="hud-dot red"></span>
            <span>{sensorStats.High} Landslide Warning</span>
          </div>
          <div className="hud-stat watch">
            <span className="hud-dot yellow"></span>
            <span>{sensorStats.Medium} Watch</span>
          </div>
          <div className="hud-stat safe">
            <span className="hud-dot green"></span>
            <span>{sensorStats.Low} Safe</span>
          </div>
        </div>
      </div>

      {/* 3. Active Landslide Hazard Zone Banner (Only visible when Red alert active) */}
      {hasRedAlert && (
        <div className="active-danger-zone-badge">
          <span className="danger-zone-icon">🚨</span>
          <span className="danger-zone-text">
            <strong>ACTIVE LANDSLIDE THREAT ZONE</strong>: Contoured hazard highlight active on slope
          </span>
        </div>
      )}

      {/* 4. Leaflet Map Container */}
      <div id="risk-map-container" ref={mapContainerRef} className="map-container"></div>

      {/* 5. Enhanced Legend */}
      <div className="map-legend">
        <div className="legend-title">Realistic Mountain Relief & Sensor Fusion</div>
        <div className="legend-items">
          <div className="legend-item">
            <span className="legend-color high"></span>
            <span><strong>Red:</strong> Landslide Warning (Pulsing Hazard Zone Contour)</span>
          </div>
          <div className="legend-item">
            <span className="legend-color medium"></span>
            <span><strong>Yellow:</strong> Elevated Watch (Normal Calm Relief)</span>
          </div>
          <div className="legend-item">
            <span className="legend-color low"></span>
            <span><strong>Green:</strong> Safe / Baseline (Normal Calm Relief)</span>
          </div>
          <div className="legend-item live-legend-item">
            <span className="legend-live-icon">⚡</span>
            <span><strong>Node PZ-01:</strong> Live Physical Piezo Sensor (Audio Mic-In)</span>
          </div>
        </div>
      </div>
    </div>
  );
}


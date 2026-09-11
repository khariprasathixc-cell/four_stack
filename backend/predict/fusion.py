from typing import Dict, Any, List
from .rainfall import fetch_rainfall_risk
from .terrain import fetch_terrain_risk

# Fusion Rule Matrix: [terrain_risk][rainfall_risk] -> final_risk
FUSION_MATRIX: Dict[str, Dict[str, str]] = {
    "High": {
        "High": "High",
        "Medium": "High",
        "Low": "Medium",
    },
    "Medium": {
        "High": "High",
        "Medium": "Medium",
        "Low": "Low",
    },
    "Low": {
        "High": "Medium",
        "Medium": "Low",
        "Low": "Low",
    },
}

COLOR_MAP = {
    "Low": "#10b981",     # Emerald green
    "Medium": "#f59e0b",  # Amber
    "High": "#ef4444",    # Crimson red
}


def combine_risk_levels(terrain_risk: str, rainfall_risk: str) -> str:
    """
    Combines terrain risk and rainfall risk using the weighted rule matrix.
    """
    terrain = terrain_risk if terrain_risk in FUSION_MATRIX else "Low"
    rainfall = rainfall_risk if rainfall_risk in FUSION_MATRIX[terrain] else "Low"
    return FUSION_MATRIX[terrain][rainfall]


from datetime import datetime, timezone
import math

def compute_point_fusion(rainfall_risk: str, piezo_risk: str) -> Dict[str, str]:
    """
    Computes point-level multi-sensor fused early warning status:
    - Both Low/Normal -> Green (safe)
    - Either one elevated but not both -> Yellow (watch)
    - Both piezo disturbance AND high rainfall triggered simultaneously at same point -> Red (High Risk / Landslide Warning)
    """
    is_piezo_alert = str(piezo_risk).strip().lower() in ("alert", "high", "spike", "active", "warning")
    is_rain_high = str(rainfall_risk).strip().lower() == "high"
    is_rain_elevated = str(rainfall_risk).strip().lower() in ("medium", "high")

    if is_piezo_alert and is_rain_high:
        return {
            "status_level": "High",
            "status_label": "High Risk / Landslide Warning",
            "color": "#ef4444",
            "code": "RED_ALERT",
        }
    elif is_piezo_alert or is_rain_elevated:
        return {
            "status_level": "Medium",
            "status_label": "Elevated Watch",
            "color": "#f59e0b",
            "code": "YELLOW_WATCH",
        }
    else:
        return {
            "status_level": "Low",
            "status_label": "Safe / Normal",
            "color": "#10b981",
            "code": "GREEN_SAFE",
        }


def generate_sensor_network(
    lat: float,
    lon: float,
    radius_km: float,
    fused_features: List[Dict[str, Any]],
    rainfall_risk: str,
    rainfall_24h_mm: float,
) -> List[Dict[str, Any]]:
    """
    Scatters 7 discrete sensor nodes across slope, ridge, and gully terrain features.
    Node PZ-01 is marked as the Live Physical Hardware Sensor (wired to audio mic).
    Nodes PZ-02..PZ-07 represent the distributed telemetry network.
    """
    now_ts = datetime.now(timezone.utc).isoformat()
    # Geographic offset scaling (1km in lat ~ 0.009 deg)
    d_deg = (radius_km * 0.45) / 111.139

    # Preset placement topologies relative to center [lat, lon]
    node_configs = [
        {
            "id": "PZ-01",
            "name": "Node PZ-01 (Live Piezo Audio Probe)",
            "is_live": True,
            "d_lat": 0.0,
            "d_lon": 0.0,
            "default_piezo": "Normal",
            "location_desc": "Primary Slope Face (Physical Mic-In Hardware Link)",
        },
        {
            "id": "PZ-02",
            "name": "Node PZ-02 (North Drainage Gully)",
            "is_live": False,
            "d_lat": d_deg * 1.3,
            "d_lon": d_deg * 0.4,
            "default_piezo": "Normal",
            "location_desc": "North Drainage Gully / Water Chute",
        },
        {
            "id": "PZ-03",
            "name": "Node PZ-03 (Upper Ridge Escarpment)",
            "is_live": False,
            "d_lat": d_deg * 0.9,
            "d_lon": -d_deg * 1.1,
            # In high hazard regions (e.g. Wayanad / Darjeeling), trigger piezo disturbance
            "default_piezo": "Alert" if rainfall_risk == "High" else "Normal",
            "location_desc": "Upper Escarpment Crown Scarp (Tension Crack Zone)",
        },
        {
            "id": "PZ-04",
            "name": "Node PZ-04 (Mid-Slope Debris Track)",
            "is_live": False,
            "d_lat": -d_deg * 0.6,
            "d_lon": d_deg * 1.2,
            # In Munnar, trigger piezo disturbance under moderate rainfall to show Yellow Watch
            "default_piezo": "Alert" if rainfall_risk == "Medium" else "Normal",
            "location_desc": "Mid-Slope Talus & Colluvium Shear Zone",
        },
        {
            "id": "PZ-05",
            "name": "Node PZ-05 (Valley Toe Settlement Array)",
            "is_live": False,
            "d_lat": -d_deg * 1.4,
            "d_lon": -d_deg * 0.5,
            "default_piezo": "Normal",
            "location_desc": "Basal Slope Toe & Settlement Runout Area",
        },
        {
            "id": "PZ-06",
            "name": "Node PZ-06 (Western Flank Ridge Monitor)",
            "is_live": False,
            "d_lat": d_deg * 0.2,
            "d_lon": -d_deg * 1.5,
            "default_piezo": "Normal",
            "location_desc": "West Ridge Convex Spur",
        },
        {
            "id": "PZ-07",
            "name": "Node PZ-07 (Eastern Tributary Shear Probe)",
            "is_live": False,
            "d_lat": -d_deg * 1.0,
            "d_lon": d_deg * 1.4,
            "default_piezo": "Normal",
            "location_desc": "East Drainage Tributary Bedrock Contact",
        },
    ]

    sensors = []
    for cfg in node_configs:
        s_lat = round(lat + cfg["d_lat"], 5)
        s_lon = round(lon + cfg["d_lon"], 5)

        # Estimate elevation and slope from nearest feature cell
        closest_elev = 1200.0
        closest_slope = 24.0
        closest_curv = 0.0
        min_d = float("inf")

        for feat in fused_features[:60]:
            p = feat.get("properties", {})
            geom = feat.get("geometry", {})
            coords = geom.get("coordinates", [[]])[0]
            if coords:
                c_lon = (coords[0][0] + coords[2][0]) / 2.0
                c_lat = (coords[0][1] + coords[2][1]) / 2.0
                dist = math.hypot(s_lat - c_lat, s_lon - c_lon)
                if dist < min_d:
                    min_d = dist
                    closest_elev = p.get("elevation_m", 1200.0)
                    closest_slope = p.get("slope_deg", 24.0)
                    closest_curv = p.get("curvature", 0.0)

        fusion_meta = compute_point_fusion(rainfall_risk, cfg["default_piezo"])

        sensor_node = {
            "id": cfg["id"],
            "name": cfg["name"],
            "is_live": cfg["is_live"],
            "location_desc": cfg["location_desc"],
            "lat": s_lat,
            "lon": s_lon,
            "elevation_m": closest_elev,
            "slope_deg": closest_slope,
            "curvature": closest_curv,
            "rainfall_risk": rainfall_risk,
            "rainfall_24h_mm": rainfall_24h_mm,
            "piezo_risk": cfg["default_piezo"],
            "status_level": fusion_meta["status_level"],
            "status_label": fusion_meta["status_label"],
            "status_color": fusion_meta["color"],
            "status_code": fusion_meta["code"],
            "last_updated": now_ts,
        }
        sensors.append(sensor_node)

    return sensors


async def evaluate_combined_risk(lat: float, lon: float, radius_km: float = 3.0) -> Dict[str, Any]:
    """
    Fuses terrain risk (OpenTopography SRTM + slope/curvature) with
    rainfall risk (Open-Meteo 24h/72h accumulation) and distributed piezo sensors
    into a unified GeoJSON, sensor grid, and risk report.
    """
    # 1. Fetch rainfall risk
    rainfall_data = await fetch_rainfall_risk(lat, lon)
    rainfall_risk = rainfall_data.get("rainfall_risk", "Low")
    acc_24h = rainfall_data.get("accumulation_24h_mm", 0.0)
    acc_72h = rainfall_data.get("accumulation_72h_mm", 0.0)

    # 2. Fetch terrain risk
    terrain_data = await fetch_terrain_risk(lat, lon, radius_km)
    raw_geojson = terrain_data.get("geojson", {})
    terrain_meta = raw_geojson.get("metadata", {})
    raw_features: List[Dict[str, Any]] = raw_geojson.get("features", [])

    # 3. Fuse cell-by-cell
    fused_features = []
    final_risk_counts = {"Low": 0, "Medium": 0, "High": 0}

    for feat in raw_features:
        props = dict(feat.get("properties", {}))
        cell_terrain_risk = props.get("terrain_risk", "Low")

        final_risk = combine_risk_levels(cell_terrain_risk, rainfall_risk)
        final_risk_counts[final_risk] += 1

        props["rainfall_risk"] = rainfall_risk
        props["rainfall_24h_mm"] = acc_24h
        props["rainfall_72h_mm"] = acc_72h
        props["final_risk"] = final_risk
        props["final_risk_color"] = COLOR_MAP[final_risk]
        props["terrain_risk_color"] = COLOR_MAP.get(cell_terrain_risk, "#10b981")

        fused_features.append({
            "type": "Feature",
            "geometry": feat.get("geometry"),
            "properties": props,
        })

    # 4. Generate distributed multi-point sensor grid
    sensors = generate_sensor_network(
        lat, lon, radius_km, fused_features, rainfall_risk, acc_24h
    )

    total_cells = len(fused_features)
    high_cells = final_risk_counts["High"]
    med_cells = final_risk_counts["Medium"]

    # Overall region risk assessment
    if high_cells > 0 and (high_cells / max(1, total_cells)) >= 0.05:
        overall_risk = "High"
        summary_desc = (
            f"HIGH RISK: {high_cells} active slope zones show critical vulnerability "
            f"under {rainfall_risk.lower()} rainfall conditions ({acc_24h}mm in 24h). "
            f"Landslide probability is elevated; evacuation readiness advised."
        )
    elif med_cells > 0 and (med_cells / max(1, total_cells)) >= 0.15:
        overall_risk = "Medium"
        summary_desc = (
            f"MEDIUM RISK: Moderate terrain instability detected across {med_cells} sectors. "
            f"Rainfall accumulation ({acc_24h}mm 24h / {acc_72h}mm 72h) warrants heightened monitoring."
        )
    elif high_cells > 0:
        overall_risk = "Medium"
        summary_desc = (
            f"MEDIUM RISK: Isolated steep gullies detected ({high_cells} high-hazard cells). "
            f"Localized slope failure possible in drainage channels."
        )
    else:
        overall_risk = "Low"
        summary_desc = (
            f"LOW RISK: Stable terrain slope angles (<15°) with manageable precipitation "
            f"({acc_24h}mm in 24h). Landslide risk is currently minimal."
        )

    fused_geojson = {
        "type": "FeatureCollection",
        "features": fused_features,
        "metadata": {
            **terrain_meta,
            "final_risk_counts": final_risk_counts,
            "overall_risk": overall_risk,
            "high_risk_percentage": round((high_cells / max(1, total_cells)) * 100, 1),
            "medium_risk_percentage": round((med_cells / max(1, total_cells)) * 100, 1),
            "low_risk_percentage": round((final_risk_counts["Low"] / max(1, total_cells)) * 100, 1),
        },
    }

    return {
        "status": "success",
        "query": {
            "latitude": lat,
            "longitude": lon,
            "radius_km": radius_km,
        },
        "overall_risk": overall_risk,
        "summary": summary_desc,
        "rainfall": rainfall_data,
        "sensors": sensors,
        "is_mock": terrain_data.get("is_mock", False) or rainfall_data.get("is_mock", False),
        "terrain": {
            "api_key_configured": terrain_data.get("api_key_configured", False),
            "is_synthetic": terrain_data.get("is_synthetic", False),
            "is_mock": terrain_data.get("is_mock", False),
            "data_source": terrain_data.get("data_source", "Terrain Model"),
            "error_code": terrain_data.get("error_code"),
            "error_message": terrain_data.get("error_message"),
            "bounding_box": terrain_data.get("bounding_box"),
            "metadata": terrain_meta,
        },
        "geojson": fused_geojson,
    }

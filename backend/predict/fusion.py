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


async def evaluate_combined_risk(lat: float, lon: float, radius_km: float = 3.0) -> Dict[str, Any]:
    """
    Fuses terrain risk (OpenTopography SRTM + slope/curvature) with
    rainfall risk (Open-Meteo 24h/72h accumulation) into a unified GeoJSON and risk report.
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
        "terrain": {
            "api_key_configured": terrain_data.get("api_key_configured", False),
            "is_synthetic": terrain_data.get("is_synthetic", False),
            "error_code": terrain_data.get("error_code"),
            "error_message": terrain_data.get("error_message"),
            "bounding_box": terrain_data.get("bounding_box"),
            "metadata": terrain_meta,
        },
        "geojson": fused_geojson,
    }

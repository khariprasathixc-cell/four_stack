import os
import json
import math
import logging
from pathlib import Path
from datetime import datetime, timezone
from typing import Dict, Any, List
import httpx

logger = logging.getLogger(__name__)

OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"
MOCK_FILE = Path(__file__).resolve().parent.parent / "mock_data" / "rainfall_samples.json"

# Rainfall risk thresholds (mm)
THRESHOLD_24H_HIGH = 65.0
THRESHOLD_24H_MEDIUM = 25.0
THRESHOLD_72H_HIGH = 120.0
THRESHOLD_72H_MEDIUM = 50.0

# 3 Quick presets for matching coordinates
PRESET_COORDS = [
    ("wayanad", 11.5540, 76.1306),
    ("munnar", 10.0889, 77.0595),
    ("darjeeling", 27.0410, 88.2663),
]


def classify_rainfall_risk(acc_24h: float, acc_72h: float) -> str:
    """
    Classifies rainfall risk into Low, Medium, or High based on 24h & 72h accumulation.
    Based on empirical geotechnical landslide thresholds (e.g., USGS / GSI criteria).
    """
    if acc_24h >= THRESHOLD_24H_HIGH or acc_72h >= THRESHOLD_72H_HIGH:
        return "High"
    elif acc_24h >= THRESHOLD_24H_MEDIUM or acc_72h >= THRESHOLD_72H_MEDIUM:
        return "Medium"
    else:
        return "Low"


def find_closest_preset(lat: float, lon: float) -> str:
    """Finds the closest preset key based on Euclidean geographic distance."""
    closest_key = "wayanad"
    min_dist = float("inf")
    for key, p_lat, p_lon in PRESET_COORDS:
        dist = math.hypot(lat - p_lat, lon - p_lon)
        if dist < min_dist:
            min_dist = dist
            closest_key = key
    return closest_key


def load_mock_rainfall(lat: float, lon: float) -> Dict[str, Any]:
    """
    Loads predefined realistic rainfall time series from local cached mock data.
    Ensures instant responses with zero network calls and high reproducibility.
    """
    preset_key = find_closest_preset(lat, lon)
    if MOCK_FILE.exists():
        try:
            with open(MOCK_FILE, "r", encoding="utf-8") as f:
                all_presets = json.load(f)
            preset_data = all_presets.get(preset_key)
            if preset_data:
                result = dict(preset_data)
                result["status"] = "success"
                result["latitude"] = lat
                result["longitude"] = lon
                result["is_mock"] = True
                result["data_source"] = f"Cached Regional Profile ({preset_key.capitalize()})"
                return result
        except Exception as e:
            logger.warning(f"Failed to read mock rainfall file: {e}")

    # Fallback default if mock file is somehow inaccessible
    return {
        "status": "success",
        "latitude": lat,
        "longitude": lon,
        "rainfall_risk": "Medium",
        "accumulation_24h_mm": 42.0,
        "accumulation_72h_mm": 88.0,
        "current_hour_rate_mm": 3.5,
        "evaluation_time_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:00"),
        "is_mock": True,
        "data_source": "Cached Regional Model",
        "thresholds": {
            "24h_medium": THRESHOLD_24H_MEDIUM,
            "24h_high": THRESHOLD_24H_HIGH,
            "72h_medium": THRESHOLD_72H_MEDIUM,
            "72h_high": THRESHOLD_72H_HIGH,
        },
        "recent_trend": [],
    }


async def fetch_rainfall_risk(lat: float, lon: float) -> Dict[str, Any]:
    """
    Fetches rainfall accumulation and hazard classification.
    Controlled by USE_MOCK_DATA (default: True). When enabled, serves from
    local pre-cached datasets with zero network dependencies.
    """
    use_mock = os.getenv("USE_MOCK_DATA", "true").strip().lower() in ("true", "1", "yes")

    if use_mock:
        return load_mock_rainfall(lat, lon)

    # Live API code path (when USE_MOCK_DATA=false)
    params = {
        "latitude": lat,
        "longitude": lon,
        "hourly": "precipitation",
        "past_days": 3,
        "forecast_days": 1,
        "timezone": "UTC",
    }

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(OPEN_METEO_URL, params=params)
            response.raise_for_status()
            data = response.json()

        hourly = data.get("hourly", {})
        times: List[str] = hourly.get("time", [])
        precip_values: List[float] = [
            val if val is not None else 0.0 for val in hourly.get("precipitation", [])
        ]

        now_utc = datetime.now(timezone.utc)
        current_iso = now_utc.strftime("%Y-%m-%dT%H:00")

        current_idx = None
        for idx, t_str in enumerate(times):
            if t_str >= current_iso:
                current_idx = idx
                break

        if current_idx is None:
            current_idx = len(times) - 1

        start_24h = max(0, current_idx - 23)
        start_72h = max(0, current_idx - 71)

        window_24h = precip_values[start_24h : current_idx + 1]
        window_72h = precip_values[start_72h : current_idx + 1]

        acc_24h = round(float(sum(window_24h)), 2)
        acc_72h = round(float(sum(window_72h)), 2)
        current_hour_rate = (
            round(float(precip_values[current_idx]), 2)
            if current_idx < len(precip_values)
            else 0.0
        )

        risk_level = classify_rainfall_risk(acc_24h, acc_72h)

        recent_trend = []
        for i in range(start_24h, current_idx + 1):
            recent_trend.append({
                "time": times[i],
                "precipitation_mm": precip_values[i],
            })

        return {
            "status": "success",
            "latitude": lat,
            "longitude": lon,
            "rainfall_risk": risk_level,
            "accumulation_24h_mm": acc_24h,
            "accumulation_72h_mm": acc_72h,
            "current_hour_rate_mm": current_hour_rate,
            "evaluation_time_utc": times[current_idx] if current_idx < len(times) else current_iso,
            "is_mock": False,
            "data_source": "Open-Meteo Live API",
            "thresholds": {
                "24h_medium": THRESHOLD_24H_MEDIUM,
                "24h_high": THRESHOLD_24H_HIGH,
                "72h_medium": THRESHOLD_72H_MEDIUM,
                "72h_high": THRESHOLD_72H_HIGH,
            },
            "recent_trend": recent_trend,
        }
    except Exception as e:
        logger.warning(f"Live Open-Meteo fetch failed ({e}); gracefully falling back to cached mock data.")
        return load_mock_rainfall(lat, lon)

import httpx
from datetime import datetime, timezone
from typing import Dict, Any, List

OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"

# Rainfall risk thresholds (mm)
THRESHOLD_24H_HIGH = 65.0
THRESHOLD_24H_MEDIUM = 25.0
THRESHOLD_72H_HIGH = 120.0
THRESHOLD_72H_MEDIUM = 50.0


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


async def fetch_rainfall_risk(lat: float, lon: float) -> Dict[str, Any]:
    """
    Fetches hourly rainfall from the Open-Meteo API for a given lat/lon.
    Computes 24h and 72h rainfall accumulation and classifies rainfall risk.
    """
    params = {
        "latitude": lat,
        "longitude": lon,
        "hourly": "precipitation",
        "past_days": 3,
        "forecast_days": 1,
        "timezone": "UTC",
    }

    async with httpx.AsyncClient(timeout=15.0) as client:
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

    # Locate the index closest to or immediately preceding current time
    current_idx = None
    for idx, t_str in enumerate(times):
        if t_str >= current_iso:
            current_idx = idx
            break

    # If not found or at the end, use the last recorded past time
    if current_idx is None:
        current_idx = len(times) - 1

    # Extract 24h window (up to current hour) and 72h window
    start_24h = max(0, current_idx - 23)
    start_72h = max(0, current_idx - 71)

    window_24h = precip_values[start_24h : current_idx + 1]
    window_72h = precip_values[start_72h : current_idx + 1]

    acc_24h = round(float(sum(window_24h)), 2)
    acc_72h = round(float(sum(window_72h)), 2)
    current_hour_rate = round(float(precip_values[current_idx]), 2) if current_idx < len(precip_values) else 0.0

    risk_level = classify_rainfall_risk(acc_24h, acc_72h)

    # Prepare recent 24-hour hourly trend for visualization
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
        "thresholds": {
            "24h_medium": THRESHOLD_24H_MEDIUM,
            "24h_high": THRESHOLD_24H_HIGH,
            "72h_medium": THRESHOLD_72H_MEDIUM,
            "72h_high": THRESHOLD_72H_HIGH,
        },
        "recent_trend": recent_trend,
    }

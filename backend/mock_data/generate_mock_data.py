import json
import math
import numpy as np
from pathlib import Path
from datetime import datetime, timezone, timedelta

now = datetime.now(timezone.utc)
OUT_DIR = Path(__file__).resolve().parent
ELEV_DIR = OUT_DIR / "elevation_samples"
ELEV_DIR.mkdir(parents=True, exist_ok=True)

# -------------------------------------------------------------
# 1. RAINFALL SAMPLES
# -------------------------------------------------------------
# Wayanad (Critical High Risk Scenario - Monsoon cloudburst)
w_profile_48 = [1.2, 1.5, 2.0, 1.8] * 12
w_profile_24 = [
    3.0, 3.8, 4.5, 5.8, 7.2, 8.5, 11.4, 9.2, 7.5, 6.0, 4.8, 4.2,
    3.5, 3.0, 2.4, 2.0, 1.8, 1.5, 1.2, 1.0, 0.8, 0.6, 0.4, 0.2
]
wayanad_vals = [round(x, 1) for x in (w_profile_48[:48] + w_profile_24)]

# Munnar (Moderate Risk Scenario - Continuous mountain drizzle/showers)
m_profile_48 = [0.7, 0.9, 1.0, 0.8] * 12
m_profile_24 = [
    1.4, 1.6, 2.1, 2.6, 3.0, 2.8, 2.4, 1.9, 1.5, 1.3, 1.1, 1.2,
    1.5, 1.8, 1.7, 1.4, 1.2, 1.0, 0.8, 0.6, 0.5, 0.4, 0.3, 0.2
]
munnar_vals = [round(x, 1) for x in (m_profile_48[:48] + m_profile_24)]

# Darjeeling (Severe High Risk Scenario - Heavy Himalayan rainfall)
d_profile_48 = [1.3, 1.7, 1.9, 1.5] * 12
d_profile_24 = [
    2.5, 3.2, 4.1, 5.4, 6.8, 7.6, 8.8, 7.0, 5.5, 4.4, 3.6, 3.1,
    2.8, 2.4, 2.0, 1.6, 1.4, 1.1, 0.9, 0.7, 0.5, 0.4, 0.3, 0.2
]
darjeeling_vals = [round(x, 1) for x in (d_profile_48[:48] + d_profile_24)]

def build_rainfall_preset(name, lat, lon, vals):
    acc_24 = round(sum(vals[-24:]), 1)
    acc_72 = round(sum(vals[-72:]), 1)
    if acc_24 >= 65.0 or acc_72 >= 120.0:
        risk = "High"
    elif acc_24 >= 25.0 or acc_72 >= 50.0:
        risk = "Medium"
    else:
        risk = "Low"

    base_time = now - timedelta(hours=len(vals) - 1)
    hourly_records = []
    for i, v in enumerate(vals):
        t_str = (base_time + timedelta(hours=i)).strftime("%Y-%m-%dT%H:00")
        hourly_records.append({"time": t_str, "precipitation_mm": v})

    return {
        "preset_id": name,
        "latitude": lat,
        "longitude": lon,
        "rainfall_risk": risk,
        "accumulation_24h_mm": acc_24,
        "accumulation_72h_mm": acc_72,
        "current_hour_rate_mm": vals[-1],
        "evaluation_time_utc": hourly_records[-1]["time"],
        "thresholds": {
            "24h_medium": 25.0,
            "24h_high": 65.0,
            "72h_medium": 50.0,
            "72h_high": 120.0,
        },
        "recent_trend": hourly_records[-24:],
    }

rainfall_mock = {
    "wayanad": build_rainfall_preset("wayanad", 11.5540, 76.1306, wayanad_vals),
    "munnar": build_rainfall_preset("munnar", 10.0889, 77.0595, munnar_vals),
    "darjeeling": build_rainfall_preset("darjeeling", 27.0410, 88.2663, darjeeling_vals),
}

with open(OUT_DIR / "rainfall_samples.json", "w", encoding="utf-8") as f:
    json.dump(rainfall_mock, f, indent=2)

print("Saved rainfall_samples.json with 3 presets")

# -------------------------------------------------------------
# 2. ELEVATION SAMPLES (.npy grids)
# -------------------------------------------------------------
def generate_topographic_grid(
    base_elev: float,
    amplitude: float,
    frequency: float,
    gully_depth: float,
    resolution: int = 24,
    ruggedness: float = 1.0,
) -> np.ndarray:
    """Generates realistic mountain topography DEM (resolution x resolution)."""
    y = np.linspace(0, 2.5 * np.pi, resolution)
    x = np.linspace(0, 2.5 * np.pi, resolution)
    X, Y = np.meshgrid(x, y)

    # Primary mountain ridgeline
    ridge = amplitude * np.sin(frequency * X + 0.3 * Y) + (amplitude * 0.6) * np.cos(0.8 * frequency * Y - 0.2 * X)
    
    # Drainage gully / hollow
    gully_center_x = 1.25 * np.pi
    gully_center_y = 1.25 * np.pi
    gully = -gully_depth * np.exp(-(((X - gully_center_x) ** 2) + ((Y - gully_center_y) ** 2) * 1.5) / 2.0)
    
    # Micro-relief / ruggedness
    micro = (amplitude * 0.08 * ruggedness) * np.sin(4.5 * X) * np.cos(4.5 * Y)
    
    # Regional slope tilt
    tilt = (amplitude * 0.4) * (Y / (2.5 * np.pi)) - (amplitude * 0.2) * (X / (2.5 * np.pi))

    dem = base_elev + ridge + gully + micro + tilt
    return np.round(np.clip(dem, 5.0, 8848.0), 1)

# Wayanad: Western Ghats high mountain scarp, Chembra peak range (900m - 2100m)
grid_wayanad = generate_topographic_grid(
    base_elev=1150.0, amplitude=650.0, frequency=0.85, gully_depth=380.0, resolution=24, ruggedness=1.2
)
np.save(ELEV_DIR / "wayanad.npy", grid_wayanad)

# Munnar: Anamudi high ranges (1400m - 2300m), rolling tea slopes
grid_munnar = generate_topographic_grid(
    base_elev=1650.0, amplitude=520.0, frequency=0.75, gully_depth=260.0, resolution=24, ruggedness=0.9
)
np.save(ELEV_DIR / "munnar.npy", grid_munnar)

# Darjeeling: Steep Himalayan terrain (1300m - 2600m), high shear slope angles
grid_darjeeling = generate_topographic_grid(
    base_elev=1850.0, amplitude=750.0, frequency=1.1, gully_depth=480.0, resolution=24, ruggedness=1.4
)
np.save(ELEV_DIR / "darjeeling.npy", grid_darjeeling)

print("Generated and saved 3 elevation grids to elevation_samples/ (.npy)")

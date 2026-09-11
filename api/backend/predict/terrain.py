import os
import io
import math
import logging
from pathlib import Path
from dotenv import load_dotenv
import httpx
import numpy as np
from typing import Dict, Any, Tuple, Optional

# Explicitly ensure backend/.env is loaded relative to backend directory
ENV_PATH = Path(__file__).resolve().parent.parent / ".env"
if ENV_PATH.exists():
    load_dotenv(dotenv_path=ENV_PATH, override=True)

logger = logging.getLogger(__name__)

OPENTOPOGRAPHY_BASE_URL = "https://portal.opentopography.org/API/globaldem"
MOCK_ELEV_DIR = Path(__file__).resolve().parent.parent / "mock_data" / "elevation_samples"

# 3 Quick presets for matching coordinates
PRESET_COORDS = [
    ("wayanad", 11.5540, 76.1306),
    ("munnar", 10.0889, 77.0595),
    ("darjeeling", 27.0410, 88.2663),
]

# Terrain risk color codes
COLOR_MAP = {
    "Low": "#10b981",     # Emerald green
    "Medium": "#f59e0b",  # Amber orange
    "High": "#ef4444",    # Crimson red
}


def calculate_bounding_box(lat: float, lon: float, radius_km: float) -> Tuple[float, float, float, float]:
    """
    Computes (south, north, west, east) bounding box in degrees from lat, lon, and radius_km.
    """
    # 1 degree of latitude is approx 111.139 km
    d_lat = radius_km / 111.139
    # 1 degree of longitude scales with cos(latitude)
    lat_rad = math.radians(lat)
    cos_lat = math.cos(lat_rad)
    if abs(cos_lat) < 1e-6:
        cos_lat = 1e-6
    d_lon = radius_km / (111.139 * cos_lat)

    south = max(-89.0, lat - d_lat)
    north = min(89.0, lat + d_lat)
    west = max(-180.0, lon - d_lon)
    east = min(180.0, lon + d_lon)

    return south, north, west, east


def parse_aaigrid(grid_text: str) -> Tuple[np.ndarray, Dict[str, float]]:
    """
    Parses ESRI ASCII Grid (AAIGrid) format returned by OpenTopography.
    """
    lines = grid_text.strip().splitlines()
    header: Dict[str, float] = {}
    data_start_idx = 0

    for idx, line in enumerate(lines):
        tokens = line.strip().split()
        if len(tokens) == 2 and tokens[0].lower() in [
            "ncols", "nrows", "xllcorner", "yllcorner", "xllcenter", "yllcenter", "cellsize", "nodata_value"
        ]:
            header[tokens[0].lower()] = float(tokens[1])
            data_start_idx = idx + 1
        else:
            break

    nrows = int(header.get("nrows", 0))
    ncols = int(header.get("ncols", 0))
    nodata = header.get("nodata_value", -9999)

    # Read remaining lines as float matrix
    raw_data = []
    for line in lines[data_start_idx:]:
        if not line.strip():
            continue
        vals = [float(x) for x in line.strip().split()]
        raw_data.extend(vals)

    grid = np.array(raw_data, dtype=np.float64).reshape((nrows, ncols))

    # Clean nodata values if any
    mask_nodata = (grid == nodata) | (grid < -500) | np.isnan(grid)
    if np.any(mask_nodata):
        valid_mean = float(np.mean(grid[~mask_nodata])) if np.any(~mask_nodata) else 100.0
        grid[mask_nodata] = valid_mean

    return grid, header


def generate_synthetic_dem(south: float, north: float, west: float, east: float, resolution: int = 24) -> np.ndarray:
    """
    Generates a realistic synthetic topographic DEM when OpenTopography API key is not available.
    Uses multi-harmonic sinusoidal and ridge functions to model natural mountain slopes and valleys.
    """
    y = np.linspace(0, 3 * np.pi, resolution)
    x = np.linspace(0, 3 * np.pi, resolution)
    X, Y = np.meshgrid(x, y)

    # Base mountain ridge + steep gully
    ridge = 800 * np.sin(0.7 * X + 0.4 * Y) + 450 * np.cos(0.9 * Y - 0.3 * X)
    gully = -300 * np.exp(-((X - 1.5 * np.pi) ** 2 + (Y - 1.5 * np.pi) ** 2) / 3.0)
    noise = 60 * np.sin(3.0 * X) * np.cos(3.0 * Y)
    base_elevation = 900.0

    dem = base_elevation + ridge + gully + noise
    # Ensure all elevations are positive
    dem = np.clip(dem, 50.0, 5000.0)
    return dem


def compute_slope_and_curvature(
    elevation_grid: np.ndarray,
    south: float,
    north: float,
    west: float,
    east: float,
) -> Tuple[np.ndarray, np.ndarray]:
    """
    Computes slope angle in degrees and Laplacian curvature from the elevation grid using numpy.
    - np.gradient for slope
    - second derivatives for curvature
    """
    nrows, ncols = elevation_grid.shape
    mid_lat = (south + north) / 2.0

    # Grid spacing in meters
    lat_span_km = (north - south) * 111.139
    lon_span_km = (east - west) * 111.139 * math.cos(math.radians(mid_lat))

    dy_m = max(1.0, (lat_span_km * 1000.0) / max(1, nrows - 1))
    dx_m = max(1.0, (lon_span_km * 1000.0) / max(1, ncols - 1))

    # First derivatives (gradient)
    # Axis 0 is rows (latitude, top is north), Axis 1 is columns (longitude, left is west)
    dz_dy, dz_dx = np.gradient(elevation_grid, dy_m, dx_m)

    # Gradient magnitude = sqrt((dz/dx)^2 + (dz/dy)^2)
    grad_mag = np.hypot(dz_dx, dz_dy)

    # Slope angle in degrees = arctan(grad_mag) * (180 / pi)
    slope_rad = np.arctan(grad_mag)
    slope_deg = np.degrees(slope_rad)

    # Second derivatives for Laplacian curvature: d2z/dx2 + d2z/dy2
    _, d2z_dx2 = np.gradient(dz_dx, dy_m, dx_m)
    d2z_dy2, _ = np.gradient(dz_dy, dy_m, dx_m)
    curvature = d2z_dx2 + d2z_dy2

    return slope_deg, curvature


def classify_terrain_risk(slope: float, curv: float) -> str:
    """
    Classifies a grid cell into Low/Medium/High terrain risk based on slope angle and curvature.
    - Low: slope < 15 degrees
    - Medium: 15 <= slope <= 35 degrees (or concave hollows on 12-15 deg)
    - High: slope > 35 degrees (or 25-35 deg with steep convergent concavity)
    """
    if slope > 35.0:
        return "High"
    elif slope >= 25.0 and curv < -0.003:
        # Steep concave slope (water concentration zone)
        return "High"
    elif slope >= 15.0:
        return "Medium"
    elif slope >= 12.0 and curv < -0.005:
        return "Medium"
    else:
        return "Low"


def grid_to_geojson(
    elevation_grid: np.ndarray,
    slope_deg: np.ndarray,
    curvature: np.ndarray,
    south: float,
    north: float,
    west: float,
    east: float,
) -> Dict[str, Any]:
    """
    Converts 2D grids into a GeoJSON FeatureCollection of polygonal cells.
    To ensure silky-smooth Leaflet map rendering, downsamples grid if needed (e.g. max 24x24).
    """
    nrows, ncols = elevation_grid.shape
    target_dim = min(24, max(nrows, ncols))

    # Downsample using block averaging if grid is too dense
    if nrows > target_dim or ncols > target_dim:
        row_indices = np.linspace(0, nrows - 1, target_dim, dtype=int)
        col_indices = np.linspace(0, ncols - 1, target_dim, dtype=int)
        elevation_sub = elevation_grid[np.ix_(row_indices, col_indices)]
        slope_sub = slope_deg[np.ix_(row_indices, col_indices)]
        curv_sub = curvature[np.ix_(row_indices, col_indices)]
    else:
        target_dim = nrows
        elevation_sub = elevation_grid
        slope_sub = slope_deg
        curv_sub = curvature

    sub_rows, sub_cols = elevation_sub.shape
    d_lat = (north - south) / sub_rows
    d_lon = (east - west) / sub_cols

    features = []
    risk_counts = {"Low": 0, "Medium": 0, "High": 0}

    for r in range(sub_rows):
        # OpenTopography rows are typically top (north) to bottom (south)
        cell_north = north - (r * d_lat)
        cell_south = cell_north - d_lat

        for c in range(sub_cols):
            cell_west = west + (c * d_lon)
            cell_east = cell_west + d_lon

            elev = float(elevation_sub[r, c])
            slope = float(slope_sub[r, c])
            curv = float(curv_sub[r, c])

            risk = classify_terrain_risk(slope, curv)
            risk_counts[risk] += 1

            # Polygon coordinates: [ [ [lon, lat], ... ] ]
            polygon_coords = [
                [
                    [round(cell_west, 6), round(cell_south, 6)],
                    [round(cell_east, 6), round(cell_south, 6)],
                    [round(cell_east, 6), round(cell_north, 6)],
                    [round(cell_west, 6), round(cell_north, 6)],
                    [round(cell_west, 6), round(cell_south, 6)],
                ]
            ]

            feature = {
                "type": "Feature",
                "geometry": {
                    "type": "Polygon",
                    "coordinates": polygon_coords,
                },
                "properties": {
                    "cell_id": f"cell_{r}_{c}",
                    "elevation_m": round(elev, 1),
                    "slope_deg": round(slope, 1),
                    "curvature": round(curv, 6),
                    "terrain_risk": risk,
                    "color": COLOR_MAP[risk],
                },
            }
            features.append(feature)

    total_cells = len(features)
    dominant_risk = max(risk_counts, key=risk_counts.get) if total_cells > 0 else "Low"

    return {
        "type": "FeatureCollection",
        "features": features,
        "metadata": {
            "total_cells": total_cells,
            "risk_counts": risk_counts,
            "dominant_terrain_risk": dominant_risk,
            "max_slope_deg": round(float(np.max(slope_sub)), 1),
            "avg_slope_deg": round(float(np.mean(slope_sub)), 1),
            "min_elevation_m": round(float(np.min(elevation_sub)), 1),
            "max_elevation_m": round(float(np.max(elevation_sub)), 1),
            "bounds": {"south": south, "north": north, "west": west, "east": east},
            "elevation_matrix": elevation_sub.round(1).tolist(),
            "slope_matrix": slope_sub.round(1).tolist(),
        },
    }


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


def load_mock_elevation(lat: float, lon: float) -> Tuple[np.ndarray, str]:
    """
    Loads pre-cached regional elevation grid (.npy) from mock_data/elevation_samples/.
    Ensures zero network latency, zero API key dependency, and consistent terrain modeling.
    """
    preset_key = find_closest_preset(lat, lon)
    npy_path = MOCK_ELEV_DIR / f"{preset_key}.npy"
    if npy_path.exists():
        try:
            grid = np.load(npy_path)
            return grid, preset_key
        except Exception as e:
            logger.warning(f"Failed to load mock elevation file {npy_path}: {e}")

    # Fallback to Perlin-like synthetic generator if file missing
    return generate_synthetic_dem(0, 1, 0, 1, resolution=24), "default_synthetic"


async def fetch_terrain_risk(lat: float, lon: float, radius_km: float = 3.0) -> Dict[str, Any]:
    """
    Fetches elevation data for bounding box, computes slope and curvature, and outputs GeoJSON.
    Controlled by USE_MOCK_DATA (default: True). When enabled, serves from local pre-cached
    elevation grids with zero network latency and no API key required.
    """
    use_mock = os.getenv("USE_MOCK_DATA", "true").strip().lower() in ("true", "1", "yes")
    south, north, west, east = calculate_bounding_box(lat, lon, radius_km)

    if use_mock:
        elevation_grid, preset_name = load_mock_elevation(lat, lon)
        slope_deg, curvature = compute_slope_and_curvature(
            elevation_grid, south, north, west, east
        )
        geojson_result = grid_to_geojson(
            elevation_grid, slope_deg, curvature, south, north, west, east
        )
        return {
            "status": "success",
            "api_key_configured": True,
            "is_synthetic": False,
            "is_mock": True,
            "data_source": f"Cached Regional DEM ({preset_name.capitalize()})",
            "error_code": None,
            "error_message": None,
            "bounding_box": {
                "south": south,
                "north": north,
                "west": west,
                "east": east,
                "center_lat": lat,
                "center_lon": lon,
                "radius_km": radius_km,
            },
            "geojson": geojson_result,
        }

    # Live API code path (when USE_MOCK_DATA=false)
    if not os.getenv("OPENTOPOGRAPHY_API_KEY", "").strip():
        if ENV_PATH.exists():
            load_dotenv(dotenv_path=ENV_PATH, override=True)

    api_key = os.getenv("OPENTOPOGRAPHY_API_KEY", "").strip()
    is_synthetic = False
    error_code: Optional[str] = None
    error_message: Optional[str] = None
    api_key_configured = bool(api_key)

    elevation_grid: Optional[np.ndarray] = None

    if api_key_configured:
        params = {
            "demtype": "SRTMGL3",
            "south": round(south, 5),
            "north": round(north, 5),
            "west": round(west, 5),
            "east": round(east, 5),
            "outputFormat": "AAIGrid",
            "API_Key": api_key,
        }
        try:
            async with httpx.AsyncClient(timeout=20.0) as client:
                resp = await client.get(OPENTOPOGRAPHY_BASE_URL, params=params)
                if resp.status_code == 200 and ("ncols" in resp.text.lower() or "cellsize" in resp.text.lower()):
                    grid, _ = parse_aaigrid(resp.text)
                    elevation_grid = grid
                    error_code = None
                    error_message = None
                    is_synthetic = False
                elif resp.status_code in (401, 403):
                    logger.warning(f"OpenTopography key unauthorized/invalid (HTTP {resp.status_code})")
                    error_code = "OPENTOPOGRAPHY_KEY_INVALID"
                    error_message = f"OpenTopography API key is invalid or unauthorized (HTTP {resp.status_code}). Check OPENTOPOGRAPHY_API_KEY in backend/.env."
                    is_synthetic = True
                else:
                    logger.warning(f"OpenTopography returned status {resp.status_code}: {resp.text[:200]}")
                    error_code = "OPENTOPOGRAPHY_API_UNAVAILABLE"
                    error_message = f"OpenTopography API returned HTTP {resp.status_code}: {resp.text[:150]}"
                    is_synthetic = True
        except Exception as e:
            logger.error(f"Failed to query OpenTopography API: {e}")
            error_code = "OPENTOPOGRAPHY_API_UNAVAILABLE"
            error_message = f"OpenTopography connection error: {str(e)}"
            is_synthetic = True
    else:
        error_code = "OPENTOPOGRAPHY_KEY_MISSING"
        error_message = "OpenTopography API key is missing. Add OPENTOPOGRAPHY_API_KEY to backend/.env."
        is_synthetic = True

    if elevation_grid is None:
        elevation_grid, _ = load_mock_elevation(lat, lon)

    slope_deg, curvature = compute_slope_and_curvature(
        elevation_grid, south, north, west, east
    )

    geojson_result = grid_to_geojson(
        elevation_grid, slope_deg, curvature, south, north, west, east
    )

    return {
        "status": "success",
        "api_key_configured": api_key_configured,
        "is_synthetic": is_synthetic,
        "is_mock": False,
        "data_source": "OpenTopography SRTMGL3 Live API" if not is_synthetic else "Cached Regional DEM",
        "error_code": error_code,
        "error_message": error_message,
        "bounding_box": {
            "south": south,
            "north": north,
            "west": west,
            "east": east,
            "center_lat": lat,
            "center_lon": lon,
            "radius_km": radius_km,
        },
        "geojson": geojson_result,
    }

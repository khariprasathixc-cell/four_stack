import os
import sys
import logging
from pathlib import Path
from dotenv import load_dotenv

# Ensure backend directory is in sys.path
BASE_DIR = Path(__file__).resolve().parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

# Explicitly load .env from backend directory with override=True
ENV_PATH = BASE_DIR / ".env"
if not ENV_PATH.exists():
    # Fallback to workspace root if present
    ALT_ENV = BASE_DIR.parent / ".env"
    if ALT_ENV.exists():
        ENV_PATH = ALT_ENV

load_dotenv(dotenv_path=ENV_PATH, override=True)

logger = logging.getLogger("slope_to_rescue")
logging.basicConfig(level=logging.INFO)

def get_masked_key() -> str:
    key = os.getenv("OPENTOPOGRAPHY_API_KEY", "").strip()
    if not key:
        return "None (OPENTOPOGRAPHY_KEY_MISSING)"
    if len(key) <= 4:
        return f"{key[:1]}***"
    return f"{key[:4]}***"

# Startup notification visible in console immediately
print(f"[Slope-to-Rescue] Backend init: OPENTOPOGRAPHY_API_KEY loaded: {get_masked_key()} (from {ENV_PATH})")

from fastapi import FastAPI, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Dict, Any

from predict.rainfall import fetch_rainfall_risk
from predict.terrain import fetch_terrain_risk
from predict.fusion import evaluate_combined_risk

app = FastAPI(
    title="Slope-to-Rescue API",
    description="Landslide Early Warning System — Phase 1 (Predict: Terrain + Rainfall Risk)",
    version="1.0.0",
)

@app.on_event("startup")
async def startup_event():
    masked = get_masked_key()
    logger.info(f"OpenTopography API Key loaded: {masked}")
    print(f"[Slope-to-Rescue] Boot complete: OPENTOPOGRAPHY_API_KEY loaded: {masked}")

# Enable CORS for local development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
async def health_check() -> Dict[str, Any]:
    """
    Health check endpoint returning system status and module availability.
    """
    has_opentopo_key = bool(os.getenv("OPENTOPOGRAPHY_API_KEY", "").strip())
    return {
        "status": "healthy",
        "service": "slope-to-rescue-backend",
        "phase": "Phase 1: Predict",
        "modules": {
            "predict_rainfall": "active",
            "predict_terrain": "active",
            "predict_fusion": "active",
            "detect_piezo": "standby (Phase 2)",
            "assist_camera": "standby (Phase 3)",
        },
        "opentopography_key_configured": has_opentopo_key,
    }


@app.get("/api/rainfall")
async def get_rainfall(
    lat: float = Query(..., description="Latitude of target location"),
    lon: float = Query(..., description="Longitude of target location"),
) -> Dict[str, Any]:
    """
    Returns rainfall accumulation (24h/72h) and rainfall risk classification from Open-Meteo.
    """
    try:
        return await fetch_rainfall_risk(lat, lon)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Rainfall evaluation failed: {str(e)}")


@app.get("/api/terrain")
async def get_terrain(
    lat: float = Query(..., description="Latitude of target center"),
    lon: float = Query(..., description="Longitude of target center"),
    radius_km: float = Query(3.0, ge=0.5, le=25.0, description="Radius in km (0.5 to 25.0)"),
) -> Dict[str, Any]:
    """
    Returns terrain elevation grid, slope, curvature, and terrain risk GeoJSON.
    """
    try:
        return await fetch_terrain_risk(lat, lon, radius_km)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Terrain evaluation failed: {str(e)}")


@app.get("/api/risk")
async def get_combined_risk(
    lat: float = Query(11.5540, description="Latitude of target center"),
    lon: float = Query(76.1306, description="Longitude of target center"),
    radius_km: float = Query(3.0, ge=0.5, le=25.0, description="Radius in km (0.5 to 25.0)"),
) -> Dict[str, Any]:
    """
    Combines terrain risk and rainfall accumulation into a unified risk assessment.
    Returns combined GeoJSON polygons with final risk levels, raw slope, and rainfall metrics.
    """
    try:
        return await evaluate_combined_risk(lat, lon, radius_km)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Risk fusion failed: {str(e)}")


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", 8000))
    host = os.getenv("HOST", "127.0.0.1")
    uvicorn.run("main:app", host=host, port=port, reload=True)

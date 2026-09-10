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

def get_masked_val(env_name: str) -> str:
    val = os.getenv(env_name, "").strip()
    if not val:
        return f"None ({env_name}_NOT_SET)"
    if len(val) <= 4:
        return f"{val[:1]}***"
    return f"{val[:4]}***"

msg91_key_masked = get_masked_val("MSG91_AUTH_KEY")
msg91_template_masked = get_masked_val("MSG91_TEMPLATE_ID")
mock_sms_flag = os.getenv("MOCK_SMS", "false").strip().lower()

# Startup notification visible in console immediately
print(f"[Slope-to-Rescue] Backend init: OPENTOPOGRAPHY_API_KEY loaded: {get_masked_key()} (from {ENV_PATH})")
print(f"[Slope-to-Rescue] Backend init: MSG91_AUTH_KEY loaded: {msg91_key_masked}, FLOW_ID: {msg91_template_masked}, MOCK_SMS: {mock_sms_flag}")

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
    logger.info(f"MSG91 Auth Key loaded: {msg91_key_masked}, Flow ID: {msg91_template_masked}, Mock SMS: {mock_sms_flag}")
    print(f"[Slope-to-Rescue] Boot complete: OPENTOPOGRAPHY_API_KEY: {masked} | MSG91_AUTH_KEY: {msg91_key_masked}")

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


from datetime import datetime, timezone
import time
from typing import Dict, Any, Optional
import httpx

class AlertRequest(BaseModel):
    phone: str
    zoneName: str = "Unknown Zone"
    riskLevel: str = "High"
    lat: float = 11.5540
    lon: float = 76.1306
    geofenceRadiusKm: float = 5.0
    userDistanceKm: Optional[float] = None

class MotionTelemetry(BaseModel):
    zoneName: str = "Unknown Zone"
    lat: float = 11.5540
    lon: float = 76.1306
    motionLevelPct: float = 0.0
    displacementDetected: bool = False
    boundingBox: Optional[Dict[str, Any]] = None
    timestamp: Optional[str] = None


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


import json
import sqlite3
import tempfile

try:
    DATA_DIR = Path(tempfile.gettempdir()) / "slope_data"
    DATA_DIR.mkdir(parents=True, exist_ok=True)
except Exception:
    DATA_DIR = Path(tempfile.gettempdir())

LOGS_FILE = DATA_DIR / "sos_logs.json"
DB_FILE = DATA_DIR / "sos_logs.db"

def init_sos_db():
    try:
        if not DATA_DIR.exists():
            DATA_DIR.mkdir(parents=True, exist_ok=True)
        with sqlite3.connect(DB_FILE) as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS sos_logs (
                    id TEXT PRIMARY KEY,
                    timestamp TEXT,
                    recipient TEXT,
                    zone TEXT,
                    risk_level TEXT,
                    message_id TEXT,
                    http_status INTEGER,
                    response_type TEXT,
                    mode TEXT,
                    geofence_radius_km REAL,
                    user_distance_km REAL,
                    alert_body TEXT
                )
            """)
            conn.commit()
    except Exception as e:
        logger.warning(f"[DB Init Warning]: {e}")

try:
    init_sos_db()
except Exception as e:
    logger.warning(f"[Initial DB setup skipped]: {e}")

def save_sos_log_entry(entry: Dict[str, Any]):
    """
    Persists dispatch log to SQLite and JSON cache.
    Guaranteed never to throw or crash alert flow.
    """
    try:
        log_id = entry.get("id") or f"log_{int(time.time()*1000)}_{int(time.time()) % 1000}"
        entry["id"] = log_id
        
        # 1. Save to SQLite
        try:
            with sqlite3.connect(DB_FILE) as conn:
                conn.execute("""
                    INSERT OR REPLACE INTO sos_logs (
                        id, timestamp, recipient, zone, risk_level, message_id,
                        http_status, response_type, mode, geofence_radius_km,
                        user_distance_km, alert_body
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    log_id,
                    entry.get("timestamp"),
                    entry.get("recipient"),
                    entry.get("zone"),
                    entry.get("risk_level"),
                    entry.get("message_id"),
                    entry.get("http_status", 200),
                    entry.get("response_type", "success"),
                    entry.get("mode", "mock"),
                    entry.get("geofence_radius_km", 5.0),
                    entry.get("user_distance_km"),
                    entry.get("alert_body", "")
                ))
                conn.commit()
        except Exception as sqle:
            logger.warning(f"[SQLite Write Warning]: {sqle}")

        # 2. Save to JSON file as human-readable cache
        existing = []
        if LOGS_FILE.exists():
            try:
                with open(LOGS_FILE, "r", encoding="utf-8") as f:
                    existing = json.load(f)
            except Exception:
                existing = []
        existing.insert(0, entry)
        if len(existing) > 200:
            existing = existing[:200]
        with open(LOGS_FILE, "w", encoding="utf-8") as f:
            json.dump(existing, f, indent=2)
        logger.info(f"[SOS Storage] Persisted log {log_id} to {LOGS_FILE}")
    except Exception as e:
        logger.error(f"[SOS Log Storage Non-Fatal Error]: {e}")

def get_all_sos_logs() -> list:
    """
    Returns all logged dispatch entries, newest first.
    """
    # 1. Try SQLite first
    try:
        if DB_FILE.exists():
            with sqlite3.connect(DB_FILE) as conn:
                conn.row_factory = sqlite3.Row
                cursor = conn.cursor()
                cursor.execute("SELECT * FROM sos_logs ORDER BY timestamp DESC LIMIT 200")
                rows = [dict(row) for row in cursor.fetchall()]
                if rows:
                    return rows
    except Exception as e:
        logger.warning(f"[SQLite Read Warning]: {e}")

    # 2. Try JSON file fallback
    if LOGS_FILE.exists():
        try:
            with open(LOGS_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                if isinstance(data, list):
                    return data
        except Exception as e:
            logger.warning(f"[JSON Read Warning]: {e}")
    return []


@app.get("/api/sos-logs")
async def get_sos_logs_endpoint() -> list:
    """
    Returns all emergency dispatch log entries, newest first.
    Demo-proof audit trail for judges and command operators.
    """
    try:
        return get_all_sos_logs()
    except Exception as e:
        logger.error(f"[SOS Logs Endpoint Error]: {e}")
        return []


@app.post("/api/send-alert")
async def send_sos_alert(request: AlertRequest) -> Dict[str, Any]:
    """
    Dispatches emergency SOS alert via MSG91 SMS or mock simulation.
    Dynamically re-reads .env so credential updates take effect immediately.
    Logs dispatch attempt persistently wrapped in non-blocking try/except.
    """
    phone = request.phone.strip()
    if not phone:
        raise HTTPException(status_code=400, detail="Phone number is required")

    # Re-read .env on each request so live edits to backend/.env apply without restarting uvicorn
    load_dotenv(dotenv_path=ENV_PATH, override=True)

    msg91_key = os.getenv("MSG91_AUTH_KEY", "").strip()
    mock_env = os.getenv("MOCK_SMS", "true").strip().lower()
    is_mock = (mock_env in ["true", "1"]) or not msg91_key

    alert_text = (
        f"[CRITICAL SOS] Landslide Early Warning for {request.zoneName} "
        f"({request.riskLevel} Risk). Geofence radius: {request.geofenceRadiusKm:.1f}km. "
        f"Evacuate to stable ground immediately. Emergency helpline: 112."
    )
    now_ts = datetime.now(timezone.utc).isoformat()

    if is_mock:
        reason = f"MOCK_SMS is '{mock_env}'" if (mock_env in ["true", "1"]) else "MSG91_AUTH_KEY is empty on disk"
        logger.info(f"[SOS Alert Mock] Mode: mock ({reason}). Dispatching preview to {phone}")
        mock_msg_id = f"MOCK-MSG91-{int(time.time() * 1000)}"

        # Non-blocking persistent log write
        try:
            save_sos_log_entry({
                "timestamp": now_ts,
                "recipient": phone,
                "zone": request.zoneName,
                "risk_level": request.riskLevel,
                "message_id": mock_msg_id,
                "http_status": 200,
                "response_type": "success",
                "mode": "mock",
                "geofence_radius_km": request.geofenceRadiusKm,
                "user_distance_km": request.userDistanceKm,
                "alert_body": alert_text
            })
        except Exception as log_err:
            logger.error(f"[SOS Dispatch Log Error - Non-Fatal]: {log_err}")

        return {
            "success": True,
            "mode": "mock",
            "message": "Mock SOS SMS dispatched successfully (Simulated)",
            "messageId": mock_msg_id,
            "phone": phone,
            "riskLevel": request.riskLevel,
            "zoneName": request.zoneName,
            "geofenceRadiusKm": request.geofenceRadiusKm,
            "userDistanceKm": request.userDistanceKm,
            "timestamp": now_ts,
            "alertBody": alert_text,
            "mockNote": f"Running in mock mode because {reason}. Enter real credentials in backend/.env and save."
        }

    # Live MSG91 Flow dispatch
    try:
        sender_id = os.getenv("MSG91_SENDER_ID", "SLPRSC").strip()
        template_id = os.getenv("MSG91_TEMPLATE_ID", "").strip()
        clean_phone = "".join(filter(str.isdigit, phone))

        # If user entered a 10-digit number without country code, prefix India (91)
        if len(clean_phone) == 10:
            clean_phone = f"91{clean_phone}"

        if not template_id:
            logger.error("[MSG91 Dispatch Error] MSG91_TEMPLATE_ID (Flow ID) is empty in backend/.env")
            err_msg_id = f"ERR-TEMPLATE-{int(time.time()*1000)}"
            try:
                save_sos_log_entry({
                    "timestamp": now_ts,
                    "recipient": clean_phone,
                    "zone": request.zoneName,
                    "risk_level": request.riskLevel,
                    "message_id": err_msg_id,
                    "http_status": 400,
                    "response_type": "error",
                    "mode": "live_msg91_error",
                    "geofence_radius_km": request.geofenceRadiusKm,
                    "user_distance_km": request.userDistanceKm,
                    "alert_body": alert_text
                })
            except Exception as log_err:
                logger.error(f"[SOS Dispatch Log Error - Non-Fatal]: {log_err}")

            return {
                "success": False,
                "mode": "live_msg91_error",
                "error": "MSG91_TEMPLATE_ID (Flow ID) is missing in backend/.env. Please paste your Flow ID from MSG91 dashboard.",
                "phone": clean_phone,
                "timestamp": now_ts
            }

        payload = {
            "template_id": template_id,
            "sender": sender_id,
            "short_url": "0",
            "mobiles": clean_phone,
            "recipients": [
                {
                    "mobiles": clean_phone,
                    "var1": request.zoneName,
                    "var2": request.riskLevel,
                    "var3": f"{request.geofenceRadiusKm:.1f}km"
                }
            ],
            "var1": request.zoneName,
            "var2": request.riskLevel,
            "var3": f"{request.geofenceRadiusKm:.1f}km"
        }

        masked_key = f"{msg91_key[:4]}***" if len(msg91_key) >= 4 else "***"
        print("\n" + "=" * 60)
        print("[MSG91 LIVE DISPATCH] Initiating HTTP POST to MSG91 Flow API")
        print(f"  Endpoint:      https://control.msg91.com/api/v5/flow/")
        print(f"  Auth Key:      {masked_key} (length: {len(msg91_key)})")
        print(f"  Template/Flow: {template_id}")
        print(f"  Sender ID:     {sender_id}")
        print(f"  Recipient:     {clean_phone}")
        print(f"  Payload:       {payload}")
        print("=" * 60)

        async with httpx.AsyncClient(timeout=12.0) as client:
            resp = await client.post(
                "https://control.msg91.com/api/v5/flow/",
                headers={"authkey": msg91_key, "content-type": "application/json"},
                json=payload
            )
            raw_text = resp.text
            try:
                resp_data = resp.json()
            except Exception:
                resp_data = {"raw": raw_text}

        print(f"[MSG91 RESPONSE] HTTP Status: {resp.status_code}")
        print(f"[MSG91 RESPONSE] Body:        {raw_text}")
        print("=" * 60 + "\n")

        # Check for MSG91 rejection/error payload
        if resp.status_code != 200 or (isinstance(resp_data, dict) and resp_data.get("type") == "error"):
            error_msg = resp_data.get("message") if isinstance(resp_data, dict) else raw_text
            err_msg_id = f"ERR-MSG91-{int(time.time()*1000)}"
            try:
                save_sos_log_entry({
                    "timestamp": now_ts,
                    "recipient": clean_phone,
                    "zone": request.zoneName,
                    "risk_level": request.riskLevel,
                    "message_id": err_msg_id,
                    "http_status": resp.status_code,
                    "response_type": "error",
                    "mode": "live_msg91_error",
                    "geofence_radius_km": request.geofenceRadiusKm,
                    "user_distance_km": request.userDistanceKm,
                    "alert_body": alert_text
                })
            except Exception as log_err:
                logger.error(f"[SOS Dispatch Log Error - Non-Fatal]: {log_err}")

            return {
                "success": False,
                "mode": "live_msg91_error",
                "error": f"MSG91 Gateway Error (HTTP {resp.status_code}): {error_msg}",
                "data": resp_data,
                "phone": clean_phone,
                "timestamp": now_ts
            }

        live_msg_id = resp_data.get("message", f"MSG91-{int(time.time()*1000)}")
        try:
            save_sos_log_entry({
                "timestamp": now_ts,
                "recipient": clean_phone,
                "zone": request.zoneName,
                "risk_level": request.riskLevel,
                "message_id": live_msg_id,
                "http_status": resp.status_code or 200,
                "response_type": "success",
                "mode": "live_msg91",
                "geofence_radius_km": request.geofenceRadiusKm,
                "user_distance_km": request.userDistanceKm,
                "alert_body": alert_text
            })
        except Exception as log_err:
            logger.error(f"[SOS Dispatch Log Error - Non-Fatal]: {log_err}")

        return {
            "success": True,
            "mode": "live_msg91",
            "message": "SMS dispatched to mobile carrier via MSG91",
            "messageId": live_msg_id,
            "data": resp_data,
            "phone": clean_phone,
            "timestamp": now_ts,
            "alertBody": alert_text
        }
    except Exception as err:
        logger.error(f"[MSG91 Network/Exception Error]: {err}")
        try:
            save_sos_log_entry({
                "timestamp": now_ts,
                "recipient": phone,
                "zone": request.zoneName,
                "risk_level": request.riskLevel,
                "message_id": f"EXC-{int(time.time()*1000)}",
                "http_status": 500,
                "response_type": "exception",
                "mode": "live_msg91_error",
                "geofence_radius_km": request.geofenceRadiusKm,
                "user_distance_km": request.userDistanceKm,
                "alert_body": alert_text
            })
        except Exception as log_err:
            logger.error(f"[SOS Dispatch Log Error - Non-Fatal]: {log_err}")

        return {
            "success": False,
            "mode": "live_msg91_error",
            "error": f"Failed to transmit SMS via MSG91: {str(err)}",
            "phone": phone,
            "timestamp": now_ts
        }


@app.post("/api/assist/motion")
async def receive_motion_telemetry(data: MotionTelemetry) -> Dict[str, Any]:
    """
    Receives camera optical displacement telemetry and logs potential ground shift.
    """
    now_ts = datetime.now(timezone.utc).isoformat()
    logger.info(f"[Assist Vision] Motion Telemetry from {data.zoneName}: displacement={data.displacementDetected}, level={data.motionLevelPct:.1f}%")
    return {
        "status": "received",
        "zone": data.zoneName,
        "displacementDetected": data.displacementDetected,
        "motionLevelPct": data.motionLevelPct,
        "severity": "CRITICAL" if data.motionLevelPct > 20 else "WARNING" if data.displacementDetected else "NOMINAL",
        "acknowledgedAt": now_ts
    }


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", 8000))
    host = os.getenv("HOST", "127.0.0.1")
    uvicorn.run("main:app", host=host, port=port, reload=True)


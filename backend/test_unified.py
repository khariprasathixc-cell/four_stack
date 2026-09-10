import asyncio
import os
import sys
from pathlib import Path

# Add backend directory to sys.path
BASE_DIR = Path(__file__).resolve().parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

from main import app
from httpx import AsyncClient, ASGITransport

async def run_tests():
    print("=== Testing FastAPI Backend with AsyncClient ===")
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        # 1. Health check
        res = await client.get("/api/health")
        print(f"GET /api/health -> {res.status_code}")
        assert res.status_code == 200, f"Health check failed: {res.text}"
        data = res.json()
        print(f"Health check response: {data['status']}, modules: {data['modules']}")

        # 2. Risk check (Wayanad preset)
        res = await client.get("/api/risk?lat=11.5540&lon=76.1306&radius_km=3.0")
        print(f"GET /api/risk (Wayanad) -> {res.status_code}")
        assert res.status_code == 200, f"Risk check failed: {res.text}"
        risk_data = res.json()
        print(f"Overall risk: {risk_data.get('overall_risk')}, is_mock: {risk_data.get('is_mock')}")
        features_count = len(risk_data.get('geojson', {}).get('features', []))
        print(f"GeoJSON features count: {features_count}")
        assert features_count > 0, "No GeoJSON features generated!"

        # 3. Send Alert check (Mock SMS)
        alert_payload = {
            "phone": "+919876543210",
            "zoneName": "Wayanad, Kerala",
            "riskLevel": "High",
            "lat": 11.5540,
            "lon": 76.1306,
            "geofenceRadiusKm": 5.0,
            "userDistanceKm": 1.2
        }
        res = await client.post("/api/send-alert", json=alert_payload)
        print(f"POST /api/send-alert -> {res.status_code}")
        assert res.status_code == 200, f"Send alert failed: {res.text}"
        alert_resp = res.json()
        print(f"Alert response: success={alert_resp.get('success')}, mode={alert_resp.get('mode')}, messageId={alert_resp.get('messageId')}")
        assert alert_resp.get("success") is True

        # 4. Assist Motion check
        motion_payload = {
            "zoneName": "Wayanad, Kerala",
            "lat": 11.5540,
            "lon": 76.1306,
            "motionLevelPct": 14.5,
            "displacementDetected": True,
            "boundingBox": {"x": 10, "y": 20, "w": 40, "h": 30}
        }
        res = await client.post("/api/assist/motion", json=motion_payload)
        print(f"POST /api/assist/motion -> {res.status_code}")
        assert res.status_code == 200, f"Motion telemetry failed: {res.text}"
        motion_resp = res.json()
        print(f"Motion response: status={motion_resp.get('status')}, severity={motion_resp.get('severity')}")

    print("\n=== All FastAPI Backend Tests Passed! ===")

if __name__ == "__main__":
    asyncio.run(run_tests())

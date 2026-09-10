import asyncio
import httpx
from main import app

async def run_test():
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://testserver") as client:
        # 1. Fetch current logs
        res = await client.get("/api/sos-logs")
        assert res.status_code == 200, f"Expected 200, got {res.status_code}"
        logs = res.json()
        print(f"Current log count: {len(logs)}")
        assert isinstance(logs, list), "Expected list of logs"
        
        # 2. Dispatch an alert
        alert_payload = {
            "phone": "9876543210",
            "zoneName": "Darjeeling, Himalayas",
            "riskLevel": "High",
            "geofenceRadiusKm": 5.0,
            "userDistanceKm": 1.85
        }
        res_post = await client.post("/api/send-alert", json=alert_payload)
        assert res_post.status_code == 200, f"Expected 200 from send-alert, got {res_post.status_code}"
        
        # 3. Read back from /api/sos-logs
        res2 = await client.get("/api/sos-logs")
        assert res2.status_code == 200
        logs2 = res2.json()
        assert len(logs2) >= 1
        newest = logs2[0]
        print(f"Newest log entry: {newest}")
        
        required_fields = ["timestamp", "recipient", "zone", "risk_level", "message_id", "http_status", "response_type", "mode"]
        for field in required_fields:
            assert field in newest, f"Missing required field: {field}"
            
        print("ALL /api/sos-logs CONTRACT CHECKS PASSED!")

if __name__ == "__main__":
    asyncio.run(run_test())

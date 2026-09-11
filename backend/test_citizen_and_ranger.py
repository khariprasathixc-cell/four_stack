import asyncio
import httpx

async def main():
    async with httpx.AsyncClient(base_url="http://127.0.0.1:8000", timeout=10.0) as client:
        print("\n--- 1. Testing GET /api/citizen-alerts ---")
        r = await client.get("/api/citizen-alerts")
        print(f"Status: {r.status_code}")
        assert r.status_code == 200
        alerts = r.json()
        print(f"Received {len(alerts)} initial alerts:")
        for a in alerts[:2]:
            print(f"  - [{a['id']}] {a['name']} at ({a['lat']}, {a['lon']}) - {a['zoneName']}")

        print("\n--- 2. Testing POST /api/citizen-alert ---")
        panic_payload = {
            "phone": "+91 98471 99999",
            "name": "Live Test Citizen",
            "lat": 11.5532,
            "lon": 76.1298,
            "zoneName": "Wayanad (Meppadi Slopes)",
            "riskLevel": "High",
            "userDistanceKm": 0.22,
            "source": "citizen_panic"
        }
        r = await client.post("/api/citizen-alert", json=panic_payload)
        print(f"Status: {r.status_code}")
        assert r.status_code == 200
        res = r.json()
        print(f"Response: {res}")
        assert res["success"] is True
        assert "PANIC" in res["alertId"]

        print("\n--- 3. Testing POST /api/broadcast-alert ---")
        broadcast_payload = {
            "zoneName": "Wayanad (Meppadi Slopes)",
            "riskLevel": "High",
            "customMessage": "[TEST EVACUATION] Move to high ground immediately.",
            "geofenceRadiusKm": 5.0
        }
        r = await client.post("/api/broadcast-alert", json=broadcast_payload)
        print(f"Status: {r.status_code}")
        assert r.status_code == 200
        b_res = r.json()
        print(f"Broadcast Response: totalDispatched={b_res['totalDispatched']}, mode={b_res['mode']}")
        assert b_res["success"] is True
        assert b_res["totalDispatched"] >= 1

        print("\n--- 4. Testing GET /api/sos-logs ---")
        r = await client.get("/api/sos-logs")
        print(f"Status: {r.status_code}")
        assert r.status_code == 200
        logs = r.json()
        print(f"Total audit logs recorded: {len(logs)}")
        assert len(logs) >= 2
        print(f"Latest log: {logs[0]['message_id']} ({logs[0].get('mode')}) -> {logs[0].get('recipient')}")

        print("\n--- 5. Testing GET /api/risk (Preset Wayanad) ---")
        r = await client.get("/api/risk?lat=11.5540&lon=76.1306&radius_km=3.0")
        print(f"Status: {r.status_code}")
        assert r.status_code == 200
        risk_data = r.json()
        meta = risk_data.get("geojson", {}).get("metadata", {})
        elev_m = meta.get("elevation_matrix")
        sensors = risk_data.get("sensors")
        print(f"Elevation Matrix Rows: {len(elev_m) if elev_m else 0}")
        print(f"Sensor Network Nodes: {len(sensors) if sensors else 0}")
        assert elev_m is not None
        assert len(sensors) >= 6

    print("\n✅ ALL BACKEND CITIZEN & RANGER API TESTS PASSED 100%!")

if __name__ == "__main__":
    asyncio.run(main())

import urllib.request
import urllib.error
import json

BASE = "https://four-stack.vercel.app"

def test_endpoint(name, path, method="GET", body=None):
    url = f"{BASE}{path}"
    headers = {"User-Agent": "Mozilla/5.0"}
    data = None
    if body:
        headers["Content-Type"] = "application/json"
        data = json.dumps(body).encode("utf-8")
    
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        res = urllib.request.urlopen(req, timeout=15)
        raw = res.read().decode("utf-8")
        parsed = json.loads(raw)
        print(f"PASS: [{res.status}] {name} ({path})")
        return parsed
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8", errors="ignore")
        print(f"FAIL: [{e.code}] {name} ({path}): {err_body[:150]}")
        return None
    except Exception as e:
        print(f"ERROR: {name} ({path}): {e}")
        return None

print("=" * 60)
print(f"TESTING LIVE VERCEL DEPLOYMENT: {BASE}")
print("=" * 60)

# 1. Health
h = test_endpoint("Health Check", "/api/health")

# 2. Risk (Wayanad)
r = test_endpoint("Risk Evaluation (Wayanad)", "/api/risk?lat=11.5540&lon=76.1306&radius_km=3.0")
if r:
    print(f"   -> Overall Risk: {r.get('overall_risk')}, Features: {len(r.get('geojson', {}).get('features', []))}")

# 3. SOS Dispatch
alert_body = {
    "phone": "9876543210",
    "zoneName": "Wayanad, Kerala (High Hazard Zone)",
    "riskLevel": "High",
    "geofenceRadiusKm": 5.0,
    "userDistanceKm": 2.1
}
sos = test_endpoint("SOS Dispatch Alert", "/api/send-alert", method="POST", body=alert_body)
if sos:
    print(f"   -> Mode: {sos.get('mode')}, Success: {sos.get('success')}, MessageID: {sos.get('messageId')}")

# 4. SOS Logs
logs = test_endpoint("SOS Dispatch Logs", "/api/sos-logs")
if isinstance(logs, list):
    print(f"   -> Stored Logs Count: {len(logs)}")
    if logs:
        print(f"   -> Latest Log Entry ID: {logs[0].get('id')}, Mode: {logs[0].get('mode')}")

# 5. All 5 Presets
presets = [
    ("Wayanad", 11.5540, 76.1306),
    ("Munnar", 10.0889, 77.0595),
    ("Darjeeling", 27.0410, 88.2663),
    ("Amalfi", 40.6340, 14.6027),
    ("Oso", 48.2770, -121.9160),
]
print("\nTesting all 5 presets on live Vercel:")
for name, lat, lon in presets:
    pr = test_endpoint(f"Preset {name}", f"/api/risk?lat={lat}&lon={lon}&radius_km=3.0")
    if pr:
        print(f"   -> {name}: {pr.get('overall_risk')} Risk | Source: {pr.get('terrain', {}).get('elevation_source')}")

print("\n" + "=" * 60)
print("ALL LIVE VERCEL TESTS COMPLETED!")
print("=" * 60)

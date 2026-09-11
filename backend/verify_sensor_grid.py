import urllib.request
import json

base_api = 'http://127.0.0.1:8000'
presets = [
    ('Wayanad', 11.5540, 76.1306),
    ('Munnar', 10.0889, 77.0595),
    ('Darjeeling', 27.0410, 88.2663)
]

for name, lat, lon in presets:
    url = f"{base_api}/api/risk?lat={lat}&lon={lon}&radius_km=3.0"
    res = urllib.request.urlopen(url)
    assert res.status == 200
    data = json.loads(res.read().decode('utf-8'))
    
    print(f"=== Preset {name} ===")
    print(f"Overall Risk: {data['overall_risk']}, Rain: {data['rainfall']['rainfall_risk']} ({data['rainfall']['accumulation_24h_mm']}mm)")
    
    sensors = data.get('sensors', [])
    print(f"Sensors ({len(sensors)} nodes):")
    assert len(sensors) >= 6, "Expected at least 6 sensor points"
    
    live_found = False
    for s in sensors:
        print(f"  - {s['id']}: {s['name']} | Piezo={s['piezo_risk']} | Rain={s['rainfall_risk']} | Fusion={s['status_label']} ({s['status_color']}) | Live={s['is_live']}")
        if s['is_live']:
            live_found = True
    assert live_found, "Live hardware sensor PZ-01 not marked as is_live"
    
    meta = data['geojson']['metadata']
    assert 'elevation_matrix' in meta, "elevation_matrix missing from metadata"
    assert 'bounds' in meta, "bounds missing from metadata"
    print(f"Hillshade 2D Relief Metadata: Grid {len(meta['elevation_matrix'])}x{len(meta['elevation_matrix'][0])}, Bounds={meta['bounds']}")
    print()

frontend_res = urllib.request.urlopen('http://localhost:5173/')
assert frontend_res.status == 200
print(f"Frontend HTTP Status: {frontend_res.status} (Vite server is healthy)")
print("\nALL MULTI-POINT SENSOR GRID & 2D HILLSHADE TESTS PASSED SUCCESSFULLY!")

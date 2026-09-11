import asyncio
from predict.rainfall import fetch_rainfall_risk
from predict.terrain import fetch_terrain_risk
from predict.fusion import evaluate_combined_risk

presets = [
    ("Wayanad", 11.5540, 76.1306, 3.0),
    ("Munnar", 10.0889, 77.0595, 3.0),
    ("Darjeeling", 27.0410, 88.2663, 3.0),
]

async def test_all():
    print("Testing all 3 presets with USE_MOCK_DATA=true:")
    for name, lat, lon, rad in presets:
        res = await evaluate_combined_risk(lat, lon, rad)
        rain_risk = res["rainfall"]["rainfall_risk"]
        rain_24 = res["rainfall"]["accumulation_24h_mm"]
        overall = res["overall_risk"]
        cells = len(res["geojson"]["features"])
        err_code = res["terrain"]["error_code"]
        is_mock = res.get("is_mock")
        source = res["terrain"]["data_source"]
        print(f"{name:12}: Overall={overall:<6} RainRisk={rain_risk:<6} 24hRain={rain_24:>5.1f}mm Cells={cells} ErrorCode={err_code} is_mock={is_mock} Source='{source}'")
        assert err_code is None
        assert cells > 0
        assert is_mock is True
    print("\nAll 3 presets returned complete valid risk data with ZERO error codes!")

if __name__ == "__main__":
    asyncio.run(test_all())

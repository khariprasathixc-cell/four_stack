# ⛰️ Slope-to-Rescue: Landslide Early Warning & Response System

> **A multi-phase real-time landslide risk intelligence and disaster response platform.**

```
   ┌────────────────────────────────────────────────────────┐
   │                  SLOPE-TO-RESCUE                       │
   │                                                        │
   │  [ Phase 1: PREDICT ] ──▶ [ Phase 2: DETECT ] ──▶ [ Phase 3: ASSIST ]
   │   Rainfall + Terrain        Edge Piezo Sensors      Thermal/Camera Vision
   │   Topographic Modeling      Vibration Telemetry     Evacuation Routing  
   └────────────────────────────────────────────────────────┘
```

---

## 📌 Phase 1: Predict (Rainfall + Terrain Risk)

Phase 1 provides predictive early-warning hazard modeling by combining **terrain topography** (SRTM Digital Elevation Models) with **real-time atmospheric precipitation** (Open-Meteo).

- **Rainfall Risk Modeling** (`predict/rainfall.py`):
  - Ingests precipitation time-series from the Open-Meteo meteorological API (no key required).
  - Computes antecedent 24-hour and 72-hour rainfall accumulation.
  - Classifies rainfall threat based on geotechnical pore-pressure and saturation thresholds.
- **Terrain Risk Modeling** (`predict/terrain.py`):
  - Generates geographic bounding boxes from target center coordinates (`lat`, `lon`, `radius_km`).
  - Downloads 90m SRTM global DEM data via the OpenTopography REST API.
  - Computes first derivatives (slope angle in degrees) using `np.gradient(Z, dy, dx)`.
  - Computes second derivatives to calculate Laplacian curvature ($\nabla^2 Z = \frac{\partial^2 Z}{\partial x^2} + \frac{\partial^2 Z}{\partial y^2}$) identifying hollows, gullies, and water-channeling convergence zones.
  - Generates GeoJSON cell polygons with terrain risk levels (`Low`, `Medium`, `High`).
  - **Graceful Degradation**: If an OpenTopography API key is not yet set, the system seamlessly provides an educational synthetic elevation model and informs the user via clear UI alerts without crashing.
- **Risk Fusion Engine** (`predict/fusion.py`):
  - Fuses cell-level terrain slope vulnerability with regional rainfall saturation using a weighted geotechnical decision matrix.
  - Produces an interactive, color-coded GeoJSON FeatureCollection with per-cell metrics (slope, curvature, rainfall accumulation, final hazard rating).
- **Interactive Dashboard** (`frontend/`):
  - Built with React, Vite, and Leaflet.
  - **OpenTopoMap Keyless Base Tiles**: High-resolution topographic contour and hillshade tiles without any API key or watermarks.
  - **Zero-Dependency Demo Mode**: Automatic pre-cached regional datasets (`USE_MOCK_DATA=true`) providing instant risk evaluations for all 5 presets.
  - Color-coded risk map overlay (Emerald Green: Low, Amber: Medium, Crimson: High).
  - Cell inspection popups with live slope, curvature, and elevation metrics.
  - Side telemetry panel with 24h & 72h rainfall gauges and overall hazard summary.
  - Preset quick-selects for high-risk zones (e.g., Wayanad, Kerala; Munnar, Western Ghats; Darjeeling, Himalayas).

---

## 📂 Repository Structure

```
four_stack/
├── README.md                      # Comprehensive project documentation
├── backend/                       # FastAPI predictive service
│   ├── .env.example               # Template environment configuration
│   ├── .env                       # Local environment variables (USE_MOCK_DATA=true)
│   ├── requirements.txt           # Python backend dependencies
│   ├── main.py                    # FastAPI application & API endpoints
│   ├── mock_data/                 # Predefined regional datasets for instant demos
│   │   ├── rainfall_samples.json  # 72h/24h precipitation records for all presets
│   │   └── elevation_samples/     # 90m SRTM-like elevation grids (.npy)
│   ├── predict/                   # Phase 1: Predict Module
│   │   ├── __init__.py
│   │   ├── rainfall.py            # Precipitation analysis (mock loader + live Open-Meteo)
│   │   ├── terrain.py             # Topography & slope modeling (cached DEMs + live SRTM)
│   │   └── fusion.py              # Multi-hazard decision matrix & GeoJSON fusion
│   ├── detect/                    # Phase 2: Detect Module (Future Expansion)
│   │   └── __init__.py            # Ingestion stubs for ESP32 & piezo vibration
│   └── assist/                    # Phase 3: Assist Module (Future Expansion)
│       └── __init__.py            # Stubs for camera streams, CV & rescue routing
└── frontend/                      # React + Vite + Leaflet Web Dashboard
    ├── package.json
    ├── vite.config.js
    ├── index.html
    └── src/
        ├── App.jsx                # Main dashboard application
        ├── App.css                # Polished modern theme & layout styling
        ├── components/
        │   ├── Header.jsx         # App header & module status
        │   ├── ControlBar.jsx     # Coordinates input, presets & triggers
        │   ├── RiskMap.jsx        # Interactive Leaflet GeoJSON risk map
        │   ├── SidePanel.jsx      # Telemetry gauges, rainfall stats & summary
        │   └── ApiKeyBanner.jsx   # Informative banner for OpenTopography key
        └── main.jsx
```

---

## 🔑 OpenTopography API Key Configuration

> [!NOTE]
> **Zero-Setup Demo Mode (`USE_MOCK_DATA=true`)**:
> By default, the system runs with `USE_MOCK_DATA=true` enabled in `backend/.env`. This provides instant, calibrated regional topographic models and precipitation time-series across all 5 presets with **zero API key required** and **zero network latency**.
> 
> To switch to live API queries, set `USE_MOCK_DATA=false` in `backend/.env` and follow the key configuration steps below.

> [!IMPORTANT]
> **Live Key Configuration Details**:
> - **Exact Variable Name**: `OPENTOPOGRAPHY_API_KEY`
> - **Exact File Location**: `backend/.env` (located inside the `backend/` directory)
> - **Restart Required**: You **MUST restart the uvicorn backend process** after editing `backend/.env`. Uvicorn's `--reload` flag only monitors Python source files (`*.py`) for changes; it does **not** automatically reload system environment variables.

### Step-by-Step Setup for Live Data:
1. Go to the [OpenTopography Portal](https://portal.opentopography.org/myopentopo).
2. Create a free account or sign in.
3. In **My OpenTopo**, click **Authorizations & API Keys** → **Request an API Key**.
4. Open the file `backend/.env`:
   ```env
   USE_MOCK_DATA=false
   OPENTOPOGRAPHY_API_KEY="your_opentopography_key_here"
   ```
5. **Restart Uvicorn**:
   Stop any running uvicorn process (`Ctrl + C`) and restart it:
   ```bash
   cd backend
   uvicorn main:app --reload --port 8001
   ```
6. **Confirm in Console**: On boot, check the console output. You will see:
   ```
   [Slope-to-Rescue] Backend init: OPENTOPOGRAPHY_API_KEY loaded: abcd*** (from .../backend/.env)
   ```
   *(The key is automatically masked for security and never logged in full).*

---

## 🚀 Quick Start Guide

### 1. Backend Setup (FastAPI)

From the project root:

```bash
# Navigate to backend directory
cd backend

# Create virtual environment (if not already created)
python -m venv .venv

# Activate virtual environment
# Windows (PowerShell):
.\.venv\Scripts\Activate.ps1
# Windows (cmd):
.\.venv\Scripts\activate.bat
# Linux / macOS:
source .venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Start the development server
uvicorn main:app --reload --port 8000
```

The backend will be live at:
- **API Base**: [http://127.0.0.1:8000](http://127.0.0.1:8000)
- **Interactive OpenAPI Docs**: [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs)
- **Health Check**: [http://127.0.0.1:8000/api/health](http://127.0.0.1:8000/api/health)
- **Risk Assessment Endpoint**: [http://127.0.0.1:8000/api/risk?lat=11.5540&lon=76.1306&radius_km=3.0](http://127.0.0.1:8000/api/risk?lat=11.5540&lon=76.1306&radius_km=3.0)

---

### 2. Frontend Setup (React + Vite)

In a separate terminal:

```bash
# Navigate to frontend directory
cd frontend

# Install dependencies
npm install

# Start Vite dev server
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

---

## 📡 API Reference

### `GET /api/health`
Returns service health status and availability of all modules (Predict, Detect, Assist).

### `GET /api/rainfall?lat={lat}&lon={lon}`
Returns:
- `accumulation_24h_mm`: Cumulative precipitation over the past 24 hours.
- `accumulation_72h_mm`: Cumulative precipitation over the past 72 hours.
- `rainfall_risk`: Categorical risk (`Low`, `Medium`, `High`).
- `recent_trend`: Hourly precipitation breakdown.

### `GET /api/terrain?lat={lat}&lon={lon}&radius_km={radius}`
Returns:
- `bounding_box`: Computed geographic bounds (`south`, `north`, `west`, `east`).
- `geojson`: FeatureCollection of terrain cells classified by slope angle & curvature.
- `api_key_configured`: Boolean indicating whether a real OpenTopography API key is in use.

### `GET /api/risk?lat={lat}&lon={lon}&radius_km={radius}`
Combines terrain slope analysis with precipitation accumulation into a unified multi-hazard risk assessment GeoJSON.

### `POST /api/send-alert`
Dispatches emergency SOS notification via MSG91 Flow API or mock simulation.
**Payload:**
```json
{
  "phone": "+919876543210",
  "zoneName": "Wayanad, Kerala",
  "riskLevel": "High",
  "lat": 11.5540,
  "lon": 76.1306,
  "geofenceRadiusKm": 5.0,
  "userDistanceKm": 1.2
}
```

### `POST /api/assist/motion`
Receives optical displacement telemetry and bounding boxes from the client camera frame differencing engine.

---

## 🚀 Unified Vercel Deployment

Slope-to-Rescue deploys as a **single unified project on Vercel** serving:
1. **Static React/Vite Frontend** (built to `frontend/dist`).
2. **Node.js Serverless Function** (`api/send-alert.js`) handling `/api/send-alert` with MSG91 SMS dispatch and mock fallback.
3. **Python Serverless Functions** (`api/index.py`) routing `/api/risk`, `/api/health`, `/api/terrain`, and `/api/rainfall` to the FastAPI backend.

### Deployment Configuration (`vercel.json`)
```json
{
  "version": 2,
  "buildCommand": "cd frontend && npm install && npm run build",
  "outputDirectory": "frontend/dist",
  "framework": "vite",
  "rewrites": [
    { "source": "/api/send-alert", "destination": "/api/send-alert.js" },
    { "source": "/api/(.*)", "destination": "/api/index.py" }
  ]
}
```

### Environment Variables on Vercel Dashboard
Configure the following in your Vercel Project Settings (*Environment Variables*):
- `USE_MOCK_DATA`: Set to `true` to utilize pre-calibrated SRTM elevation samples and rainfall profiles.
- `MOCK_SMS`: Set to `true` for mock SMS delivery during evaluation without incurring SMS gateway charges.
- `MSG91_AUTH_KEY`: (Optional) Your live MSG91 authentication key for real SMS broadcast.
- `MSG91_TEMPLATE_ID`: (Optional) Your approved MSG91 Flow template identifier.
- `OPENTOPOGRAPHY_API_KEY`: (Optional) OpenTopography key for live global SRTM DEM querying.

---

## 🎛️ Unified Dashboard Capabilities

1. **Persistent Top-Level Status Bar**:
   - Continuous situational awareness across panels: `Active Panel | Zone: High Risk | SOS: Armed (5.0km) | Camera: Monitoring | Engine: Online`.
2. **Predict Panel**:
   - Interactive Leaflet map with OpenTopoMap contours and GeoJSON risk cell polygons.
   - 24h/72h rainfall saturation gauges and terrain slope breakdown.
   - 5 instant presets: Wayanad, Munnar, Darjeeling, Amalfi Coast, and Oso.
3. **SOS Panel**:
   - Automated hazard geofence centered on the selected risk zone.
   - Dynamic radius scaling: **High Risk** $\rightarrow 5.0\text{ km}$, **Medium Risk** $\rightarrow 3.0\text{ km}$, **Low Risk** $\rightarrow 1.0\text{ km}$.
   - Real-time GPS verification via Haversine distance calculations.
   - Critical danger banner with direct one-touch emergency helpline dialing (`112`, `1078`, `108`, `100`).
   - SOS broadcast trigger dispatching SMS via `/api/send-alert`.
4. **Assist Panel**:
   - High-speed client-side frame differencing running at 30–60 fps via HTML5 Canvas.
   - Targets rear camera (`facingMode: "environment"`) on mobile or webcam with synthetic slope fallback.
   - Neon glowing bounding boxes and centroid crosshairs around moving debris clusters.
   - Instant alarm state flagging potential slope displacement with zone context labeling.
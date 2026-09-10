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
│   ├── .env                       # Local environment variables
│   ├── requirements.txt           # Python backend dependencies
│   ├── main.py                    # FastAPI application & API endpoints
│   ├── predict/                   # Phase 1: Predict Module
│   │   ├── __init__.py
│   │   ├── rainfall.py            # Open-Meteo precipitation analysis
│   │   ├── terrain.py             # OpenTopography SRTM DEM, slope & curvature
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

> [!IMPORTANT]
> **Key Configuration Details**:
> - **Exact Variable Name**: `OPENTOPOGRAPHY_API_KEY`
> - **Exact File Location**: `backend/.env` (located inside the `backend/` directory)
> - **Restart Required**: You **MUST restart the uvicorn backend process** after editing `backend/.env`. Uvicorn's `--reload` flag only monitors Python source files (`*.py`) for changes; it does **not** automatically reload system environment variables.

### Step-by-Step Setup:
1. Go to the [OpenTopography Portal](https://portal.opentopography.org/myopentopo).
2. Create a free account or sign in.
3. In **My OpenTopo**, click **Authorizations & API Keys** → **Request an API Key**.
4. Open the file `backend/.env` (create it if it doesn't exist by copying `backend/.env.example`):
   ```env
   OPENTOPOGRAPHY_API_KEY="your_opentopography_key_here"
   ```
5. **Restart Uvicorn**:
   Stop any running uvicorn process (`Ctrl + C`) and restart it:
   ```bash
   cd backend
   uvicorn main:app --reload --port 8000
   ```
6. **Confirm in Console**: On boot, check the console output. You will see:
   ```
   [Slope-to-Rescue] Backend init: OPENTOPOGRAPHY_API_KEY loaded: abcd*** (from .../backend/.env)
   ```
   *(The key is automatically masked for security and never logged in full).*

> *Note: If `OPENTOPOGRAPHY_API_KEY` is empty or missing, the backend safely falls back to a synthetic topographic model with error code `OPENTOPOGRAPHY_KEY_MISSING` and displays an instructional banner on the dashboard without crashing.*

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

---

## 🔮 Future Roadmap (Phase 2 & Phase 3)

- **Phase 2: DETECT (In-Situ Surface Vibration)**:
  - Integration with distributed ESP32 nodes equipped with piezoelectric vibration sensors.
  - Subsurface micro-crack and tremor detection before visible mass movement occurs.
  - WebSocket ingestion into `backend/detect/`.
- **Phase 3: ASSIST (Thermal / Optical Camera Vision & Response Routing)**:
  - Optical flow monitoring for surface slope displacement.
  - Evacuation corridors and rescue team dispatch routing into `backend/assist/`.
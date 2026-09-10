@echo off
echo ===================================================
echo   Starting Slope-to-Rescue (Backend + Frontend)
echo ===================================================

:: 1. Launch FastAPI Backend in a new window on port 8001
start "Slope-to-Rescue Backend (FastAPI)" cmd /k "cd /d "%~dp0backend" && .\venv\Scripts\python.exe -m uvicorn main:app --reload --port 8001"

:: 2. Launch Vite React Frontend in a new window on port 5173
start "Slope-to-Rescue Frontend (Vite)" cmd /k "cd /d "%~dp0" && npm run dev"

echo.
echo Both servers have been launched in separate windows!
echo - Frontend: http://localhost:5173
echo - Backend API: http://localhost:8001
echo - Backend Docs: http://localhost:8001/docs
echo.

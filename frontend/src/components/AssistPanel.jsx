import React, { useEffect, useRef, useState } from 'react';

export default function AssistPanel({
  zoneName = 'Target Region',
  centerLat = 11.554,
  centerLon = 76.1306,
  riskLevel = 'High',
  activeApiUrl,
  onCameraStateChange,
}) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null); // Overlay & rendering canvas
  const processCanvasRef = useRef(document.createElement('canvas')); // Offscreen downscaled canvas
  const prevFrameDataRef = useRef(null);
  const animationFrameIdRef = useRef(null);
  const streamRef = useRef(null);

  const [cameraStatus, setCameraStatus] = useState('idle'); // 'idle' | 'active' | 'error' | 'simulated'
  const [errorMessage, setErrorMessage] = useState(null);
  const [motionLevelPct, setMotionLevelPct] = useState(0);
  const [isDisplacementAlert, setIsDisplacementAlert] = useState(false);
  const [threshold, setThreshold] = useState(25); // Luminance delta threshold
  const [sensitivityPct, setSensitivityPct] = useState(2.0); // % of pixels needed to trigger alert
  const [fps, setFps] = useState(0);
  const [motionEvents, setMotionEvents] = useState([]);
  const [isTelemetrySending, setIsTelemetrySending] = useState(false);
  const lastTelemetryTimeRef = useRef(0);

  // Initialize camera stream
  useEffect(() => {
    startCamera();

    return () => {
      stopCamera();
    };
  }, []);

  const startCamera = async () => {
    stopCamera();
    setCameraStatus('connecting');
    setErrorMessage(null);

    try {
      // First attempt: Rear / Environment camera preferred
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 640 },
            height: { ideal: 480 },
          },
          audio: false,
        });
      } catch (envErr) {
        console.warn('Rear camera not directly available, falling back to any video camera:', envErr);
        // Fallback to default user camera
        stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: false,
        });
      }

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }

      setCameraStatus('active');
      if (onCameraStateChange) onCameraStateChange('monitoring', 0);
      startMotionProcessingLoop();
    } catch (err) {
      console.warn('Camera access error, enabling demo simulated mode:', err);
      setErrorMessage(`Camera hardware notice: ${err.message || 'Access denied'}. Switched to Demo Terrain Simulator.`);
      startSimulatedMode();
    }
  };

  const stopCamera = () => {
    if (animationFrameIdRef.current) {
      cancelAnimationFrame(animationFrameIdRef.current);
      animationFrameIdRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    prevFrameDataRef.current = null;
  };

  // Simulated optical displacement mode (for testing without camera or on desktop)
  const startSimulatedMode = () => {
    stopCamera();
    setCameraStatus('simulated');
    if (onCameraStateChange) onCameraStateChange('monitoring', 0);

    const procWidth = 160;
    const procHeight = 120;
    const procCanvas = processCanvasRef.current;
    procCanvas.width = procWidth;
    procCanvas.height = procHeight;
    const procCtx = procCanvas.getContext('2d', { willReadFrequently: true });

    let simX = 30;
    let simSpeed = 1.2;
    let frameCount = 0;
    let lastFpsCheck = Date.now();

    const simLoop = () => {
      frameCount++;
      const now = Date.now();
      if (now - lastFpsCheck >= 1000) {
        setFps(frameCount);
        frameCount = 0;
        lastFpsCheck = now;
      }

      // Draw synthetic hillside slope background
      procCtx.fillStyle = '#1e293b';
      procCtx.fillRect(0, 0, procWidth, procHeight);

      // Draw hill slope contour
      procCtx.fillStyle = '#334155';
      procCtx.beginPath();
      procCtx.moveTo(0, procHeight);
      procCtx.lineTo(0, 40);
      procCtx.lineTo(procWidth, 90);
      procCtx.lineTo(procWidth, procHeight);
      procCtx.fill();

      // Draw simulated moving debris / rock sliding
      simX += simSpeed;
      if (simX > procWidth - 40 || simX < 20) {
        simSpeed = -simSpeed;
      }

      procCtx.fillStyle = '#ef4444';
      procCtx.fillRect(simX, 55 + (simX * 0.25), 24, 16);

      // Perform frame differencing on the generated scene
      processFrame(procCanvas, procCtx, procWidth, procHeight);
      animationFrameIdRef.current = requestAnimationFrame(simLoop);
    };

    animationFrameIdRef.current = requestAnimationFrame(simLoop);
  };

  // Main 30-60 fps motion differencing loop
  const startMotionProcessingLoop = () => {
    const procWidth = 160;
    const procHeight = 120;
    const procCanvas = processCanvasRef.current;
    procCanvas.width = procWidth;
    procCanvas.height = procHeight;
    const procCtx = procCanvas.getContext('2d', { willReadFrequently: true });

    let frameCount = 0;
    let lastFpsCheck = Date.now();

    const loop = () => {
      const video = videoRef.current;
      if (video && video.readyState >= 2) {
        frameCount++;
        const now = Date.now();
        if (now - lastFpsCheck >= 1000) {
          setFps(frameCount);
          frameCount = 0;
          lastFpsCheck = now;
        }

        // Downscale current video frame for rapid 0ms diffing
        procCtx.drawImage(video, 0, 0, procWidth, procHeight);
        processFrame(procCanvas, procCtx, procWidth, procHeight);
      }
      animationFrameIdRef.current = requestAnimationFrame(loop);
    };

    animationFrameIdRef.current = requestAnimationFrame(loop);
  };

  // Differential frame subtraction core
  const processFrame = (procCanvas, procCtx, width, height) => {
    const currentFrame = procCtx.getImageData(0, 0, width, height);
    const currData = currentFrame.data;
    const prevData = prevFrameDataRef.current;

    const overlayCanvas = canvasRef.current;
    if (!overlayCanvas) return;
    const overlayCtx = overlayCanvas.getContext('2d');
    overlayCanvas.width = width;
    overlayCanvas.height = height;
    overlayCtx.clearRect(0, 0, width, height);

    if (!prevData) {
      // Store first frame as baseline
      prevFrameDataRef.current = new Uint8ClampedArray(currData);
      return;
    }

    let changedPixels = 0;
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;

    const totalPixels = width * height;

    // Fast luminance subtraction loop
    for (let i = 0; i < currData.length; i += 4) {
      const r = currData[i];
      const g = currData[i + 1];
      const b = currData[i + 2];
      const lum = (r * 299 + g * 587 + b * 114) / 1000;

      const pr = prevData[i];
      const pg = prevData[i + 1];
      const pb = prevData[i + 2];
      const prevLum = (pr * 299 + pg * 587 + pb * 114) / 1000;

      const diff = Math.abs(lum - prevLum);

      if (diff > threshold) {
        changedPixels++;
        const pixelIdx = i / 4;
        const x = pixelIdx % width;
        const y = Math.floor(pixelIdx / width);

        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }

    // Update baseline frame for next iteration
    prevFrameDataRef.current.set(currData);

    const displacementPct = Math.min(100, Math.round((changedPixels / totalPixels) * 1000) / 10);
    setMotionLevelPct(displacementPct);

    const isAlert = displacementPct >= sensitivityPct && changedPixels > 25;
    setIsDisplacementAlert(isAlert);

    if (onCameraStateChange) {
      onCameraStateChange(isAlert ? 'alert' : 'monitoring', displacementPct);
    }

    // Render HUD overlay on canvas
    if (changedPixels > 15 && minX <= maxX && minY <= maxY) {
      // Draw neon bounding box around moving region
      const boxColor = isAlert ? '#ef4444' : '#f59e0b';
      overlayCtx.strokeStyle = boxColor;
      overlayCtx.lineWidth = 2;
      overlayCtx.strokeRect(minX, minY, maxX - minX, maxY - minY);

      // Crosshair at centroid
      const cX = Math.round((minX + maxX) / 2);
      const cY = Math.round((minY + maxY) / 2);
      overlayCtx.fillStyle = boxColor;
      overlayCtx.fillRect(cX - 3, cY - 1, 7, 2);
      overlayCtx.fillRect(cX - 1, cY - 3, 2, 7);

      // Label on box
      overlayCtx.font = '9px monospace';
      overlayCtx.fillStyle = '#ffffff';
      overlayCtx.fillText(
        `${displacementPct}% Shift`,
        Math.max(5, minX),
        Math.max(10, minY - 3)
      );
    }

    // Log telemetry if alert is triggered (throttled to once every 4 seconds)
    const now = Date.now();
    if (isAlert && now - lastTelemetryTimeRef.current > 4000) {
      lastTelemetryTimeRef.current = now;
      const logEntry = {
        time: new Date().toLocaleTimeString(),
        displacement: displacementPct,
        box: { x: minX, y: minY, w: maxX - minX, h: maxY - minY },
      };
      setMotionEvents((prev) => [logEntry, ...prev.slice(0, 4)]);
      sendMotionTelemetry(displacementPct, true, { minX, minY, maxX, maxY });
    }
  };

  // Dispatch motion telemetry to backend /api/assist/motion
  const sendMotionTelemetry = async (levelPct, alertFlag, box) => {
    if (!activeApiUrl) return;
    setIsTelemetrySending(true);
    try {
      await fetch(`${activeApiUrl}/api/assist/motion`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          zoneName,
          lat: centerLat,
          lon: centerLon,
          motionLevelPct: levelPct,
          displacementDetected: alertFlag,
          boundingBox: box,
          timestamp: new Date().toISOString(),
        }),
      });
    } catch (e) {
      // Background telemetry silently handles connectivity hiccups
    } finally {
      setIsTelemetrySending(false);
    }
  };

  return (
    <div className="assist-panel-wrapper" id="assist-panel-section">
      {/* 1. Zone Context Header Stamp */}
      <section className="assist-header-card">
        <div className="assist-context-stamp">
          <span className="stamp-icon">📹</span>
          <div className="stamp-meta">
            <div className="stamp-title">
              Rear Camera Optical Displacement Monitor
              <span className="stamp-facing-tag">facingMode: "environment"</span>
            </div>
            <div className="stamp-coords">
              Target Zone: <strong>{zoneName}</strong> ({centerLat.toFixed(4)}°N, {centerLon.toFixed(4)}°E) •{' '}
              <span className={`risk-tag-inline ${riskLevel.toLowerCase()}`}>{riskLevel} Risk</span>
            </div>
          </div>
        </div>

        <div className="camera-controls-quick">
          {cameraStatus !== 'active' ? (
            <button
              type="button"
              className="btn-cam-action active"
              onClick={startCamera}
            >
              📷 Connect Rear Camera
            </button>
          ) : (
            <button
              type="button"
              className="btn-cam-action danger"
              onClick={stopCamera}
            >
              ⏹️ Disconnect Camera
            </button>
          )}

          <button
            type="button"
            className={`btn-cam-action ${cameraStatus === 'simulated' ? 'sim-active' : ''}`}
            onClick={startSimulatedMode}
          >
            🧪 Simulated Slope Debris Stream
          </button>
        </div>
      </section>

      {errorMessage && (
        <div className="camera-notice-banner">
          <span>ℹ️ {errorMessage}</span>
        </div>
      )}

      {/* 2. Live Video & Real-Time Differencing Canvas Viewport */}
      <section className="assist-viewport-card">
        <div className={`video-container-relative ${isDisplacementAlert ? 'displacement-alarm-border' : ''}`}>
          {/* Main Video element */}
          <video
            ref={videoRef}
            className="camera-video-element"
            playsInline
            muted
            autoPlay
            style={{ display: cameraStatus === 'active' ? 'block' : 'none' }}
          ></video>

          {/* Fallback backdrop when simulated */}
          {cameraStatus === 'simulated' && (
            <div className="simulated-camera-placeholder">
              <span className="sim-watermark">SYNTHETIC TERRAIN DEBRIS STREAM (30 FPS)</span>
            </div>
          )}

          {/* Differential Motion Overlay Canvas */}
          <canvas ref={canvasRef} className="motion-diff-canvas"></canvas>

          {/* Optical HUD Overlays */}
          <div className="camera-hud-overlay">
            <div className="hud-top-row">
              <div className="hud-badge live-badge">
                <span className="hud-dot"></span>
                <span>{cameraStatus === 'active' ? 'OPTICAL FEED LIVE' : 'SYNTHETIC STREAM'}</span>
              </div>
              <div className="hud-badge fps-badge">{fps} FPS</div>
            </div>

            {/* Critical Displacement Alert Overlay */}
            {isDisplacementAlert && (
              <div className="hud-displacement-banner">
                <span className="hud-alarm-icon">⚠️</span>
                <span>SLOPE DISPLACEMENT DETECTED ({motionLevelPct}%)</span>
              </div>
            )}

            <div className="hud-bottom-row">
              <span className="hud-zone-label">
                📍 {zoneName} ({centerLat.toFixed(2)}°, {centerLon.toFixed(2)}°)
              </span>
              <span className="hud-algorithm-tag">Method: Consecutive Pixel Differencing</span>
            </div>
          </div>
        </div>

        {/* Real-Time Motion Intensity Gauge */}
        <div className="motion-gauge-container">
          <div className="gauge-header">
            <span className="gauge-title">Surface Displacement Intensity</span>
            <span className={`gauge-value ${isDisplacementAlert ? 'alert' : ''}`}>
              {motionLevelPct}%{' '}
              {isDisplacementAlert ? '(DISPLACEMENT DETECTED)' : '(STABLE)'}
            </span>
          </div>
          <div className="gauge-bar-bg">
            <div
              className={`gauge-bar-fill ${
                isDisplacementAlert ? 'fill-alert' : motionLevelPct > 1 ? 'fill-warn' : 'fill-ok'
              }`}
              style={{ width: `${Math.min(100, motionLevelPct * 4)}%` }}
            ></div>
            {/* Threshold indicator line */}
            <div
              className="gauge-threshold-line"
              style={{ left: `${sensitivityPct * 4}%` }}
              title={`Alert Threshold: ${sensitivityPct}%`}
            ></div>
          </div>
          <div className="gauge-sub">
            Threshold: {sensitivityPct}% displacement triggers automated disaster alert.
          </div>
        </div>
      </section>

      {/* 3. Sensitivity Controls & Telemetry Dispatch Log */}
      <section className="assist-card tuning-card">
        <div className="tuning-grid">
          <div className="tune-item">
            <label htmlFor="input-threshold">
              Luminance Delta Sensitivity (&tau;): <strong>{threshold}</strong>
            </label>
            <input
              id="input-threshold"
              type="range"
              min="10"
              max="60"
              value={threshold}
              onChange={(e) => setThreshold(Number(e.target.value))}
              className="slider-range"
            />
            <span className="tune-sub">Lower values detect micro-movement; higher ignores noise.</span>
          </div>

          <div className="tune-item">
            <label htmlFor="input-sensitivity">
              Displacement Threshold Area: <strong>{sensitivityPct}%</strong>
            </label>
            <input
              id="input-sensitivity"
              type="range"
              min="0.5"
              max="10.0"
              step="0.5"
              value={sensitivityPct}
              onChange={(e) => setSensitivityPct(Number(e.target.value))}
              className="slider-range"
            />
            <span className="tune-sub">Minimum moving surface area before triggering alarm.</span>
          </div>
        </div>

        {/* Recent Displacement Event Log */}
        <div className="displacement-log-section">
          <div className="log-header">
            <span>Recent Optical Displacement Events:</span>
            {isTelemetrySending && <span className="telemetry-sync">Syncing with backend...</span>}
          </div>

          {motionEvents.length === 0 ? (
            <div className="log-empty">No critical surface displacement events logged yet. Surface is stable.</div>
          ) : (
            <div className="log-list">
              {motionEvents.map((evt, idx) => (
                <div key={idx} className="log-entry">
                  <span className="log-badge-alert">⚠️ SHIFT</span>
                  <span className="log-time">{evt.time}</span>
                  <span className="log-displacement">Displacement: {evt.displacement}%</span>
                  <span className="log-meta">
                    Cluster: {evt.box.w}x{evt.box.h}px
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

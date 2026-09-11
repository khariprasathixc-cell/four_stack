import React, { useState, useEffect, useRef, useMemo } from 'react';

// Default configuration parameters
const DEFAULT_SLIDING_WINDOW_SEC = 2.5; // Rolling baseline window
const DEFAULT_SENSITIVITY_K = 3.5;      // Mean + k * standard deviation
const DEFAULT_NOISE_GATE = 0.035;       // Minimum threshold floor to prevent triggers in dead silence
const DEFAULT_COOLDOWN_MS = 750;        // Debounce tail decay time

function PiezoPanel({
  zoneName = 'Target Zone',
  onPiezoStateChange,
  onPiezoTrigger,
  regionalRainfallRisk = 'High',
}) {
  // Capture state: 'standby' | 'monitoring' | 'alert' | 'simulated'
  const [captureStatus, setCaptureStatus] = useState('standby');
  const [errorMessage, setErrorMessage] = useState(null);

  // Real-time telemetry metrics
  const [instantAmplitude, setInstantAmplitude] = useState(0);
  const [rollingMean, setRollingMean] = useState(0);
  const [rollingStdDev, setRollingStdDev] = useState(0);
  const [currentThreshold, setCurrentThreshold] = useState(0.1);
  const [isSpikeActive, setIsSpikeActive] = useState(false);

  // Refs for high-frequency telemetry throttling & trigger notification
  const lastTelemetryUpdateRef = useRef(0);
  const currentThresholdRef = useRef(0.1);
  const rollingMeanRef = useRef(0);
  const lastTriggerNotifyTimeRef = useRef(0);

  // Adjustable detection sensitivity
  const [sensitivityK, setSensitivityK] = useState(DEFAULT_SENSITIVITY_K);
  const [noiseGate, setNoiseGate] = useState(DEFAULT_NOISE_GATE);
  const [cooldownMs, setCooldownMs] = useState(DEFAULT_COOLDOWN_MS);
  const [selectedSimProfile, setSelectedSimProfile] = useState('rock_fracture');

  // Detected events log
  const [events, setEvents] = useState(() => {
    try {
      const saved = localStorage.getItem('slope_piezo_detected_events');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [showWiringGuide, setShowWiringGuide] = useState(false);

  // Web Audio API refs
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const animationFrameRef = useRef(null);
  const canvasRef = useRef(null);

  // Sliding window buffer of recent peak amplitudes (e.g. 150 frames @ 60fps)
  const amplitudeHistoryRef = useRef([]);
  const lastEventTimeRef = useRef(0);
  const spikeStartTimeRef = useRef(null);
  const peakAmplitudeInCurrentSpikeRef = useRef(0);

  // Simulation synthetic waveform injection ref
  const simulationBufferRef = useRef(null);

  // Notify parent dashboard of piezo state changes
  useEffect(() => {
    if (onPiezoStateChange) {
      if (captureStatus === 'standby') {
        onPiezoStateChange('standby');
      } else if (isSpikeActive) {
        onPiezoStateChange('alert');
      } else {
        onPiezoStateChange('monitoring');
      }
    }
  }, [captureStatus, isSpikeActive, onPiezoStateChange]);

  // Persist events to localStorage
  const saveEvents = (newEvents) => {
    setEvents(newEvents);
    try {
      localStorage.setItem('slope_piezo_detected_events', JSON.stringify(newEvents.slice(0, 100)));
    } catch (e) {
      console.warn('Failed to save piezo events:', e);
    }
  };

  // Cleanup Web Audio resources on unmount
  useEffect(() => {
    return () => {
      stopAudioCapture();
    };
  }, []);

  /**
   * Start Web Audio API capture from 3.5mm mic jack or USB audio device
   */
  const startAudioCapture = async () => {
    setErrorMessage(null);
    try {
      stopAudioCapture();

      // Constraints for raw contact piezo: disable software voice filters
      const constraints = {
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      mediaStreamRef.current = stream;

      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const audioCtx = new AudioCtx();
      audioContextRef.current = audioCtx;

      // Resume context if browser suspended it
      if (audioCtx.state === 'suspended') {
        await audioCtx.resume();
      }

      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.0; // Raw transient detection
      analyserRef.current = analyser;

      // Connect source to analyser only (NOT to audioCtx.destination to avoid feedback!)
      source.connect(analyser);

      amplitudeHistoryRef.current = [];
      setCaptureStatus('monitoring');
      startAnalysisLoop();
    } catch (err) {
      console.error('Failed to open audio input for piezo sensor:', err);
      setErrorMessage(
        `Microphone input access error: ${err.message || 'Permission denied or no audio device found'}. Plug your piezo into the 3.5mm jack or use "Simulate Test Signal".`
      );
      setCaptureStatus('standby');
    }
  };

  /**
   * Stop audio capture and release microphone
   */
  const stopAudioCapture = () => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }
    if (audioContextRef.current) {
      try {
        audioContextRef.current.close();
      } catch {}
      audioContextRef.current = null;
    }
    analyserRef.current = null;
    simulationBufferRef.current = null;
    setCaptureStatus('standby');
    setIsSpikeActive(false);
  };

  /**
   * Continuous animation & signal processing loop (sampled at 60 FPS)
   */
  const startAnalysisLoop = () => {
    const dataArray = new Float32Array(1024);

    const tick = () => {
      let currentWaveform = null;

      // 1. Check if synthetic test signal is currently injected
      if (simulationBufferRef.current && simulationBufferRef.current.length > 0) {
        currentWaveform = simulationBufferRef.current.shift();
      } else if (analyserRef.current) {
        // Read real audio from piezo audio jack
        analyserRef.current.getFloatTimeDomainData(dataArray);
        currentWaveform = dataArray;
      }

      if (currentWaveform) {
        processSignalFrame(currentWaveform);
        drawWaveform(currentWaveform);
      }

      animationFrameRef.current = requestAnimationFrame(tick);
    };

    animationFrameRef.current = requestAnimationFrame(tick);
  };

  /**
   * Signal processing & rolling baseline computation
   * Part 2: mean + k * standard deviation over sliding window
   */
  const processSignalFrame = (waveform) => {
    // 1. Calculate instantaneous peak amplitude in current frame
    let maxAbs = 0;
    for (let i = 0; i < waveform.length; i++) {
      const val = Math.abs(waveform[i]);
      if (val > maxAbs) maxAbs = val;
    }

    // 2. Maintain rolling history of frame amplitudes (~2.5 seconds = 150 frames @ 60fps)
    const history = amplitudeHistoryRef.current;
    history.push(maxAbs);
    if (history.length > 150) {
      history.shift();
    }

    // 3. Compute rolling mean (mu) and standard deviation (sigma)
    const N = history.length;
    let sum = 0;
    for (let i = 0; i < N; i++) sum += history[i];
    const mean = sum / N;

    let varSum = 0;
    for (let i = 0; i < N; i++) {
      const diff = history[i] - mean;
      varSum += diff * diff;
    }
    const stdDev = Math.sqrt(varSum / N);

    // 4. Calculate adaptive threshold: mean + k * stdDev
    const computedThreshold = Math.max(mean + sensitivityK * stdDev, noiseGate);
    currentThresholdRef.current = computedThreshold;
    rollingMeanRef.current = mean;

    // 5. Spike detection & debounce/cooldown logic
    const now = Date.now();
    const isOverThreshold = maxAbs > computedThreshold;

    // Part 1 Fix: Throttle React state telemetry updates to ~10Hz (every 100ms) or when threshold is crossed
    if (isOverThreshold || now - lastTelemetryUpdateRef.current >= 100) {
      lastTelemetryUpdateRef.current = now;
      setInstantAmplitude(maxAbs);
      setRollingMean(mean);
      setRollingStdDev(stdDev);
      setCurrentThreshold(computedThreshold);
    }

    if (isOverThreshold) {
      if (!spikeStartTimeRef.current) {
        spikeStartTimeRef.current = now;
        peakAmplitudeInCurrentSpikeRef.current = maxAbs;
      } else {
        if (maxAbs > peakAmplitudeInCurrentSpikeRef.current) {
          peakAmplitudeInCurrentSpikeRef.current = maxAbs;
        }
      }

      // Check if past debounce cooldown since last registered event
      if (now - lastEventTimeRef.current > cooldownMs) {
        lastEventTimeRef.current = now;
        setIsSpikeActive(true);

        const durationMs = Math.round(now - spikeStartTimeRef.current + 16);
        const peakAmp = peakAmplitudeInCurrentSpikeRef.current;
        const snr = (peakAmp / (mean || 0.001)).toFixed(1);

        // Compute fusion diagnosis
        const isRainHigh = String(regionalRainfallRisk).toLowerCase() === 'high';
        const isSevere = peakAmp >= 2.0 * computedThreshold;
        let ruleTag = 'PIEZO ADVISORY';
        let ruleDiagnosis = 'Minor acoustic anomaly';
        if (isRainHigh && peakAmp > computedThreshold) {
          ruleTag = 'RULE A (RAIN+PIEZO FUSED)';
          ruleDiagnosis = `Rule A: Acoustic crack breach (${(peakAmp * 100).toFixed(1)}% > ${(computedThreshold * 100).toFixed(1)}%) + High Rainfall Saturation`;
        } else if (isSevere) {
          ruleTag = 'RULE B (PIEZO SEVERE ALONE)';
          ruleDiagnosis = `Rule B: High-energy acoustic shock (${(peakAmp * 100).toFixed(1)}% >= 2x ${(computedThreshold * 100).toFixed(1)}%) alone without rainfall confirmation`;
        } else if (peakAmp > computedThreshold) {
          ruleTag = 'PIEZO SPIKE';
          ruleDiagnosis = `Acoustic transient breach (${(peakAmp * 100).toFixed(1)}% > ${(computedThreshold * 100).toFixed(1)}%) under ${regionalRainfallRisk} rain`;
        }

        const newEvent = {
          id: `piezo_${now}_${Math.floor(Math.random() * 1000)}`,
          timestamp: new Date().toISOString(),
          peak_amplitude: Number(peakAmp.toFixed(3)),
          threshold_at_trigger: Number(computedThreshold.toFixed(3)),
          noise_floor: Number(mean.toFixed(3)),
          snr_ratio: Number(snr),
          duration_ms: durationMs > 0 ? durationMs : 24,
          severity: peakAmp > 0.55 ? 'CRITICAL' : peakAmp > 0.25 ? 'WARNING' : 'ADVISORY',
          fusion_rule: ruleTag,
          diagnosis: ruleDiagnosis,
        };

        setEvents((prev) => {
          const updated = [newEvent, ...prev.slice(0, 99)];
          try {
            localStorage.setItem('slope_piezo_detected_events', JSON.stringify(updated));
          } catch {}
          return updated;
        });

        // Notify parent dashboard for Part 2 cascading escalation and Part 3 real-time fusion logic
        if (now - lastTriggerNotifyTimeRef.current > 400) {
          lastTriggerNotifyTimeRef.current = now;
          if (onPiezoTrigger) {
            onPiezoTrigger({
              peakAmplitude: peakAmp,
              threshold: computedThreshold,
              mean,
              severity: newEvent.severity,
              isSimulated: captureStatus === 'simulated' || simulationBufferRef.current !== null,
              ruleTag,
              ruleDiagnosis,
            });
          }
        }

        // Clear spike active state after brief display duration
        setTimeout(() => {
          setIsSpikeActive(false);
        }, 1200);
      }
    } else {
      spikeStartTimeRef.current = null;
    }
  };

  /**
   * Draw waveform and rolling threshold on HTML5 Canvas
   */
  const drawWaveform = (waveform) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    const midY = height / 2;

    // Background
    ctx.fillStyle = '#0a0f1d';
    ctx.fillRect(0, 0, width, height);

    // Subtle grid lines
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, midY);
    ctx.lineTo(width, midY);
    ctx.stroke();

    for (let y = midY - 60; y >= 0; y -= 40) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
    for (let y = midY + 60; y < height; y += 40) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    // Draw Rolling Threshold Lines (+Threshold and -Threshold)
    const threshNormalized = Math.min(currentThreshold, 1.0);
    const threshPixelYPositive = midY - threshNormalized * (midY - 10);
    const threshPixelYNegative = midY + threshNormalized * (midY - 10);

    ctx.strokeStyle = isSpikeActive ? 'rgba(239, 68, 68, 0.85)' : 'rgba(245, 158, 11, 0.6)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);

    // Positive threshold
    ctx.beginPath();
    ctx.moveTo(0, threshPixelYPositive);
    ctx.lineTo(width, threshPixelYPositive);
    ctx.stroke();

    // Negative threshold
    ctx.beginPath();
    ctx.moveTo(0, threshPixelYNegative);
    ctx.lineTo(width, threshPixelYNegative);
    ctx.stroke();
    ctx.setLineDash([]); // Reset dash

    // Draw Incoming Piezo Waveform Line Graph
    ctx.lineWidth = isSpikeActive ? 2.5 : 1.8;
    ctx.strokeStyle = isSpikeActive ? '#ef4444' : '#00e5ff';
    ctx.shadowBlur = isSpikeActive ? 12 : 6;
    ctx.shadowColor = isSpikeActive ? '#ef4444' : '#00e5ff';

    ctx.beginPath();
    const sliceWidth = width / waveform.length;
    let x = 0;

    for (let i = 0; i < waveform.length; i++) {
      const sample = waveform[i]; // value in range [-1.0, 1.0]
      const y = midY - sample * (midY - 10);

      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
      x += sliceWidth;
    }
    ctx.stroke();
    ctx.shadowBlur = 0; // Reset glow

    // Canvas Status HUD Overlay
    ctx.font = '11px monospace';
    ctx.fillStyle = isSpikeActive ? '#ef4444' : '#38bdf8';
    ctx.fillText(
      `THRESHOLD: ±${currentThreshold.toFixed(3)} (μ:${rollingMean.toFixed(3)} + ${sensitivityK}σ)`,
      14,
      20
    );

    ctx.fillStyle = '#94a3b8';
    ctx.fillText(`INST PEAK: ${(instantAmplitude * 100).toFixed(1)}%`, width - 130, 20);

    // Hazard Breach Glow on Canvas Edges
    if (isSpikeActive) {
      ctx.strokeStyle = 'rgba(239, 68, 68, 0.9)';
      ctx.lineWidth = 4;
      ctx.strokeRect(0, 0, width, height);

      ctx.fillStyle = 'rgba(239, 68, 68, 0.15)';
      ctx.fillRect(0, 0, width, height);

      ctx.font = 'bold 14px sans-serif';
      ctx.fillStyle = '#ffffff';
      ctx.fillText('🚨 ACOUSTIC CRACK SPIKE DETECTED', width / 2 - 130, midY - 20);
    }
  };

  /**
   * Part 4: Inject Synthetic Spike Pattern into Analysis Pipeline
   * Generates a damped transient impulse mimicking a rock fissure or soil shear slip
   */
  const triggerSimulation = (profileType = 'rock_fracture') => {
    // If not already in monitoring loop, start the analysis loop
    if (captureStatus === 'standby') {
      setCaptureStatus('simulated');
      startAnalysisLoop();
    }

    const frameCount = 30; // ~500ms of frames
    const frames = [];

    // Frequency and amplitude profiles for different geotechnical events
    let peakAmp = 0.75;
    let decayRate = 0.18;
    let freq = 12.0;

    if (profileType === 'soil_slip') {
      peakAmp = 0.45;
      decayRate = 0.08;
      freq = 6.0;
    } else if (profileType === 'acoustic_tap') {
      peakAmp = 0.85;
      decayRate = 0.25;
      freq = 20.0;
    }

    // 1. Initial 4 baseline quiet frames
    for (let f = 0; f < 4; f++) {
      const frame = new Float32Array(1024);
      for (let i = 0; i < 1024; i++) {
        frame[i] = (Math.random() - 0.5) * 0.02; // ambient noise floor
      }
      frames.push(frame);
    }

    // 2. Sharp transient impulse followed by decaying ringing
    for (let f = 0; f < frameCount; f++) {
      const frame = new Float32Array(1024);
      const envelope = Math.exp(-decayRate * f);

      for (let i = 0; i < 1024; i++) {
        const t = (f * 1024 + i) / 1024;
        const carrier = Math.sin(t * freq);
        const noise = (Math.random() - 0.5) * 0.04;
        frame[i] = peakAmp * envelope * carrier + noise;
      }
      frames.push(frame);
    }

    // 3. Trailing calm frames
    for (let f = 0; f < 10; f++) {
      const frame = new Float32Array(1024);
      for (let i = 0; i < 1024; i++) {
        frame[i] = (Math.random() - 0.5) * 0.02;
      }
      frames.push(frame);
    }

    simulationBufferRef.current = frames;
  };

  const handleClearEvents = () => {
    if (window.confirm('Clear all recorded piezo crack detection events?')) {
      saveEvents([]);
    }
  };

  // Export Events to CSV
  const handleExportCsv = () => {
    if (events.length === 0) return;
    const headers = ['Timestamp', 'Peak Amplitude', 'Threshold at Trigger', 'Noise Floor', 'SNR Ratio', 'Duration (ms)', 'Severity'];
    const rows = events.map((e) => [
      `"${new Date(e.timestamp).toISOString()}"`,
      e.peak_amplitude,
      e.threshold_at_trigger,
      e.noise_floor,
      e.snr_ratio,
      e.duration_ms,
      `"${e.severity}"`,
    ]);
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const link = document.createElement('a');
    link.href = encodeURI(csvContent);
    link.download = `piezo_crack_events_${Date.now()}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="piezo-panel-container" id="piezo-panel">
      {/* 1. Header & Live Mode Banner */}
      <div className="piezo-hero-banner">
        <div className="hero-left">
          <div className="piezo-phase-tag">PHASE 2: DETECT</div>
          <h2>⚡ 27mm Piezo Sensor • Audio Jack Ingestion</h2>
          <p className="hero-subtitle">
            Zero-microcontroller acoustic surveillance • Real-time subsurface shear crack & transient micro-fracture detection
          </p>
        </div>

        <div className="hero-right">
          <div className={`piezo-status-badge status-${captureStatus} ${isSpikeActive ? 'status-alert' : ''}`}>
            {isSpikeActive ? (
              <>🚨 ALERT: CRACK DETECTED</>
            ) : captureStatus === 'monitoring' ? (
              <>🟢 ACOUSTIC MONITORING ACTIVE</>
            ) : captureStatus === 'simulated' ? (
              <>🧪 SIMULATED SIGNAL INJECTION</>
            ) : (
              <>⚪ STANDBY (CAPTURE IDLE)</>
            )}
          </div>
          <button
            type="button"
            className="btn-wiring-toggle"
            onClick={() => setShowWiringGuide(!showWiringGuide)}
          >
            {showWiringGuide ? 'Hide Wiring Spec' : '🔌 3.5mm Hardware Guide'}
          </button>
        </div>
      </div>

      {/* 2. Hardware Wiring Explainer Modal / Card */}
      {showWiringGuide && (
        <div className="wiring-guide-card">
          <div className="guide-header">
            <h4>🔌 Direct 3.5mm Audio Jack Pinout (No Microcontroller Required)</h4>
            <button
              type="button"
              className="btn-close-guide"
              onClick={() => setShowWiringGuide(false)}
            >
              ✕
            </button>
          </div>
          <p className="guide-desc">
            A standard 27mm piezo disc generates a piezoelectric voltage spike when deformed or subjected to acoustic shock waves. By connecting it directly to a 3.5mm mic-in port, the computer or phone's audio ADC digitizes the signal without needing an ESP32 or custom PCB:
          </p>
          <div className="wiring-diagram-grid">
            <div className="wire-col">
              <span className="wire-point">Outer Brass Disc (Ground)</span>
              <span className="wire-arrow">➔</span>
              <span className="wire-target">3.5mm Sleeve (Ground)</span>
            </div>
            <div className="wire-col">
              <span className="wire-point">Inner Ceramic White (Signal)</span>
              <span className="wire-arrow">➔</span>
              <span className="wire-target">3.5mm Tip / Ring 2 (Mic In)</span>
            </div>
            <div className="wire-col">
              <span className="wire-point">Optional Protection</span>
              <span className="wire-arrow">➔</span>
              <span className="wire-target">1MΩ resistor across leads</span>
            </div>
          </div>
        </div>
      )}

      {/* 3. Error Alert */}
      {errorMessage && (
        <div className="error-alert">
          <span className="error-icon">⚠️</span>
          <div className="error-text">
            <strong>Capture Notice:</strong> {errorMessage}
          </div>
        </div>
      )}

      {/* 4. Telemetry Metrics Row */}
      <div className="piezo-metrics-grid">
        <div className="metric-card">
          <div className="metric-icon">📈</div>
          <div className="metric-info">
            <span className="metric-value">{(instantAmplitude * 100).toFixed(1)}%</span>
            <span className="metric-label">Instantaneous Peak</span>
          </div>
          <div className="amplitude-bar-track">
            <div
              className={`amplitude-bar-fill ${isSpikeActive ? 'fill-alert' : ''}`}
              style={{ width: `${Math.min(instantAmplitude * 100, 100)}%` }}
            ></div>
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-icon">🎯</div>
          <div className="metric-info">
            <span className="metric-value">{(currentThreshold * 100).toFixed(1)}%</span>
            <span className="metric-label">
              Rolling Baseline (μ + {sensitivityK}σ)
            </span>
          </div>
          <span className="metric-subtext">Adapts to ambient noise floor</span>
        </div>

        <div className="metric-card">
          <div className="metric-icon">🌊</div>
          <div className="metric-info">
            <span className="metric-value">{(rollingMean * 100).toFixed(2)}%</span>
            <span className="metric-label">Ambient Noise Floor (μ)</span>
          </div>
          <span className="metric-subtext">σ: {(rollingStdDev * 100).toFixed(2)}%</span>
        </div>

        <div className="metric-card">
          <div className="metric-icon">💥</div>
          <div className="metric-info">
            <span className="metric-value">{events.length}</span>
            <span className="metric-label">Acoustic Crack Events</span>
          </div>
          <span className="metric-subtext">Logged in audit registry</span>
        </div>
      </div>

      {/* 5. Main Oscilloscope Waveform Display */}
      <div className={`oscilloscope-wrapper ${isSpikeActive ? 'oscilloscope-alert' : ''}`}>
        <div className="oscilloscope-toolbar">
          <span className="scope-title">
            LIVE TRANSIENT OSCILLOSCOPE (FloatTimeDomain 1024-Point Buffer)
          </span>
          <div className="scope-legend">
            <span className="legend-item cyan">━ Raw Waveform</span>
            <span className="legend-item amber">┅ Rolling Baseline Threshold (±T)</span>
          </div>
        </div>

        <canvas
          ref={canvasRef}
          width={900}
          height={220}
          className="waveform-canvas"
        />

        {captureStatus === 'standby' && (
          <div className="scope-standby-overlay">
            <div className="overlay-content">
              <span className="overlay-icon">🎙️</span>
              <h3>Piezo Audio Stream Idle</h3>
              <p>
                Connect your 27mm piezo disc to the 3.5mm mic jack and click "Start Audio Capture", or use "Simulate Test Signal" to test with synthetic fissure transients.
              </p>
              <div className="overlay-actions">
                <button
                  type="button"
                  className="btn-primary"
                  onClick={startAudioCapture}
                >
                  ▶ Start Audio Capture
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => triggerSimulation('rock_fracture')}
                >
                  ⚡ Inject Test Signal
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 6. Control Panel & Simulation Toolbar */}
      <div className="piezo-control-grid">
        {/* Left: Capture & Real Hardware Controls */}
        <div className="control-card">
          <h4>🎛️ Audio Ingestion & Calibration</h4>
          <div className="control-actions-row">
            {captureStatus === 'standby' ? (
              <button
                type="button"
                className="btn-primary btn-start-capture"
                onClick={startAudioCapture}
              >
                ▶ Start Audio Capture (3.5mm Jack)
              </button>
            ) : (
              <button
                type="button"
                className="btn-danger btn-stop-capture"
                onClick={stopAudioCapture}
              >
                ⏹ Stop Audio Capture
              </button>
            )}
          </div>

          <div className="sliders-container">
            <div className="slider-group">
              <div className="slider-header">
                <label>Sensitivity Multiplier (k·σ):</label>
                <span className="slider-val">{sensitivityK}σ</span>
              </div>
              <input
                type="range"
                min="2.0"
                max="6.0"
                step="0.1"
                value={sensitivityK}
                onChange={(e) => setSensitivityK(parseFloat(e.target.value))}
                className="range-slider"
              />
              <span className="slider-hint">Lower k = more sensitive, higher k = avoids false positives</span>
            </div>

            <div className="slider-group">
              <div className="slider-header">
                <label>Noise Floor Gate:</label>
                <span className="slider-val">{(noiseGate * 100).toFixed(1)}%</span>
              </div>
              <input
                type="range"
                min="0.01"
                max="0.15"
                step="0.005"
                value={noiseGate}
                onChange={(e) => setNoiseGate(parseFloat(e.target.value))}
                className="range-slider"
              />
              <span className="slider-hint">Prevents spurious triggering in dead-quiet environments</span>
            </div>
          </div>
        </div>

        {/* Right: Part 4 Synthetic Signal Simulation */}
        <div className="control-card simulation-card">
          <h4>🧪 Part 4: Test Signal Simulation (No Hardware Needed)</h4>
          <p className="card-desc">
            Injects calibrated transient wave bursts into the exact same signal processing pipeline to test rolling thresholding, debouncing, and alert propagation:
          </p>

          <div className="sim-profile-selector">
            <label>Transient Signature Profile:</label>
            <div className="sim-options">
              <button
                type="button"
                className={`sim-option-btn ${selectedSimProfile === 'rock_fracture' ? 'active' : ''}`}
                onClick={() => setSelectedSimProfile('rock_fracture')}
              >
                🪨 Rock Micro-Fracture (Sharp 75% Spike)
              </button>
              <button
                type="button"
                className={`sim-option-btn ${selectedSimProfile === 'soil_slip' ? 'active' : ''}`}
                onClick={() => setSelectedSimProfile('soil_slip')}
              >
                🍂 Soil Shear Slip (45% Mid Ring)
              </button>
              <button
                type="button"
                className={`sim-option-btn ${selectedSimProfile === 'acoustic_tap' ? 'active' : ''}`}
                onClick={() => setSelectedSimProfile('acoustic_tap')}
              >
                🔨 Surface Knock (85% Heavy Transient)
              </button>
            </div>
          </div>

          <button
            type="button"
            className="btn-simulate-trigger"
            onClick={() => triggerSimulation(selectedSimProfile)}
          >
            ⚡ Inject Synthetic Crack Signal
          </button>
        </div>
      </div>

      {/* 7. Detected Crack Events Audit Log */}
      <div className="piezo-events-section">
        <div className="events-header">
          <div className="events-header-left">
            <h3>📋 Acoustic Crack Detection Ledger</h3>
            <span className="events-count-pill">{events.length} Events Detected</span>
          </div>

          <div className="events-actions">
            <button
              type="button"
              className="btn-export-log"
              onClick={handleExportCsv}
              disabled={events.length === 0}
            >
              📊 Export CSV
            </button>
            {events.length > 0 && (
              <button
                type="button"
                className="btn-clear-log"
                onClick={handleClearEvents}
              >
                🗑️ Clear History
              </button>
            )}
          </div>
        </div>

        {events.length === 0 ? (
          <div className="events-empty-state">
            <span className="empty-icon">📭</span>
            <h4>No Acoustic Crack Transients Detected</h4>
            <p>
              Tap the physical piezo disc or click "Inject Synthetic Crack Signal" above to trigger a detection event.
            </p>
          </div>
        ) : (
          <div className="events-table-wrapper">
            <table className="events-table">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Peak Amplitude</th>
                  <th>Threshold at Trigger</th>
                  <th>Noise Floor (μ)</th>
                  <th>SNR Ratio</th>
                  <th>Duration</th>
                  <th>Severity</th>
                  <th>Diagnosis</th>
                </tr>
              </thead>
              <tbody>
                {events.map((evt, idx) => {
                  const isCrit = evt.severity === 'CRITICAL';
                  const isRuleA = evt.fusion_rule && evt.fusion_rule.includes('RULE A');
                  const isRuleB = evt.fusion_rule && evt.fusion_rule.includes('RULE B');
                  return (
                    <tr key={evt.id || `${evt.timestamp}-${idx}`} className={isCrit ? 'row-critical' : 'row-warning'}>
                      <td className="cell-time">
                        <span className="time-val">
                          {new Date(evt.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                        </span>
                        <span className="date-val">
                          {new Date(evt.timestamp).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                        </span>
                      </td>
                      <td className="cell-amp">
                        <span className="amp-badge">
                          {(evt.peak_amplitude * 100).toFixed(1)}%
                        </span>
                      </td>
                      <td className="cell-thresh">
                        {(evt.threshold_at_trigger * 100).toFixed(1)}%
                      </td>
                      <td className="cell-noise">
                        {(evt.noise_floor * 100).toFixed(2)}%
                      </td>
                      <td className="cell-snr">
                        <strong>{evt.snr_ratio}x</strong>
                      </td>
                      <td className="cell-duration">
                        {evt.duration_ms} ms
                      </td>
                      <td className="cell-severity">
                        <span className={`badge-severity sev-${evt.severity.toLowerCase()}`}>
                          {evt.severity}
                        </span>
                      </td>
                      <td className="cell-diagnosis">
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                          {evt.fusion_rule && (
                            <span
                              style={{
                                display: 'inline-block',
                                alignSelf: 'flex-start',
                                padding: '2px 6px',
                                borderRadius: '4px',
                                fontSize: '10px',
                                fontWeight: 700,
                                letterSpacing: '0.03em',
                                background: isRuleA ? 'rgba(239, 68, 68, 0.22)' : isRuleB ? 'rgba(245, 158, 11, 0.22)' : 'rgba(56, 189, 248, 0.15)',
                                color: isRuleA ? '#f87171' : isRuleB ? '#fbbf24' : '#38bdf8',
                                border: `1px solid ${isRuleA ? '#ef4444' : isRuleB ? '#f59e0b' : '#38bdf8'}`,
                              }}
                            >
                              {evt.fusion_rule}
                            </span>
                          )}
                          <span>
                            {evt.diagnosis || (evt.peak_amplitude > 0.6
                              ? 'High-energy shear rupture transient'
                              : evt.peak_amplitude > 0.3
                              ? 'Subsurface micro-crack acoustic emission'
                              : 'Minor acoustic anomaly')}
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export default React.memo(PiezoPanel);

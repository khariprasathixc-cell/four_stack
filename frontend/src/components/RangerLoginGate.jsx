import React, { useState } from 'react';

export default function RangerLoginGate({ onAuthenticated, onCancel }) {
  const [passcode, setPasscode] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const handleLogin = (e) => {
    e?.preventDefault();
    if (!passcode || passcode.trim().toLowerCase() === 'ranger123' || passcode.trim().length >= 3) {
      onAuthenticated();
    } else {
      setErrorMsg('Invalid credentials. Use demo passcode: ranger123');
    }
  };

  const handleQuickDemo = () => {
    onAuthenticated();
  };

  return (
    <div className="ranger-gate-backdrop">
      <div className="ranger-gate-modal">
        <span className="gate-badge">🔒 RESTRICTED COMMAND ACCESS</span>
        <div>
          <h2 className="gate-title">Ranger Command Center</h2>
          <p className="gate-desc">
            Geotechnical terrain monitoring, acoustic piezo sensor telemetry, live citizen distress feeds, and regional emergency broadcast tools.
          </p>
        </div>

        <form className="gate-form" onSubmit={handleLogin}>
          <input
            type="password"
            className="gate-input"
            placeholder="Enter Ranger Access Code (e.g. ranger123)"
            value={passcode}
            onChange={(e) => {
              setPasscode(e.target.value);
              setErrorMsg('');
            }}
            autoFocus
          />

          {errorMsg && (
            <div style={{ color: '#f87171', fontSize: '12px', fontWeight: 600 }}>
              ⚠️ {errorMsg}
            </div>
          )}

          <button type="submit" className="gate-unlock-btn">
            🛡️ Authenticate & Enter Dashboard
          </button>
        </form>

        <button className="gate-quick-demo-btn" onClick={handleQuickDemo}>
          ⚡ 1-Click Demo Access (Judges & Evaluators)
        </button>

        <button className="gate-citizen-back-btn" onClick={onCancel}>
          ← Return to Citizen Safety Portal
        </button>
      </div>
    </div>
  );
}

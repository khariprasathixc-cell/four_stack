import React, { useState } from 'react';

export default function ApiKeyBanner({ terrainInfo }) {
  const [showGuide, setShowGuide] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);

  if (!terrainInfo || isDismissed) return null;

  // ONLY show watermark/banner when the backend explicitly returns an API key error code
  // Never show on generic fetch failures or when real elevation data is successfully loaded.
  const errorCode = terrainInfo.error_code;
  if (!errorCode) return null;

  const isKeyMissing = errorCode === 'OPENTOPOGRAPHY_KEY_MISSING';
  const isKeyInvalid = errorCode === 'OPENTOPOGRAPHY_KEY_INVALID';
  const isApiDown = errorCode === 'OPENTOPOGRAPHY_API_UNAVAILABLE';

  // If not one of the explicit terrain API issues, do not display this banner
  if (!isKeyMissing && !isKeyInvalid && !isApiDown) {
    return null;
  }

  return (
    <div className={`api-key-banner ${isKeyInvalid ? 'banner-invalid' : ''}`}>
      <div className="banner-main">
        <div className="banner-icon">{isKeyInvalid ? '❌' : '⚠️'}</div>
        <div className="banner-text">
          {isKeyMissing && (
            <>
              <strong>OpenTopography API Key Required (OPENTOPOGRAPHY_KEY_MISSING):</strong>{' '}
              No key configured in <code>backend/.env</code>. Displaying synthetic topographic DEM for preview.
            </>
          )}
          {isKeyInvalid && (
            <>
              <strong>OpenTopography API Key Invalid (OPENTOPOGRAPHY_KEY_INVALID):</strong>{' '}
              The key configured in <code>backend/.env</code> was rejected by OpenTopography (HTTP 401/403 Unauthorized).
              Please verify your key.
            </>
          )}
          {isApiDown && (
            <>
              <strong>OpenTopography Service Notice (OPENTOPOGRAPHY_API_UNAVAILABLE):</strong>{' '}
              Unable to reach OpenTopography API. Displaying synthetic topographic model for preview.
            </>
          )}
        </div>
        <div className="banner-buttons">
          <button
            className="banner-action-btn"
            onClick={() => setShowGuide(!showGuide)}
          >
            {showGuide ? 'Hide Instructions' : 'How to configure API key'}
          </button>
          <button
            className="banner-close-btn"
            onClick={() => setIsDismissed(true)}
            title="Dismiss notice"
          >
            ✕
          </button>
        </div>
      </div>

      {showGuide && (
        <div className="banner-guide-box">
          <h4>Steps to configure OpenTopography SRTM access:</h4>
          <ol>
            <li>
              Create a free account at{' '}
              <a
                href="https://portal.opentopography.org/myopentopo"
                target="_blank"
                rel="noreferrer"
              >
                portal.opentopography.org/myopentopo
              </a>
            </li>
            <li>
              Navigate to <strong>My OpenTopo</strong> → <strong>Authorizations & API Keys</strong> and click <em>Request an API Key</em>.
            </li>
            <li>
              Open <code>backend/.env</code> in this repository and set:
              <pre>OPENTOPOGRAPHY_API_KEY="your_api_key_here"</pre>
            </li>
            <li>
              <strong>Important:</strong> Restart the uvicorn backend server after editing <code>.env</code> (environment variables are loaded into Python's environment on process boot).
            </li>
          </ol>
        </div>
      )}
    </div>
  );
}

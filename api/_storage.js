/**
 * Unified Serverless Persistence Layer for SOS Dispatch Logs
 * 
 * Supports:
 * 1. Upstash Redis / Vercel KV REST API (Zero external npm dependencies, pure fetch)
 * 2. File-system persistence in writable temp directory (/tmp/sos_logs.json)
 * 3. In-memory global fallback cache
 * 
 * Designed to NEVER throw an unhandled exception or block alert dispatch.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '';
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';
const REDIS_KEY = 'slope_sos_dispatch_logs';

// File fallback path: use os.tmpdir() or /tmp
const FALLBACK_DIR = os.tmpdir() || '/tmp';
const FALLBACK_FILE = path.join(FALLBACK_DIR, 'slope_sos_dispatch_logs.json');

// Memory fallback across hot invocations
if (!globalThis.__slope_sos_logs_memory) {
  globalThis.__slope_sos_logs_memory = [];
}

/**
 * Save a dispatch log entry
 */
export async function saveDispatchLog(entry) {
  if (!entry) return null;

  const normalizedEntry = {
    id: entry.id || `log_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
    timestamp: entry.timestamp || new Date().toISOString(),
    recipient: entry.recipient || entry.phone || 'Unknown',
    zone: entry.zone || entry.zoneName || 'Target Zone',
    risk_level: entry.risk_level || entry.riskLevel || 'High',
    message_id: entry.message_id || entry.messageId || 'MOCK-ID',
    http_status: Number(entry.http_status != null ? entry.http_status : (entry.httpStatus || 200)),
    response_type: entry.response_type || entry.responseType || (entry.success === false ? 'error' : 'success'),
    mode: entry.mode || 'mock',
    geofence_radius_km: entry.geofence_radius_km != null ? Number(entry.geofence_radius_km) : (entry.geofenceRadiusKm != null ? Number(entry.geofenceRadiusKm) : 5.0),
    user_distance_km: entry.user_distance_km != null ? Number(entry.user_distance_km) : (entry.userDistanceKm != null ? Number(entry.userDistanceKm) : null),
    alert_body: entry.alert_body || entry.alertBody || '',
    created_at: Date.now()
  };

  // 1. Try Upstash Redis / Vercel KV if configured
  if (KV_URL && KV_TOKEN) {
    try {
      const response = await fetch(KV_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${KV_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(['LPUSH', REDIS_KEY, JSON.stringify(normalizedEntry)])
      });

      if (response.ok) {
        console.log(`[SOS Storage] Persisted log ${normalizedEntry.id} to Upstash/KV`);
        return normalizedEntry;
      }
      console.warn(`[SOS Storage] Upstash returned status ${response.status}. Falling back to file/memory.`);
    } catch (kvErr) {
      console.warn('[SOS Storage KV Exception]:', kvErr.message);
    }
  }

  // 2. File fallback
  try {
    let existing = [];
    if (fs.existsSync(FALLBACK_FILE)) {
      const raw = fs.readFileSync(FALLBACK_FILE, 'utf-8');
      existing = JSON.parse(raw);
    }
    existing.unshift(normalizedEntry);
    // Cap at 200 items
    if (existing.length > 200) existing = existing.slice(0, 200);
    fs.writeFileSync(FALLBACK_FILE, JSON.stringify(existing, null, 2), 'utf-8');
    console.log(`[SOS Storage] Persisted log ${normalizedEntry.id} to ${FALLBACK_FILE}`);
  } catch (fileErr) {
    console.warn(`[SOS Storage File Exception]:`, fileErr.message);
  }

  // 3. Memory cache update
  globalThis.__slope_sos_logs_memory.unshift(normalizedEntry);
  if (globalThis.__slope_sos_logs_memory.length > 200) {
    globalThis.__slope_sos_logs_memory = globalThis.__slope_sos_logs_memory.slice(0, 200);
  }

  return normalizedEntry;
}

/**
 * Retrieve all dispatch logs (newest first)
 */
export async function getDispatchLogs() {
  // 1. Try Upstash Redis / Vercel KV
  if (KV_URL && KV_TOKEN) {
    try {
      const response = await fetch(KV_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${KV_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(['LRANGE', REDIS_KEY, '0', '199'])
      });

      if (response.ok) {
        const json = await response.json();
        if (Array.isArray(json.result)) {
          const parsed = json.result.map((item) => {
            try {
              return typeof item === 'string' ? JSON.parse(item) : item;
            } catch {
              return item;
            }
          });
          return parsed;
        }
      }
    } catch (kvErr) {
      console.warn('[SOS Storage KV Read Exception]:', kvErr.message);
    }
  }

  // 2. Try file fallback
  try {
    if (fs.existsSync(FALLBACK_FILE)) {
      const raw = fs.readFileSync(FALLBACK_FILE, 'utf-8');
      const items = JSON.parse(raw);
      if (Array.isArray(items)) {
        return items;
      }
    }
  } catch (fileErr) {
    console.warn('[SOS Storage File Read Exception]:', fileErr.message);
  }

  // 3. Return memory fallback
  return globalThis.__slope_sos_logs_memory || [];
}

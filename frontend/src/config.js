/**
 * Centralized API Configuration for Slope-to-Rescue
 * 
 * In production (Vercel): defaults to '/api' (relative paths on same origin).
 * In local dev: defaults to '/api' (proxied by Vite to http://localhost:8001)
 * or can be set via VITE_API_BASE_URL in local .env.
 */

let rawBase = (import.meta.env.VITE_API_BASE_URL || '/api').trim().replace(/\/+$/, '');

// Prevent leaking localhost:8001 into production builds
const isProdEnv = import.meta.env.PROD || (typeof window !== 'undefined' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1');
if (isProdEnv && (rawBase.includes('localhost') || rawBase.includes('127.0.0.1') || rawBase === '')) {
  rawBase = '/api';
}

// Ensures API_BASE always points to the '/api' prefix without double-slashes
export const API_BASE = rawBase.endsWith('/api')
  ? rawBase
  : (rawBase === '' ? '/api' : `${rawBase}/api`);

export const API_BASE_URL = API_BASE;

export default API_BASE;


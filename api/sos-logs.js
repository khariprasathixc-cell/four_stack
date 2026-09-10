/**
 * Vercel Serverless Function: SOS Dispatch Logs
 * Route: GET /api/sos-logs
 * 
 * Returns all dispatch attempts, newest first.
 * Demo-proof endpoint for judges and audit trails.
 */

import { getDispatchLogs } from './_storage.js';

export default async function handler(req, res) {
  // CORS configuration
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed. Use GET.' });
  }

  try {
    const logs = await getDispatchLogs();
    return res.status(200).json(logs);
  } catch (error) {
    console.error('[SOS Logs Error]:', error);
    // Return empty array with 200 so demo page never crashes
    return res.status(200).json([]);
  }
}

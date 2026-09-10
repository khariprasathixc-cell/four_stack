/**
 * Vercel Serverless Function: Emergency SOS Dispatch
 * Route: POST /api/send-alert
 * 
 * Supports MSG91 Flow/SMS API with automatic mock fallback.
 * Includes non-blocking persistent logging via api/_storage.js
 */

import { saveDispatchLog } from './_storage.js';

export default async function handler(req, res) {
  // CORS configuration
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed. Use POST.' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    const { phone, zoneName = 'Target Zone', riskLevel = 'High', lat, lon, geofenceRadiusKm = 5.0, userDistanceKm } = body;

    if (!phone || typeof phone !== 'string' || phone.trim().length === 0) {
      return res.status(400).json({ error: 'Valid phone number is required.' });
    }

    const cleanPhone = phone.trim();
    const timestamp = new Date().toISOString();
    const alertMessage = `[CRITICAL SOS] Landslide Early Warning for ${zoneName} (${riskLevel} Risk). Geofence radius: ${Number(geofenceRadiusKm).toFixed(1)}km. Evacuate to higher stable ground immediately. Emergency helpline: 112.`;

    const mockSmsEnv = (process.env.MOCK_SMS || 'true').trim().toLowerCase();
    const isMock =
      mockSmsEnv === 'true' ||
      mockSmsEnv === '1' ||
      !process.env.MSG91_AUTH_KEY;

    if (isMock) {
      const mockMessageId = `MOCK-MSG91-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
      console.log(`[SOS Dispatch - Mock] Sent to ${cleanPhone}: ${alertMessage}`);

      // Non-blocking persistent log write
      try {
        await saveDispatchLog({
          timestamp,
          recipient: cleanPhone,
          zone: zoneName,
          risk_level: riskLevel,
          message_id: mockMessageId,
          http_status: 200,
          response_type: 'success',
          mode: 'mock',
          geofence_radius_km: Number(geofenceRadiusKm),
          user_distance_km: userDistanceKm != null ? Number(userDistanceKm) : null,
          alert_body: alertMessage
        });
      } catch (logErr) {
        console.error('[SOS Dispatch Log Error - Non-Fatal]:', logErr);
      }

      return res.status(200).json({
        success: true,
        mode: 'mock',
        message: 'Mock SOS SMS dispatched successfully',
        messageId: mockMessageId,
        phone: cleanPhone,
        riskLevel,
        zoneName,
        geofenceRadiusKm: Number(geofenceRadiusKm),
        userDistanceKm: userDistanceKm != null ? Number(userDistanceKm) : null,
        timestamp,
        alertBody: alertMessage,
        mockNote: 'MSG91_AUTH_KEY not configured or MOCK_SMS=true. Simulated SMS delivery.'
      });
    }

    // Live MSG91 Flow API dispatch
    const authKey = (process.env.MSG91_AUTH_KEY || '').trim();
    const senderId = (process.env.MSG91_SENDER_ID || 'SLPRSC').trim();
    const templateId = (process.env.MSG91_TEMPLATE_ID || '').trim();
    let numericPhone = cleanPhone.replace(/[^0-9]/g, '');

    // Prefix India country code 91 if user entered 10 digits
    if (numericPhone.length === 10) {
      numericPhone = `91${numericPhone}`;
    }

    if (!templateId) {
      // Non-blocking persistent log write for missing template configuration
      try {
        await saveDispatchLog({
          timestamp,
          recipient: numericPhone,
          zone: zoneName,
          risk_level: riskLevel,
          message_id: `ERR-TEMPLATE-${Date.now()}`,
          http_status: 400,
          response_type: 'error',
          mode: 'live_msg91_error',
          geofence_radius_km: Number(geofenceRadiusKm),
          user_distance_km: userDistanceKm != null ? Number(userDistanceKm) : null,
          alert_body: alertMessage
        });
      } catch (logErr) {
        console.error('[SOS Dispatch Log Error - Non-Fatal]:', logErr);
      }

      return res.status(200).json({
        success: false,
        mode: 'live_msg91_error',
        error: 'MSG91_TEMPLATE_ID (Flow ID) is missing in environment variables. Please configure your Flow ID.',
        phone: numericPhone,
        timestamp
      });
    }

    const payload = {
      template_id: templateId,
      sender: senderId,
      short_url: '0',
      mobiles: numericPhone,
      recipients: [
        {
          mobiles: numericPhone,
          var1: zoneName,
          var2: `${riskLevel} Risk`,
          var3: `${Number(geofenceRadiusKm).toFixed(1)}km`
        }
      ],
      var1: zoneName,
      var2: `${riskLevel} Risk`,
      var3: `${Number(geofenceRadiusKm).toFixed(1)}km`
    };

    const msg91Res = await fetch('https://control.msg91.com/api/v5/flow/', {
      method: 'POST',
      headers: {
        'authkey': authKey,
        'content-type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const msg91Data = await msg91Res.json();

    if (msg91Data && msg91Data.type === 'error') {
      const errMessageId = `ERR-MSG91-${Date.now()}`;
      try {
        await saveDispatchLog({
          timestamp,
          recipient: numericPhone,
          zone: zoneName,
          risk_level: riskLevel,
          message_id: errMessageId,
          http_status: msg91Res.status || 400,
          response_type: 'error',
          mode: 'live_msg91_error',
          geofence_radius_km: Number(geofenceRadiusKm),
          user_distance_km: userDistanceKm != null ? Number(userDistanceKm) : null,
          alert_body: alertMessage
        });
      } catch (logErr) {
        console.error('[SOS Dispatch Log Error - Non-Fatal]:', logErr);
      }

      return res.status(200).json({
        success: false,
        mode: 'live_msg91_error',
        error: `MSG91 Error: ${msg91Data.message || 'Rejected by MSG91'}`,
        data: msg91Data,
        phone: numericPhone,
        timestamp
      });
    }

    const liveMessageId = msg91Data?.message || `MSG91-${Date.now()}`;

    // Non-blocking persistent log write on success
    try {
      await saveDispatchLog({
        timestamp,
        recipient: numericPhone,
        zone: zoneName,
        risk_level: riskLevel,
        message_id: liveMessageId,
        http_status: msg91Res.status || 200,
        response_type: 'success',
        mode: 'live_msg91',
        geofence_radius_km: Number(geofenceRadiusKm),
        user_distance_km: userDistanceKm != null ? Number(userDistanceKm) : null,
        alert_body: alertMessage
      });
    } catch (logErr) {
      console.error('[SOS Dispatch Log Error - Non-Fatal]:', logErr);
    }

    return res.status(200).json({
      success: true,
      mode: 'live_msg91',
      message: 'SMS dispatched to mobile carrier via MSG91',
      messageId: liveMessageId,
      data: msg91Data,
      phone: numericPhone,
      timestamp,
      alertBody: alertMessage
    });
  } catch (error) {
    console.error('[SOS Dispatch Error]:', error);
    return res.status(500).json({
      error: error.message || 'Internal server error while dispatching SOS alert.'
    });
  }
}

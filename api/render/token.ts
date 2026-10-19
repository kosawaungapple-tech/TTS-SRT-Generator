import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';

/**
 * Gives a signed, short-lived render token to a valid access-code user, plus the address of the render server.
 * Needs these Vercel environment variables:
 *   RENDER_SERVER_URL  https address of the hosted render worker
 *   RENDER_SECRET      same secret the worker was started with
 * The worker checks the signature, so a token cannot be made without the secret.
 */
const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'directed-reporter-wkx2q';
const DATABASE_ID = process.env.FIREBASE_DATABASE_ID || 'ai-studio-recap1062026srts-ff74dc66-bac1-45e8-851d-dcb5797f03e0';
const WEB_API_KEY = process.env.FIREBASE_WEB_API_KEY || 'AIzaSyCw5gC3dGaBGnuxqnn6VEQFuWG_fcAwyYs';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const secret = process.env.RENDER_SECRET;
  const base = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/${encodeURIComponent(DATABASE_ID)}/documents`;
  // The admin can point users at his own PC (through a tunnel) from the Admin page: settings/render_server { url, requireGrant }.
  let cfgUrl = '';
  let requireGrant = false;
  try {
    const cr = await fetch(`${base}/settings/render_server?key=${WEB_API_KEY}`);
    if (cr.ok) {
      const cf = ((await cr.json()) as { fields?: Record<string, { booleanValue?: boolean; stringValue?: string }> }).fields || {};
      cfgUrl = (cf.url?.stringValue || '').trim();
      requireGrant = cf.requireGrant?.booleanValue === true;
    }
  } catch { /* fall back to the environment variable */ }
  const serverUrl = (cfgUrl || process.env.RENDER_SERVER_URL || '').replace(/\/+$/, '');
  if (!secret || !serverUrl) {
    return res.status(503).json({ error: 'not_configured', message: 'The render server is not set up yet.' });
  }

  const code = String((req.body && req.body.accessCode) || '').trim();
  if (!/^[A-Za-z0-9_-]{3,64}$/.test(code)) {
    return res.status(401).json({ error: 'invalid_code', message: 'Access code missing or invalid.' });
  }

  try {
    const url = `${base}/user_controls/${encodeURIComponent(code)}?key=${WEB_API_KEY}`;
    const r = await fetch(url);
    if (r.status === 404) return res.status(401).json({ error: 'invalid_code', message: 'Access code not found.' });
    if (!r.ok) return res.status(502).json({ error: 'lookup_failed', message: 'Could not check the access code.' });
    const doc = (await r.json()) as { fields?: Record<string, { booleanValue?: boolean; stringValue?: string }> };
    const f = doc.fields || {};
    if (f.isActive?.booleanValue !== true) {
      return res.status(403).json({ error: 'inactive', message: 'This access code is not active.' });
    }
    const expiry = f.expiryDate?.stringValue;
    if (expiry && new Date(expiry) < new Date()) {
      return res.status(403).json({ error: 'expired', message: 'This access code has expired.' });
    }
    // Admin can switch rendering off for one user by setting renderEnabled = false on their user_controls document.
    if (requireGrant && f.renderEnabled?.booleanValue !== true) {
      return res.status(403).json({ error: 'not_granted', message: 'The admin has not allowed server rendering for your account yet.' });
    }
    if (f.renderEnabled?.booleanValue === false) {
      return res.status(403).json({ error: 'render_disabled', message: 'Server rendering is not enabled for this account.' });
    }

    const exp = Math.floor(Date.now() / 1000) + 15 * 60;
    const body = Buffer.from(JSON.stringify({ uid: code, exp })).toString('base64url');
    const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
    return res.status(200).json({ url: serverUrl, token: `${body}.${sig}`, expiresAt: exp });
  } catch (e) {
    console.error('[render token]', e);
    return res.status(500).json({ error: 'server_error', message: 'Could not create a render token.' });
  }
}

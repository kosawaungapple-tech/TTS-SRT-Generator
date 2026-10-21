import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';
import { adminReady, getAdmin } from '../_lib/fb.js';

/**
 * Gives a signed, short-lived render token to a valid, activated user, plus the address of the render server.
 * Vercel environment variables:
 *   RENDER_SERVER_URL  https address of the render worker (can also be set on the Admin page: settings/render_server)
 *   RENDER_SECRET      same secret the worker was started with
 * When the Firebase service account is configured (FIREBASE_SERVICE_ACCOUNT) the caller must send its Firebase ID token
 * (Authorization: Bearer ...); otherwise it falls back to the older access-code check.
 */
const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'directed-reporter-wkx2q';
const DATABASE_ID = process.env.FIREBASE_DATABASE_ID || 'ai-studio-recap1062026srts-ff74dc66-bac1-45e8-851d-dcb5797f03e0';
const WEB_API_KEY = process.env.FIREBASE_WEB_API_KEY || 'AIzaSyCw5gC3dGaBGnuxqnn6VEQFuWG_fcAwyYs';

type Fields = Record<string, { booleanValue?: boolean; stringValue?: string }>;
const REST = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/${encodeURIComponent(DATABASE_ID)}/documents`;

async function readRest(path: string): Promise<Record<string, unknown> | null | undefined> {
  const r = await fetch(`${REST}/${path}?key=${WEB_API_KEY}`);
  if (r.status === 404) return null;
  if (!r.ok) return undefined;
  const f = ((await r.json()) as { fields?: Fields }).fields || {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(f)) out[k] = v.booleanValue ?? v.stringValue;
  return out;
}

async function readDoc(path: string): Promise<Record<string, unknown> | null | undefined> {
  if (adminReady()) {
    try {
      const s = await getAdmin().db.doc(path).get();
      return s.exists ? (s.data() as Record<string, unknown>) : null;
    } catch { return undefined; }
  }
  return readRest(path);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const secret = process.env.RENDER_SECRET;
  const cfg = (await readDoc('settings/render_server')) || {};
  const serverUrl = String((cfg.url as string) || process.env.RENDER_SERVER_URL || '').trim().replace(/\/+$/, '');
  const requireGrant = cfg.requireGrant === true;
  if (!secret || !serverUrl) {
    return res.status(503).json({ error: 'not_configured', message: 'The render server is not set up yet.' });
  }

  let code = '';
  if (adminReady()) {
    const m = /^Bearer\s+(.+)$/i.exec(String(req.headers.authorization || ''));
    if (!m) return res.status(401).json({ error: 'invalid_code', message: 'Please sign in again.' });
    try {
      const decoded = await getAdmin().auth.verifyIdToken(m[1]);
      code = String((decoded as { vbsId?: string }).vbsId || '');
    } catch {
      return res.status(401).json({ error: 'invalid_code', message: 'Please sign in again.' });
    }
  } else {
    code = String((req.body && req.body.accessCode) || '').trim();
  }
  if (!/^[A-Za-z0-9_-]{3,128}$/.test(code)) {
    return res.status(401).json({ error: 'invalid_code', message: 'Access code missing or invalid.' });
  }

  try {
    const u = await readDoc(`user_controls/${code}`);
    if (u === null) return res.status(401).json({ error: 'invalid_code', message: 'Access code not found.' });
    if (u === undefined) return res.status(502).json({ error: 'lookup_failed', message: 'Could not check the access code.' });
    if (u.isActive !== true) return res.status(403).json({ error: 'inactive', message: 'This access code is not active.' });
    const expiry = u.expiryDate as string | undefined;
    if (expiry && new Date(expiry) < new Date()) return res.status(403).json({ error: 'expired', message: 'This access code has expired.' });
    if (requireGrant && u.renderEnabled !== true) {
      return res.status(403).json({ error: 'not_granted', message: 'The admin has not allowed server rendering for your account yet.' });
    }
    if (u.renderEnabled === false) {
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

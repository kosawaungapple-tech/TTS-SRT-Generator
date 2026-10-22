import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';
import { adminReady, getAdmin } from '../_lib/fb.js';

/**
 * The PC worker calls this every minute with its current public address (a Cloudflare quick tunnel changes address
 * every time it restarts). The request is signed with RENDER_SECRET, so only your own worker can publish an address.
 * The website then hands phones the fresh address - nobody has to paste a URL.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const secret = process.env.RENDER_SECRET;
  if (!secret) return res.status(503).json({ error: 'not_configured', message: 'RENDER_SECRET is not set on the website.' });
  if (!adminReady()) return res.status(503).json({ error: 'not_configured', message: 'FIREBASE_SERVICE_ACCOUNT is not set on the website.' });

  const { url, ts, sig } = (req.body || {}) as { url?: string; ts?: number; sig?: string };
  const u = String(url || '').trim().replace(/\/+$/, '');
  if (!/^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(u) || typeof ts !== 'number' || typeof sig !== 'string') {
    return res.status(400).json({ error: 'bad_request' });
  }
  if (Math.abs(Date.now() - ts) > 5 * 60 * 1000) return res.status(401).json({ error: 'stale', message: 'Check the PC clock.' });
  const want = crypto.createHmac('sha256', secret).update(`${ts}.${u}`).digest('hex');
  const a = Buffer.from(want), b = Buffer.from(sig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(401).json({ error: 'bad_signature' });

  try {
    await getAdmin().db.doc('settings/render_live').set({ url: u, lastSeen: Date.now() });
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('[render register]', e);
    return res.status(500).json({ error: 'server_error' });
  }
}

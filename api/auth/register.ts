import type { VercelRequest, VercelResponse } from '@vercel/node';
import { adminReady, getAdmin, OWNER_ID } from '../_lib/fb.js';
import { hashPassword } from '../_lib/pass.js';
import { clientIp, tooMany } from '../_lib/rate.js';
import { notifyNewUser } from '../_lib/telegram.js';

/** Self sign-up: always creates a *pending* account (the admin activates it). The browser cannot set any other field. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  if (!adminReady()) return res.status(503).json({ error: 'not_configured' });

  const id = String(req.body?.code ?? '').trim();
  const password = String(req.body?.password ?? '');
  const note = String(req.body?.note ?? '').trim().slice(0, 200);
  if (!/^[A-Za-z0-9_-]{3,32}$/.test(id) || id === OWNER_ID || id.toLowerCase().includes('admin')) {
    return res.status(400).json({ error: 'invalid_id' });
  }
  if (password.length < 6 || password.length > 200) return res.status(400).json({ error: 'weak_password' });

  const ip = clientIp(req);
  if (tooMany(`reg:${ip}`, 5, 60 * 60_000)) return res.status(429).json({ error: 'too_many_attempts' });

  try {
    const { db } = getAdmin();
    const ref = db.collection('user_controls').doc(id);
    if ((await ref.get()).exists) return res.status(409).json({ error: 'id_taken' });
    await ref.set({
      vbsId: id, dailyUsage: 0, credits: 0, lastUsedDate: new Date().toDateString(), isUnlimited: false,
      membershipStatus: 'standard', isBlocked: false, expiryDate: null, role: 'user', note,
      passwordHash: hashPassword(password), password: null,
      isActive: false, status: 'pending', selfRegistered: true, createdAt: new Date(), updatedAt: new Date(),
    });
    // Tell the admin on Telegram (never blocks or fails the sign-up).
    await notifyNewUser(id, note, ip).catch(() => undefined);
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('[auth/register]', e);
    return res.status(500).json({ error: 'server_error' });
  }
}

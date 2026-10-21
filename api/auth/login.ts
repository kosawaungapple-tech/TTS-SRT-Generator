import type { VercelRequest, VercelResponse } from '@vercel/node';
import { adminReady, getAdmin, OWNER_ID } from '../_lib/fb';
import { verifyPassword, safeEq } from '../_lib/pass';
import { clientIp, tooMany } from '../_lib/rate';

/**
 * Server-side login. Checks the access code + password and hands back a Firebase custom token whose claims
 * (vbsId, admin) are what the Firestore security rules look at. Nothing here can be forged from the browser.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  if (!adminReady()) return res.status(503).json({ error: 'not_configured' });

  const code = String(req.body?.code ?? '').trim();
  const password = String(req.body?.password ?? '');
  if (!code || code.length > 128 || code.includes('/')) return res.status(400).json({ error: 'invalid_code' });

  const ip = clientIp(req);
  if (tooMany(`login:${ip}`, 30, 10 * 60_000) || tooMany(`login:${ip}:${code}`, 8, 10 * 60_000)) {
    return res.status(429).json({ error: 'too_many_attempts' });
  }

  try {
    const { auth, db } = getAdmin();

    if (code === OWNER_ID) {
      const adminPw = process.env.ADMIN_PASSWORD;
      if (!adminPw) return res.status(503).json({ error: 'admin_password_not_set' });
      if (!safeEq(adminPw, password)) return res.status(401).json({ error: 'invalid_password' });
      const ref = db.collection('user_controls').doc(OWNER_ID);
      const snap = await ref.get();
      if (!snap.exists) {
        await ref.set({
          vbsId: OWNER_ID, role: 'admin', isActive: true, isUnlimited: true, membershipStatus: 'premium', isBlocked: false,
          dailyUsage: 0, credits: 0, lastUsedDate: new Date().toDateString(), note: 'The Commander', createdAt: new Date(), updatedAt: new Date(),
        });
      }
      const token = await auth.createCustomToken(OWNER_ID, { admin: true, vbsId: OWNER_ID });
      return res.status(200).json({
        token,
        profile: { vbsId: OWNER_ID, role: 'admin', isActive: true, note: 'The Commander', membershipStatus: 'premium' },
      });
    }

    const snap = await db.collection('user_controls').doc(code).get();
    if (!snap.exists) return res.status(401).json({ error: 'invalid_code' });
    const d = snap.data() as Record<string, unknown>;

    if (!verifyPassword(code, password, d as { passwordHash?: string; password?: string | null })) {
      return res.status(401).json({ error: 'invalid_password' });
    }
    if (d.expiryDate && new Date(String(d.expiryDate)) < new Date()) return res.status(403).json({ error: 'expired' });
    if (d.isActive !== true) return res.status(403).json({ error: d.status === 'pending' ? 'pending' : 'deactivated' });

    const isAdmin = d.role === 'admin';
    // An admin account must have its own password: never hand out an admin token for a document that has none.
    if (isAdmin && !d.passwordHash && !(d.password && String(d.password).trim())) {
      return res.status(403).json({ error: 'admin_needs_password' });
    }
    const token = await auth.createCustomToken(code, { admin: isAdmin, vbsId: code });

    // The profile the browser needs, without secrets or server timestamps.
    const { password: _pw, passwordHash: _ph, createdAt: _c, updatedAt: _u, lastLoginAt: _l, ...profile } = d;
    void _pw; void _ph; void _c; void _u; void _l;
    return res.status(200).json({ token, profile: { ...profile, vbsId: code } });
  } catch (e) {
    console.error('[auth/login]', e);
    return res.status(500).json({ error: 'server_error' });
  }
}

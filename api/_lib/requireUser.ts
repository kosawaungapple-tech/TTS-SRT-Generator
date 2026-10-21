import type { VercelRequest } from '@vercel/node';
import { adminReady, getAdmin } from './fb';

/**
 * Who is calling? Reads the Firebase ID token the website sends in the `x-vbs-token` header.
 * Returns null when the caller is not signed in through the server (or the token is invalid / expired).
 * When the server-side login is not configured yet, returns `{ legacy: true }` so existing behaviour keeps working.
 */
export async function requireUser(req: VercelRequest): Promise<{ vbsId: string; admin: boolean; legacy?: boolean } | null> {
  if (!adminReady()) return { vbsId: 'legacy', admin: false, legacy: true };
  let token = String(req.headers['x-vbs-token'] || '').trim();
  if (!token) {
    // The website also sends its Firebase ID token as `Authorization: Bearer <jwt>` (a JWT has two dots; API keys do not).
    const m = /^Bearer\s+(.+)$/i.exec(String(req.headers.authorization || ''));
    if (m && m[1].split('.').length === 3) token = m[1];
  }
  if (!token) return null;
  try {
    const d = (await getAdmin().auth.verifyIdToken(token)) as { vbsId?: string; admin?: boolean };
    if (!d.vbsId) return null;
    return { vbsId: d.vbsId, admin: d.admin === true };
  } catch {
    return null;
  }
}

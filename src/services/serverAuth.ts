import { auth, signInWithCustomToken } from '../firebase';
import type { VBSUserControl } from '../types';

/**
 * Server-side login (Vercel /api/auth/*). When the Firebase service account is set up on the server, the access code and
 * password are checked there and the browser receives a Firebase token carrying the user's id / admin claim - that is
 * what the Firestore security rules rely on. When it is not set up yet, callers fall back to the older direct flow.
 */
let statusPromise: Promise<{ configured: boolean; adminPasswordSet: boolean }> | null = null;

export function getServerAuthStatus(force = false) {
  if (!statusPromise || force) {
    statusPromise = fetch('/api/auth/status', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : { configured: false, adminPasswordSet: false }))
      .catch(() => ({ configured: false, adminPasswordSet: false }));
  }
  return statusPromise;
}

export type ServerLoginResult =
  | { ok: true; profile: VBSUserControl }
  | { ok: false; error: string };

export async function serverLogin(code: string, password: string): Promise<ServerLoginResult> {
  let data: { token?: string; profile?: VBSUserControl; error?: string } = {};
  let status = 0;
  try {
    const r = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, password }),
    });
    status = r.status;
    data = await r.json().catch(() => ({}));
  } catch {
    return { ok: false, error: 'network' };
  }
  if (status !== 200 || !data.token || !data.profile) return { ok: false, error: data.error || `http_${status}` };
  try {
    await signInWithCustomToken(auth, data.token);
  } catch {
    return { ok: false, error: 'sign_in_failed' };
  }
  return { ok: true, profile: data.profile };
}

export async function serverRegister(code: string, password: string, note: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const r = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, password, note }),
    });
    const d = await r.json().catch(() => ({}));
    return r.ok ? { ok: true } : { ok: false, error: d.error || `http_${r.status}` };
  } catch {
    return { ok: false, error: 'network' };
  }
}

/** True when the current Firebase user was signed in through the server (has the vbsId claim). */
export async function hasServerSession(): Promise<boolean> {
  const u = auth.currentUser;
  if (!u || u.isAnonymous) return false;
  try {
    const t = await u.getIdTokenResult();
    return !!t.claims.vbsId;
  } catch {
    return false;
  }
}

export async function authHeader(): Promise<Record<string, string>> {
  const u = auth.currentUser;
  if (!u || u.isAnonymous) return {};
  try { return { Authorization: `Bearer ${await u.getIdToken()}` }; } catch { return {}; }
}

export function loginErrorText(code: string, mm: boolean): string {
  const t: Record<string, [string, string]> = {
    invalid_code: ['Invalid Access Code.', 'Access Code မမှန်ပါ'],
    invalid_password: ['Wrong password.', 'Password မှားနေပါတယ်'],
    expired: ['This Access Code has expired.', 'ဒီ Access Code သက်တမ်းကုန်သွားပါပြီ'],
    deactivated: ['This Access Code has been deactivated.', 'ဒီ Access Code ကို ပိတ်ထားပါတယ်'],
    pending: ['Your account is waiting for the admin to activate it.', 'သင့်အကောင့်ကို Admin က အတည်ပြုဖို့ စောင့်နေဆဲပါ'],
    too_many_attempts: ['Too many attempts. Please wait a few minutes.', 'ကြိုးစားမှု များလွန်းပါတယ်၊ မိနစ်အနည်းငယ်စောင့်ပါ'],
    admin_password_not_set: ['The admin password is not set on the server yet (ADMIN_PASSWORD).', 'Server မှာ Admin password (ADMIN_PASSWORD) မသတ်မှတ်ရသေးပါ'],
    network: ['Could not reach the server.', 'Server နဲ့ မချိတ်နိုင်ပါ'],
    sign_in_failed: ['Sign-in failed. Please try again.', 'ဝင်ရောက်မှု မအောင်မြင်ပါ၊ ထပ်ကြိုးစားပါ'],
  };
  const row = t[code];
  return row ? row[mm ? 1 : 0] : (mm ? `ဝင်ရောက်မှု မအောင်မြင်ပါ (${code})` : `Sign-in failed (${code})`);
}

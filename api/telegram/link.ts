import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { adminReady, getAdmin } from '../_lib/fb.js';
import { requireUser } from '../_lib/requireUser.js';
import { tg } from '../_lib/telegram.js';
import { clientIp, tooMany } from '../_lib/rate.js';

let botName = '';
async function getBotName(): Promise<string> {
  if (botName) return botName;
  const r = await tg('getMe', {});
  const u = (r.result as { username?: string } | undefined)?.username;
  if (u) botName = u;
  return botName;
}

/** Lets a signed-in user connect their own Telegram: start (one-time link), status, unlink. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  if (!adminReady() || !process.env.TELEGRAM_BOT_TOKEN) return res.status(503).json({ error: 'not_configured' });
  const me = await requireUser(req);
  if (!me || me.legacy) return res.status(401).json({ error: 'sign_in_required' });

  const action = String(req.body?.action || 'status');
  const { db } = getAdmin();
  const ref = db.collection('user_controls').doc(me.vbsId);
  try {
    if (action === 'status') {
      const d = (await ref.get()).data() || {};
      return res.status(200).json({ linked: !!d.telegramChatId, username: d.telegramUsername || '' });
    }
    if (action === 'unlink') {
      await ref.set({ telegramChatId: FieldValue.delete(), telegramUsername: FieldValue.delete(), telegramLinkedAt: FieldValue.delete() }, { merge: true });
      return res.status(200).json({ ok: true });
    }
    if (action === 'start') {
      if (tooMany(`tglink:${me.vbsId}:${clientIp(req)}`, 10, 10 * 60_000)) return res.status(429).json({ error: 'too_many_attempts' });
      const bot = await getBotName();
      if (!bot) return res.status(503).json({ error: 'bot_unreachable' });
      const code = crypto.randomBytes(5).toString('hex');
      await db.collection('telegram_links').doc(code).set({ vbsId: me.vbsId, expiresAt: Date.now() + 15 * 60_000 });
      return res.status(200).json({ url: `https://t.me/${bot}?start=${code}`, bot });
    }
    return res.status(400).json({ error: 'bad_action' });
  } catch (e) {
    console.error('[telegram/link]', e);
    return res.status(500).json({ error: 'server_error' });
  }
}

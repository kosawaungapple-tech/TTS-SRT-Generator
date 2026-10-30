import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { adminReady, getAdmin, OWNER_ID } from '../_lib/fb.js';
import { adminChat, esc, pendingButtons, send, tg } from '../_lib/telegram.js';

const same = (a: string, b: string) => {
  const x = crypto.createHash('sha256').update(a).digest();
  const y = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(x, y);
};
const validId = (s: string) => /^[A-Za-z0-9_-]{3,32}$/.test(s) && s !== OWNER_ID;

type Doc = Record<string, unknown>;
async function getUser(id: string): Promise<Doc | null> {
  const s = await getAdmin().db.collection('user_controls').doc(id).get();
  return s.exists ? (s.data() as Doc) : null;
}
const stamp = () => ({ updatedAt: new Date() });

async function activate(id: string, credits = 0): Promise<string> {
  if (!validId(id)) return '❌ Invalid user id';
  const ref = getAdmin().db.collection('user_controls').doc(id);
  if (!(await ref.get()).exists) return `❌ <code>${esc(id)}</code> not found`;
  const before = (await ref.get()).data() as Doc | undefined;
  await ref.set({ isActive: true, status: 'active', isBlocked: false, ...stamp(), ...(credits ? { credits: FieldValue.increment(credits) } : {}) }, { merge: true });
  if (before?.telegramChatId && !before.isActive) await send(String(before.telegramChatId), '🎉 Your account is now <b>activated</b>. You can use the app!');
  return `✅ <code>${esc(id)}</code> activated${credits ? ` (+${credits} credits)` : ''}`;
}
async function setFlags(id: string, patch: Doc, okText: string): Promise<string> {
  if (!validId(id)) return '❌ Invalid user id';
  const ref = getAdmin().db.collection('user_controls').doc(id);
  if (!(await ref.get()).exists) return `❌ <code>${esc(id)}</code> not found`;
  await ref.set({ ...patch, ...stamp() }, { merge: true });
  return `${okText} <code>${esc(id)}</code>`;
}
function summary(id: string, u: Doc): string {
  const state = u.isBlocked ? '🚫 blocked' : u.isActive ? '🟢 active' : u.status === 'pending' ? '🟡 pending' : '⚪ inactive';
  return `<b>${esc(id)}</b> — ${state}\ncredits: ${esc(u.credits ?? 0)} · role: ${esc(u.role ?? 'user')}${u.note ? `\nnote: ${esc(u.note)}` : ''}`;
}

const HELP = `<b>VBS admin bot</b>
/pending – accounts waiting for activation
/user &lt;id&gt; – show an account
/activate &lt;id&gt; · /deactivate &lt;id&gt;
/block &lt;id&gt; · /unblock &lt;id&gt;
/credits &lt;id&gt; &lt;number&gt; – add credits (negative to remove)`;

async function handleCommand(chat: number | string, text: string) {
  const [cmdRaw, a1, a2] = text.trim().split(/\s+/);
  const cmd = cmdRaw.toLowerCase().replace(/@.*$/, '');
  const { db } = getAdmin();
  if (cmd === '/pending') {
    const snap = await db.collection('user_controls').where('status', '==', 'pending').limit(20).get();
    if (snap.empty) return send(chat, '👍 No accounts are waiting.');
    for (const d of snap.docs) await send(chat, summary(d.id, d.data()), pendingButtons(d.id));
    return;
  }
  if (cmd === '/user' && a1) { const u = await getUser(a1); return send(chat, u ? summary(a1, u) : `❌ <code>${esc(a1)}</code> not found`); }
  if (cmd === '/activate' && a1) return send(chat, await activate(a1));
  if (cmd === '/deactivate' && a1) return send(chat, await setFlags(a1, { isActive: false }, '⏸ deactivated'));
  if (cmd === '/block' && a1) return send(chat, await setFlags(a1, { isBlocked: true, isActive: false }, '🚫 blocked'));
  if (cmd === '/unblock' && a1) return send(chat, await setFlags(a1, { isBlocked: false }, '♻️ unblocked'));
  if (cmd === '/credits' && a1 && a2 && Number.isFinite(Number(a2))) {
    const n = Math.trunc(Number(a2));
    if (!validId(a1)) return send(chat, '❌ Invalid user id');
    const ref = db.collection('user_controls').doc(a1);
    if (!(await ref.get()).exists) return send(chat, `❌ <code>${esc(a1)}</code> not found`);
    await ref.set({ credits: FieldValue.increment(n), ...stamp() }, { merge: true });
    return send(chat, `💳 <code>${esc(a1)}</code> ${n >= 0 ? '+' : ''}${n} credits`);
  }
  return send(chat, HELP);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET || '';

  // One-time setup: open  https://<your-site>/api/telegram/webhook?setup=<TELEGRAM_WEBHOOK_SECRET>  in a browser.
  if (req.method === 'GET') {
    const given = String(req.query.setup || '');
    if (!secret || !process.env.TELEGRAM_BOT_TOKEN || !given || !same(given, secret)) return res.status(403).json({ error: 'forbidden' });
    const host = String(req.headers['x-forwarded-host'] || req.headers.host || '');
    const r = await tg('setWebhook', { url: `https://${host}/api/telegram/webhook`, secret_token: secret, allowed_updates: ['message', 'callback_query'], drop_pending_updates: true });
    return res.status(r.ok ? 200 : 500).json({ ok: r.ok, description: r.description, webhook: `https://${host}/api/telegram/webhook` });
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  // Only Telegram (it echoes the secret we registered) may call this.
  if (!secret || !same(String(req.headers['x-telegram-bot-api-secret-token'] || ''), secret)) return res.status(403).json({ error: 'forbidden' });
  if (!adminReady()) return res.status(200).json({ ok: true });

  try {
    const upd = req.body || {};
    const msg = upd.message;
    const cb = upd.callback_query;
    const admin = adminChat();

    if (msg?.text) {
      const chat = msg.chat.id;
      const link = /^\/start(?:@\w+)?\s+([a-f0-9]{10})\s*$/i.exec(msg.text);
      if (link && msg.chat.type === 'private') {
        // A user pressed the "Connect Telegram" link from the website's Settings.
        const { db } = getAdmin();
        const lref = db.collection('telegram_links').doc(link[1].toLowerCase());
        const snap = await lref.get();
        const data = snap.exists ? (snap.data() as { vbsId?: string; expiresAt?: number }) : null;
        if (!data?.vbsId || !data.expiresAt || data.expiresAt < Date.now()) {
          await send(chat, '⚠️ This link has expired. Open the website → Settings → Telegram and press Connect again.');
        } else {
          await db.collection('user_controls').doc(data.vbsId).set({
            telegramChatId: String(chat), telegramUsername: msg.from?.username ? `@${msg.from.username}` : String(msg.from?.first_name || ''), telegramLinkedAt: new Date(), updatedAt: new Date(),
          }, { merge: true });
          await lref.delete();
          await send(chat, `✅ Connected to account <b>${esc(data.vbsId)}</b>.\nYou will get account notices here (for example when your account is activated).`);
        }
      } else if (/^\/start/i.test(msg.text) && String(msg.from?.id) !== admin) {
        await send(chat, `Your Telegram ID: <code>${esc(msg.from?.id)}</code>\nPut it in the website's Vercel setting <code>TELEGRAM_ADMIN_CHAT_ID</code> to make this bot yours.`);
      } else if (String(msg.from?.id) !== admin || String(chat) !== admin) {
        await send(chat, '⛔ Not authorized.');
      } else {
        await handleCommand(chat, msg.text);
      }
    } else if (cb) {
      const chat = cb.message?.chat?.id;
      if (String(cb.from?.id) !== admin || String(chat) !== admin) {
        await tg('answerCallbackQuery', { callback_query_id: cb.id, text: 'Not authorized', show_alert: true });
      } else {
        const [kind, id] = String(cb.data || '').split(':');
        let out = '❓ Unknown action';
        if (kind === 'a') out = await activate(id);
        else if (kind === 'a10') out = await activate(id, 10);
        else if (kind === 'r') out = await setFlags(id, { isBlocked: true, isActive: false }, '🚫 rejected & blocked');
        await tg('answerCallbackQuery', { callback_query_id: cb.id, text: out.replace(/<[^>]+>/g, '').slice(0, 150) });
        if (cb.message) await tg('editMessageText', { chat_id: chat, message_id: cb.message.message_id, text: `${out}\n\n(${new Date().toISOString().slice(11, 19)} UTC)`, parse_mode: 'HTML' });
      }
    }
  } catch (e) {
    console.error('[telegram/webhook]', e);
  }
  return res.status(200).json({ ok: true });
}

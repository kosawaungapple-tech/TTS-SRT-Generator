// Telegram bot helpers (admin notifications + controls). Env on Vercel:
//   TELEGRAM_BOT_TOKEN      from @BotFather
//   TELEGRAM_ADMIN_CHAT_ID  your own Telegram user id (send /start to the bot to see it)
//   TELEGRAM_WEBHOOK_SECRET any long random text; Telegram sends it back with every update
export const tgConfigured = () => !!process.env.TELEGRAM_BOT_TOKEN && !!process.env.TELEGRAM_ADMIN_CHAT_ID;
export const adminChat = () => String(process.env.TELEGRAM_ADMIN_CHAT_ID || '').trim();

export const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export type Button = { text: string; callback_data: string };

export async function tg(method: string, body: Record<string, unknown>): Promise<{ ok: boolean; description?: string; result?: unknown }> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return { ok: false, description: 'no token' };
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 6000);
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctrl.signal,
    });
    return await r.json();
  } catch (e) {
    return { ok: false, description: String((e as Error)?.message || e) };
  } finally { clearTimeout(t); }
}

export function send(chatId: string | number, text: string, buttons?: Button[][]) {
  return tg('sendMessage', {
    chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true,
    ...(buttons ? { reply_markup: { inline_keyboard: buttons } } : {}),
  });
}

/** Buttons shown under a pending-account message. */
export const pendingButtons = (id: string): Button[][] => [
  [{ text: '✅ Activate', callback_data: `a:${id}` }, { text: '✅ +10 credits', callback_data: `a10:${id}` }],
  [{ text: '🚫 Reject (block)', callback_data: `r:${id}` }],
];

export async function notifyNewUser(id: string, note: string, ip: string) {
  if (!tgConfigured()) return;
  await send(
    adminChat(),
    `🆕 <b>New account</b> (waiting for activation)\n\nUser ID: <code>${esc(id)}</code>\nNote: ${esc(note) || '-'}\nIP: ${esc(ip)}\nTime: ${new Date().toISOString().replace('T', ' ').slice(0, 19)} UTC`,
    pendingButtons(id)
  );
}

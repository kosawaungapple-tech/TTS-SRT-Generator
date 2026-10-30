import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Send, Loader2, CheckCircle2, Unlink } from 'lucide-react';
import { authHeader } from '../services/serverAuth';

interface Props { isMm: boolean; showToast: (message: string, type: 'success' | 'error') => void }

async function call(action: 'status' | 'start' | 'unlink'): Promise<{ ok: boolean; status: number; data: { linked?: boolean; username?: string; url?: string; error?: string } }> {
  const r = await fetch('/api/telegram/link', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
    body: JSON.stringify({ action }),
  });
  return { ok: r.ok, status: r.status, data: await r.json().catch(() => ({})) };
}

/** Settings card: connect your own Telegram to this account (account notices such as "your account is activated"). */
export const TelegramLinkCard: React.FC<Props> = ({ isMm, showToast }) => {
  const [state, setState] = useState<'loading' | 'unavailable' | 'off' | 'on'>('loading');
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const timer = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await call('status');
      if (!r.ok) { setState('unavailable'); return false; }
      setUsername(r.data.username || '');
      setState(r.data.linked ? 'on' : 'off');
      return !!r.data.linked;
    } catch { setState('unavailable'); return false; }
  }, []);

  useEffect(() => { void refresh(); return () => { if (timer.current) window.clearInterval(timer.current); }; }, [refresh]);

  const connect = async () => {
    setBusy(true);
    try {
      const r = await call('start');
      if (!r.ok || !r.data.url) { showToast(isMm ? 'Telegram ချိတ်လို့မရပါ (Server မှာ Bot မသတ်မှတ်ရသေးပါ)' : 'Telegram is not available right now', 'error'); return; }
      window.open(r.data.url, '_blank', 'noopener');
      setWaiting(true);
      let tries = 0;
      if (timer.current) window.clearInterval(timer.current);
      timer.current = window.setInterval(async () => {
        tries++;
        if (await refresh() || tries > 100) {
          if (timer.current) window.clearInterval(timer.current);
          setWaiting(false);
        }
      }, 3000);
    } catch { showToast(isMm ? 'Server ကို မချိတ်နိုင်ပါ' : 'Could not reach the server', 'error'); }
    finally { setBusy(false); }
  };

  const unlink = async () => {
    setBusy(true);
    try { await call('unlink'); setState('off'); setUsername(''); showToast(isMm ? 'Telegram ချိတ်ဆက်မှု ဖြုတ်ပြီးပါပြီ' : 'Telegram disconnected', 'success'); }
    catch { showToast(isMm ? 'မအောင်မြင်ပါ' : 'Failed', 'error'); }
    finally { setBusy(false); }
  };

  if (state === 'unavailable') return null; // not signed in through the server, or the bot is not set up: nothing to show

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 mb-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[13px] font-extrabold text-white flex items-center gap-2"><Send size={15} />{isMm ? 'Telegram ချိတ်ဆက်ရန်' : 'Connect Telegram'}</div>
          <div className="text-[11.5px] text-slate-500 mt-0.5">
            {state === 'on'
              ? (isMm ? `ချိတ်ပြီးပါပြီ ${username ? `(${username})` : ''} — အကောင့်သတင်းတွေ (ဥပမာ Activate ဖြစ်ကြောင်း) ကို Telegram မှာ ရပါမယ်` : `Connected ${username ? `(${username})` : ''} — you get account notices here, e.g. when your account is activated`)
              : (isMm ? 'ခလုတ်နှိပ်ပြီး Telegram မှာ START နှိပ်ရုံပါ' : 'Press the button, then press START in Telegram')}
          </div>
        </div>
        {state === 'loading' ? <Loader2 size={16} className="animate-spin text-slate-500" /> : state === 'on' ? (
          <button type="button" onClick={unlink} disabled={busy} className="shrink-0 h-9 px-3 rounded-xl bg-white/10 hover:bg-white/15 text-[12px] font-bold text-white flex items-center gap-1.5 disabled:opacity-50"><Unlink size={14} />{isMm ? 'ဖြုတ်မည်' : 'Disconnect'}</button>
        ) : (
          <button type="button" onClick={connect} disabled={busy || waiting} className="shrink-0 h-9 px-4 rounded-xl bg-sky-500 text-white text-[12px] font-extrabold flex items-center gap-1.5 disabled:opacity-60">
            {busy || waiting ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}{waiting ? (isMm ? 'စောင့်နေသည်…' : 'Waiting…') : (isMm ? 'ချိတ်မည်' : 'Connect')}
          </button>
        )}
      </div>
      {state === 'on' && <div className="mt-2 text-[11px] text-emerald-400 flex items-center gap-1"><CheckCircle2 size={13} />{isMm ? 'အဆင်သင့်' : 'Active'}</div>}
    </div>
  );
};

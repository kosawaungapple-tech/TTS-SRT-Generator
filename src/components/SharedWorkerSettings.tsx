import React, { useEffect, useState } from 'react';
import { db, doc, getDoc, setDoc, serverTimestamp } from '../firebase';

/**
 * Admin: share your PC worker with the users you allow (the Laptop button in the user list).
 * Users never see the address or the secret - the website hands them a short-lived signed token.
 */
export const SharedWorkerSettings: React.FC = () => {
  const [url, setUrl] = useState('');
  const [requireGrant, setRequireGrant] = useState(true);
  const [msg, setMsg] = useState('');
  const [liveAge, setLiveAge] = useState<number | null>(null);
  const [secret, setSecret] = useState('');
  const [copied, setCopied] = useState(false);

  /** Makes a random secret and a Windows launcher (.bat) that already contains it - double-click to start. */
  const makeLauncher = () => {
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    const sec = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
    const site = window.location.origin;
    const bat = [
      '@echo off',
      'title VBS - phone render (keep this window open)',
      'cd /d "%~dp0"',
      `set RENDER_SECRET=${sec}`,
      `set SITE_URL=${site}`,
      'set PORT=5006',
      'set "PATH=%PATH%;C:\\Program Files (x86)\\cloudflared;C:\\Program Files\\cloudflared"',
      'where node >nul 2>nul || (echo Node.js is not installed. Install it from https://nodejs.org then run this again. & pause & exit /b 1)',
      'where cloudflared >nul 2>nul || (echo Installing cloudflared... & winget install -e --id Cloudflare.cloudflared --accept-source-agreements --accept-package-agreements)',
      'echo Getting the latest worker...',
      `curl -L -s -o vbs-ffmpeg-worker.js ${site}/worker/vbs-ffmpeg-worker.js`,
      ':loop',
      'node vbs-ffmpeg-worker.js',
      'echo Worker stopped. Restarting in 5 seconds (close this window to quit)...',
      'timeout /t 5 >nul',
      'goto loop',
      '',
    ].join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([bat], { type: 'application/octet-stream' }));
    a.download = 'VBS-Phone-Render.bat';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    setSecret(sec);
    setCopied(false);
  };

  useEffect(() => {
    let stop = false;
    const check = () => getDoc(doc(db, 'settings', 'render_live'))
      .then(s => {
        const d = s.data() as { lastSeen?: number } | undefined;
        if (!stop) setLiveAge(d?.lastSeen ? Math.round((Date.now() - d.lastSeen) / 1000) : null);
      })
      .catch(() => { /* offline */ });
    void check();
    const t = setInterval(check, 20000);
    return () => { stop = true; clearInterval(t); };
  }, []);

  useEffect(() => {
    getDoc(doc(db, 'settings', 'render_server'))
      .then(s => {
        const d = s.data() as { url?: string; requireGrant?: boolean } | undefined;
        if (d) { setUrl(d.url || ''); setRequireGrant(d.requireGrant !== false); }
      })
      .catch(() => { /* offline */ });
  }, []);

  const save = async () => {
    try {
      await setDoc(doc(db, 'settings', 'render_server'), { url: url.trim().replace(/\/+$/, ''), requireGrant, updatedAt: serverTimestamp() }, { merge: true });
      setMsg('Saved ✓');
    } catch {
      setMsg('Save failed');
    }
  };

  return (
    <div className="mt-6 p-5 rounded-3xl bg-white/5 border border-white/10 space-y-3">
      <h4 className="text-sm font-bold text-white">Share this PC with users (shared render address)</h4>
      <div className={`flex items-center gap-2 text-xs font-bold ${liveAge !== null && liveAge < 150 ? 'text-emerald-400' : 'text-slate-400'}`}>
        <span className={`w-2 h-2 rounded-full ${liveAge !== null && liveAge < 150 ? 'bg-emerald-400' : 'bg-slate-600'}`} />
        {liveAge !== null && liveAge < 150 ? `PC online - phones can render now (seen ${liveAge}s ago)` : 'PC offline (no automatic worker has checked in)'}
      </div>
      <p className="text-[11px] text-slate-400 leading-relaxed">
        <b>Automatic (recommended):</b> install <span className="font-mono">cloudflared</span> once, then start the user worker:<br />
        <span className="font-mono">RENDER_SECRET=&lt;secret&gt; PORT=5006 node vbs-ffmpeg-worker.js</span><br />
        It opens the tunnel and tells the website its address every minute - phones need nothing. Put the same secret in Vercel as <span className="font-mono">RENDER_SECRET</span> (once). Allow each user with the laptop button in the user list.<br />
        <b>Manual (fallback):</b> paste a fixed https address below; it is only used when no automatic worker is online.
      </p>
      <div className="rounded-2xl bg-amber-400/10 border border-amber-400/30 p-4 space-y-3">
        <div className="text-xs font-bold text-amber-200">Easiest setup (Windows)</div>
        <ol className="text-[11px] text-slate-300 leading-relaxed list-decimal pl-4 space-y-1">
          <li>Press the button below. It downloads <b>VBS-Phone-Render.bat</b> and shows a secret.</li>
          <li>Copy the secret into Vercel &rarr; Settings &rarr; Environment Variables as <span className="font-mono">RENDER_SECRET</span>, then Redeploy (once).</li>
          <li>Double-click the .bat on your PC and keep the window open. It installs what it needs and connects by itself.</li>
        </ol>
        <button type="button" onClick={makeLauncher} className="px-5 py-2 rounded-xl bg-amber-400 text-black text-xs font-extrabold">Create launcher + secret</button>
        {secret && (
          <div className="flex items-center gap-2">
            <input readOnly value={secret} onFocus={e => e.currentTarget.select()} className="flex-1 bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-[11px] text-white font-mono" />
            <button type="button" onClick={() => { void navigator.clipboard?.writeText(secret).then(() => setCopied(true)).catch(() => { /* ignore */ }); }} className="px-3 py-2 rounded-xl bg-white/10 text-white text-xs font-bold">{copied ? 'Copied' : 'Copy'}</button>
          </div>
        )}
      </div>
      <input
        value={url}
        onChange={e => setUrl(e.target.value)}
        placeholder="https://xxxx.trycloudflare.com"
        className="w-full bg-slate-900 border border-white/10 rounded-xl px-4 py-3 text-sm text-white font-mono"
      />
      <label className="flex items-center gap-2 text-xs text-slate-300">
        <input type="checkbox" checked={requireGrant} onChange={e => setRequireGrant(e.target.checked)} />
        Only users I allowed (laptop button) can render
      </label>
      <div className="flex items-center gap-3">
        <button type="button" onClick={save} className="px-5 py-2 rounded-xl bg-amber-400 text-black text-xs font-extrabold">Save</button>
        {msg && <span className="text-xs text-slate-300">{msg}</span>}
      </div>
    </div>
  );
};

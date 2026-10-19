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
      <p className="text-[11px] text-slate-400 leading-relaxed">
        1) Start a second worker for users: <span className="font-mono">RENDER_SECRET=&lt;secret&gt; PORT=5006 node vbs-ffmpeg-worker.js</span> (your own worker on 5005 is not touched).<br />
        2) Open a tunnel to it: <span className="font-mono">cloudflared tunnel --url http://localhost:5006</span> and paste the https address below.<br />
        3) Put the same secret in Vercel as <span className="font-mono">RENDER_SECRET</span> (once). Then use the laptop button in the user list to allow each user.
      </p>
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

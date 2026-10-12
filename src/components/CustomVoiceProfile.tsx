import React, { useState, useRef, useEffect } from 'react';
import { Mic, Upload, Trash2, Square, CheckCircle2, AlertCircle, Loader2, Wand2 } from 'lucide-react';
import { useLanguage } from '../contexts/LanguageContext';
import { GeminiTTSService } from '../services/geminiService';
import { apiChannelManager } from '../services/apiChannelManager';
import { toMono24kWavBase64 } from '../utils/voiceAudio';

interface CustomVoiceProfileProps {
  /** Receives the Gemini custom voice id (voice_...) or null when removed. */
  onProfileChange: (voiceId: string | null) => void;
  initialProfile?: string | null;
}

const CONSENT_SENTENCE = 'I am the owner of this voice and I consent to Google using this voice to create a synthetic voice model.';

type Clip = { blob: Blob; url: string; seconds: number };

export const CustomVoiceProfile: React.FC<CustomVoiceProfileProps> = ({ onProfileChange, initialProfile }) => {
  const { language } = useLanguage();
  const mm = language === 'mm';
  const voiceId = /^voice(key)?_/.test(initialProfile || '') ? (initialProfile as string) : null;

  const [sample, setSample] = useState<Clip | null>(null);
  const [consent, setConsent] = useState<Clip | null>(null);
  const [recording, setRecording] = useState<'sample' | 'consent' | null>(null);
  const [secs, setSecs] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);

  // Old versions stored a raw audio sample here; it is no longer used.
  useEffect(() => {
    if (initialProfile && !voiceId) {
      try { localStorage.removeItem('vbs_custom_voice_profile'); } catch { /* ignore */ }
      onProfileChange(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stopTimer = () => { if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; } };

  const startRecording = async (which: 'sample' | 'consent') => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      recRef.current = rec;
      chunksRef.current = [];
      rec.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      let seconds = 0;
      rec.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' });
        const clip = { blob, url: URL.createObjectURL(blob), seconds };
        if (which === 'sample') setSample(clip); else setConsent(clip);
      };
      rec.start();
      setRecording(which);
      setSecs(0);
      timerRef.current = window.setInterval(() => {
        seconds += 1;
        setSecs(seconds);
        if (seconds >= (which === 'sample' ? 30 : 15)) stopRecording();
      }, 1000);
    } catch {
      setError(mm ? 'မိုက်ခရိုဖုန်း အသုံးပြုခွင့် မရပါ' : 'Microphone access denied');
    }
  };

  const stopRecording = () => {
    stopTimer();
    if (recRef.current && recRef.current.state !== 'inactive') recRef.current.stop();
    setRecording(null);
  };

  const onUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 15 * 1024 * 1024) { setError(mm ? 'ဖိုင်ကြီးလွန်းသည် (အများဆုံး 15MB)' : 'File too large (max 15MB)'); return; }
    const url = URL.createObjectURL(f);
    const a = new Audio(url);
    a.onloadedmetadata = () => setSample({ blob: f, url, seconds: Math.round(a.duration) });
    a.onerror = () => setError(mm ? 'ဤအသံဖိုင်ကို ဖတ်မရပါ' : 'Cannot read this audio file');
    setError(null);
  };

  const gemini = () => {
    const managed = apiChannelManager.getSettings().useAdminKeys;
    return new GeminiTTSService(managed ? '' : apiChannelManager.getActiveKey() || '');
  };

  const createVoice = async () => {
    if (!sample || !consent) return;
    if (sample.seconds < 10) { setError(mm ? 'နမူနာအသံ အနည်းဆုံး ၁၀ စက္ကန့် လိုပါသည်' : 'The sample must be at least 10 seconds'); return; }
    setBusy(true);
    setError(null);
    try {
      const [src, con] = await Promise.all([toMono24kWavBase64(sample.blob, 20), toMono24kWavBase64(consent.blob, 12)]);
      const id = await gemini().createCustomVoice(src.base64, con.base64);
      try { localStorage.setItem('vbs_custom_voice_profile', id); } catch { /* ignore */ }
      onProfileChange(id);
      setSample(null);
      setConsent(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const removeVoice = async () => {
    if (!voiceId) return;
    setBusy(true);
    try { await gemini().deleteCustomVoice(voiceId); } catch (e) { console.warn('Delete voice failed', e); }
    try { localStorage.removeItem('vbs_custom_voice_profile'); } catch { /* ignore */ }
    onProfileChange(null);
    setBusy(false);
  };

  const RecBtn = ({ which }: { which: 'sample' | 'consent' }) => (
    <button
      type="button"
      onClick={() => (recording === which ? stopRecording() : startRecording(which))}
      disabled={!!recording && recording !== which}
      className={`flex flex-1 items-center justify-center gap-2 p-4 rounded-2xl border-2 border-dashed transition-all text-[11px] font-bold uppercase tracking-wider ${
        recording === which ? 'bg-red-500/10 border-red-500 text-red-500' : 'bg-white/5 border-white/10 text-slate-400 hover:border-amber-400/50 hover:text-amber-500'
      }`}
    >
      {recording === which ? <Square size={18} /> : <Mic size={18} />}
      {recording === which ? `${mm ? 'ရပ်မည်' : 'Stop'} (${secs}s)` : mm ? 'အသံသွင်းမည်' : 'Record'}
    </button>
  );

  if (voiceId) {
    return (
      <div className="space-y-3">
        <div className="bg-amber-400/10 border border-amber-400/20 rounded-2xl p-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-amber-400 rounded-full text-black"><CheckCircle2 size={20} /></div>
            <div>
              <p className="text-sm font-bold text-white">{mm ? 'သင့်အသံ အသင့်ဖြစ်ပါပြီ' : 'Your voice is ready'}</p>
              <p className="text-[10px] text-slate-400 uppercase tracking-tight">{mm ? 'ဖတ်ပေးတဲ့အခါ ဤအသံကို သုံးမည်' : 'Used automatically when generating speech'}</p>
            </div>
          </div>
          <button onClick={removeVoice} disabled={busy} className="text-red-400 hover:text-red-500 transition-colors p-2" title={mm ? 'ဖျက်မည်' : 'Delete voice'}>
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
          </button>
        </div>
        {error && <p className="text-red-400 text-[11px]">{error}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-[11px] text-slate-400 leading-relaxed">
        {mm
          ? 'Google AI Studio key နဲ့ပဲ သင့်အသံကို အတုယူပါမည်။ အဆင့် ၂ ဆင့်သာ — ၁) အသံနမူနာ ၂) သဘောတူညီချက် စာကြောင်း ဖတ်သွင်းခြင်း။ ကိုယ့်အသံ (သို့) ခွင့်ပြုချက်ရထားသူ၏ အသံကိုသာ သုံးပါ။'
          : 'Clones your voice using just your Google AI Studio key. Two steps: 1) a voice sample, 2) read one consent sentence. Only use your own voice or one you have permission to use.'}
      </p>

      <div className="space-y-2">
        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{sample ? '✅ ' : ''}{mm ? '၁) အသံနမူနာ (၁၀–၂၀ စက္ကန့်၊ ကြည်ကြည်လင်လင်)' : '1) Voice sample (10–20s, clear speech)'}</p>
        <div className="flex gap-3">
          <RecBtn which="sample" />
          <label className="flex flex-1 items-center justify-center gap-2 p-4 rounded-2xl border-2 border-dashed bg-white/5 border-white/10 text-slate-400 hover:border-amber-400/50 hover:text-amber-500 cursor-pointer transition-all text-[11px] font-bold uppercase tracking-wider">
            <Upload size={18} />
            {mm ? 'ဖိုင်တင်မည်' : 'Upload'}
            <input type="file" accept="audio/*" className="hidden" onChange={onUpload} />
          </label>
        </div>
        {sample && (
          <div className="flex items-center gap-2">
            <audio src={sample.url} controls className="h-8 flex-1" />
            <span className="text-[10px] text-slate-500">{sample.seconds}s</span>
          </div>
        )}
      </div>

      <div className="space-y-2">
        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{consent ? '✅ ' : ''}{mm ? '၂) အောက်ပါစာကြောင်းကို အသံထွက်ဖတ်ပြီး သွင်းပါ' : '2) Record yourself reading this sentence'}</p>
        <p className="text-xs text-amber-300 bg-amber-400/5 border border-amber-400/10 rounded-xl p-3 leading-relaxed">“{CONSENT_SENTENCE}”</p>
        <RecBtn which="consent" />
        {consent && <audio src={consent.url} controls className="h-8 w-full" />}
      </div>

      {!busy && (!sample || !consent) && (
        <p className="text-[11px] text-amber-300 bg-amber-400/5 border border-amber-400/10 rounded-xl p-3 leading-relaxed">
          {mm
            ? `ခလုတ်ကို နှိပ်နိုင်ရန် လိုအပ်နေသေးသည် — ${!sample ? '၁) အသံနမူနာ' : ''}${!sample && !consent ? ' နှင့် ' : ''}${!consent ? '၂) သဘောတူစာကြောင်း အသံသွင်းခြင်း' : ''} ကို သွင်းပါ။`
            : `Still needed before you can create the voice: ${!sample ? 'step 1 (voice sample)' : ''}${!sample && !consent ? ' and ' : ''}${!consent ? 'step 2 (consent recording)' : ''}.`}
        </p>
      )}
      <button
        type="button"
        onClick={createVoice}
        disabled={!sample || !consent || busy || !!recording}
        className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl bg-amber-400 text-black font-bold text-xs uppercase tracking-wider disabled:opacity-40 hover:bg-amber-300 transition-all"
      >
        {busy ? <Loader2 size={16} className="animate-spin" /> : <Wand2 size={16} />}
        {mm ? 'ကျွန်ုပ်အသံ ဖန်တီးမည်' : 'Create my voice'}
      </button>

      {error && (
        <div className="flex items-start gap-2 text-red-400 text-[11px] bg-red-400/5 p-2 rounded-lg border border-red-400/10">
          <AlertCircle size={14} className="shrink-0 mt-0.5" />
          <span className="break-words">{error}</span>
        </div>
      )}
      <p className="text-[9px] text-slate-500 leading-relaxed italic">
        {mm ? '* အသံနမူနာနှင့် သဘောတူစာကြောင်းကို မိုက်ခရိုဖုန်းတစ်ခုတည်း၊ တိတ်ဆိတ်သောနေရာတစ်ခုတည်းတွင် သွင်းပါ။' : '* Record both clips on the same microphone in the same quiet place.'}
      </p>
    </div>
  );
};

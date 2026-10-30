/**
 * Small interface sounds made with the Web Audio API (no sound files, nothing to download or license).
 * Settings are remembered per browser. Everything is wrapped so a blocked/unsupported audio never breaks the app.
 */
export type UiSoundName = 'click' | 'success' | 'error' | 'done' | 'notify';

const KEY = 'VBS_UI_SOUND';
export interface SoundPrefs { enabled: boolean; clicks: boolean; volume: number }
const DEFAULTS: SoundPrefs = { enabled: true, clicks: true, volume: 0.5 };

let prefs: SoundPrefs | null = null;
export function getSoundPrefs(): SoundPrefs {
  if (prefs) return prefs;
  try {
    const raw = localStorage.getItem(KEY);
    prefs = raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<SoundPrefs>) } : { ...DEFAULTS };
  } catch { prefs = { ...DEFAULTS }; }
  return prefs;
}
export function setSoundPrefs(p: Partial<SoundPrefs>) {
  prefs = { ...getSoundPrefs(), ...p };
  try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch { /* storage unavailable */ }
}

let ctx: AudioContext | null = null;
function ac(): AudioContext | null {
  try {
    if (!ctx) {
      const C = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!C) return null;
      ctx = new C();
    }
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch { return null; }
}

/** One soft note: sine/triangle with a quick attack and a smooth fade. */
function note(c: AudioContext, freq: number, start: number, dur: number, gain: number, type: OscillatorType = 'sine') {
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, start);
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), start + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  o.connect(g).connect(c.destination);
  o.start(start);
  o.stop(start + dur + 0.03);
}

let lastClick = 0;
export function playUiSound(name: UiSoundName) {
  const p = getSoundPrefs();
  if (!p.enabled || p.volume <= 0) return;
  if (name === 'click' && !p.clicks) return;
  const c = ac();
  if (!c) return;
  const v = p.volume;
  const t = c.currentTime + 0.005;
  try {
    switch (name) {
      case 'click': {
        const now = performance.now();
        if (now - lastClick < 60) return; // no machine-gun clicks
        lastClick = now;
        note(c, 880, t, 0.06, 0.05 * v, 'triangle');
        break;
      }
      case 'success': // two rising notes
        note(c, 659.25, t, 0.16, 0.12 * v);
        note(c, 987.77, t + 0.09, 0.22, 0.12 * v);
        break;
      case 'done': // a short happy arpeggio for finished jobs
        [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => note(c, f, t + i * 0.1, 0.28, 0.13 * v));
        break;
      case 'error': // two falling low notes
        note(c, 311.13, t, 0.18, 0.12 * v, 'triangle');
        note(c, 233.08, t + 0.12, 0.28, 0.12 * v, 'triangle');
        break;
      case 'notify':
        note(c, 783.99, t, 0.14, 0.1 * v);
        note(c, 783.99, t + 0.16, 0.2, 0.1 * v);
        break;
    }
  } catch { /* ignore audio errors */ }
}

/** Plays a click for presses on buttons / links / switches. Install once. */
export function installClickSounds() {
  const onClick = (e: MouseEvent) => {
    const el = (e.target as HTMLElement | null)?.closest?.('button, a[href], [role="button"], [role="tab"], select, input[type="checkbox"], input[type="radio"], label') as (HTMLElement & { disabled?: boolean }) | null;
    if (!el || el.disabled || el.getAttribute('aria-disabled') === 'true') return;
    playUiSound('click');
  };
  document.addEventListener('click', onClick, { capture: true, passive: true });
  return () => document.removeEventListener('click', onClick, { capture: true });
}

export type ThemeChoice = 'dark' | 'light' | 'system';
const KEY = 'VBS_THEME';
export const THEME_EVENT = 'vbs-theme';

export function getThemeChoice(): ThemeChoice {
  try { const v = localStorage.getItem(KEY); if (v === 'light' || v === 'dark' || v === 'system') return v; } catch { /* storage unavailable */ }
  return 'dark';
}
export function resolveTheme(c: ThemeChoice = getThemeChoice()): 'dark' | 'light' {
  if (c === 'system') {
    try { return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'; } catch { return 'dark'; }
  }
  return c;
}
/** Puts `dark` or `light` on <html> (Tailwind's `dark:` variants and the light palette in index.css key off these). */
export function applyTheme(c: ThemeChoice = getThemeChoice()) {
  const t = resolveTheme(c);
  const el = document.documentElement;
  el.classList.toggle('dark', t === 'dark');
  el.classList.toggle('light', t === 'light');
  el.style.colorScheme = t;
  try { document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t === 'light' ? '#f6f7fb' : '#000000'); } catch { /* ignore */ }
}
export function setThemeChoice(c: ThemeChoice) {
  try { localStorage.setItem(KEY, c); } catch { /* storage unavailable */ }
  applyTheme(c);
  window.dispatchEvent(new Event(THEME_EVENT));
}

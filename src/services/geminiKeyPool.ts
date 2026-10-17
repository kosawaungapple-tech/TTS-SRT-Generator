import { isPlausibleApiKey } from './apiChannelManager';

/**
 * Extra personal Gemini (AI Studio) keys. When the active key hits its limit for a model,
 * the request moves to the next key instead of waiting hours for the limit to reset.
 * A limit is remembered per key AND model (a spent TTS quota does not block text models).
 */
const STORAGE_KEY = 'vbs_gemini_extra_keys';

export class KeyLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KeyLimitError';
  }
}

const coolingUntil = new Map<string, number>();
const cdKey = (key: string, model: string) => `${key}|${model}`;

export function getExtraKeys(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(raw) ? raw.filter((k): k is string => typeof k === 'string' && isPlausibleApiKey(k)).map(k => k.trim()) : [];
  } catch {
    return [];
  }
}

export function setExtraKeys(keys: string[]): void {
  const clean = Array.from(new Set(keys.map(k => k.trim()).filter(k => isPlausibleApiKey(k))));
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(clean)); } catch { /* storage unavailable */ }
  coolingUntil.clear();
}

/** Seconds a limit message says to wait ("retry in 17h7.79s", "retry in 41s"); null if it does not say. */
export function parseRetrySeconds(msg: string): number | null {
  const m = msg.match(/retry in\s+(?:(\d+)h)?\s*(?:(\d+)m)?\s*([\d.]+)s/i);
  if (!m) return null;
  return (Number(m[1] || 0) * 3600) + (Number(m[2] || 0) * 60) + Number(m[3] || 0);
}

export function markLimited(key: string, model: string, message: string): void {
  const secs = parseRetrySeconds(message);
  // unknown wait: assume a short per-minute limit; long daily limits announce their wait
  const wait = Math.min(24 * 3600, Math.max(30, secs ?? 60));
  coolingUntil.set(cdKey(key, model), Date.now() + wait * 1000);
}

function isFree(key: string, model: string): boolean {
  return (coolingUntil.get(cdKey(key, model)) || 0) <= Date.now();
}

/** Primary key first, then the extras; keys that are cooling for this model are skipped. */
export function pickKey(primary: string, model: string, tried: Set<string>): string | null {
  const all = Array.from(new Set([primary, ...getExtraKeys()].filter(k => !!k)));
  return all.find(k => !tried.has(k) && isFree(k, model)) || null;
}

export function hasOtherFreeKey(current: string, primary: string, model: string): boolean {
  const all = Array.from(new Set([primary, ...getExtraKeys()].filter(k => !!k)));
  return all.some(k => k !== current && isFree(k, model));
}

export function keyCount(primary: string): number {
  return new Set([primary, ...getExtraKeys()].filter(k => !!k)).size;
}

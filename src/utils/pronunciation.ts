/**
 * Pronunciation fixes applied to the text that is SPOKEN (never to subtitles).
 * Built-in entries fix words the TTS model reads wrongly; users can add their own
 * (one per line, "word -> how it should be written so it is read correctly").
 */
export const BUILTIN_PRONUNCIATION: [string, string][] = [
  // "အံ့ဩ" was read as "အံ့သ" (the ဩ got dropped); this spelling is read correctly
  ['အံ့ဩ', 'အံ့သော်'],
  ['အံ့သြ', 'အံ့သော်'],
];

const STORAGE_KEY = 'vbs_pronunciation_rules';

export function getCustomPronunciation(): string {
  try { return localStorage.getItem(STORAGE_KEY) || ''; } catch { return ''; }
}

export function setCustomPronunciation(v: string): void {
  try { localStorage.setItem(STORAGE_KEY, v); } catch { /* storage unavailable */ }
}

export function parsePronunciation(raw: string): [string, string][] {
  return raw
    .split('\n')
    .map(l => l.split('->').map(p => p.trim()))
    .filter((p): p is [string, string] => p.length === 2 && !!p[0] && p[1] !== undefined)
    .map(p => [p[0], p[1]]);
}

/** Plain string replacement (no regex) so odd characters in a rule can never throw. */
export function applyPronunciation(text: string): string {
  let out = text;
  for (const [from, to] of [...parsePronunciation(getCustomPronunciation()), ...BUILTIN_PRONUNCIATION]) {
    if (from) out = out.split(from).join(to);
  }
  return out;
}

import type { SubtitleStyle } from './subtitleOverlay';

export interface SubtitlePreset {
  id: string;
  name: { mm: string; en: string };
  /** Small preview colours for the chip. */
  swatch: { fill: string; stroke: string; accent?: string; bg?: string };
  /** Overlay videos are blended with "Screen", so they must stay bright to be visible. */
  style: Omit<SubtitleStyle, 'positionY'> & { positionY?: number };
}

const FONT = '"Noto Sans Myanmar", "Padauk", sans-serif';

export const SUBTITLE_PRESETS: SubtitlePreset[] = [
  {
    id: 'viral',
    name: { mm: 'အနီ Viral', en: 'Red Viral' },
    swatch: { fill: '#ff2a2a', stroke: '#ffffff' },
    style: { fontSize: 50, fontFamily: FONT, fontColor: '#ff2a2a', strokeColor: '#ffffff', strokeWidth: 9, bgBoxEnabled: false, bgBoxColor: 'rgba(0,0,0,0)' },
  },
  {
    id: 'yellow',
    name: { mm: 'အဝါ', en: 'Yellow' },
    swatch: { fill: '#ffe600', stroke: '#000000' },
    style: { fontSize: 50, fontFamily: FONT, fontColor: '#ffe600', strokeColor: '#000000', strokeWidth: 9, bgBoxEnabled: false, bgBoxColor: 'rgba(0,0,0,0)' },
  },
  {
    id: 'white',
    name: { mm: 'အဖြူ ရိုးရိုး', en: 'Classic White' },
    swatch: { fill: '#ffffff', stroke: '#000000' },
    style: { fontSize: 46, fontFamily: FONT, fontColor: '#ffffff', strokeColor: '#000000', strokeWidth: 8, bgBoxEnabled: false, bgBoxColor: 'rgba(0,0,0,0)' },
  },
  {
    id: 'box',
    name: { mm: 'အနက်ခုံ', en: 'Dark Box' },
    swatch: { fill: '#ffffff', stroke: '#111111' },
    style: { fontSize: 44, fontFamily: FONT, fontColor: '#ffffff', strokeColor: '#000000', strokeWidth: 0, bgBoxEnabled: true, bgBoxColor: 'rgba(0,0,0,0.72)' },
  },
  {
    id: 'twotone',
    name: { mm: 'နှစ်ရောင် Clean', en: 'Clean two-tone' },
    swatch: { fill: '#ffffff', stroke: '#000000', accent: '#ffd400' },
    style: { fontSize: 48, fontFamily: FONT, fontColor: '#ffffff', accentColor: '#ffd400', strokeColor: '#000000', strokeWidth: 8, bgBoxEnabled: false, bgBoxColor: 'rgba(0,0,0,0)' },
  },
  {
    id: 'pop',
    name: { mm: 'Pop အဝါခုံ', en: 'Pop highlight' },
    swatch: { fill: '#111111', stroke: '#111111', bg: '#ffe600' },
    style: { fontSize: 46, fontFamily: FONT, fontColor: '#111111', strokeColor: '#000000', strokeWidth: 0, bgBoxEnabled: true, bgBoxColor: '#ffe600', boxRadius: 10 },
  },
  {
    id: 'sticker',
    name: { mm: 'Sticker အဖြူ', en: 'Sticker' },
    swatch: { fill: '#111111', stroke: '#111111', bg: '#ffffff' },
    style: { fontSize: 44, fontFamily: FONT, fontColor: '#111111', strokeColor: '#000000', strokeWidth: 0, bgBoxEnabled: true, bgBoxColor: '#ffffff', boxRadius: 28 },
  },
  {
    id: 'banner',
    name: { mm: 'Banner အနီ', en: 'Banner' },
    swatch: { fill: '#ffffff', stroke: '#b00020', bg: '#d0021b' },
    style: { fontSize: 44, fontFamily: FONT, fontColor: '#ffffff', strokeColor: '#000000', strokeWidth: 0, bgBoxEnabled: true, bgBoxColor: '#d0021b', boxRadius: 2 },
  },
];

/** 'noto' | 'padauk' or the CSS family of a font the user added in Settings. */
export type SubtitleFontId = string;
export const SUBTITLE_FONTS: { id: string; label: string; family: string; sample: string }[] = [
  { id: 'noto', label: 'Noto Sans Myanmar', family: '"Noto Sans Myanmar", "Padauk", sans-serif', sample: 'မင်္ဂလာပါ' },
  { id: 'padauk', label: 'Padauk', family: '"Padauk", "Noto Sans Myanmar", sans-serif', sample: 'မင်္ဂလာပါ' },
];

/** CSS font-family list for a built-in font id or a user font family (always falls back to the Myanmar fonts). */
export function fontFamilyFor(font: string): string {
  const b = SUBTITLE_FONTS.find(f => f.id === font);
  if (b) return b.family;
  return font ? `"${font}", ${FONT}` : FONT;
}

export function getSubtitleStyle(id: string, positionY: number, sizeScale = 1, font: SubtitleFontId = 'noto'): SubtitleStyle {
  const p = SUBTITLE_PRESETS.find(x => x.id === id) || SUBTITLE_PRESETS[0];
  const family = fontFamilyFor(font);
  return { ...p.style, fontFamily: family, fontSize: Math.round(p.style.fontSize * sizeScale), positionY } as SubtitleStyle;
}

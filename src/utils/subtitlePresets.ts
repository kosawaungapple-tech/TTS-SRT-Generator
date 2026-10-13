import type { SubtitleStyle } from './subtitleOverlay';

export interface SubtitlePreset {
  id: string;
  name: { mm: string; en: string };
  /** Small preview colours for the chip. */
  swatch: { fill: string; stroke: string };
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
];

export function getSubtitleStyle(id: string, positionY: number): SubtitleStyle {
  const p = SUBTITLE_PRESETS.find(x => x.id === id) || SUBTITLE_PRESETS[0];
  return { ...p.style, positionY } as SubtitleStyle;
}

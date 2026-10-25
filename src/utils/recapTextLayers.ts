export interface TextLayer {
  id: number;
  text: string;
  /** seconds on the recap timeline */
  start: number;
  end: number;
  /** centre of the text, % of the frame */
  x: number;
  y: number;
  /** font size as % of the frame width */
  size: number;
  color: string;
  /** dark outline */
  stroke: boolean;
  /** dark box behind the text */
  box: boolean;
  /** how it appears */
  anim?: 'none' | 'fade' | 'slide';
  /** ready-made title look; 'plain' uses colour / outline / box as set */
  look?: TitleLook;
  /** CSS family of a font the user added in Settings (default: Noto Sans Myanmar) */
  font?: string;
}

export type TitleLook = 'plain' | 'plate' | 'news' | 'banner' | 'sticker';
export const TITLE_LOOKS: Record<Exclude<TitleLook, 'plain'>, { bg: string; fg: string; radius: number; full?: boolean; label: { mm: string; en: string } }> = {
  plate: { bg: 'rgba(0,0,0,0.72)', fg: '#ffffff', radius: 0.25, label: { mm: 'Plate', en: 'Plate' } },
  news: { bg: '#0b3d91', fg: '#ffffff', radius: 0.05, label: { mm: 'News', en: 'News' } },
  banner: { bg: '#d0021b', fg: '#ffffff', radius: 0, full: true, label: { mm: 'Banner', en: 'Banner' } },
  sticker: { bg: '#ffffff', fg: '#111111', radius: 0.6, label: { mm: 'Sticker', en: 'Sticker' } },
};

export function newTextLayer(id: number, start = 0, end = 3): TextLayer {
  return { id, text: '', start, end, x: 50, y: 12, size: 6, color: '#ffffff', stroke: true, box: false, anim: 'fade' };
}

/** Draws one text layer on a transparent full-frame PNG that the render worker lays over the video between start and end. */
export async function renderTextLayerPng(l: TextLayer, W: number, H: number): Promise<Blob | null> {
  const text = l.text.trim();
  if (!text) return null;
  try { await document.fonts.load('bold 40px "Noto Sans Myanmar"', text); } catch { /* fall back */ }
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const font = Math.max(12, Math.round((W * l.size) / 100));
  ctx.font = `bold ${font}px ${l.font ? `"${l.font}", ` : ''}"Noto Sans Myanmar", "Padauk", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  const maxW = W * 0.9;
  // wrap to the frame width
  const words = text.split(/(\s+)/);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if (ctx.measureText(cur + w).width > maxW && cur.trim()) { lines.push(cur.trim()); cur = w.trimStart(); } else cur += w;
  }
  if (cur.trim()) lines.push(cur.trim());
  const lh = Math.round(font * 1.35);
  const cx = (W * l.x) / 100;
  const cy = (H * l.y) / 100;
  const top = cy - ((lines.length - 1) * lh) / 2;
  const lk = l.look && l.look !== 'plain' ? TITLE_LOOKS[l.look] : null;
  if (lk) {
    const w = lk.full ? W : Math.max(...lines.map(s => ctx.measureText(s).width)) + font * 0.9;
    const h = lines.length * lh + font * 0.4;
    ctx.fillStyle = lk.bg;
    ctx.beginPath();
    ctx.roundRect(cx - w / 2, cy - h / 2, w, h, font * lk.radius);
    ctx.fill();
  } else if (l.box) {
    const w = Math.max(...lines.map(s => ctx.measureText(s).width)) + font * 0.8;
    const h = lines.length * lh + font * 0.3;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.beginPath();
    ctx.roundRect(cx - w / 2, cy - h / 2, w, h, font * 0.25);
    ctx.fill();
  }
  lines.forEach((s, i) => {
    const y = top + i * lh;
    if (l.stroke && !lk) {
      ctx.lineWidth = Math.max(3, font * 0.14);
      ctx.strokeStyle = '#000000';
      ctx.strokeText(s, cx, y);
    }
    ctx.fillStyle = lk ? lk.fg : l.color;
    ctx.fillText(s, cx, y);
  });
  return await new Promise<Blob | null>(res => canvas.toBlob(b => res(b), 'image/png'));
}

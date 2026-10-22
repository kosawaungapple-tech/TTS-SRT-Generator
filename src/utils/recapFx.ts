/** Edit-tool settings for the recap render (transitions, fades, colour looks, ducking, intro/outro cards, image overlays). */

export type TransitionType =
  | 'none' | 'fade' | 'fadeblack' | 'fadewhite' | 'dissolve' | 'wipeleft' | 'wiperight'
  | 'slideleft' | 'slideright' | 'slideup' | 'slidedown' | 'circleopen' | 'circleclose'
  | 'zoomin' | 'pixelize' | 'radial' | 'smoothleft';

export type FilterName = 'none' | 'cinematic' | 'warm' | 'cool' | 'bw' | 'vivid' | 'vintage' | 'matte' | 'sharp';

export interface CardCfg {
  on: boolean;
  title: string;
  sub: string;
  /** seconds */
  dur: number;
  bg: string;
  color: string;
}

export interface RecapFx {
  transition: { type: TransitionType; dur: number };
  fadeIn: number;
  fadeOut: number;
  filter: FilterName;
  duck: { on: boolean; strength: 'soft' | 'normal' | 'strong' };
  intro: CardCfg;
  outro: CardCfg;
}

export const defaultFx = (): RecapFx => ({
  transition: { type: 'none', dur: 0.5 },
  fadeIn: 0,
  fadeOut: 0,
  filter: 'none',
  duck: { on: true, strength: 'normal' },
  intro: { on: false, title: '', sub: '', dur: 2.5, bg: '#0b1020', color: '#ffffff' },
  outro: { on: false, title: 'Subscribe', sub: '', dur: 3, bg: '#0b1020', color: '#fbbf24' },
});

/** True when nothing beyond the basic render is asked for (an older PC worker is then good enough). */
export function fxIsDefault(fx: RecapFx): boolean {
  return fx.transition.type === 'none' && !fx.fadeIn && !fx.fadeOut && fx.filter === 'none' && !fx.intro.on && !fx.outro.on
    && fx.duck.on && fx.duck.strength === 'normal';
}

/** Rough CSS look-alikes of the render filters, for the preview only. */
export const FILTER_CSS: Record<FilterName, string> = {
  none: '',
  cinematic: 'contrast(1.12) saturate(0.9) sepia(0.12) hue-rotate(-8deg)',
  warm: 'sepia(0.28) saturate(1.1) hue-rotate(-8deg)',
  cool: 'saturate(1.05) hue-rotate(12deg) brightness(1.02)',
  bw: 'grayscale(1) contrast(1.1)',
  vivid: 'saturate(1.45) contrast(1.08)',
  vintage: 'sepia(0.45) contrast(0.95) saturate(0.85)',
  matte: 'contrast(0.9) brightness(1.04) saturate(0.8)',
  sharp: 'contrast(1.06)',
};

export const TRANSITIONS: { id: TransitionType; en: string; mm: string }[] = [
  { id: 'none', en: 'None', mm: 'မရှိ' },
  { id: 'fade', en: 'Fade', mm: 'Fade' },
  { id: 'dissolve', en: 'Dissolve', mm: 'Dissolve' },
  { id: 'fadeblack', en: 'Dip to black', mm: 'အမည်းဖြတ်' },
  { id: 'fadewhite', en: 'Dip to white', mm: 'အဖြူဖြတ်' },
  { id: 'slideleft', en: 'Slide left', mm: 'ဘယ်လျှောင်' },
  { id: 'slideright', en: 'Slide right', mm: 'ညာလျှောင်' },
  { id: 'slideup', en: 'Slide up', mm: 'အပေါ်လျှောင်' },
  { id: 'slidedown', en: 'Slide down', mm: 'အောက်လျှောင်' },
  { id: 'wipeleft', en: 'Wipe left', mm: 'ဘယ်သုတ်' },
  { id: 'wiperight', en: 'Wipe right', mm: 'ညာသုတ်' },
  { id: 'circleopen', en: 'Circle open', mm: 'စက်ဝိုင်းဖွင့်' },
  { id: 'circleclose', en: 'Circle close', mm: 'စက်ဝိုင်းပိတ်' },
  { id: 'zoomin', en: 'Zoom in', mm: 'Zoom ဝင်' },
  { id: 'radial', en: 'Radial', mm: 'Radial' },
  { id: 'pixelize', en: 'Pixelize', mm: 'Pixel' },
  { id: 'smoothleft', en: 'Smooth left', mm: 'ညင်သာစွာ ဘယ်' },
];

export const FILTERS: { id: FilterName; en: string; mm: string }[] = [
  { id: 'none', en: 'Original', mm: 'မူရင်း' },
  { id: 'cinematic', en: 'Cinematic', mm: 'Cinematic' },
  { id: 'warm', en: 'Warm', mm: 'နွေး' },
  { id: 'cool', en: 'Cool', mm: 'အေး' },
  { id: 'bw', en: 'Black & white', mm: 'အဖြူအမည်း' },
  { id: 'vivid', en: 'Vivid', mm: 'ရောင်စုံ' },
  { id: 'vintage', en: 'Vintage', mm: 'Vintage' },
  { id: 'matte', en: 'Matte', mm: 'Matte' },
  { id: 'sharp', en: 'Sharpen', mm: 'ပိုကြည်' },
];

function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const lines: string[] = [];
  let cur = '';
  for (const w of text.split(/(\s+)/)) {
    if (ctx.measureText(cur + w).width > maxW && cur.trim()) { lines.push(cur.trim()); cur = w.trimStart(); } else cur += w;
  }
  if (cur.trim()) lines.push(cur.trim());
  return lines;
}

/** Intro / outro card: a full-frame PNG with a coloured background, a big title and a smaller line under it. */
export async function renderCardPng(c: CardCfg, W: number, H: number): Promise<Blob | null> {
  if (!c.on || (!c.title.trim() && !c.sub.trim())) return null;
  try { await document.fonts.load('bold 40px "Noto Sans Myanmar"', c.title + c.sub); } catch { /* fall back */ }
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, c.bg);
  g.addColorStop(1, '#000000');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const tFont = Math.round(W * 0.085), sFont = Math.round(W * 0.045);
  ctx.font = `bold ${tFont}px "Noto Sans Myanmar", "Padauk", sans-serif`;
  const tLines = c.title.trim() ? wrap(ctx, c.title.trim(), W * 0.85) : [];
  ctx.font = `${sFont}px "Noto Sans Myanmar", "Padauk", sans-serif`;
  const sLines = c.sub.trim() ? wrap(ctx, c.sub.trim(), W * 0.85) : [];
  const tlh = Math.round(tFont * 1.4), slh = Math.round(sFont * 1.5);
  const total = tLines.length * tlh + (tLines.length && sLines.length ? tFont * 0.5 : 0) + sLines.length * slh;
  let y = H / 2 - total / 2 + tlh / 2;
  ctx.fillStyle = c.color;
  ctx.font = `bold ${tFont}px "Noto Sans Myanmar", "Padauk", sans-serif`;
  for (const l of tLines) { ctx.fillText(l, W / 2, y); y += tlh; }
  if (tLines.length && sLines.length) y += tFont * 0.5;
  ctx.fillStyle = 'rgba(255,255,255,0.82)';
  ctx.font = `${sFont}px "Noto Sans Myanmar", "Padauk", sans-serif`;
  for (const l of sLines) { ctx.fillText(l, W / 2, y - tlh / 2 + slh / 2); y += slh; }
  return await new Promise<Blob | null>(res => canvas.toBlob(b => res(b), 'image/png'));
}

export interface ImageOverlay {
  id: number;
  name: string;
  url: string;
  start: number;
  end: number;
  /** centre, % of the frame */
  x: number;
  y: number;
  /** width as % of the frame width */
  size: number;
  /** 0.1 - 1 */
  opacity: number;
  anim: 'none' | 'fade' | 'slide';
}

export function newImageOverlay(id: number, file: File, duration: number): ImageOverlay {
  return { id, name: file.name, url: URL.createObjectURL(file), start: 0, end: Math.min(4, Math.max(1.5, duration)), x: 85, y: 12, size: 18, opacity: 1, anim: 'fade' };
}

/** Draws an image sticker / logo / PiP picture on a transparent full-frame PNG (laid over the video between start and end). */
export async function renderImageOverlayPng(o: ImageOverlay, W: number, H: number): Promise<Blob | null> {
  try {
    const img = new Image();
    img.src = o.url;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const w = (W * o.size) / 100;
    const h = (w * img.naturalHeight) / Math.max(1, img.naturalWidth);
    ctx.globalAlpha = Math.max(0.05, Math.min(1, o.opacity));
    ctx.drawImage(img, (W * o.x) / 100 - w / 2, (H * o.y) / 100 - h / 2, w, h);
    return await new Promise<Blob | null>(res => canvas.toBlob(b => res(b), 'image/png'));
  } catch {
    return null;
  }
}

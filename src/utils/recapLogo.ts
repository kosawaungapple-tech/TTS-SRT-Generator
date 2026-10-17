export type LogoPosition = 'tl' | 'tr' | 'bl' | 'br';

export interface LogoSpec {
  image: HTMLImageElement | null;
  text: string;
  position: LogoPosition;
  /** Logo width as a percentage of the frame width. */
  sizePct: number;
  /** 0.1 - 1 */
  opacity: number;
}

export function loadLogoImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read the logo image')); };
    img.src = url;
  });
}

/** Draws the logo (image and/or text) on a transparent full-frame PNG that the render worker lays over the video. */
export async function renderLogoPng(spec: LogoSpec, W: number, H: number): Promise<Blob | null> {
  if (!spec.image && !spec.text.trim()) return null;
  try { await document.fonts.load('bold 40px "Noto Sans Myanmar"', spec.text || 'A'); } catch { /* fall back */ }
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.globalAlpha = Math.max(0.1, Math.min(1, spec.opacity));

  const margin = Math.round(W * 0.03);
  const boxW = Math.round((W * spec.sizePct) / 100);
  let imgW = 0, imgH = 0;
  if (spec.image) {
    imgW = boxW;
    imgH = Math.round(boxW * (spec.image.naturalHeight / Math.max(1, spec.image.naturalWidth)));
  }
  const fontSize = Math.max(14, Math.round(boxW * 0.28));
  const text = spec.text.trim();
  let textW = 0;
  if (text) {
    ctx.font = `bold ${fontSize}px "Noto Sans Myanmar", "Padauk", sans-serif`;
    textW = ctx.measureText(text).width;
  }
  const gap = spec.image && text ? Math.round(fontSize * 0.3) : 0;
  const textH = text ? Math.round(fontSize * 1.3) : 0;
  const blockW = Math.max(imgW, textW);
  const blockH = imgH + gap + textH;
  const x0 = spec.position === 'tl' || spec.position === 'bl' ? margin : W - margin - blockW;
  const y0 = spec.position === 'tl' || spec.position === 'tr' ? margin : H - margin - blockH;

  if (spec.image) ctx.drawImage(spec.image, x0 + (blockW - imgW) / 2, y0, imgW, imgH);
  if (text) {
    ctx.font = `bold ${fontSize}px "Noto Sans Myanmar", "Padauk", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const cx = x0 + blockW / 2;
    const cy = y0 + imgH + gap + textH / 2;
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(3, fontSize * 0.14);
    ctx.strokeStyle = '#000000';
    ctx.strokeText(text, cx, cy);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, cx, cy);
  }
  return await new Promise<Blob | null>(res => canvas.toBlob(b => res(b), 'image/png'));
}

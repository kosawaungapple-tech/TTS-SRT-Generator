import { wrapTextIntoLines } from './subtitleUtils';

/**
 * Subtitle look shared by the editor preview and the server-rendered recap.
 * The preview draws with this exact function, and the recap renders every subtitle
 * line to a transparent PNG with it, so what you see in the editor is what the
 * render machine overlays (same font, size, colours, stroke, box and position),
 * even if that machine has none of the fonts installed.
 */
export interface SubtitleStyle {
  /** Font size in px on a 1280px-wide canvas (scaled with the real canvas width). */
  fontSize: number;
  /** CSS font-family list, e.g. '"Noto Sans Myanmar", sans-serif'. */
  fontFamily: string;
  fontColor: string;
  strokeColor: string;
  /** Stroke width in px on a 1280px-wide canvas. 0 = no stroke. */
  strokeWidth: number;
  bgBoxEnabled: boolean;
  /** Any CSS colour, e.g. 'rgba(0,0,0,0.7)'. */
  bgBoxColor: string;
  /** Vertical centre of the subtitle block, in percent of the canvas height. */
  positionY: number;
}

export function drawSubtitleOverlay(
  ctx: CanvasRenderingContext2D,
  canvasW: number,
  canvasH: number,
  text: string,
  style: SubtitleStyle
): void {
  if (!text || !text.trim()) return;

  ctx.save();

  const scaleMultiplier = canvasW / 1280;
  const scaledFontSize = Math.round(style.fontSize * scaleMultiplier);
  ctx.font = `bold ${scaledFontSize}px ${style.fontFamily}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Auto-wrap lines that are too wide for the video frame or contain long unbroken text
  const rawLines = text.split('\n');
  const maxAllowedWidth = canvasW * 0.86;
  const lines: string[] = [];
  rawLines.forEach(l => {
    const trimmed = l.trim();
    if (!trimmed) return;
    if (ctx.measureText(trimmed).width <= maxAllowedWidth && trimmed.length <= 36) {
      lines.push(trimmed);
    } else {
      lines.push(...wrapTextIntoLines(trimmed, 30, 2));
    }
  });
  if (lines.length === 0) lines.push(text);
  const lineHeight = scaledFontSize * 1.35;
  const totalTextHeight = lines.length * lineHeight;
  const posY = canvasH * (style.positionY / 100);

  let maxLineWidth = 0;
  lines.forEach(line => {
    const m = ctx.measureText(line);
    if (m.width > maxLineWidth) maxLineWidth = m.width;
  });

  if (style.bgBoxEnabled && maxLineWidth > 0) {
    const boxPaddingX = 24 * scaleMultiplier;
    const boxPaddingY = 12 * scaleMultiplier;
    const boxW = maxLineWidth + boxPaddingX * 2;
    const boxH = totalTextHeight + boxPaddingY * 2;
    const boxX = (canvasW - boxW) / 2;
    const boxY = posY - totalTextHeight / 2 - boxPaddingY;
    const radius = 12 * scaleMultiplier;

    ctx.save();
    ctx.fillStyle = style.bgBoxColor;
    ctx.beginPath();
    ctx.roundRect(boxX, boxY, boxW, boxH, radius);
    ctx.fill();
    ctx.restore();
  }

  lines.forEach((line, lIdx) => {
    const lineY = posY - totalTextHeight / 2 + lIdx * lineHeight + lineHeight / 2;

    if (style.strokeWidth > 0) {
      ctx.strokeStyle = style.strokeColor;
      ctx.lineWidth = style.strokeWidth * scaleMultiplier;
      ctx.lineJoin = 'round';
      ctx.miterLimit = 2;
      ctx.strokeText(line, canvasW / 2, lineY);
    }

    ctx.fillStyle = style.fontColor;
    ctx.fillText(line, canvasW / 2, lineY);
  });

  ctx.restore();
}

/** Make sure the page has the font ready before drawing it on a canvas. */
async function ensureFont(style: SubtitleStyle, canvasW: number, sample: string): Promise<void> {
  try {
    const size = Math.round(style.fontSize * (canvasW / 1280));
    await document.fonts.load(`bold ${size}px ${style.fontFamily}`, sample);
    await document.fonts.ready;
  } catch {
    /* font API unavailable: canvas falls back to the next family */
  }
}

/** Renders one subtitle to a transparent full-canvas PNG. */
export async function renderSubtitlePng(
  text: string,
  canvasW: number,
  canvasH: number,
  style: SubtitleStyle
): Promise<Blob> {
  await ensureFont(style, canvasW, text);
  const canvas = document.createElement('canvas');
  canvas.width = canvasW;
  canvas.height = canvasH;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is not available for subtitle rendering');
  drawSubtitleOverlay(ctx, canvasW, canvasH, text, style);
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Could not encode subtitle image'))), 'image/png');
  });
}

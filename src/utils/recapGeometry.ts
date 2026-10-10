import type { SubtitleStyle } from './subtitleOverlay';

export type RecapFramingMode = 'blurred-fit' | 'letterbox' | 'cover' | 'contain';

const OUTPUT_SIZES: Record<string, [number, number]> = {
  '16:9': [1920, 1080],
  '9:16': [1080, 1920],
  '1:1': [1080, 1080],
  '4:5': [1080, 1350],
  '4:3': [1440, 1080],
  '21:9': [2560, 1080],
};

/** Output frame size for the chosen aspect ratio ('original' keeps the source size). */
export function getRecapOutputSize(aspectRatio: string, sourceW: number, sourceH: number): [number, number] {
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  const size = OUTPUT_SIZES[aspectRatio];
  if (size) return [size[0], size[1]];
  return [even(sourceW || 1920), even(sourceH || 1080)];
}

export interface SubtitlePiece {
  text: string;
  /** Start/end as a fraction (0..1) of the scene narration. */
  from: number;
  to: number;
}

/**
 * Splits one narration into subtitle-sized pieces, with timing proportional to text length.
 * `splitBlocks` is the same splitter the editor uses for "Sync Subtitles".
 */
export function planSubtitlePieces(
  narration: string,
  splitBlocks: (sentence: string, maxChars: number, maxLineChars: number) => string[][]
): SubtitlePiece[] {
  const sentences = narration
    .split(/[။\n]+|(?<=[.!?])\s+/u)
    .map(s => s.trim())
    .filter(Boolean);

  const texts: string[] = [];
  for (const sentence of sentences) {
    for (const lines of splitBlocks(sentence, 52, 30)) {
      const joined = lines.join('\n').trim();
      if (joined) texts.push(joined);
    }
  }
  if (texts.length === 0) return [];

  const weights = texts.map(t => Math.max(1, [...t.replace(/\s+/g, '')].length));
  const total = weights.reduce((a, b) => a + b, 0);
  let acc = 0;
  return texts.map((text, i) => {
    const from = acc / total;
    acc += weights[i];
    return { text, from, to: acc / total };
  });
}

export type { SubtitleStyle };

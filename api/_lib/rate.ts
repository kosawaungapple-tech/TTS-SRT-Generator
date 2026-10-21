import type { VercelRequest } from '@vercel/node';

// Best-effort limiter (memory of one serverless instance). It slows down guessing; it is not a hard guarantee.
const hits = new Map<string, number[]>();

export function clientIp(req: VercelRequest): string {
  const xf = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return xf || String(req.socket?.remoteAddress || 'unknown');
}

export function tooMany(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const list = (hits.get(key) || []).filter(t => now - t < windowMs);
  list.push(now);
  hits.set(key, list);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some(t => now - t < windowMs)) hits.delete(k);
  return list.length > max;
}

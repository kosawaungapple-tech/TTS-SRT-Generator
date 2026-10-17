/**
 * Pitch-preserving time stretch (WSOLA) for speech.
 * rate > 1 = faster/shorter, rate < 1 = slower/longer. Plain resampling (playbackRate) also raises
 * the pitch, which made sped-up narration scenes sound like a different person.
 */
export function wsolaStretch(x: Float32Array, rate: number, sampleRate: number): Float32Array {
  if (!x.length || Math.abs(rate - 1) < 0.005) return x;
  const frame = Math.max(256, Math.round(sampleRate * 0.04)) & ~1; // ~40 ms
  const hop = frame / 2;
  const anaHop = hop * rate;
  const seek = Math.round(sampleRate * 0.012);
  const outLen = Math.ceil(x.length / rate);
  const out = new Float32Array(outLen + frame * 2);
  const win = new Float32Array(frame);
  for (let i = 0; i < frame; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / frame);

  let prev = 0;
  for (let k = 0; ; k++) {
    const outPos = k * hop;
    if (outPos >= outLen) break;
    const nominal = Math.round(k * anaHop);
    if (nominal >= x.length) break;
    let best = nominal;
    const tgt = prev + hop;
    if (k > 0 && tgt + frame < x.length) {
      let bestC = -Infinity;
      for (let d = -seek; d <= seek; d += 2) {
        const s = nominal + d;
        if (s < 0 || s + frame >= x.length) continue;
        let c = 0;
        for (let i = 0; i < frame; i += 4) c += x[s + i] * x[tgt + i];
        if (c > bestC) { bestC = c; best = s; }
      }
    }
    const lim = Math.min(frame, x.length - best);
    for (let i = 0; i < lim; i++) out[outPos + i] += x[best + i] * win[i];
    prev = best;
  }
  return out.subarray(0, outLen);
}

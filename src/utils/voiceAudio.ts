import { audioBufferToWav } from './audioUtils';

/** Decode any browser-playable audio, mix to mono, resample to 24 kHz and encode 16-bit WAV (what Gemini voice replication expects). */
export async function toMono24kWavBase64(source: Blob, maxSeconds = 20): Promise<{ base64: string; seconds: number }> {
  const AC = (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext) as typeof AudioContext;
  const ctx = new AC();
  let decoded: AudioBuffer;
  try {
    decoded = await ctx.decodeAudioData(await source.arrayBuffer());
  } finally {
    await ctx.close();
  }
  const seconds = Math.min(decoded.duration, maxSeconds);
  const rate = 24000;
  const off = new OfflineAudioContext(1, Math.max(1, Math.ceil(seconds * rate)), rate);
  const src = off.createBufferSource();
  src.buffer = decoded;
  src.connect(off.destination);
  src.start(0);
  const rendered = await off.startRendering();
  const wav = audioBufferToWav(rendered);
  const bytes = new Uint8Array(await wav.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { base64: btoa(bin), seconds };
}

/**
 * Pulls the sound out of a video/audio file as a small mono 16 kHz WAV (about 2 MB per minute)
 * so speech-to-text uploads stay small instead of sending the whole video from a phone.
 * Returns null when the browser cannot decode the file (caller should upload the original).
 */
export async function extractSpeechWav(source: Blob, rate = 16000): Promise<Blob | null> {
  try {
    const AC = (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext) as typeof AudioContext;
    const ctx = new AC();
    let decoded: AudioBuffer;
    try {
      decoded = await ctx.decodeAudioData(await source.arrayBuffer());
    } finally {
      await ctx.close();
    }
    const off = new OfflineAudioContext(1, Math.max(1, Math.ceil(decoded.duration * rate)), rate);
    const src = off.createBufferSource();
    src.buffer = decoded;
    src.connect(off.destination);
    src.start(0);
    return audioBufferToWav(await off.startRendering());
  } catch {
    return null;
  }
}

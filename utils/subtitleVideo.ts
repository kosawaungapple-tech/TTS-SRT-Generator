import { drawSubtitleOverlay, ensureFont, type SubtitleStyle } from './subtitleOverlay';

export interface TimedSubtitle { start: number; end: number; text: string }

export interface SubtitleVideoOptions {
  subtitles: TimedSubtitle[];
  /** Narration to mix in (decoded). Optional: omit for a silent overlay. */
  audio?: AudioBuffer;
  duration: number;
  width: number;
  height: number;
  style: SubtitleStyle;
  /** 'black' -> use CapCut blend mode "Screen"; 'green' -> use Chroma key. */
  background: 'black' | 'green';
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

export function pickRecorderMime(): { mime: string; ext: 'mp4' | 'webm' } | null {
  if (typeof MediaRecorder === 'undefined') return null;
  const candidates: Array<[string, 'mp4' | 'webm']> = [
    ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'mp4'],
    ['video/mp4;codecs=avc1', 'mp4'],
    ['video/mp4', 'mp4'],
    ['video/webm;codecs=vp9,opus', 'webm'],
    ['video/webm;codecs=vp8,opus', 'webm'],
    ['video/webm', 'webm'],
  ];
  for (const [mime, ext] of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(mime)) return { mime, ext };
    } catch { /* try next */ }
  }
  return null;
}

/**
 * Renders the subtitles as a video (text on a flat colour) in real time with MediaRecorder.
 * CapCut on a phone cannot import .srt files, but it accepts any video: add this one as an overlay
 * and set Blend = Screen (black background) or Chroma key (green background).
 * Real time: the page has to stay open for as long as the video is long.
 */
export async function renderSubtitleVideo(o: SubtitleVideoOptions): Promise<{ blob: Blob; ext: 'mp4' | 'webm' }> {
  const rec = pickRecorderMime();
  if (!rec) throw new Error('This browser cannot record video (MediaRecorder missing).');
  const canvas = document.createElement('canvas');
  canvas.width = o.width;
  canvas.height = o.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is not available');
  const bg = o.background === 'green' ? '#00ff00' : '#000000';

  await Promise.all(o.subtitles.map(s => ensureFont(o.style, o.width, s.text).catch(() => undefined)));

  const paint = (t: number) => {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, o.width, o.height);
    const cue = o.subtitles.find(s => t >= s.start && t < s.end);
    if (cue) drawSubtitleOverlay(ctx, o.width, o.height, cue.text, o.style);
  };
  paint(0);

  const stream = canvas.captureStream(30);
  let audioCtx: AudioContext | null = null;
  let src: AudioBufferSourceNode | null = null;
  if (o.audio) {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    audioCtx = new Ctx();
    if (audioCtx.state === 'suspended') await audioCtx.resume().catch(() => undefined);
    const dest = audioCtx.createMediaStreamDestination();
    src = audioCtx.createBufferSource();
    src.buffer = o.audio;
    src.connect(dest);
    dest.stream.getAudioTracks().forEach(tr => stream.addTrack(tr));
  }

  const chunks: Blob[] = [];
  const recorder = new MediaRecorder(stream, { mimeType: rec.mime, videoBitsPerSecond: 2_500_000 });
  recorder.ondataavailable = e => {
    if (e.data && e.data.size) chunks.push(e.data);
  };
  const stopped = new Promise<void>(resolve => {
    recorder.onstop = () => resolve();
  });

  recorder.start(1000);
  src?.start();
  const t0 = performance.now();
  await new Promise<void>((resolve, reject) => {
    const tick = () => {
      if (o.signal?.aborted) {
        reject(new Error('Cancelled'));
        return;
      }
      const t = (performance.now() - t0) / 1000;
      paint(t);
      o.onProgress?.(Math.min(1, t / o.duration));
      if (t >= o.duration) resolve();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }).catch(e => {
    try { recorder.stop(); } catch { /* ignore */ }
    throw e;
  });
  recorder.stop();
  await stopped;
  stream.getTracks().forEach(tr => tr.stop());
  try { src?.stop(); } catch { /* already ended */ }
  void audioCtx?.close();

  const blob = new Blob(chunks, { type: rec.mime.split(';')[0] });
  if (!blob.size) throw new Error('The recording came out empty');
  return { blob, ext: rec.ext };
}

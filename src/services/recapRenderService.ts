import type { GeminiTTSService, RecapPlanScene } from './geminiService';
import type { TTSConfig } from '../types';

/**
 * Client side of the scene-based recap pipeline:
 *   scenes (from generateRecapPlan) -> one TTS clip per scene -> /api/recap/render
 * The server fits each scene's footage to the real length of its narration.
 */

const RENDER_URL_KEY = 'vbs_render_server_url';

/** Base URL of the machine running server.ts + ffmpeg ('' = same origin). */
export function getRenderServerUrl(): string {
  try {
    return (localStorage.getItem(RENDER_URL_KEY) || '').trim().replace(/\/+$/, '');
  } catch {
    return '';
  }
}

export function setRenderServerUrl(url: string): void {
  try {
    localStorage.setItem(RENDER_URL_KEY, url.trim().replace(/\/+$/, ''));
  } catch {
    /* storage unavailable */
  }
}

export interface SceneRecapRenderParams {
  gemini: GeminiTTSService;
  videoFile: File | Blob;
  videoFileName?: string;
  scenes: RecapPlanScene[];
  tts: TTSConfig;
  aspectRatio?: string;
  burnSubtitles?: boolean;
  fontFamily?: string;
  fontSize?: number;
  fontColor?: string;
  strokeColor?: string;
  fontFile?: Blob;
  serverUrl?: string;
  onProgress?: (done: number, total: number, message: string) => void;
  onRetry?: (seconds: number, message: string) => void;
  signal?: AbortSignal;
}

export interface SceneRecapRenderResult {
  downloadUrl: string;
  duration: number;
  sceneDurations: number[];
}

export async function renderSceneRecap(p: SceneRecapRenderParams): Promise<SceneRecapRenderResult> {
  const { scenes } = p;
  if (!scenes.length) throw new Error('No scenes to render');

  // 1) One narration clip per scene, so the server knows each line's real length.
  const audios: Blob[] = [];
  for (let i = 0; i < scenes.length; i++) {
    if (p.signal?.aborted) throw new Error('Cancelled');
    p.onProgress?.(i, scenes.length + 1, `Voiceover ${i + 1}/${scenes.length}`);
    const result = await p.gemini.generateTTS(scenes[i].narration, p.tts, undefined, undefined, p.onRetry);
    if (!result?.audioUrl) throw new Error(`No audio returned for scene ${i + 1}`);
    const blob = await (await fetch(result.audioUrl)).blob();
    if (blob.size === 0) throw new Error(`Empty audio for scene ${i + 1}`);
    audios.push(blob);
  }

  // 2) Send everything to the render server.
  p.onProgress?.(scenes.length, scenes.length + 1, 'Rendering video on server...');
  const form = new FormData();
  form.append('video', p.videoFile, p.videoFileName || 'video.mp4');
  form.append(
    'scenes',
    JSON.stringify(scenes.map(s => ({ start: s.start, end: s.end, narration: s.narration })))
  );
  audios.forEach((b, i) => form.append(`audio_${i}`, b, `scene_${i}.wav`));
  if (p.aspectRatio) form.append('aspectRatio', p.aspectRatio);
  form.append('burnSubtitles', String(Boolean(p.burnSubtitles)));
  if (p.fontFamily) form.append('fontFamily', p.fontFamily);
  if (p.fontSize) form.append('fontSize', String(p.fontSize));
  if (p.fontColor) form.append('fontColor', p.fontColor);
  if (p.strokeColor) form.append('strokeColor', p.strokeColor);
  if (p.fontFile) form.append('fontFile', p.fontFile, 'custom.ttf');

  const base = (p.serverUrl ?? getRenderServerUrl()).replace(/\/+$/, '');
  let resp: Response;
  try {
    resp = await fetch(`${base}/api/recap/render`, { method: 'POST', body: form, signal: p.signal });
  } catch (e) {
    const where = base || 'this site';
    throw new Error(
      `Cannot reach the render server (${where}). Start server.ts on your PC and set its URL ` +
        `(e.g. http://localhost:3000) as the render server. ${e instanceof Error ? e.message : ''}`
    );
  }

  let data: { success?: boolean; error?: string; downloadUrl?: string; duration?: number; sceneDurations?: number[] } = {};
  try {
    data = await resp.json();
  } catch {
    /* non-JSON error page (for example a 404 from a host with no render route) */
  }
  if (!resp.ok || !data.success || !data.downloadUrl) {
    throw new Error(data.error || `Render server returned HTTP ${resp.status}`);
  }

  p.onProgress?.(scenes.length + 1, scenes.length + 1, 'Done');
  return {
    downloadUrl: data.downloadUrl.startsWith('http') ? data.downloadUrl : `${base}${data.downloadUrl}`,
    duration: data.duration ?? 0,
    sceneDurations: data.sceneDurations ?? [],
  };
}

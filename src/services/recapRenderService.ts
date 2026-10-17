import type { GeminiTTSService, RecapPlanScene } from './geminiService';
import type { TTSConfig } from '../types';
import { WorkerEngineService } from './workerEngineService';
import { renderSubtitlePng, type SubtitleStyle } from '../utils/subtitleOverlay';
import { planSubtitlePieces, type RecapFramingMode } from '../utils/recapGeometry';
import { splitSentenceIntoCueBlocks } from '../utils/subtitleUtils';

/**
 * Client side of the scene-based recap pipeline:
 *   scenes (from generateRecapPlan) -> one TTS clip per scene -> subtitle images drawn here
 *   with the editor's own subtitle code -> /api/recap/render
 * The render machine fits each scene's footage to the real length of its narration, frames it
 * like the editor preview and overlays the subtitle images, so no fonts are needed there.
 */

/**
 * Where the render happens: the same FFmpeg Worker the rest of the app uses
 * (default http://localhost:5005, set in the Worker settings). The worker (or server.ts)
 * must expose POST /api/recap/render.
 */
export function getRenderServerUrl(): string {
  return WorkerEngineService.getWorkerUrl().replace(/\/+$/, '');
}

export interface SceneRecapRenderParams {
  gemini: GeminiTTSService;
  videoFile: File | Blob;
  videoFileName?: string;
  scenes: RecapPlanScene[];
  tts: TTSConfig;
  /** Already generated narration (one WAV per scene); skips the TTS step. */
  audios?: Blob[];
  /** Output frame size, e.g. from getRecapOutputSize(). */
  outputWidth: number;
  outputHeight: number;
  aspectRatio?: string;
  framing: RecapFramingMode;
  blurAmount: number;
  /** Bar colour for letterbox / contain. */
  bgColor: string;
  /** Subtitle look (same object the editor preview uses). null = no subtitles. */
  subtitleStyle: SubtitleStyle | null;
  /** Transparent full-frame PNG with the logo, laid over the finished video. */
  logoPng?: Blob | null;
  /** Background music (your own / licensed file) mixed under the voice. */
  /** Blur a horizontal band of the SOURCE video (its burned-in subtitles). y/h are fractions of the frame height. */
  subtitleBlur?: { y: number; h: number } | null;
  bgm?: File | null;
  /** 0.02 - 1 */
  bgmVolume?: number;
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
  const totalSteps = scenes.length * 2 + 1;
  let step = 0;

  // 1) One narration clip per scene, so the server knows each line's real length.
  const audios: Blob[] = p.audios && p.audios.length === scenes.length ? [...p.audios] : [];
  for (let i = 0; i < scenes.length && audios.length < scenes.length; i++) {
    if (p.signal?.aborted) throw new Error('Cancelled');
    p.onProgress?.(step++, totalSteps, `Voiceover ${i + 1}/${scenes.length}`);
    const result = await p.gemini.generateTTS(scenes[i].narration, p.tts, undefined, undefined, p.onRetry);
    if (!result?.audioUrl) throw new Error(`No audio returned for scene ${i + 1}`);
    const blob = await (await fetch(result.audioUrl)).blob();
    if (blob.size === 0) throw new Error(`Empty audio for scene ${i + 1}`);
    audios.push(blob);
  }

  // 2) Subtitle images, drawn here so they look exactly like the editor preview.
  const subtitleImages: Array<{ scene: number; index: number; blob: Blob }> = [];
  const sceneSubs: Array<Array<{ from: number; to: number }>> = scenes.map(() => []);
  if (p.subtitleStyle) {
    for (let i = 0; i < scenes.length; i++) {
      if (p.signal?.aborted) throw new Error('Cancelled');
      p.onProgress?.(step++, totalSteps, `Subtitles ${i + 1}/${scenes.length}`);
      const pieces = planSubtitlePieces(scenes[i].narration, splitSentenceIntoCueBlocks);
      for (let j = 0; j < pieces.length; j++) {
        const blob = await renderSubtitlePng(pieces[j].text, p.outputWidth, p.outputHeight, p.subtitleStyle);
        subtitleImages.push({ scene: i, index: j, blob });
        sceneSubs[i].push({ from: pieces[j].from, to: pieces[j].to });
      }
    }
  } else {
    step += scenes.length;
  }

  // 3a) The worker must be new enough for the features asked for (an old one silently ignores them).
  {
    const need = p.subtitleBlur ? '1.6.0' : p.bgm ? '1.5.0' : p.logoPng ? '1.4.0' : '';
    if (need) {
      try {
        const hb = (p.serverUrl ?? getRenderServerUrl()).replace(/\/+$/, '');
        const h = await fetch(`${hb}/health`).then(r => r.json());
        const parse = (v?: string) => (v || '0').split('.').map(n => parseInt(n, 10) || 0);
        const a = parse(h?.version), b = parse(need);
        let ok = true;
        for (let i = 0; i < 3; i++) { if ((a[i] || 0) !== (b[i] || 0)) { ok = (a[i] || 0) > (b[i] || 0); break; } }
        if (!ok) {
          throw new Error(
            `Your PC worker is v${h?.version || 'old'}, but blur / BGM / logo need v${need} or newer. ` +
              `Download the latest vbs-ffmpeg-worker.js, close the old worker and start it again. ` +
              `သင့် PC worker က version အဟောင်းဖြစ်နေလို့ blur/BGM/logo မပါပါဘူး — vbs-ffmpeg-worker.js အသစ်ကို ပြန်ယူပြီး အဟောင်းကို ပိတ်ကာ ပြန်စပါ။`
          );
        }
      } catch (e) {
        if (e instanceof Error && e.message.startsWith('Your PC worker')) throw e;
        /* health unreachable: the render request below reports that */
      }
    }
  }

  // 3) Send everything to the render server.
  p.onProgress?.(step, totalSteps, 'Rendering video...');
  const form = new FormData();
  form.append('video', p.videoFile, p.videoFileName || 'video.mp4');
  form.append(
    'scenes',
    JSON.stringify(scenes.map((s, i) => ({ start: s.start, end: s.end, narration: s.narration, subs: sceneSubs[i] })))
  );
  audios.forEach((b, i) => form.append(`audio_${i}`, b, `scene_${i}.wav`));
  subtitleImages.forEach(s => form.append(`sub_${s.scene}_${s.index}`, s.blob, `sub_${s.scene}_${s.index}.png`));
  if (p.logoPng) form.append('logo', p.logoPng, 'logo.png');
  if (p.subtitleBlur) {
    form.append('blurBandY', String(p.subtitleBlur.y));
    form.append('blurBandH', String(p.subtitleBlur.h));
  }
  if (p.bgm) {
    form.append('bgm', p.bgm, p.bgm.name || 'bgm.mp3');
    form.append('bgmVolume', String(p.bgmVolume ?? 0.2));
  }
  form.append('outWidth', String(p.outputWidth));
  form.append('outHeight', String(p.outputHeight));
  if (p.aspectRatio) form.append('aspectRatio', p.aspectRatio);
  form.append('framing', p.framing);
  form.append('blurAmount', String(p.blurAmount));
  form.append('bgColor', p.bgColor);

  const base = (p.serverUrl ?? getRenderServerUrl()).replace(/\/+$/, '');
  let resp: Response;
  try {
    resp = await fetch(`${base}/api/recap/render`, { method: 'POST', body: form, signal: p.signal });
  } catch (e) {
    const where = base || 'this site';
    throw new Error(
      `Cannot reach the render worker (${where}). Start vbs-ffmpeg-worker.js on your PC ` +
        `(default http://localhost:5005). A plain-http LAN address cannot be used from this https site. ` +
        `${e instanceof Error ? e.message : ''}`
    );
  }

  let data: { success?: boolean; error?: string; downloadUrl?: string; duration?: number; sceneDurations?: number[] } = {};
  try {
    data = await resp.json();
  } catch {
    /* non-JSON error page (for example a 404 from a host with no render route) */
  }
  if (resp.status === 404 && !data.success) {
    throw new Error(
      'The render worker has no recap endpoint. Download the latest vbs-ffmpeg-worker.js (v1.6.0) and restart it.'
    );
  }
  if (!resp.ok || !data.success || !data.downloadUrl) {
    throw new Error(data.error || `Render server returned HTTP ${resp.status}`);
  }

  p.onProgress?.(totalSteps, totalSteps, 'Done');
  return {
    downloadUrl: data.downloadUrl.startsWith('http') ? data.downloadUrl : `${base}${data.downloadUrl}`,
    duration: data.duration ?? 0,
    sceneDurations: data.sceneDurations ?? [],
  };
}

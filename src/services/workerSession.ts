import { WorkerEngineService } from './workerEngineService';

/**
 * Long videos (movies): the file is sent to the PC worker once (streamed to disk there), then the worker
 * extracts the speech track and later renders from its own copy - the browser never has to hold the whole movie in memory.
 */
const base = () => WorkerEngineService.getWorkerUrl().replace(/\/+$/, '');
const authHeaders = (): Record<string, string> => {
  const key = WorkerEngineService.getWorkerKey();
  return key ? { Authorization: `Bearer ${key}` } : {};
};

/** Videos this big (or this long) go through the worker instead of being read into the browser. */
export const LONG_VIDEO_BYTES = 150 * 1024 * 1024;
export const LONG_VIDEO_SECONDS = 15 * 60;
export const isLongVideo = (file: { size: number }, seconds: number) => file.size > LONG_VIDEO_BYTES || seconds > LONG_VIDEO_SECONDS;

export function uploadVideoToWorker(file: File, onProgress?: (fraction: number) => void, signal?: AbortSignal): Promise<{ videoId: string; duration: number }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${base()}/api/recap/upload`);
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    for (const [k, v] of Object.entries(authHeaders())) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = e => { if (e.lengthComputable) onProgress?.(e.loaded / e.total); };
    xhr.onerror = () => reject(new Error(`Cannot reach the PC worker (${base()}). Start vbs-ffmpeg-worker.js on your PC. (PC Worker ကို မချိတ်နိုင်ပါ)`));
    xhr.onabort = () => reject(new Error('Cancelled'));
    xhr.onload = () => {
      let d: { success?: boolean; videoId?: string; duration?: number; error?: string } = {};
      try { d = JSON.parse(xhr.responseText); } catch { /* not JSON */ }
      if (xhr.status === 404) return reject(new Error('Your PC worker is too old for long videos. Download the latest vbs-ffmpeg-worker.js (v1.12.0) and restart it. (Worker အဟောင်းဖြစ်နေသည် — အသစ်ယူပါ)'));
      if (xhr.status !== 200 || !d.success || !d.videoId) return reject(new Error(d.error || `Upload failed (HTTP ${xhr.status})`));
      resolve({ videoId: d.videoId, duration: d.duration || 0 });
    };
    signal?.addEventListener('abort', () => xhr.abort());
    xhr.send(file);
  });
}

/** Speech track (mono mp3) of an uploaded video, ready for speech-to-text. */
export async function fetchWorkerSpeech(videoId: string): Promise<Blob> {
  const r = await fetch(`${base()}/api/recap/audio`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ videoId }),
  });
  if (!r.ok) {
    const d = await r.json().catch(() => ({} as { error?: string }));
    throw new Error(d.error || `Could not extract the speech (HTTP ${r.status})`);
  }
  return await r.blob();
}

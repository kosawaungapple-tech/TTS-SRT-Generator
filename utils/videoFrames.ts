/**
 * Grabs small JPEG stills from a video file in the browser (no server needed).
 * Used to show Gemini what is actually on screen in each recap scene.
 * Returns base64 strings (no data: prefix). A frame that cannot be read is skipped.
 */
export async function captureVideoFrames(
  file: Blob,
  times: number[],
  maxWidth = 384,
  quality = 0.6
): Promise<string[]> {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.muted = true;
  video.preload = 'auto';
  video.playsInline = true;
  video.src = url;

  const waitFor = (event: 'loadedmetadata' | 'seeked', ms: number) =>
    new Promise<boolean>(resolve => {
      const timer = window.setTimeout(() => {
        video.removeEventListener(event, onEvent);
        resolve(false);
      }, ms);
      const onEvent = () => {
        window.clearTimeout(timer);
        resolve(true);
      };
      video.addEventListener(event, onEvent, { once: true });
    });

  const out: string[] = [];
  try {
    if (video.readyState < 1 && !(await waitFor('loadedmetadata', 10000))) return out;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return out;

    const scale = Math.min(1, maxWidth / vw);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(vw * scale);
    canvas.height = Math.round(vh * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return out;

    for (const t of times) {
      const target = Math.max(0, Math.min((video.duration || t) - 0.05, t));
      const seeked = waitFor('seeked', 6000);
      video.currentTime = target;
      if (!(await seeked)) continue;
      try {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const data = canvas.toDataURL('image/jpeg', quality).split(',')[1];
        if (data) out.push(data);
      } catch {
        /* tainted or undecodable frame: skip */
      }
    }
  } finally {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  }
  return out;
}

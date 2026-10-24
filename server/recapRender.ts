import type express from "express";
import fs from "fs";
import os from "os";
import path from "path";
import { spawn } from "child_process";
import type multer from "multer";

/**
 * Scene-based recap renderer.
 *
 * Input  : one source video, N narration audio files (one per scene), N scene ranges
 *          [{ start, end }] taken from the source video, and optional subtitle images.
 * Output : one MP4 where every scene's footage is fitted to the length of its own
 *          narration (speed-adjusted within limits, then frozen/trimmed), framed exactly
 *          like the editor preview (blurred background / black bars / crop), all scenes
 *          joined, narration laid underneath and the browser-drawn subtitle PNGs on top.
 *
 * Subtitles are PNGs drawn by the browser with the same code as the editor preview, so the
 * font, size, colours, stroke, box and position match what the user sees, and this machine
 * does not need any of the fonts installed.
 */

export type RecapFraming = "blurred-fit" | "letterbox" | "cover" | "contain";

export interface RecapSubtitle {
  /** Start/end as a fraction (0..1) of the scene's narration. */
  from: number;
  to: number;
  /** Path of a full-canvas transparent PNG. */
  file: string;
}

export interface RecapScene {
  start: number;
  end: number;
  narration?: string;
  subs?: RecapSubtitle[];
}

export interface RecapRenderOptions {
  videoPath: string;
  audioPaths: string[];
  scenes: RecapScene[];
  outputPath: string;
  /** Exact output size chosen by the editor. Falls back to aspectRatio, then the source size. */
  outWidth?: number;
  outHeight?: number;
  aspectRatio?: string;
  framing?: RecapFraming;
  /** Editor "Background Blur Amount" (5..45). */
  blurAmount?: number;
  /** Bar colour for letterbox / contain, e.g. "#000000". */
  bgColor?: string;
  /** Silence added after each narration line so cuts don't feel rushed. */
  paddingSeconds?: number;
  /** Footage is never sped up / slowed down more than this around 1.0x. */
  minSpeed?: number;
  maxSpeed?: number;
  fps?: number;
}

const RESOLUTIONS: Record<string, [number, number]> = {
  "9:16": [1080, 1920],
  "1:1": [1080, 1080],
  "4:5": [1080, 1350],
  "4:3": [1440, 1080],
  "16:9": [1920, 1080],
  "21:9": [2560, 1080],
};

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += d.toString()));
    p.stderr.on("data", (d) => (err += d.toString()));
    p.on("error", (e) => reject(new Error(`${cmd} could not start (${e.message}). Is FFmpeg installed and in PATH?`)));
    p.on("close", (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(`${cmd} exited with ${code}: ${err.slice(-1500)}`));
    });
  });
}

async function probeDuration(file: string): Promise<number> {
  const out = await run("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=nw=1:nk=1",
    file,
  ]);
  const d = parseFloat(out.trim());
  if (!isFinite(d) || d <= 0) throw new Error(`Could not read duration of ${path.basename(file)}`);
  return d;
}

async function probeSize(file: string): Promise<[number, number]> {
  const out = await run("ffprobe", [
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=width,height",
    "-of", "csv=p=0",
    file,
  ]);
  const [w, h] = out.trim().split(",").map((n) => parseInt(n, 10));
  if (!w || !h) throw new Error("Could not read video size");
  return [w, h];
}

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

function ffColor(hex: string | undefined): string {
  return hex && /^#[0-9a-fA-F]{6}$/.test(hex.trim()) ? "0x" + hex.trim().slice(1) : "0x000000";
}

/**
 * Per-scene filter graph. Mirrors the editor preview:
 *   blurred-fit : blurred copy of the video fills the frame, sharp video fitted on top
 *   letterbox / contain : video fitted, padded with the chosen bar colour
 *   cover       : video scaled up and cropped to fill the frame
 */
function sceneFilterGraph(o: {
  factor: number;
  fps: number;
  outW: number;
  outH: number;
  framing: RecapFraming;
  keepSourceFrame: boolean;
  blurAmount: number;
  bgColor: string;
  holdSeconds: number;
}): string {
  const { outW: W, outH: H } = o;
  const pre = `setpts=(PTS-STARTPTS)*${o.factor.toFixed(6)},fps=${o.fps}`;
  const post = [
    o.holdSeconds > 0.02 ? `tpad=stop_mode=clone:stop_duration=${o.holdSeconds.toFixed(3)}` : null,
    "format=yuv420p",
  ]
    .filter(Boolean)
    .join(",");

  if (o.keepSourceFrame) return `[0:v]${pre},setsar=1,${post}[v]`;

  if (o.framing === "cover") {
    return `[0:v]${pre},scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,${post}[v]`;
  }
  if (o.framing === "blurred-fit") {
    // The editor blurs a 320px copy with radius max(2, blurAmount/4) and darkens it to 65%.
    const sigma = Math.max(2, Math.round(o.blurAmount / 4));
    return (
      `[0:v]${pre},split=2[a][b];` +
      `[a]scale=320:180,gblur=sigma=${sigma},lutyuv=y=val*0.65,eq=saturation=1.2,scale=${W}:${H}[bg];` +
      `[b]scale=${W}:${H}:force_original_aspect_ratio=decrease[fg];` +
      `[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1,${post}[v]`
    );
  }
  return (
    `[0:v]${pre},scale=${W}:${H}:force_original_aspect_ratio=decrease,` +
    `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=${ffColor(o.bgColor)},setsar=1,${post}[v]`
  );
}

export async function renderRecap(opts: RecapRenderOptions): Promise<{
  duration: number;
  sceneDurations: number[];
}> {
  const {
    videoPath,
    audioPaths,
    scenes,
    outputPath,
    paddingSeconds = 0.25,
    minSpeed = 0.8,
    maxSpeed = 1.25,
    fps = 30,
  } = opts;

  if (!scenes.length) throw new Error("No scenes provided");
  if (scenes.length !== audioPaths.length) {
    throw new Error(`Scene count (${scenes.length}) and narration audio count (${audioPaths.length}) differ`);
  }

  const work = fs.mkdtempSync(path.join(os.tmpdir(), "recap-"));
  try {
    const sourceDuration = await probeDuration(videoPath);
    const [srcW, srcH] = await probeSize(videoPath);

    let outW: number;
    let outH: number;
    const keepSourceFrame = !opts.outWidth && !(opts.aspectRatio && RESOLUTIONS[opts.aspectRatio]);
    if (opts.outWidth && opts.outHeight) {
      outW = even(Math.min(4096, opts.outWidth));
      outH = even(Math.min(4096, opts.outHeight));
    } else if (opts.aspectRatio && RESOLUTIONS[opts.aspectRatio]) {
      [outW, outH] = RESOLUTIONS[opts.aspectRatio];
    } else {
      outW = even(srcW);
      outH = even(srcH);
    }
    const framing: RecapFraming = opts.framing || "blurred-fit";

    const sceneDurations: number[] = [];
    const speechDurations: number[] = [];
    const videoParts: string[] = [];
    const audioParts: string[] = [];

    for (let i = 0; i < scenes.length; i++) {
      const sc = scenes[i];
      const start = Math.max(0, Math.min(sourceDuration - 0.1, Number(sc.start) || 0));
      const end = Math.max(start + 0.5, Math.min(sourceDuration, Number(sc.end) || start + 5));
      const clipLen = end - start;

      const narrDur = await probeDuration(audioPaths[i]);
      const target = narrDur + paddingSeconds;

      // How fast must the clip play to last exactly `target`?
      const speed = clipLen / target; // >1 = speed up, <1 = slow down
      let cutLen = clipLen;
      let factor: number; // PTS multiplier
      let holdSeconds = 0;

      if (speed > maxSpeed) {
        // Source scene is much longer than narration: only take what fits at maxSpeed.
        cutLen = Math.min(clipLen, target * maxSpeed);
        factor = 1 / maxSpeed;
      } else if (speed < minSpeed) {
        // Source scene is too short: slow to minSpeed, then freeze the last frame.
        factor = 1 / minSpeed;
        holdSeconds = Math.max(0, target - cutLen * factor);
      } else {
        factor = 1 / speed;
      }

      const vOut = path.join(work, `v_${i}.mp4`);
      await run("ffmpeg", [
        "-y", "-v", "error",
        "-ss", start.toFixed(3),
        "-t", cutLen.toFixed(3),
        "-i", videoPath,
        "-an",
        "-filter_complex", sceneFilterGraph({
          factor, fps, outW, outH, framing, keepSourceFrame,
          blurAmount: opts.blurAmount ?? 20,
          bgColor: opts.bgColor || "#000000",
          holdSeconds,
        }),
        "-map", "[v]",
        "-t", target.toFixed(3),
        "-c:v", "libx264", "-preset", "fast", "-crf", "20",
        "-r", String(fps),
        "-movflags", "+faststart",
        vOut,
      ]);

      const aOut = path.join(work, `a_${i}.wav`);
      await run("ffmpeg", [
        "-y", "-v", "error",
        "-i", audioPaths[i],
        "-af", `apad=pad_dur=${paddingSeconds.toFixed(3)},atrim=0:${target.toFixed(3)},aresample=44100`,
        "-ac", "2",
        aOut,
      ]);

      videoParts.push(vOut);
      audioParts.push(aOut);
      sceneDurations.push(target);
      speechDurations.push(narrDur);
    }

    const listFile = (name: string, files: string[]) => {
      const p = path.join(work, name);
      fs.writeFileSync(p, files.map((f) => `file '${f.replace(/\\/g, "/").replace(/'/g, "'\\''")}'`).join("\n"));
      return p;
    };

    const joinedVideo = path.join(work, "joined.mp4");
    await run("ffmpeg", ["-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", listFile("v.txt", videoParts), "-c", "copy", joinedVideo]);

    const joinedAudio = path.join(work, "joined.wav");
    await run("ffmpeg", ["-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", listFile("a.txt", audioParts), "-c", "copy", joinedAudio]);

    const totalDuration = sceneDurations.reduce((a, b) => a + b, 0);

    // Subtitle track: one image per subtitle, transparent gaps in between, timed from the
    // real narration lengths measured above.
    const timeline: Array<{ file: string; start: number; end: number }> = [];
    let offset = 0;
    scenes.forEach((sc, i) => {
      const speech = speechDurations[i];
      let cursor = 0;
      for (const sub of sc.subs || []) {
        if (!sub.file || !fs.existsSync(sub.file)) continue;
        const a = Math.max(cursor, Math.min(1, Number(sub.from) || 0));
        const b = Math.max(a, Math.min(1, Number(sub.to) || 1));
        if (b - a <= 0) continue;
        // concat resolves relative entries against the list file's folder, so use absolute paths
        timeline.push({ file: path.resolve(sub.file), start: offset + a * speech, end: offset + b * speech });
        cursor = b;
      }
      offset += sceneDurations[i];
    });

    let subsList: string | null = null;
    if (timeline.length > 0) {
      const blank = path.join(work, "blank.png");
      await run("ffmpeg", [
        "-y", "-v", "error",
        "-f", "lavfi", "-i", `color=c=0x00000000:s=${outW}x${outH},format=rgba`,
        "-frames:v", "1",
        blank,
      ]);
      const q = (f: string) => f.replace(/\\/g, "/").replace(/'/g, "'\\''");
      const lines: string[] = ["ffconcat version 1.0"];
      let t = 0;
      for (const seg of timeline) {
        if (seg.start - t > 0.001) lines.push(`file '${q(blank)}'`, `duration ${(seg.start - t).toFixed(3)}`);
        const d = Math.max(0.04, seg.end - Math.max(seg.start, t));
        lines.push(`file '${q(seg.file)}'`, `duration ${d.toFixed(3)}`);
        t = Math.max(seg.start, t) + d;
      }
      if (totalDuration - t > 0.001) lines.push(`file '${q(blank)}'`, `duration ${(totalDuration - t).toFixed(3)}`);
      lines.push(`file '${q(blank)}'`); // concat demuxer drops the duration of the last entry
      subsList = path.join(work, "subs.txt");
      fs.writeFileSync(subsList, lines.join("\n"));
    }

    const finalArgs = ["-y", "-v", "error", "-i", joinedVideo];
    if (subsList) {
      finalArgs.push(
        "-f", "concat", "-safe", "0", "-i", subsList,
        "-i", joinedAudio,
        "-filter_complex", `[1:v]fps=${fps},format=rgba[s];[0:v][s]overlay=0:0:format=auto:eof_action=pass,format=yuv420p[v]`,
        "-map", "[v]", "-map", "2:a:0",
        "-c:v", "libx264", "-preset", "fast", "-crf", "19", "-pix_fmt", "yuv420p"
      );
    } else {
      finalArgs.push("-i", joinedAudio, "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy");
    }
    finalArgs.push("-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-shortest", outputPath);
    await run("ffmpeg", finalArgs);

    return { duration: totalDuration, sceneDurations };
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

/**
 * POST /api/recap/render   (multipart/form-data)
 *   video            : source video file
 *   audio_<i>        : narration for scene i
 *   sub_<i>_<j>      : subtitle PNG j of scene i (optional)
 *   scenes           : JSON  [{ start, end, narration, subs:[{from,to}] }]
 *   outWidth, outHeight, aspectRatio, framing, blurAmount, bgColor : optional
 */
export function registerRecapRoutes(app: express.Express, upload: multer.Multer) {
  // The render server may live on a PC/VPS while the web app is on Vercel,
  // so this route answers cross-origin requests itself.
  app.use("/api/recap", (req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    // Chrome Private Network Access preflight (HTTPS site -> localhost/PC)
    res.setHeader("Access-Control-Allow-Private-Network", "true");
    if (req.method === "OPTIONS") return res.status(204).end();
    next();
  });

  const MAX_SCENES = 80;

  app.post("/api/recap/render", upload.any(), async (req: express.Request, res: express.Response) => {
    req.setTimeout(0);
    res.setTimeout(0);

    const uploaded = (Array.isArray(req.files) ? req.files : []) as Express.Multer.File[];
    const byName = new Map<string, Express.Multer.File>();
    uploaded.forEach((f) => byName.set(f.fieldname, f));
    const cleanup = () => {
      for (const f of uploaded) {
        try { fs.unlinkSync(f.path); } catch { /* ignore */ }
      }
    };

    try {
      const video = byName.get("video");
      if (!video) return res.status(400).json({ success: false, error: "No video file received" });

      let rawScenes: Array<{ start: number; end: number; narration?: string; subs?: Array<{ from: number; to: number }> }>;
      try {
        rawScenes = JSON.parse(String(req.body.scenes || "[]"));
      } catch {
        return res.status(400).json({ success: false, error: "scenes must be valid JSON" });
      }
      if (!Array.isArray(rawScenes) || rawScenes.length === 0 || rawScenes.length > MAX_SCENES) {
        return res.status(400).json({ success: false, error: `scenes must contain 1-${MAX_SCENES} items` });
      }

      const audioPaths: string[] = [];
      const scenes: RecapScene[] = [];
      for (let i = 0; i < rawScenes.length; i++) {
        const a = byName.get(`audio_${i}`);
        if (!a) return res.status(400).json({ success: false, error: `Missing narration audio for scene ${i}` });
        audioPaths.push(a.path);
        const subs: RecapSubtitle[] = [];
        (rawScenes[i].subs || []).slice(0, 30).forEach((s, j) => {
          const f = byName.get(`sub_${i}_${j}`);
          if (f) subs.push({ from: s.from, to: s.to, file: f.path });
        });
        scenes.push({ start: rawScenes[i].start, end: rawScenes[i].end, narration: rawScenes[i].narration, subs });
      }

      const outputName = `recap_${Date.now()}.mp4`;
      const outputPath = path.join("public/output", outputName);
      const framing = String(req.body.framing || "blurred-fit") as RecapFraming;

      const result = await renderRecap({
        videoPath: video.path,
        audioPaths,
        scenes,
        outputPath,
        outWidth: req.body.outWidth ? parseInt(req.body.outWidth, 10) : undefined,
        outHeight: req.body.outHeight ? parseInt(req.body.outHeight, 10) : undefined,
        aspectRatio: req.body.aspectRatio || undefined,
        framing: ["blurred-fit", "letterbox", "cover", "contain"].includes(framing) ? framing : "blurred-fit",
        blurAmount: req.body.blurAmount ? parseInt(req.body.blurAmount, 10) : undefined,
        bgColor: req.body.bgColor || undefined,
      });

      res.json({
        success: true,
        downloadUrl: `/output/${outputName}`,
        duration: result.duration,
        sceneDurations: result.sceneDurations,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[Recap Render] failed:", msg);
      res.status(500).json({ success: false, error: msg });
    } finally {
      cleanup();
    }
  });
}

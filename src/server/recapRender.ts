import type express from "express";
import fs from "fs";
import os from "os";
import path from "path";
import { spawn } from "child_process";
import type multer from "multer";

/**
 * Scene-based recap renderer.
 *
 * Input  : one source video, N narration audio files (one per scene) and N scene
 *          ranges [{ start, end }] taken from the source video.
 * Output : one MP4 where every scene's video is fitted to the length of its own
 *          narration (speed-adjusted within limits, then frozen/trimmed), all scenes
 *          are concatenated, narration is laid underneath, and an SRT built from the
 *          real narration timings can be burned in.
 */

export interface RecapScene {
  start: number;
  end: number;
  narration?: string;
}

export interface RecapRenderOptions {
  videoPath: string;
  audioPaths: string[];
  scenes: RecapScene[];
  outputPath: string;
  aspectRatio?: string;
  burnSubtitles?: boolean;
  fontFamily?: string;
  fontSize?: number;
  fontColor?: string;
  strokeColor?: string;
  fontsDir?: string;
  /** Silence added after each narration line so cuts don't feel rushed. */
  paddingSeconds?: number;
  /** Video is never sped up / slowed down more than this around 1.0x. */
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
    p.on("error", reject);
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
  return [w - (w % 2), h - (h % 2)];
}

function srtTime(sec: number): string {
  const ms = Math.max(0, Math.round(sec * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const r = ms % 1000;
  const p = (n: number, l = 2) => String(n).padStart(l, "0");
  return `${p(h)}:${p(m)}:${p(s)},${p(r, 3)}`;
}

/** Split narration into subtitle-sized pieces (Burmese "။" aware). */
function splitNarration(text: string, maxChars = 46): string[] {
  const sentences = text
    .split(/(?<=[။!?\.\n])\s*/u)
    .map((s) => s.trim())
    .filter(Boolean);
  const pieces: string[] = [];
  for (const s of sentences) {
    if ([...s].length <= maxChars) {
      pieces.push(s);
      continue;
    }
    const words = s.split(/\s+/);
    let cur = "";
    for (const w of words) {
      if ([...(cur + " " + w)].length > maxChars && cur) {
        pieces.push(cur.trim());
        cur = w;
      } else {
        cur = cur ? cur + " " + w : w;
      }
    }
    if (cur.trim()) pieces.push(cur.trim());
  }
  return pieces.length ? pieces : [text.trim()];
}

function buildSrt(
  items: Array<{ offset: number; duration: number; narration: string }>
): string {
  const blocks: string[] = [];
  let n = 1;
  for (const it of items) {
    if (!it.narration.trim()) continue;
    const pieces = splitNarration(it.narration);
    const totalChars = pieces.reduce((a, p) => a + [...p].length, 0) || 1;
    let t = it.offset;
    for (const piece of pieces) {
      const len = ([...piece].length / totalChars) * it.duration;
      const end = Math.min(it.offset + it.duration, t + len);
      blocks.push(`${n++}\n${srtTime(t)} --> ${srtTime(end)}\n${piece}\n`);
      t = end;
    }
  }
  return blocks.join("\n");
}

function hexToAss(hex: string | undefined, fallback: string): string {
  if (!hex) return fallback;
  const c = hex.replace("#", "").trim();
  if (!/^[0-9a-fA-F]{6}$/.test(c)) return fallback;
  return `&H00${c.slice(4, 6)}${c.slice(2, 4)}${c.slice(0, 2)}`.toUpperCase();
}

function escapeFilterPath(p: string): string {
  return p.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
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
    const [outW, outH] =
      opts.aspectRatio && RESOLUTIONS[opts.aspectRatio] && opts.aspectRatio !== "original"
        ? RESOLUTIONS[opts.aspectRatio]
        : [srcW, srcH];

    const sceneDurations: number[] = [];
    const videoParts: string[] = [];
    const audioParts: string[] = [];

    for (let i = 0; i < scenes.length; i++) {
      const sc = scenes[i];
      const start = Math.max(0, Math.min(sourceDuration - 0.1, Number(sc.start) || 0));
      let end = Math.max(start + 0.5, Math.min(sourceDuration, Number(sc.end) || start + 5));
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
      const vf = [
        `setpts=(PTS-STARTPTS)*${factor.toFixed(6)}`,
        `fps=${fps}`,
        `scale=${outW}:${outH}:force_original_aspect_ratio=decrease`,
        `pad=${outW}:${outH}:(ow-iw)/2:(oh-ih)/2:black`,
        `setsar=1`,
        holdSeconds > 0.02 ? `tpad=stop_mode=clone:stop_duration=${holdSeconds.toFixed(3)}` : null,
        "format=yuv420p",
      ]
        .filter(Boolean)
        .join(",");

      await run("ffmpeg", [
        "-y", "-v", "error",
        "-ss", start.toFixed(3),
        "-t", cutLen.toFixed(3),
        "-i", videoPath,
        "-an",
        "-vf", vf,
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
    }

    const listFile = (name: string, files: string[]) => {
      const p = path.join(work, name);
      fs.writeFileSync(p, files.map((f) => `file '${f.replace(/\\/g, "/").replace(/'/g, "'\\''")}'`).join("\n"));
      return p;
    };

    const videoList = listFile("v.txt", videoParts);
    const audioList = listFile("a.txt", audioParts);

    const joinedVideo = path.join(work, "joined.mp4");
    await run("ffmpeg", ["-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", videoList, "-c", "copy", joinedVideo]);

    const joinedAudio = path.join(work, "joined.wav");
    await run("ffmpeg", ["-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", audioList, "-c", "copy", joinedAudio]);

    // Optional burned-in subtitles built from real narration timings.
    let subtitleFilter: string | null = null;
    if (opts.burnSubtitles) {
      let offset = 0;
      const items = scenes.map((sc, i) => {
        const it = { offset, duration: sceneDurations[i], narration: sc.narration || "" };
        offset += sceneDurations[i];
        return it;
      });
      const srt = buildSrt(items);
      if (srt.trim()) {
        const srtPath = path.join(work, "recap.srt");
        fs.writeFileSync(srtPath, srt, "utf-8");
        const font = (opts.fontFamily || "Noto Sans Myanmar").split(",")[0].replace(/['",:\\]/g, "").trim() || "Noto Sans Myanmar";
        // fontSize is in real output pixels. libass scales SRT text against a 288px-high
        // script canvas, so convert pixels -> that canvas (otherwise text is ~5x too big).
        const px = Math.max(12, Math.min(200, Math.round(opts.fontSize || Math.min(outW, outH) * 0.05)));
        const size = Math.max(4, Math.round((px * 288) / outH));
        const style = [
          `FontName=${font}`,
          `FontSize=${size}`,
          `PrimaryColour=${hexToAss(opts.fontColor, "&H00FFFFFF")}`,
          `OutlineColour=${hexToAss(opts.strokeColor, "&H00000000")}`,
          "BorderStyle=3",
          "Outline=2.5",
          "MarginV=40",
        ].join(",");
        const fontsDirPart = opts.fontsDir ? `:fontsdir='${escapeFilterPath(opts.fontsDir)}'` : "";
        subtitleFilter = `subtitles='${escapeFilterPath(srtPath)}':original_size=${outW}x${outH}${fontsDirPart}:force_style='${style}'`;
      }
    }

    const finalArgs = ["-y", "-v", "error", "-i", joinedVideo, "-i", joinedAudio, "-map", "0:v:0", "-map", "1:a:0"];
    if (subtitleFilter) {
      finalArgs.push("-vf", subtitleFilter, "-c:v", "libx264", "-preset", "fast", "-crf", "19", "-pix_fmt", "yuv420p");
    } else {
      finalArgs.push("-c:v", "copy");
    }
    finalArgs.push("-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-shortest", outputPath);
    await run("ffmpeg", finalArgs);

    return {
      duration: sceneDurations.reduce((a, b) => a + b, 0),
      sceneDurations,
    };
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

/**
 * POST /api/recap/render   (multipart/form-data)
 *   video            : source video file
 *   audio_0..audio_N : narration for scene i
 *   scenes           : JSON  [{ start, end, narration }]
 *   aspectRatio, burnSubtitles, fontFamily, fontSize, fontColor, strokeColor : optional
 *   fontFile         : optional custom font
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
  const fields = [
    { name: "video", maxCount: 1 },
    { name: "fontFile", maxCount: 1 },
    ...Array.from({ length: MAX_SCENES }, (_, i) => ({ name: `audio_${i}`, maxCount: 1 })),
  ];

  app.post("/api/recap/render", upload.fields(fields), async (req: express.Request, res: express.Response) => {
    req.setTimeout(0);
    res.setTimeout(0);

    const files = (req.files || {}) as { [field: string]: Express.Multer.File[] };
    const allUploads = Object.values(files).flat();
    const cleanup = () => {
      for (const f of allUploads) {
        try { fs.unlinkSync(f.path); } catch { /* ignore */ }
      }
    };

    let fontDir: string | undefined;
    try {
      const video = files["video"]?.[0];
      if (!video) return res.status(400).json({ success: false, error: "No video file received" });

      let scenes: RecapScene[];
      try {
        scenes = JSON.parse(String(req.body.scenes || "[]"));
      } catch {
        return res.status(400).json({ success: false, error: "scenes must be valid JSON" });
      }
      if (!Array.isArray(scenes) || scenes.length === 0 || scenes.length > MAX_SCENES) {
        return res.status(400).json({ success: false, error: `scenes must contain 1-${MAX_SCENES} items` });
      }

      const audioPaths: string[] = [];
      for (let i = 0; i < scenes.length; i++) {
        const a = files[`audio_${i}`]?.[0];
        if (!a) return res.status(400).json({ success: false, error: `Missing narration audio for scene ${i}` });
        audioPaths.push(a.path);
      }

      const fontFile = files["fontFile"]?.[0];
      if (fontFile) {
        fontDir = fs.mkdtempSync(path.join(os.tmpdir(), "recapfont-"));
        const ext = path.extname(fontFile.originalname || "") || ".ttf";
        fs.copyFileSync(fontFile.path, path.join(fontDir, `custom${ext.replace(/[^.\w]/g, "")}`));
      }

      const outputName = `recap_${Date.now()}.mp4`;
      const outputPath = path.join("public/output", outputName);

      const result = await renderRecap({
        videoPath: video.path,
        audioPaths,
        scenes,
        outputPath,
        aspectRatio: req.body.aspectRatio || undefined,
        burnSubtitles: String(req.body.burnSubtitles) === "true",
        fontFamily: req.body.fontFamily || undefined,
        fontSize: req.body.fontSize ? parseInt(req.body.fontSize, 10) : undefined,
        fontColor: req.body.fontColor || undefined,
        strokeColor: req.body.strokeColor || undefined,
        fontsDir: fontDir,
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
      if (fontDir) fs.rmSync(fontDir, { recursive: true, force: true });
    }
  });
}

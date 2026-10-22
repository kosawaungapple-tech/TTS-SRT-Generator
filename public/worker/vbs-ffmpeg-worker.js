/**
 * VBS FFmpeg Dedicated Local PC / VPS Worker Engine
 * Runs on your local computer or VPS to process ultra-HD zero-stutter videos!
 * Port: 5005
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync, spawn, spawnSync } = require('child_process');
const crypto = require('crypto');

// ---------------------------------------------------------------------------
// Hosted (server) mode. Only active when RENDER_SECRET is set; with no env vars this
// worker behaves exactly as before (local PC, open, no limits).
//   RENDER_SECRET   shared secret used to sign render tokens (same value as on the website)
//   PUBLIC_URL      public https address of this server, e.g. https://render.example.com
//   ALLOWED_ORIGIN  website origin allowed by CORS (default *)
//   MAX_JOBS (1) / MAX_QUEUE (3) / MAX_UPLOAD_MB (200) / DAILY_LIMIT (5) / OUTPUT_TTL_MIN (30)
// ---------------------------------------------------------------------------
const HOSTED = !!process.env.RENDER_SECRET;
// Private remote use (admin only): set WORKER_KEY=<password> before starting the worker when you expose it
// through a tunnel (e.g. Cloudflare Tunnel). Every POST then needs `Authorization: Bearer <password>`.
// Without WORKER_KEY nothing changes.
const WORKER_KEY = !HOSTED ? (process.env.WORKER_KEY || '') : '';
function workerKeyOk(header) {
  const m = /^Bearer\s+(.+)$/i.exec(header || '');
  if (!m) return false;
  const a = crypto.createHash('sha256').update(m[1]).digest();
  const b = crypto.createHash('sha256').update(WORKER_KEY).digest();
  return crypto.timingSafeEqual(a, b);
}
const MAX_JOBS = Math.max(1, parseInt(process.env.MAX_JOBS || '1', 10) || 1);
const MAX_QUEUE = Math.max(0, parseInt(process.env.MAX_QUEUE || '3', 10) || 0);
const MAX_UPLOAD = Math.max(10, parseInt(process.env.MAX_UPLOAD_MB || '200', 10) || 200) * 1024 * 1024;
const DAILY_LIMIT = Math.max(1, parseInt(process.env.DAILY_LIMIT || '5', 10) || 5);
const OUTPUT_TTL_MS = Math.max(5, parseInt(process.env.OUTPUT_TTL_MIN || '30', 10) || 30) * 60 * 1000;

function verifyRenderToken(header) {
  const m = /^Bearer\s+(.+)$/i.exec(header || '');
  if (!m) return null;
  const parts = m[1].split('.');
  if (parts.length !== 2) return null;
  const expected = crypto.createHmac('sha256', process.env.RENDER_SECRET).update(parts[0]).digest();
  let given;
  try { given = Buffer.from(parts[1], 'base64url'); } catch { return null; }
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  try {
    const body = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    if (!body.uid || !body.exp || Date.now() / 1000 > body.exp) return null;
    return { uid: String(body.uid) };
  } catch { return null; }
}

let activeJobs = 0;
const waiting = [];
const busyUsers = new Set();
const dailyCount = new Map();

function takeDailySlot(uid) {
  const key = uid + ':' + new Date().toISOString().slice(0, 10);
  const n = dailyCount.get(key) || 0;
  if (n >= DAILY_LIMIT) return false;
  dailyCount.set(key, n + 1);
  return true;
}
function acquireJobSlot() {
  if (activeJobs < MAX_JOBS) { activeJobs++; return Promise.resolve(); }
  if (waiting.length >= MAX_QUEUE) return Promise.reject(new Error('QUEUE_FULL'));
  return new Promise(resolve => waiting.push(resolve));
}
function releaseJobSlot() {
  const next = waiting.shift();
  if (next) next(); else activeJobs = Math.max(0, activeJobs - 1);
}
if (HOSTED) {
  setInterval(() => {
    try {
      const now = Date.now();
      for (const f of fs.readdirSync(OUTPUT_DIR)) {
        const fp = path.join(OUTPUT_DIR, f);
        if (now - fs.statSync(fp).mtimeMs > OUTPUT_TTL_MS) fs.rmSync(fp, { force: true });
      }
      for (const k of dailyCount.keys()) if (!k.endsWith(new Date().toISOString().slice(0, 10))) dailyCount.delete(k);
    } catch {}
  }, 5 * 60 * 1000).unref();
}

const PORT = process.env.PORT || 5005;
const UPLOADS_DIR = path.join(__dirname, 'worker_uploads');
const OUTPUT_DIR = path.join(__dirname, 'worker_output');

if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

// Check FFmpeg availability
let ffmpegVersionStr = 'Unknown';
let isFfmpegInstalled = false;
try {
  ffmpegVersionStr = execSync('ffmpeg -version').toString().split('\n')[0];
  isFfmpegInstalled = true;
} catch {
  console.warn('[VBS Worker] WARNING: FFmpeg was not detected in PATH! Please ensure FFmpeg is installed.');
}

function getLanAddresses() {
  const nets = os.networkInterfaces();
  const results = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        results.push(net.address);
      }
    }
  }
  return results;
}

const lanIps = getLanAddresses();

console.log('========================================================');
console.log('       🎬 VBS FFmpeg Worker Engine (Multi-Device Ready)  ');
console.log('========================================================');
console.log(`[Status]  Port: ${PORT}`);
console.log(`[FFmpeg]  ${isFfmpegInstalled ? '🟢 Detected: ' + ffmpegVersionStr : '🔴 Not detected in PATH'}`);
console.log(`[System]  ${os.type()} ${os.release()} (${os.arch()})`);
console.log(`[Local PC]       http://localhost:${PORT}`);
if (lanIps.length > 0) {
  console.log('[Other Devices (Phone / Tablet / Other PC on same Wi-Fi)]:');
  lanIps.forEach(ip => console.log(`  📱 Set Worker URL to: http://${ip}:${PORT}`));
}
console.log(`[Health Endpoint] http://localhost:${PORT}/health`);
console.log('========================================================');
console.log('Ready to process video rendering jobs from VlogsBySaw App!');

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', HOSTED ? (process.env.ALLOWED_ORIGIN || '*') : '*');
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, HEAD');
  res.setHeader('Access-Control-Allow-Headers', (HOSTED || WORKER_KEY) ? 'Authorization, Content-Type, X-Requested-With' : '*');
  res.setHeader('Access-Control-Expose-Headers', '*');
}

const server = http.createServer((req, res) => {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (WORKER_KEY && req.method === 'POST' && !workerKeyOk(req.headers['authorization'])) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: 'Worker password is missing or wrong. Enter it in Worker settings. (Worker password မှားနေသည် / မထည့်ရသေးပါ)' }));
    req.resume();
    return;
  }

  const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = urlObj.pathname;

  // 1. Health / Status Check Endpoint
  if (req.method === 'GET' && (pathname === '/health' || pathname === '/status' || pathname === '/')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'online',
      engine: 'vbs-ffmpeg-worker',
      hosted: HOSTED,
      version: '1.10.0',
      protected: !!WORKER_KEY,
      ffmpegAvailable: isFfmpegInstalled,
      ffmpegVersion: ffmpegVersionStr,
      platform: os.platform(),
      hostname: os.hostname(),
      lanIps: getLanAddresses(),
      uptimeSeconds: Math.floor(os.uptime()),
      timestamp: new Date().toISOString()
    }));
    return;
  }

  // 2. Download / Serve Processed Video File
  if (req.method === 'GET' && pathname.startsWith('/output/')) {
    const filename = path.basename(pathname);
    const filePath = path.join(OUTPUT_DIR, filename);

    if (!fs.existsSync(filePath)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'File not found' }));
      return;
    }

    const stat = fs.statSync(filePath);
    res.writeHead(200, {
      'Content-Type': 'video/mp4',
      'Content-Length': stat.size,
      'Content-Disposition': `attachment; filename="${filename}"`
    });
    const readStream = fs.createReadStream(filePath);
    readStream.pipe(res);
    return;
  }

  // 3. Process Video Rendering Endpoint (Multipart Form Data)
  if (!HOSTED && req.method === 'POST' && pathname === '/process') {
    const contentType = req.headers['content-type'] || '';
    if (!contentType.includes('multipart/form-data')) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Expected multipart/form-data' }));
      return;
    }

    const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
    if (!boundaryMatch) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'No boundary in multipart content' }));
      return;
    }
    const boundary = boundaryMatch[1] || boundaryMatch[2];

    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', async () => {
      try {
        const buffer = Buffer.concat(chunks);
        const parsedParts = parseMultipart(buffer, boundary);

        const videoPart = parsedParts.files['video'];
        if (!videoPart || !videoPart.data || videoPart.data.length === 0) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'No video file provided' }));
          return;
        }

        const srtContent = parsedParts.fields['srtContent'] || '';
        const aspectRatio = parsedParts.fields['aspectRatio'] || '16:9';
        const trimStart = parseFloat(parsedParts.fields['trimStart'] || '0');
        const trimEnd = parseFloat(parsedParts.fields['trimEnd'] || '0');
        const featuresRaw = parsedParts.fields['features'] || '{}';
        let features = {};
        try { features = JSON.parse(featuresRaw); } catch {}

        // Custom Font & Style options
        const fontPart = parsedParts.files['fontFile'] || parsedParts.files['font'];
        const fontFamily = (parsedParts.fields['fontFamily'] || '').replace(/['"]/g, '').split(',')[0].trim();
        const fontSize = parseInt(parsedParts.fields['fontSize'] || '24', 10);
        const fontColor = parsedParts.fields['fontColor'] || '#FFFFFF';
        const strokeColor = parsedParts.fields['strokeColor'] || '#000000';

        function hexToAss(hex, fallback) {
          if (!hex || typeof hex !== 'string') return fallback;
          const clean = hex.replace('#', '').trim();
          if (clean.length === 6) {
            const r = clean.substring(0, 2);
            const g = clean.substring(2, 4);
            const b = clean.substring(4, 6);
            return `&H00${b}${g}${r}`.toUpperCase();
          }
          return fallback;
        }

        const assPrimary = hexToAss(fontColor, '&H00FFFFFF');
        const assOutline = hexToAss(strokeColor, '&H00000000');

        const timestamp = Date.now();
        const inputFilename = `worker_in_${timestamp}_${Math.random().toString(36).substring(2, 7)}.mp4`;
        const inputPath = path.join(UPLOADS_DIR, inputFilename);
        fs.writeFileSync(inputPath, videoPart.data);

        let tempFontPath = null;
        if (fontPart && fontPart.data && fontPart.data.length > 0) {
          const fontExt = path.extname(fontPart.filename || '') || '.ttf';
          const fontFilename = `font_${timestamp}_${Math.random().toString(36).substring(2, 7)}${fontExt}`;
          tempFontPath = path.join(UPLOADS_DIR, fontFilename);
          fs.writeFileSync(tempFontPath, fontPart.data);
          console.log(`[VBS Worker] Staged custom user font: ${fontFilename}`);
        }

        let tempAudioPath = null;
        const audioPart = parsedParts.files['audio'];
        if (audioPart && audioPart.data && audioPart.data.length > 0) {
          const audioExt = path.extname(audioPart.filename || '') || '.mp3';
          const audioFilename = `audio_${timestamp}_${Math.random().toString(36).substring(2, 7)}${audioExt}`;
          tempAudioPath = path.join(UPLOADS_DIR, audioFilename);
          fs.writeFileSync(tempAudioPath, audioPart.data);
          console.log(`[VBS Worker] Staged audio track: ${audioFilename}`);
        }

        let tempSrtPath = null;
        if (srtContent && srtContent.trim()) {
          tempSrtPath = path.join(UPLOADS_DIR, `sub_${timestamp}.srt`);
          fs.writeFileSync(tempSrtPath, srtContent, 'utf-8');
        }

        const outputFilename = `worker_out_${timestamp}.mp4`;
        const outputPath = path.join(OUTPUT_DIR, outputFilename);

        console.log(`[VBS Worker] Processing video (${(videoPart.data.length / (1024*1024)).toFixed(1)} MB)...`);

        // Build FFmpeg arguments
        let args = ['-y'];
        const tempSubFiles = [];
        const useOverlayMode = Boolean(parsedParts.fields['framing']); // new editor: framing + browser-drawn subtitle PNGs

        if (useOverlayMode) {
          // ---- Editor-matching render: framing like the preview + subtitle PNGs drawn by the browser ----
          const evenN = n => Math.max(2, Math.round(n / 2) * 2);
          const outWf = parseInt(parsedParts.fields['outWidth'] || '0', 10);
          const outHf = parseInt(parsedParts.fields['outHeight'] || '0', 10);
          const hasFrame = outWf > 0 && outHf > 0 && aspectRatio !== 'original';
          const W = hasFrame ? evenN(Math.min(4096, outWf)) : 0;
          const H = hasFrame ? evenN(Math.min(4096, outHf)) : 0;
          const framingRaw = parsedParts.fields['framing'];
          const framing = ['blurred-fit', 'letterbox', 'cover', 'contain'].includes(framingRaw) ? framingRaw : 'blurred-fit';
          const blurAmount = parseInt(parsedParts.fields['blurAmount'] || '20', 10);
          const bgHex = /^#[0-9a-fA-F]{6}$/.test((parsedParts.fields['bgColor'] || '').trim()) ? '0x' + parsedParts.fields['bgColor'].trim().slice(1) : '0x000000';

          args.push('-ss', String(Math.max(0, trimStart)), '-i', inputPath);
          let nextIdx = 1;
          let audioIdx = -1;
          let subsIdx = -1;
          if (tempAudioPath) { args.push('-i', tempAudioPath); audioIdx = nextIdx++; }

          // Subtitle timeline: one transparent full-frame PNG per cue, blank frames in between.
          let subsMeta = [];
          try { subsMeta = JSON.parse(parsedParts.fields['subs'] || '[]'); } catch {}
          const timeline = [];
          let cursor = 0;
          subsMeta.forEach((m, i) => {
            const f = parsedParts.files['sub_' + i];
            if (!f || !f.data || !f.data.length || !hasFrame) return;
            const start = Math.max(cursor, Number(m.start) || 0);
            const endT = Number(m.end) || 0;
            if (endT - start < 0.04) return;
            const file = path.join(UPLOADS_DIR, `sub_${timestamp}_${i}.png`);
            fs.writeFileSync(file, f.data);
            tempSubFiles.push(file);
            timeline.push({ file, start, end: endT });
            cursor = endT;
          });
          if (timeline.length > 0) {
            const blank = path.join(UPLOADS_DIR, `blank_${timestamp}.png`);
            const mk = spawnSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', `color=c=0x00000000:s=${W}x${H},format=rgba`, '-frames:v', '1', blank]);
            if (mk.status !== 0) throw new Error('Could not create blank subtitle frame: ' + String(mk.stderr || '').slice(-300));
            tempSubFiles.push(blank);
            const q = f => f.replace(/\\/g, '/').replace(/'/g, "'\\''");
            const lines = ['ffconcat version 1.0'];
            let t = 0;
            for (const seg of timeline) {
              if (seg.start - t > 0.001) lines.push(`file '${q(blank)}'`, `duration ${(seg.start - t).toFixed(3)}`);
              lines.push(`file '${q(seg.file)}'`, `duration ${(seg.end - seg.start).toFixed(3)}`);
              t = seg.end;
            }
            lines.push(`file '${q(blank)}'`); // the concat demuxer drops the duration of the last entry
            const listPath = path.join(UPLOADS_DIR, `subs_${timestamp}.txt`);
            fs.writeFileSync(listPath, lines.join('\n'));
            tempSubFiles.push(listPath);
            args.push('-f', 'concat', '-safe', '0', '-i', listPath);
            subsIdx = nextIdx++;
          }

          // Picture chain: flips / grade -> framing like the editor preview -> subtitle overlay
          const pre = [];
          if (features.flip || features.hflip) pre.push('hflip');
          if (features.vflip || features.flipVertical) pre.push('vflip');
          if (features.colorGrade) pre.push('eq=contrast=1.1:saturation=1.2:brightness=-0.05');
          const join = (...parts) => parts.filter(Boolean).join(',');
          let graph;
          if (!hasFrame) {
            graph = `[0:v]${join(...pre, 'null')}[vf]`;
          } else if (framing === 'cover') {
            graph = `[0:v]${join(...pre, `scale=${W}:${H}:force_original_aspect_ratio=increase`, `crop=${W}:${H}`, 'setsar=1')}[vf]`;
          } else if (framing === 'blurred-fit') {
            // Same recipe as the editor preview: whole frame squeezed to 320x180, blurred, darkened, stretched to fill.
            const sigma = Math.max(2, Math.round(blurAmount / 4));
            graph = `[0:v]${join(...pre, 'split=2')}[a][b];` +
              `[a]scale=320:180,gblur=sigma=${sigma},lutyuv=y=val*0.65,eq=saturation=1.2,scale=${W}:${H}[bg];` +
              `[b]scale=${W}:${H}:force_original_aspect_ratio=decrease[fg];` +
              `[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1[vf]`;
          } else {
            graph = `[0:v]${join(...pre, `scale=${W}:${H}:force_original_aspect_ratio=decrease`, `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=${bgHex}`, 'setsar=1')}[vf]`;
          }
          if (subsIdx >= 0) {
            graph += `;[${subsIdx}:v]fps=30,format=rgba[s];[vf][s]overlay=0:0:format=auto:eof_action=pass,format=yuv420p[v]`;
          } else {
            graph += `;[vf]format=yuv420p[v]`;
          }
          args.push('-filter_complex', graph, '-map', '[v]');
          if (audioIdx >= 0) args.push('-map', `${audioIdx}:a:0`, '-shortest');
          else args.push('-map', '0:a?');
          if (trimEnd > trimStart) args.push('-t', String(trimEnd - trimStart));
          console.log(`[VBS Worker] Overlay render: ${hasFrame ? W + 'x' + H : 'source size'}, framing=${framing}, ${timeline.length} subtitle images`);
        } else {

          if (trimStart > 0) {
            args.push('-ss', String(trimStart));
          }

          args.push('-i', inputPath);

          if (trimEnd > trimStart) {
            args.push('-to', String(trimEnd - trimStart));
          }

          if (tempAudioPath) {
            args.push('-i', tempAudioPath);
          }

          const vFilters = [];

          if (features.flip || features.hflip) {
            vFilters.push('hflip');
          }
          if (features.vflip || features.flipVertical) {
            vFilters.push('vflip');
          }
          if (features.colorGrade) {
            vFilters.push('eq=contrast=1.1:saturation=1.2:brightness=-0.05');
          }

          if (aspectRatio !== 'original' && aspectRatio !== '16:9') {
            const resolutions = {
              '9:16': '1080:1920',
              '1:1': '1080:1080',
              '4:5': '1080:1350',
              '4:3': '1440:1080',
              '21:9': '2560:1080'
            };
            const resStr = resolutions[aspectRatio];
            if (resStr) {
              const [tw, th] = resStr.split(':');
              vFilters.push(`scale=${tw}:${th}:force_original_aspect_ratio=decrease,pad=${tw}:${th}:(ow-iw)/2:(oh-ih)/2:black,setsar=1`);
            }
          }

          if (tempSrtPath && fs.existsSync(tempSrtPath)) {
            const escSrt = tempSrtPath.replace(/\\/g, '/').replace(/'/g, "'\\''").replace(/:/g, '\\:');
            const fontNamePart = fontFamily ? `FontName=${fontFamily},` : '';
            const fontsDirPart = tempFontPath ? `:fontsdir='${UPLOADS_DIR.replace(/\\/g, '/').replace(/'/g, "'\\''")}'` : '';
            vFilters.push(`subtitles='${escSrt}'${fontsDirPart}:force_style='${fontNamePart}FontSize=${fontSize},PrimaryColour=${assPrimary},OutlineColour=${assOutline},BorderStyle=3,Outline=2.5,MarginV=40'`);
          }

          if (vFilters.length > 0) {
            args.push('-vf', vFilters.join(','));
          }

          if (tempAudioPath) {
            args.push('-map', '0:v', '-map', '1:a:0', '-shortest');
          }

        }

        args.push(
          '-c:v', 'libx264',
          '-preset', 'veryfast',
          '-crf', '18',
          '-pix_fmt', 'yuv420p',
          '-c:a', 'aac',
          '-b:a', '192k',
          '-ar', '44100',
          '-movflags', '+faststart',
          outputPath
        );

        console.log(`[VBS Worker] Executing FFmpeg...`);
        const proc = spawn('ffmpeg', args);

        let errorLog = '';
        proc.stderr.on('data', data => { errorLog += data.toString(); });

        proc.on('close', code => {
          // Cleanup input and temp srt
          try { if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath); } catch {}
          try { if (tempSrtPath && fs.existsSync(tempSrtPath)) fs.unlinkSync(tempSrtPath); } catch {}
          try { if (tempFontPath && fs.existsSync(tempFontPath)) fs.unlinkSync(tempFontPath); } catch {}
          try { if (tempAudioPath && fs.existsSync(tempAudioPath)) fs.unlinkSync(tempAudioPath); } catch {}
          for (const f of tempSubFiles) { try { fs.unlinkSync(f); } catch {} }

          if (code === 0 && fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
            console.log(`[VBS Worker] SUCCESS! Output size: ${(fs.statSync(outputPath).size / (1024*1024)).toFixed(2)} MB`);
            const host = req.headers.host || `localhost:${PORT}`;
            const downloadUrl = `http://${host}/output/${outputFilename}`;

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              success: true,
              filename: outputFilename,
              downloadUrl: downloadUrl
            }));
          } else {
            console.error(`[VBS Worker] FFmpeg failed with exit code ${code}`);
            console.error(errorLog.slice(-500));
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              success: false,
              error: `FFmpeg exited with code ${code}. Check terminal for details.`
            }));
          }
        });

      } catch (err) {
        console.error('[VBS Worker] Exception:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // 4. Scene-based Recap Rendering (one narration clip per scene -> one finished video)
  if (req.method === 'POST' && (pathname === '/api/recap/render' || pathname === '/recap/render')) {
    const contentType = req.headers['content-type'] || '';
    const bm = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
    if (!contentType.includes('multipart/form-data') || !bm) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Expected multipart/form-data' }));
      return;
    }
    const recapBoundary = bm[1] || bm[2];
    let authUser = null;
    if (HOSTED) {
      authUser = verifyRenderToken(req.headers['authorization']);
      if (!authUser) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Not authorised. Reload the page and try again. (ဝင်ခွင့်မရပါ — စာမျက်နှာကို ပြန်ဖွင့်ပါ)' }));
        req.resume();
        return;
      }
      if (busyUsers.has(authUser.uid)) {
        res.writeHead(429, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'You already have a render running. Wait for it to finish. (သင့် render တစ်ခု လုပ်နေဆဲပါ)' }));
        req.resume();
        return;
      }
      if (parseInt(req.headers['content-length'] || '0', 10) > MAX_UPLOAD) {
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: `Video is too large for the server (max ${Math.round(MAX_UPLOAD / 1048576)} MB). Use a shorter or smaller video. (ဗီဒီယို ကြီးလွန်းသည်)` }));
        req.resume();
        return;
      }
    }
    const recapChunks = [];
    let recapBytes = 0;
    let tooBig = false;
    req.on('data', chunk => {
      if (tooBig) return;
      recapBytes += chunk.length;
      if (HOSTED && recapBytes > MAX_UPLOAD) {
        tooBig = true;
        recapChunks.length = 0;
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: `Video is too large for the server (max ${Math.round(MAX_UPLOAD / 1048576)} MB).` }));
        return;
      }
      recapChunks.push(chunk);
    });
    req.on('end', async () => {
      if (tooBig) return;
      const tempFiles = [];
      let slotHeld = false;
      const fail = (code, msg) => {
        res.writeHead(code, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: msg }));
      };
      try {
        if (HOSTED) {
          if (!takeDailySlot(authUser.uid)) return fail(429, `Daily render limit reached (${DAILY_LIMIT} per day). Try again tomorrow. (ဒီနေ့ render ကန့်သတ်ချက် ပြည့်ပါပြီ)`);
          busyUsers.add(authUser.uid);
          try { await acquireJobSlot(); slotHeld = true; } catch { busyUsers.delete(authUser.uid); return fail(503, 'The render server is busy. Try again in a few minutes. (Server လုပ်ငန်းများနေပါသည် — ခဏနေမှ ပြန်ကြိုးစားပါ)'); }
        }
        const parsed = parseMultipart(Buffer.concat(recapChunks), recapBoundary);
        const videoPart = parsed.files['video'];
        if (!videoPart || !videoPart.data || videoPart.data.length === 0) return fail(400, 'No video file provided');

        let rawScenes;
        try { rawScenes = JSON.parse(parsed.fields['scenes'] || '[]'); } catch { return fail(400, 'scenes must be valid JSON'); }
        if (!Array.isArray(rawScenes) || rawScenes.length === 0 || rawScenes.length > 80) return fail(400, 'scenes must contain 1-80 items');

        const stamp = Date.now() + '_' + Math.random().toString(36).slice(2, 8);
        const saveTemp = (name, data) => {
          const f = path.join(UPLOADS_DIR, `recap_${stamp}_${name}`);
          fs.writeFileSync(f, data);
          tempFiles.push(f);
          return f;
        };

        const videoPath = saveTemp('video.bin', videoPart.data);
        const audioPaths = [];
        const scenes = [];
        for (let i = 0; i < rawScenes.length; i++) {
          const a = parsed.files['audio_' + i];
          if (!a || !a.data || a.data.length === 0) return fail(400, 'Missing narration audio for scene ' + i);
          audioPaths.push(saveTemp(`audio_${i}.bin`, a.data));
          const subs = [];
          (rawScenes[i].subs || []).slice(0, 30).forEach((s, j) => {
            const f = parsed.files[`sub_${i}_${j}`];
            if (f && f.data && f.data.length) subs.push({ from: s.from, to: s.to, file: saveTemp(`sub_${i}_${j}.png`, f.data) });
          });
          scenes.push({ start: rawScenes[i].start, end: rawScenes[i].end, narration: rawScenes[i].narration, subs });
        }

        const logoPart = parsed.files['logo'];
        const logoPath = logoPart && logoPart.data && logoPart.data.length ? saveTemp('logo.png', logoPart.data) : undefined;
        // Timed text layers drawn by the browser (transparent full-frame PNGs shown between start and end seconds).
        const textLayers = [];
        try {
          const times = JSON.parse(parsed.fields['textLayerTimes'] || '[]');
          (Array.isArray(times) ? times : []).slice(0, 12).forEach((t, i) => {
            const f = parsed.files['textlayer_' + i];
            if (f && f.data && f.data.length && Number.isFinite(Number(t.start)) && Number.isFinite(Number(t.end))) {
              textLayers.push({ file: saveTemp(`textlayer_${i}.png`, f.data), start: Number(t.start), end: Number(t.end) });
            }
          });
        } catch { /* ignore bad layer list */ }
        const bgmPart = parsed.files['bgm'];
        const bgmPath = bgmPart && bgmPart.data && bgmPart.data.length ? saveTemp('bgm.bin', bgmPart.data) : undefined;
        const framingRaw = parsed.fields['framing'] || 'blurred-fit';
        const outputFilename = (HOSTED || WORKER_KEY) ? `recap_${crypto.randomBytes(16).toString('hex')}.mp4` : `recap_${stamp}.mp4`;
        const outputPath = path.join(OUTPUT_DIR, outputFilename);
        console.log(`[VBS Worker] Recap render: ${scenes.length} scenes, ${scenes.reduce((n, s) => n + s.subs.length, 0)} subtitle images, framing=${framingRaw}`);
        const result = await renderRecap({
          videoPath,
          audioPaths,
          scenes,
          outputPath,
          logoPath,
          textLayers,
          bgmPath,
          blurBand: parsed.fields['blurBandH'] ? { y: parseFloat(parsed.fields['blurBandY'] || '0.8'), h: parseFloat(parsed.fields['blurBandH']) } : undefined,
          bgmVolume: parsed.fields['bgmVolume'] ? parseFloat(parsed.fields['bgmVolume']) : undefined,
          outWidth: parsed.fields['outWidth'] ? parseInt(parsed.fields['outWidth'], 10) : undefined,
          outHeight: parsed.fields['outHeight'] ? parseInt(parsed.fields['outHeight'], 10) : undefined,
          aspectRatio: parsed.fields['aspectRatio'] || undefined,
          framing: ['blurred-fit', 'letterbox', 'cover', 'contain'].includes(framingRaw) ? framingRaw : 'blurred-fit',
          blurAmount: parsed.fields['blurAmount'] ? parseInt(parsed.fields['blurAmount'], 10) : undefined,
          bgColor: parsed.fields['bgColor'] || undefined,
          adjust: parsed.fields['adjZoom'] || parsed.fields['adjBrightness'] ? {
            zoom: parsed.fields['adjZoom'], panX: parsed.fields['adjPanX'], panY: parsed.fields['adjPanY'],
            brightness: parsed.fields['adjBrightness'], contrast: parsed.fields['adjContrast'], saturation: parsed.fields['adjSaturation']
          } : undefined
        });

        const host = req.headers.host || `localhost:${PORT}`;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          filename: outputFilename,
          downloadUrl: HOSTED ? `${(process.env.PUBLIC_URL || `https://${host}`).replace(/\/+$/, '')}/output/${outputFilename}` : `http://${host}/output/${outputFilename}`,
          duration: result.duration,
          sceneDurations: result.sceneDurations
        }));
        console.log(`[VBS Worker] Recap SUCCESS (${result.duration.toFixed(1)}s)`);
      } catch (err) {
        console.error('[VBS Worker] Recap render failed:', err.message);
        fail(500, err.message);
      } finally {
        if (HOSTED && authUser) busyUsers.delete(authUser.uid);
        if (slotHeld) releaseJobSlot();
        for (const f of tempFiles) {
          try { fs.rmSync(f, { recursive: true, force: true }); } catch {}
        }
      }
    });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Endpoint not found' }));
});

// Helper for parsing multipart forms without external dependencies
function parseMultipart(buffer, boundary) {
  const boundaryBuffer = Buffer.from(`--${boundary}`);
  const result = { fields: {}, files: {} };
  let start = buffer.indexOf(boundaryBuffer);

  while (start !== -1) {
    const nextStart = buffer.indexOf(boundaryBuffer, start + boundaryBuffer.length);
    if (nextStart === -1) break;

    const partBuffer = buffer.slice(start + boundaryBuffer.length, nextStart);
    start = nextStart;

    const headerEnd = partBuffer.indexOf(Buffer.from('\r\n\r\n'));
    if (headerEnd === -1) continue;

    const headerText = partBuffer.slice(0, headerEnd).toString('utf-8');
    let bodyBuffer = partBuffer.slice(headerEnd + 4);
    if (bodyBuffer.slice(-2).toString() === '\r\n') {
      bodyBuffer = bodyBuffer.slice(0, -2);
    }

    const dispMatch = headerText.match(/name="([^"]+)"(?:;\s*filename="([^"]+)")?/i);
    if (dispMatch) {
      const fieldName = dispMatch[1];
      const filename = dispMatch[2];
      if (filename) {
        result.files[fieldName] = { filename, data: bodyBuffer };
      } else {
        result.fields[fieldName] = bodyBuffer.toString('utf-8');
      }
    }
  }

  return result;
}


// ---------------------------------------------------------------------------
// Scene-based recap renderer (same logic as src/server/recapRender.ts)
// Each scene's footage is fitted to the real length of its own narration clip and framed
// like the editor preview (blurred background / bars / crop); scenes are joined, narration is
// laid underneath, and the subtitle PNGs drawn by the browser (same code as the editor
// preview) are overlaid. No fonts need to be installed on this machine.
// ---------------------------------------------------------------------------
const RECAP_RESOLUTIONS = {
  '9:16': [1080, 1920], '1:1': [1080, 1080], '4:5': [1080, 1350],
  '4:3': [1440, 1080], '16:9': [1920, 1080], '21:9': [2560, 1080]
};

function runCmd(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    p.stdout.on('data', d => { out += d.toString(); });
    p.stderr.on('data', d => { err += d.toString(); });
    p.on('error', e => reject(new Error(`${cmd} could not start (${e.message}). Is FFmpeg installed and in PATH?`)));
    p.on('close', code => code === 0 ? resolve(out) : reject(new Error(`${cmd} exited with ${code}: ${err.slice(-1200)}`)));
  });
}

async function probeDuration(file) {
  const out = await runCmd('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file]);
  const d = parseFloat(out.trim());
  if (!isFinite(d) || d <= 0) throw new Error('Could not read media duration');
  return d;
}

async function probeSize(file) {
  const out = await runCmd('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file]);
  const [w, h] = out.trim().split(',').map(n => parseInt(n, 10));
  if (!w || !h) throw new Error('Could not read video size');
  return [w, h];
}

const evenNum = n => Math.max(2, Math.round(n / 2) * 2);

function ffColor(hex) {
  return hex && /^#[0-9a-fA-F]{6}$/.test(hex.trim()) ? '0x' + hex.trim().slice(1) : '0x000000';
}

function adjustChain(a) {
  if (!a) return '';
  const num = (v, lo, hi, d) => { const n = parseFloat(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
  const zoom = num(a.zoom, 1, 1.6, 1), px = num(a.panX, -1, 1, 0), py = num(a.panY, -1, 1, 0);
  const bri = num(a.brightness, -0.3, 0.3, 0), con = num(a.contrast, 0.6, 1.6, 1), sat = num(a.saturation, 0, 2, 1);
  const parts = [];
  if (zoom > 1.001) {
    const cw = `trunc(iw/${zoom.toFixed(4)}/2)*2`, ch = `trunc(ih/${zoom.toFixed(4)}/2)*2`;
    parts.push(`crop=${cw}:${ch}:trunc((iw-${cw})*${(0.5 + px * 0.5).toFixed(4)}/2)*2:trunc((ih-${ch})*${(0.5 + py * 0.5).toFixed(4)}/2)*2`);
    parts.push(`scale=trunc(iw*${zoom.toFixed(4)}/2)*2:trunc(ih*${zoom.toFixed(4)}/2)*2`);
  }
  if (Math.abs(bri) > 0.001 || Math.abs(con - 1) > 0.001 || Math.abs(sat - 1) > 0.001) {
    parts.push(`eq=brightness=${bri.toFixed(3)}:contrast=${con.toFixed(3)}:saturation=${sat.toFixed(3)}`);
  }
  return parts.length ? parts.join(',') + ',' : '';
}

function sceneFilterGraph(o) {
  const W = o.outW, H = o.outH;
  // Optional: blur a horizontal band of the SOURCE frame (its burned-in subtitles) before anything else.
  let src = '[0:v]';
  if (o.blurBand && o.blurBand.h > 0.005) {
    const y = Math.max(0, Math.min(0.97, o.blurBand.y)).toFixed(4);
    const h = Math.max(0.01, Math.min(1 - Number(y), o.blurBand.h)).toFixed(4);
    src = `[0:v]split=2[ob][oc];[oc]crop=iw:trunc(ih*${h}/2)*2:0:trunc(ih*${y}/2)*2,gblur=sigma=28:steps=3[obl];[ob][obl]overlay=0:trunc(main_h*${y}/2)*2[ofix];[ofix]`;
  }
  // Optional picture adjustments on the source frame: zoom/crop (with pan) and brightness / contrast / saturation.
  const adj = adjustChain(o.adjust);
  const pre = `${adj}setpts=(PTS-STARTPTS)*${o.factor.toFixed(6)},fps=${o.fps}`;
  const post = [o.holdSeconds > 0.02 ? `tpad=stop_mode=clone:stop_duration=${o.holdSeconds.toFixed(3)}` : null, 'format=yuv420p']
    .filter(Boolean).join(',');

  if (o.keepSourceFrame) return `${src}${pre},setsar=1,${post}[v]`;
  if (o.framing === 'cover') {
    return `${src}${pre},scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,${post}[v]`;
  }
  if (o.framing === 'blurred-fit') {
    const sigma = Math.max(2, Math.round(o.blurAmount / 4));
    return `${src}${pre},split=2[a][b];` +
      `[a]scale=320:180,gblur=sigma=${sigma},lutyuv=y=val*0.65,eq=saturation=1.2,scale=${W}:${H}[bg];` +
      `[b]scale=${W}:${H}:force_original_aspect_ratio=decrease[fg];` +
      `[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1,${post}[v]`;
  }
  return `${src}${pre},scale=${W}:${H}:force_original_aspect_ratio=decrease,` +
    `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=${ffColor(o.bgColor)},setsar=1,${post}[v]`;
}

async function renderRecap(opts) {
  const { videoPath, audioPaths, scenes, outputPath } = opts;
  const paddingSeconds = 0.25, minSpeed = 0.9, maxSpeed = 1.25, fps = 30;
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'recap-'));
  try {
    const sourceDuration = await probeDuration(videoPath);
    const [srcW, srcH] = await probeSize(videoPath);

    let outW, outH;
    const keepSourceFrame = !opts.outWidth && !(opts.aspectRatio && RECAP_RESOLUTIONS[opts.aspectRatio]);
    if (opts.outWidth && opts.outHeight) { outW = evenNum(Math.min(4096, opts.outWidth)); outH = evenNum(Math.min(4096, opts.outHeight)); }
    else if (opts.aspectRatio && RECAP_RESOLUTIONS[opts.aspectRatio]) { [outW, outH] = RECAP_RESOLUTIONS[opts.aspectRatio]; }
    else { outW = evenNum(srcW); outH = evenNum(srcH); }
    const framing = opts.framing || 'blurred-fit';

    const sceneDurations = [], speechDurations = [], videoParts = [], audioParts = [];
    for (let i = 0; i < scenes.length; i++) {
      const sc = scenes[i];
      const start = Math.max(0, Math.min(sourceDuration - 0.1, Number(sc.start) || 0));
      const end = Math.max(start + 0.5, Math.min(sourceDuration, Number(sc.end) || start + 5));
      const clipLen = end - start;
      const narrDur = await probeDuration(audioPaths[i]);
      const target = narrDur + paddingSeconds;

      const speed = clipLen / target;
      let cutLen = clipLen, factor, holdSeconds = 0;
      if (speed > maxSpeed) { cutLen = Math.min(clipLen, target * maxSpeed); factor = 1 / maxSpeed; }
      else if (speed < minSpeed) {
        // Narration is longer than the scene: play it only a little slower and HOLD (freeze + slow zoom-in)
        // for the rest, so the picture never jumps into the next scene's footage and stays in step with the voice.
        factor = 1 / minSpeed;
        cutLen = clipLen;
        holdSeconds = Math.max(0, target - cutLen * factor);
      }
      else factor = 1 / speed;

      const vOut = path.join(work, `v_${i}.mp4`);
      const gOpts = { fps, outW, outH, framing, keepSourceFrame, blurAmount: opts.blurAmount || 20, bgColor: opts.bgColor || '#000000', blurBand: opts.blurBand, adjust: opts.adjust };
      const encode = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-r', String(fps)];
      if (opts.freezeZoom !== false && holdSeconds >= 0.8) {
        // clip -> freeze (zoom in) -> clip [-> freeze -> clip] : long holds are split in two
        const holds = holdSeconds > 8 ? 2 : 1;
        const pieces = [];
        for (let k = 0; k <= holds; k++) {
          const a0 = (cutLen * k) / (holds + 1), a1 = (cutLen * (k + 1)) / (holds + 1);
          const cp = path.join(work, `v_${i}_c${k}.mp4`);
          await runCmd('ffmpeg', ['-y', '-v', 'error', '-ss', (start + a0).toFixed(3), '-t', (a1 - a0).toFixed(3), '-i', videoPath, '-an',
            '-filter_complex', sceneFilterGraph({ ...gOpts, factor, holdSeconds: 0 }),
            '-map', '[v]', '-t', ((a1 - a0) * factor).toFixed(3), ...encode, cp]);
          pieces.push(cp);
          if (k < holds) {
            const png = path.join(work, `v_${i}_f${k}.png`);
            await runCmd('ffmpeg', ['-y', '-v', 'error', '-ss', (start + a1).toFixed(3), '-i', videoPath, '-an', '-frames:v', '1',
              '-filter_complex', sceneFilterGraph({ ...gOpts, factor: 1, holdSeconds: 0 }), '-map', '[v]', png]);
            const frames = Math.max(2, Math.round((holdSeconds / holds) * fps));
            const fp = path.join(work, `v_${i}_z${k}.mp4`);
            await runCmd('ffmpeg', ['-y', '-v', 'error', '-i', png,
              '-vf', `scale=trunc(iw*1.5/2)*2:-2,zoompan=z='1+0.12*on/${frames}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${outW}x${outH}:fps=${fps},format=yuv420p`,
              '-frames:v', String(frames), ...encode, fp]);
            pieces.push(fp);
          }
        }
        const lst = path.join(work, `v_${i}_list.txt`);
        fs.writeFileSync(lst, pieces.map(x => `file '${x.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n'));
        await runCmd('ffmpeg', ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', lst, '-t', target.toFixed(3), '-c', 'copy', vOut]);
      } else {
        await runCmd('ffmpeg', ['-y', '-v', 'error', '-ss', start.toFixed(3), '-t', cutLen.toFixed(3), '-i', videoPath, '-an',
          '-filter_complex', sceneFilterGraph({ ...gOpts, factor, holdSeconds }),
          '-map', '[v]', '-t', target.toFixed(3), ...encode, vOut]);
      }

      const aOut = path.join(work, `a_${i}.wav`);
      await runCmd('ffmpeg', ['-y', '-v', 'error', '-i', audioPaths[i],
        '-af', `apad=pad_dur=${paddingSeconds.toFixed(3)},atrim=0:${target.toFixed(3)},aresample=44100`, '-ac', '2', aOut]);

      videoParts.push(vOut); audioParts.push(aOut); sceneDurations.push(target); speechDurations.push(narrDur);
    }

    const writeList = (name, files) => {
      const f = path.join(work, name);
      fs.writeFileSync(f, files.map(x => `file '${x.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n'));
      return f;
    };
    const joinedVideo = path.join(work, 'joined.mp4');
    await runCmd('ffmpeg', ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', writeList('v.txt', videoParts), '-c', 'copy', joinedVideo]);
    const joinedAudio = path.join(work, 'joined.wav');
    await runCmd('ffmpeg', ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', writeList('a.txt', audioParts), '-c', 'copy', joinedAudio]);
    const totalDuration = sceneDurations.reduce((a, b) => a + b, 0);

    // Subtitle track from the browser-drawn PNGs, timed from the real narration lengths.
    const timeline = [];
    let offset = 0;
    scenes.forEach((sc, i) => {
      const speech = speechDurations[i];
      let cursor = 0;
      for (const sub of sc.subs || []) {
        if (!sub.file || !fs.existsSync(sub.file)) continue;
        const a = Math.max(cursor, Math.min(1, Number(sub.from) || 0));
        const b = Math.max(a, Math.min(1, Number(sub.to) || 1));
        if (b - a <= 0) continue;
        timeline.push({ file: sub.file, start: offset + a * speech, end: offset + b * speech });
        cursor = b;
      }
      offset += sceneDurations[i];
    });

    let subsList = null;
    if (timeline.length > 0) {
      const blank = path.join(work, 'blank.png');
      await runCmd('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', `color=c=0x00000000:s=${outW}x${outH},format=rgba`, '-frames:v', '1', blank]);
      const q = f => f.replace(/\\/g, '/').replace(/'/g, "'\\''");
      const lines = ['ffconcat version 1.0'];
      let t = 0;
      for (const seg of timeline) {
        if (seg.start - t > 0.001) lines.push(`file '${q(blank)}'`, `duration ${(seg.start - t).toFixed(3)}`);
        const d = Math.max(0.04, seg.end - Math.max(seg.start, t));
        lines.push(`file '${q(seg.file)}'`, `duration ${d.toFixed(3)}`);
        t = Math.max(seg.start, t) + d;
      }
      if (totalDuration - t > 0.001) lines.push(`file '${q(blank)}'`, `duration ${(totalDuration - t).toFixed(3)}`);
      lines.push(`file '${q(blank)}'`);
      subsList = path.join(work, 'subs.txt');
      fs.writeFileSync(subsList, lines.join('\n'));
    }

    const finalArgs = ['-y', '-v', 'error', '-i', joinedVideo];
    let nextIn = 1;
    const subIdx = subsList ? nextIn++ : -1;
    if (subsList) finalArgs.push('-f', 'concat', '-safe', '0', '-i', subsList);
    const logoIdx = opts.logoPath ? nextIn++ : -1;
    if (opts.logoPath) finalArgs.push('-loop', '1', '-framerate', String(fps), '-i', opts.logoPath);
    const layers = Array.isArray(opts.textLayers) ? opts.textLayers : [];
    const layerIdx = layers.map(l => { finalArgs.push('-loop', '1', '-framerate', String(fps), '-i', l.file); return nextIn++; });
    const audioIdx = nextIn++;
    finalArgs.push('-i', joinedAudio);
    const bgmIdx = opts.bgmPath ? nextIn++ : -1;
    if (opts.bgmPath) finalArgs.push('-stream_loop', '-1', '-i', opts.bgmPath);

    const parts = [];
    let vLabel = null;
    if (subsList || opts.logoPath || layers.length) {
      let chain = '[0:v]';
      if (subsList) {
        parts.push(`[${subIdx}:v]fps=${fps},format=rgba[s]`);
        parts.push(`${chain}[s]overlay=0:0:format=auto:eof_action=pass[v1]`);
        chain = '[v1]';
      }
      if (opts.logoPath) {
        parts.push(`[${logoIdx}:v]format=rgba[lg]`);
        parts.push(`${chain}[lg]overlay=0:0:format=auto:shortest=1[v2]`);
        chain = '[v2]';
      }
      layers.forEach((l, k) => {
        parts.push(`[${layerIdx[k]}:v]format=rgba[tl${k}]`);
        parts.push(`${chain}[tl${k}]overlay=0:0:format=auto:shortest=1:enable='between(t,${l.start.toFixed(3)},${l.end.toFixed(3)})'[vt${k}]`);
        chain = `[vt${k}]`;
      });
      parts.push(`${chain}format=yuv420p[v]`);
      vLabel = '[v]';
    }
    let aLabel = `${audioIdx}:a:0`;
    if (opts.bgmPath) {
      // Background music: looped, set to the chosen level, ducked under the voice, faded out at the end.
      const vol = Math.max(0.02, Math.min(1, Number(opts.bgmVolume) || 0.2));
      const fadeStart = Math.max(0, totalDuration - 2);
      parts.push(`[${audioIdx}:a]aresample=44100,asplit=2[voice][vkey]`);
      parts.push(`[${bgmIdx}:a]aresample=44100,aformat=channel_layouts=stereo,volume=${vol.toFixed(3)},atrim=0:${totalDuration.toFixed(3)},afade=t=out:st=${fadeStart.toFixed(3)}:d=2[bgm]`);
      parts.push('[bgm][vkey]sidechaincompress=threshold=0.04:ratio=6:attack=20:release=500[bgmd]');
      parts.push('[voice][bgmd]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[a]');
      aLabel = '[a]';
    }
    if (parts.length) finalArgs.push('-filter_complex', parts.join(';'));
    finalArgs.push('-map', vLabel || '0:v:0', '-map', aLabel);
    if (vLabel) finalArgs.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '19', '-pix_fmt', 'yuv420p');
    else finalArgs.push('-c:v', 'copy');
    finalArgs.push('-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-shortest', outputPath);
    await runCmd('ffmpeg', finalArgs);

    return { duration: totalDuration, sceneDurations };
  } finally {
    try { fs.rmSync(work, { recursive: true, force: true }); } catch {}
  }
}

server.requestTimeout = 0; // long uploads / renders must not be cut off
server.listen(PORT, '0.0.0.0', () => {
  console.log(`[VBS Worker] HTTP Server actively listening on 0.0.0.0:${PORT}`);
  if (HOSTED) startAutoPublish();
});

// ---------------------------------------------------------------------------
// Auto-publish (hosted mode): opens a Cloudflare quick tunnel to this worker and tells the website its
// current address every minute, so phones can render on this PC with nothing to set up.
//   SITE_URL     website address (default https://tts-srt-generator.vercel.app)
//   PUBLIC_URL   if you already have a fixed https address, it is published as is and no tunnel is started
//   NO_AUTO=1    turn this off
// Needs `cloudflared` installed (https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/).
// ---------------------------------------------------------------------------
function startAutoPublish() {
  if (process.env.NO_AUTO === '1') return;
  const site = (process.env.SITE_URL || 'https://tts-srt-generator.vercel.app').replace(/\/+$/, '');
  let current = (process.env.PUBLIC_URL || '').replace(/\/+$/, '');
  const publish = async () => {
    if (!current) return;
    const ts = Date.now();
    const sig = crypto.createHmac('sha256', process.env.RENDER_SECRET).update(`${ts}.${current}`).digest('hex');
    try {
      const r = await fetch(`${site}/api/render/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: current, ts, sig }) });
      if (!r.ok) console.warn(`[Auto] website refused the address (${r.status}): ${(await r.text()).slice(0, 160)}`);
    } catch (e) { console.warn('[Auto] could not reach the website:', e.message); }
  };
  setInterval(publish, 60 * 1000);
  if (current) { console.log(`[Auto] publishing ${current} to ${site}`); void publish(); return; }

  const run = () => {
    let child;
    try { child = spawn('cloudflared', ['tunnel', '--no-autoupdate', '--url', `http://localhost:${PORT}`], { stdio: ['ignore', 'ignore', 'pipe'] }); }
    catch (e) { console.warn('[Auto] cloudflared could not start:', e.message); return; }
    child.on('error', e => {
      if (e.code === 'ENOENT') console.warn('[Auto] cloudflared is not installed - install it, or set PUBLIC_URL, to let phones use this PC automatically.');
      else console.warn('[Auto] cloudflared error:', e.message);
    });
    child.stderr.on('data', d => {
      const m = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i.exec(String(d));
      if (m && m[0] !== current) { current = m[0]; console.log(`[Auto] 📱 phones can now use this PC: ${current}`); void publish(); }
    });
    child.on('exit', code => {
      current = '';
      if (code !== null) { console.warn('[Auto] tunnel closed, restarting in 5s'); setTimeout(run, 5000); }
    });
  };
  run();
}

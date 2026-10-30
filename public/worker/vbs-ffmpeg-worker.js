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

/** Path of a video uploaded with /api/recap/upload, or null. */
function sessionVideo(id) {
  if (!/^[a-f0-9]{16}$/.test(String(id || ''))) return null;
  const f = path.join(UPLOADS_DIR, `sess_${id}.bin`);
  return fs.existsSync(f) ? f : null;
}
// Uploaded long videos are kept for 24 hours, then removed.
function cleanSessions() {
  try {
    const now = Date.now();
    for (const f of fs.readdirSync(UPLOADS_DIR)) {
      if (!f.startsWith('sess_')) continue;
      const fp = path.join(UPLOADS_DIR, f);
      if (now - fs.statSync(fp).mtimeMs > 24 * 3600 * 1000) fs.rmSync(fp, { force: true });
    }
  } catch {}
}
cleanSessions();
setInterval(cleanSessions, 3600 * 1000).unref();

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


// ---------------------------------------------------------------------------
// Whisper speech-to-text (optional, free, runs on this PC). Needs Python + `pip install faster-whisper`.
// The Python helper is embedded here and written next to the worker on first use.
// ---------------------------------------------------------------------------
const WHISPER_PY = `import sys, json
from faster_whisper import WhisperModel
audio, lang, model, device = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
def log(m):
    sys.stderr.write('[Whisper] ' + m + '\\n'); sys.stderr.flush()
def run(dev):
    log('loading model ' + model + ' on ' + dev + ' (first time = download, please wait)')
    m = WhisperModel(model, device=dev, compute_type=('float16' if dev == 'cuda' else 'int8'))
    log('model ready, listening...')
    segs, info = m.transcribe(audio, language=None if lang in ('', 'auto') else lang, vad_filter=True, beam_size=5)
    out = []
    for s in segs:
        out.append({'start': round(s.start, 2), 'end': round(s.end, 2), 'text': s.text.strip()})
        log('%.0fs / %.0fs' % (s.end, info.duration))
    return out, info
try:
    out, info = run('cuda' if device in ('auto', 'cuda') else 'cpu')
except Exception as e:
    if device == 'cpu':
        raise
    log('GPU not usable (' + str(e)[:80] + '), using CPU')
    out, info = run('cpu')
print('@@VBS@@' + json.dumps({'language': info.language, 'segments': out}, ensure_ascii=False))
`;
let pythonCmd = null;
function findPython() {
  if (pythonCmd !== null) return pythonCmd || null;
  for (const c of process.platform === 'win32' ? ['python', 'py', 'python3'] : ['python3', 'python']) {
    try {
      const r = spawnSync(c, ['-c', 'import faster_whisper'], { stdio: 'ignore', timeout: 20000 });
      if (r.status === 0) { pythonCmd = c; return c; }
    } catch {}
  }
  pythonCmd = '';
  return null;
}
let whisperAvailable = false;
try { whisperAvailable = !!findPython(); } catch {}
console.log(`[Whisper] ${whisperAvailable ? '🟢 faster-whisper ready' : '⚪ not installed (optional: pip install faster-whisper)'}`);

function runWhisper(audioFile, lang, model) {
  const py = findPython() || (pythonCmd = null, findPython());
  if (!py) return Promise.reject(new Error('Whisper is not installed on this PC. Run: pip install faster-whisper (Whisper မထည့်ရသေးပါ)'));
  const script = path.join(UPLOADS_DIR, 'vbs_whisper.py');
  fs.writeFileSync(script, WHISPER_PY);
  const safeModel = /^[A-Za-z0-9_.\/-]{1,60}$/.test(model || '') ? model : 'small';
  const safeLang = /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(lang || '') ? lang.slice(0, 2) : 'auto';
  console.log(`[Whisper] job started (model ${safeModel}, language ${safeLang})`);
  const t0 = Date.now();
  return new Promise((resolve, reject) => {
    const p = spawn(py, ['-u', script, audioFile, safeLang, safeModel, process.env.WHISPER_DEVICE || 'auto'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    const beat = setInterval(() => console.log(`[Whisper] still working... ${Math.round((Date.now() - t0) / 1000)}s`), 20000);
    p.stdout.on('data', d => { out += d.toString(); });
    p.stderr.on('data', d => { const t = d.toString(); err += t; process.stdout.write(t.endsWith('\n') ? t : t + '\n'); });
    p.on('error', e => { clearInterval(beat); reject(new Error(`Python could not start (${e.message})`)); });
    p.on('close', code => {
      clearInterval(beat);
      if (code !== 0) return reject(new Error(`Whisper exited with ${code}: ${err.slice(-600)}`));
      const i = out.lastIndexOf('@@VBS@@');
      if (i < 0) return reject(new Error('Whisper returned no result'));
      console.log(`[Whisper] done in ${Math.round((Date.now() - t0) / 1000)}s`);
      try { resolve(JSON.parse(out.slice(i + 7))); } catch (e) { reject(e); }
    });
  });
}

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
      version: '1.14.0',
      protected: !!WORKER_KEY,
      ffmpegAvailable: isFfmpegInstalled,
      whisperAvailable,
      telegramConfigured: !!(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID),
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

  // 3b. Long videos (movies): the file is sent ONCE, streamed straight to disk (no memory buffering), then reused for
  // speech extraction and for rendering. Only on your own PC worker (not on a shared hosted server).
  if (req.method === 'POST' && (pathname === '/api/recap/upload' || pathname === '/api/recap/audio')) {
    const json = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (HOSTED) { req.resume(); return json(403, { success: false, error: 'Large uploads are only available on your own PC worker.' }); }
    if (pathname === '/api/recap/upload') {
      const id = crypto.randomBytes(8).toString('hex');
      const dest = path.join(UPLOADS_DIR, `sess_${id}.bin`);
      const out = fs.createWriteStream(dest);
      let bytes = 0, failed = false;
      req.on('data', c => { bytes += c.length; });
      req.pipe(out);
      out.on('error', e => { failed = true; try { fs.rmSync(dest, { force: true }); } catch {} json(500, { success: false, error: 'Could not save the video: ' + e.message }); });
      req.on('aborted', () => { failed = true; out.destroy(); try { fs.rmSync(dest, { force: true }); } catch {} });
      out.on('finish', async () => {
        if (failed) return;
        try {
          const duration = await probeDuration(dest);
          json(200, { success: true, videoId: id, bytes, duration });
        } catch (e) {
          try { fs.rmSync(dest, { force: true }); } catch {}
          json(400, { success: false, error: 'That file is not a readable video: ' + String(e.message || e).slice(0, 160) });
        }
      });
      return;
    }
    let body = '';
    req.on('data', c => { body += c; if (body.length > 10000) req.destroy(); });
    req.on('end', async () => {
      try {
        const { videoId } = JSON.parse(body || '{}');
        const src = sessionVideo(videoId);
        if (!src) return json(404, { success: false, error: 'The uploaded video is no longer on the worker. Upload it again.' });
        // mono 16 kHz speech track, small enough to send to speech-to-text (about 20 MB per hour)
        const mp3 = path.join(UPLOADS_DIR, `sess_${videoId}_speech.mp3`);
        await runCmd('ffmpeg', ['-y', '-v', 'error', '-i', src, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'libmp3lame', '-b:a', '48k', mp3]);
        const size = fs.statSync(mp3).size;
        res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Content-Length': size });
        const rs = fs.createReadStream(mp3);
        rs.pipe(res);
        rs.on('close', () => { try { fs.rmSync(mp3, { force: true }); } catch {} });
      } catch (e) { json(500, { success: false, error: String(e.message || e).slice(0, 300) }); }
    });
    return;
  }

  // 3c. Whisper speech-to-text on this PC: JSON {videoId} (long film already uploaded) or a raw audio body.
  if (req.method === 'POST' && pathname === '/api/transcribe') {
    const json = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (HOSTED) { req.resume(); return json(403, { success: false, error: 'Whisper is only available on your own PC worker.' }); }
    const lang = urlObj.searchParams.get('lang') || 'auto';
    const model = urlObj.searchParams.get('model') || 'small';
    const finish = async (file, cleanup) => {
      try {
        const r = await runWhisper(file, lang, model);
        json(200, { success: true, ...r });
      } catch (e) { json(500, { success: false, error: String(e.message || e).slice(0, 400) }); }
      finally { if (cleanup) try { fs.rmSync(cleanup, { force: true }); } catch {} }
    };
    if ((req.headers['content-type'] || '').includes('application/json')) {
      let body = '';
      req.on('data', c => { body += c; if (body.length > 10000) req.destroy(); });
      req.on('end', async () => {
        let videoId = '';
        try { videoId = JSON.parse(body || '{}').videoId; } catch {}
        const src = sessionVideo(videoId);
        if (!src) return json(404, { success: false, error: 'The uploaded video is no longer on the worker. Upload it again.' });
        const wav = path.join(UPLOADS_DIR, `sess_${videoId}_whisper.wav`);
        try { await runCmd('ffmpeg', ['-y', '-v', 'error', '-i', src, '-vn', '-ac', '1', '-ar', '16000', wav]); }
        catch (e) { return json(500, { success: false, error: String(e.message || e).slice(0, 300) }); }
        finish(wav, wav);
      });
      return;
    }
    const raw = path.join(UPLOADS_DIR, `tr_${crypto.randomBytes(6).toString('hex')}.bin`);
    const out = fs.createWriteStream(raw);
    req.pipe(out);
    out.on('error', e => json(500, { success: false, error: 'Could not save the audio: ' + e.message }));
    req.on('aborted', () => { out.destroy(); try { fs.rmSync(raw, { force: true }); } catch {} });
    out.on('finish', () => finish(raw, raw));
    return;
  }

  // 3d. Send a finished recap video to Telegram (the bot token / chat id are set on this PC only: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID).
  if (req.method === 'POST' && pathname === '/api/telegram/send') {
    const json = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (HOSTED) { req.resume(); return json(403, { success: false, error: 'Only on your own PC worker.' }); }
    let body = '';
    req.on('data', c => { body += c; if (body.length > 10000) req.destroy(); });
    req.on('end', async () => {
      const token = process.env.TELEGRAM_BOT_TOKEN, chat = process.env.TELEGRAM_CHAT_ID;
      if (!token || !chat) return json(400, { success: false, error: 'Telegram is not set on the PC worker. Add TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID to worker.env.cmd and restart it. (PC Worker မှာ Telegram မသတ်မှတ်ရသေးပါ)' });
      try {
        const { filename, caption } = JSON.parse(body || '{}');
        const name = path.basename(String(filename || ''));
        const file = path.join(OUTPUT_DIR, name);
        if (!name || !fs.existsSync(file)) return json(404, { success: false, error: 'The video is no longer on the worker.' });
        const size = fs.statSync(file).size;
        const cap = String(caption || '').slice(0, 900);
        const api = m => `https://api.telegram.org/bot${token}/${m}`;
        if (size > 49 * 1024 * 1024) {
          const r = await fetch(api('sendMessage'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chat, text: `${cap}\n\n⚠️ Video is ${(size / 1048576).toFixed(0)} MB - over the 50 MB Telegram bot limit, so it was not uploaded.\nIt is on your PC: worker_output\\${name}` }) });
          const d = await r.json().catch(() => ({}));
          return json(200, { success: !!d.ok, sent: false, tooBig: true, error: d.ok ? undefined : d.description });
        }
        const form = new FormData();
        form.append('chat_id', String(chat));
        form.append('caption', cap);
        form.append('supports_streaming', 'true');
        form.append('video', new Blob([fs.readFileSync(file)], { type: 'video/mp4' }), name);
        const r = await fetch(api('sendVideo'), { method: 'POST', body: form });
        const d = await r.json().catch(() => ({}));
        if (!d.ok) return json(502, { success: false, error: 'Telegram: ' + String(d.description || r.status).slice(0, 200) });
        console.log(`[VBS Worker] Sent ${name} to Telegram`);
        json(200, { success: true, sent: true });
      } catch (e) { json(500, { success: false, error: String(e.message || e).slice(0, 300) }); }
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
        const sessionPath = !HOSTED ? sessionVideo(parsed.fields['videoId']) : null;
        if (parsed.fields['videoId'] && !sessionPath) return fail(404, 'The uploaded video is no longer on the worker (kept for 24 hours). Upload it again.');
        if (!sessionPath && (!videoPart || !videoPart.data || videoPart.data.length === 0)) return fail(400, 'No video file provided');

        let rawScenes;
        try { rawScenes = JSON.parse(parsed.fields['scenes'] || '[]'); } catch { return fail(400, 'scenes must be valid JSON'); }
        if (!Array.isArray(rawScenes) || rawScenes.length === 0 || rawScenes.length > 240) return fail(400, 'scenes must contain 1-240 items');

        const stamp = Date.now() + '_' + Math.random().toString(36).slice(2, 8);
        const saveTemp = (name, data) => {
          const f = path.join(UPLOADS_DIR, `recap_${stamp}_${name}`);
          fs.writeFileSync(f, data);
          tempFiles.push(f);
          return f;
        };

        const videoPath = sessionPath || saveTemp('video.bin', videoPart.data);
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
          scenes.push({ start: rawScenes[i].start, end: rawScenes[i].end, narration: rawScenes[i].narration, subs, speed: Number(rawScenes[i].speed) || 0 });
        }

        const logoPart = parsed.files['logo'];
        const logoPath = logoPart && logoPart.data && logoPart.data.length ? saveTemp('logo.png', logoPart.data) : undefined;
        // Timed text layers drawn by the browser (transparent full-frame PNGs shown between start and end seconds).
        const textLayers = [];
        try {
          const times = JSON.parse(parsed.fields['textLayerTimes'] || '[]');
          (Array.isArray(times) ? times : []).slice(0, 20).forEach((t, i) => {
            const f = parsed.files['textlayer_' + i];
            if (f && f.data && f.data.length && Number.isFinite(Number(t.start)) && Number.isFinite(Number(t.end))) {
              textLayers.push({ file: saveTemp(`textlayer_${i}.png`, f.data), start: Number(t.start), end: Number(t.end), anim: ['fade', 'slide'].includes(t.anim) ? t.anim : 'none' });
            }
          });
        } catch { /* ignore bad layer list */ }
        let fx = {};
        try { fx = JSON.parse(parsed.fields['fx'] || '{}') || {}; } catch { fx = {}; }
        const cardFile = (key) => { const c = parsed.files[key]; return c && c.data && c.data.length ? saveTemp(key + '.png', c.data) : undefined; };
        const introPath = cardFile('card_intro'), outroPath = cardFile('card_outro');
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
          fx,
          introPath,
          outroPath,
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

// Colour looks (CapCut-style presets). Applied to the picture only, before subtitles / logo / text are laid on top.
const FILTER_PRESETS = {
  cinematic: 'eq=contrast=1.12:saturation=0.9,colorbalance=rs=-0.04:bs=0.06:rh=0.07:bh=-0.05,vignette=PI/6',
  warm: 'colorbalance=rs=0.08:rm=0.06:bs=-0.08:bm=-0.05,eq=saturation=1.1',
  cool: 'colorbalance=rs=-0.06:bs=0.08:bm=0.05,eq=saturation=1.05',
  bw: 'hue=s=0,eq=contrast=1.1',
  vivid: 'eq=saturation=1.45:contrast=1.08',
  vintage: 'curves=preset=vintage,noise=alls=7:allf=t',
  matte: 'eq=contrast=0.9:brightness=0.04:saturation=0.8',
  sharp: 'unsharp=5:5:0.9:5:5:0.0',
};

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
  const { videoPath, outputPath } = opts;
  const fx = opts.fx || {};
  let scenes = opts.scenes;
  let audioPaths = opts.audioPaths;
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

    // Intro / outro cards (full-frame PNGs drawn by the browser) become two extra silent "scenes".
    const cardDur = (c, d) => Math.max(1, Math.min(8, Number(c && c.dur) || d));
    let introDur = 0;
    if (opts.introPath && fx.intro && fx.intro.on) {
      introDur = cardDur(fx.intro, 2.5);
      scenes = [{ card: { file: opts.introPath, dur: introDur }, subs: [] }, ...scenes];
      audioPaths = [null, ...audioPaths];
    }
    if (opts.outroPath && fx.outro && fx.outro.on) {
      scenes = [...scenes, { card: { file: opts.outroPath, dur: cardDur(fx.outro, 3) }, subs: [] }];
      audioPaths = [...audioPaths, null];
    }

    const sceneDurations = [], speechDurations = [], videoParts = [], audioParts = [];
    for (let i = 0; i < scenes.length; i++) {
      const sc = scenes[i];
      if (sc.card) {
        const dur = sc.card.dur;
        const vC = path.join(work, `v_${i}.mp4`);
        await runCmd('ffmpeg', ['-y', '-v', 'error', '-loop', '1', '-framerate', String(fps), '-i', sc.card.file, '-t', dur.toFixed(3),
          '-vf', `scale=${outW}:${outH}:force_original_aspect_ratio=increase,crop=${outW}:${outH},setsar=1,fps=${fps},format=yuv420p`,
          '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-r', String(fps), vC]);
        const aC = path.join(work, `a_${i}.wav`);
        await runCmd('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo', '-t', dur.toFixed(3), '-c:a', 'pcm_s16le', aC]);
        videoParts.push(vC); audioParts.push(aC); sceneDurations.push(dur); speechDurations.push(0);
        continue;
      }
      const start = Math.max(0, Math.min(sourceDuration - 0.1, Number(sc.start) || 0));
      const end = Math.max(start + 0.5, Math.min(sourceDuration, Number(sc.end) || start + 5));
      const clipLen = end - start;
      const narrDur = await probeDuration(audioPaths[i]);
      const target = narrDur + paddingSeconds;

      const speed = clipLen / target;
      let cutLen = clipLen, factor, holdSeconds = 0;
      const userSpeed = Number(sc.speed) > 0 ? Math.min(3, Math.max(0.25, Number(sc.speed))) : 0;
      if (userSpeed) {
        // chosen by the user: play the footage at this rate (0.5 = slow motion); hold the last picture if the source runs out
        factor = 1 / userSpeed;
        cutLen = Math.max(0.3, Math.min(target * userSpeed, sourceDuration - start));
        holdSeconds = Math.max(0, target - cutLen * factor);
      }
      else if (speed > maxSpeed) { cutLen = Math.min(clipLen, target * maxSpeed); factor = 1 / maxSpeed; }
      else if (speed < minSpeed) {
        // Narration is longer than the scene: play it only a little slower and HOLD (freeze + slow zoom-in)
        // for the rest, so the picture never jumps into the next scene's footage and stays in step with the voice.
        factor = 1 / minSpeed;
        cutLen = clipLen;
        holdSeconds = Math.max(0, target - cutLen * factor);
      }
      else factor = 1 / speed;

      const vOut = path.join(work, `v_${i}.mp4`);
      // A long stretch of footage told in a short narration (movie -> 15-30 min recap): instead of showing only the first
      // part of the stretch, show several short moments spread across it, so the picture follows what the voice says.
      if (!userSpeed && speed > 1.6 && fx.montage !== false && target >= 6) {
        const n = Math.max(2, Math.min(12, Math.round(target / 4)));
        const pieceLen = target / n;
        const pieces = [];
        for (let k = 0; k < n; k++) {
          const ps = start + (Math.max(0, clipLen - pieceLen) * k) / (n - 1);
          const cp = path.join(work, `v_${i}_m${k}.mp4`);
          await runCmd('ffmpeg', ['-y', '-v', 'error', '-ss', ps.toFixed(3), '-t', pieceLen.toFixed(3), '-i', videoPath, '-an',
            '-filter_complex', sceneFilterGraph({ fps, outW, outH, framing, keepSourceFrame, blurAmount: opts.blurAmount || 20, bgColor: opts.bgColor || '#000000', blurBand: opts.blurBand, adjust: opts.adjust, factor: 1, holdSeconds: 0 }),
            '-map', '[v]', '-t', pieceLen.toFixed(3), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-r', String(fps), cp]);
          pieces.push(cp);
        }
        const lstM = path.join(work, `v_${i}_mlist.txt`);
        fs.writeFileSync(lstM, pieces.map(x => `file '${x.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n'));
        await runCmd('ffmpeg', ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', lstM, '-t', target.toFixed(3), '-c', 'copy', vOut]);
        const aM = path.join(work, `a_${i}.wav`);
        await runCmd('ffmpeg', ['-y', '-v', 'error', '-i', audioPaths[i],
          '-af', `apad=pad_dur=${paddingSeconds.toFixed(3)},atrim=0:${target.toFixed(3)},aresample=44100`, '-ac', '2', aM]);
        videoParts.push(vOut); audioParts.push(aM); sceneDurations.push(target); speechDurations.push(narrDur);
        continue;
      }
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
    const XFADE = ['fade', 'fadeblack', 'fadewhite', 'dissolve', 'wipeleft', 'wiperight', 'slideleft', 'slideright', 'slideup', 'slidedown', 'circleopen', 'circleclose', 'zoomin', 'pixelize', 'radial', 'smoothleft'];
    const tType = fx.transition && XFADE.includes(fx.transition.type) ? fx.transition.type : 'none';
    let joinedOk = false;
    if (tType !== 'none' && videoParts.length > 1) {
      try {
        const lens = [];
        for (const vp of videoParts) lens.push(await probeDuration(vp));
        const td = Math.max(0.1, Math.min(1.5, Number(fx.transition.dur) || 0.5, Math.min(...lens) * 0.45));
        const inArgs = [];
        videoParts.forEach(vp => inArgs.push('-i', vp));
        const gp = [];
        videoParts.forEach((_, i) => gp.push(i < videoParts.length - 1 ? `[${i}:v]tpad=stop_mode=clone:stop_duration=${td.toFixed(3)}[p${i}]` : `[${i}:v]null[p${i}]`));
        let prev = '[p0]', off = 0;
        for (let i = 1; i < videoParts.length; i++) {
          off += lens[i - 1];
          const out = i === videoParts.length - 1 ? '[xv]' : `[x${i}]`;
          gp.push(`${prev}[p${i}]xfade=transition=${tType}:duration=${td.toFixed(3)}:offset=${off.toFixed(3)}${out}`);
          prev = out;
        }
        await runCmd('ffmpeg', ['-y', '-v', 'error', ...inArgs, '-filter_complex', gp.join(';'), '-map', '[xv]', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '19', '-r', String(fps), '-pix_fmt', 'yuv420p', joinedVideo]);
        joinedOk = true;
      } catch (e) { console.warn('[VBS Worker] transition pass failed, joining without transitions:', String(e.message || e).slice(0, 200)); }
    }
    if (!joinedOk) await runCmd('ffmpeg', ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', writeList('v.txt', videoParts), '-c', 'copy', joinedVideo]);
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
    const presetChain = FILTER_PRESETS[fx.filter] || '';
    const fIn = Math.max(0, Math.min(3, Number(fx.fadeIn) || 0)), fOut = Math.max(0, Math.min(3, Number(fx.fadeOut) || 0));
    if (subsList || opts.logoPath || layers.length || presetChain || fIn > 0 || fOut > 0) {
      let chain = '[0:v]';
      if (presetChain) { parts.push(`${chain}${presetChain}[vp]`); chain = '[vp]'; }
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
        const S = (l.start + introDur), E = (l.end + introDur);
        const D = Math.max(0.1, Math.min(0.5, (E - S) / 3));
        const fadeF = l.anim === 'fade' || l.anim === 'slide'
          ? `,fade=t=in:st=${S.toFixed(3)}:d=${D.toFixed(3)}:alpha=1,fade=t=out:st=${(E - D).toFixed(3)}:d=${D.toFixed(3)}:alpha=1` : '';
        const yExpr = l.anim === 'slide' ? `'if(lt(t,${(S + D).toFixed(3)}),(1-max(0,t-${S.toFixed(3)})/${D.toFixed(3)})*main_h*0.05,0)'` : '0';
        parts.push(`[${layerIdx[k]}:v]format=rgba${fadeF}[tl${k}]`);
        parts.push(`${chain}[tl${k}]overlay=0:${yExpr}:eval=frame:format=auto:shortest=1:enable='between(t,${S.toFixed(3)},${E.toFixed(3)})'[vt${k}]`);
        chain = `[vt${k}]`;
      });
      const fadeV = [fIn > 0 ? `fade=t=in:st=0:d=${fIn.toFixed(3)}` : '', fOut > 0 ? `fade=t=out:st=${Math.max(0, totalDuration - fOut).toFixed(3)}:d=${fOut.toFixed(3)}` : ''].filter(Boolean).join(',');
      parts.push(`${chain}${fadeV ? fadeV + ',' : ''}format=yuv420p[v]`);
      vLabel = '[v]';
    }
    let aLabel = `${audioIdx}:a:0`;
    if (opts.bgmPath) {
      // Background music: looped, set to the chosen level, (optionally) ducked under the voice, faded out at the end.
      const vol = Math.max(0.02, Math.min(1, Number(opts.bgmVolume) || 0.2));
      const fadeStart = Math.max(0, totalDuration - 2);
      const duck = !fx.duck || fx.duck.on !== false;
      const DUCK = { soft: 'threshold=0.06:ratio=3:attack=30:release=600', normal: 'threshold=0.04:ratio=6:attack=20:release=500', strong: 'threshold=0.02:ratio=12:attack=10:release=400' };
      const bgmF = `[${bgmIdx}:a]aresample=44100,aformat=channel_layouts=stereo,volume=${vol.toFixed(3)},atrim=0:${totalDuration.toFixed(3)},afade=t=out:st=${fadeStart.toFixed(3)}:d=2`;
      if (duck) {
        parts.push(`[${audioIdx}:a]aresample=44100,asplit=2[voice][vkey]`);
        parts.push(`${bgmF}[bgm]`);
        parts.push(`[bgm][vkey]sidechaincompress=${DUCK[fx.duck && fx.duck.strength] || DUCK.normal}[bgmd]`);
        parts.push('[voice][bgmd]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[a]');
      } else {
        parts.push(`[${audioIdx}:a]aresample=44100[voice]`);
        parts.push(`${bgmF}[bgmd]`);
        parts.push('[voice][bgmd]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[a]');
      }
      aLabel = '[a]';
    }
    if (fIn > 0 || fOut > 0) {
      const af = [fIn > 0 ? `afade=t=in:st=0:d=${fIn.toFixed(3)}` : '', fOut > 0 ? `afade=t=out:st=${Math.max(0, totalDuration - fOut).toFixed(3)}:d=${fOut.toFixed(3)}` : ''].filter(Boolean).join(',');
      parts.push(`${aLabel.startsWith('[') ? aLabel : `[${aLabel}]`}${af}[af]`);
      aLabel = '[af]';
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

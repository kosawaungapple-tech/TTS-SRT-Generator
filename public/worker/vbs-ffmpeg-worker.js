/**
 * VBS FFmpeg Dedicated Local PC / VPS Worker Engine
 * Runs on your local computer or VPS to process ultra-HD zero-stutter videos!
 * Port: 5005
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync, spawn } = require('child_process');

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
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, HEAD');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Expose-Headers', '*');
}

const server = http.createServer((req, res) => {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
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
      version: '1.1.0',
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
  if (req.method === 'POST' && pathname === '/process') {
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
        const args = ['-y'];

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

        args.push(
          '-c:v', 'libx264',
          '-preset', 'fast',
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
    const recapChunks = [];
    req.on('data', chunk => recapChunks.push(chunk));
    req.on('end', async () => {
      const tempFiles = [];
      const fail = (code, msg) => {
        res.writeHead(code, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: msg }));
      };
      try {
        const parsed = parseMultipart(Buffer.concat(recapChunks), recapBoundary);
        const videoPart = parsed.files['video'];
        if (!videoPart || !videoPart.data || videoPart.data.length === 0) return fail(400, 'No video file provided');

        let scenes;
        try { scenes = JSON.parse(parsed.fields['scenes'] || '[]'); } catch { return fail(400, 'scenes must be valid JSON'); }
        if (!Array.isArray(scenes) || scenes.length === 0 || scenes.length > 80) return fail(400, 'scenes must contain 1-80 items');

        const stamp = Date.now() + '_' + Math.random().toString(36).slice(2, 8);
        const saveTemp = (name, data) => {
          const f = path.join(UPLOADS_DIR, `recap_${stamp}_${name}`);
          fs.writeFileSync(f, data);
          tempFiles.push(f);
          return f;
        };

        const videoPath = saveTemp('video.bin', videoPart.data);
        const audioPaths = [];
        for (let i = 0; i < scenes.length; i++) {
          const a = parsed.files['audio_' + i];
          if (!a || !a.data || a.data.length === 0) return fail(400, 'Missing narration audio for scene ' + i);
          audioPaths.push(saveTemp(`audio_${i}.bin`, a.data));
        }

        let fontsDir;
        const fontPart = parsed.files['fontFile'];
        if (fontPart && fontPart.data && fontPart.data.length) {
          fontsDir = path.join(UPLOADS_DIR, `recapfont_${stamp}`);
          fs.mkdirSync(fontsDir, { recursive: true });
          fs.writeFileSync(path.join(fontsDir, 'custom.ttf'), fontPart.data);
          tempFiles.push(fontsDir);
        }

        const outputFilename = `recap_${stamp}.mp4`;
        const outputPath = path.join(OUTPUT_DIR, outputFilename);
        console.log(`[VBS Worker] Recap render: ${scenes.length} scenes`);
        const result = await renderRecap({
          videoPath,
          audioPaths,
          scenes,
          outputPath,
          aspectRatio: parsed.fields['aspectRatio'] || undefined,
          burnSubtitles: parsed.fields['burnSubtitles'] === 'true',
          fontFamily: parsed.fields['fontFamily'] || undefined,
          fontSize: parsed.fields['fontSize'] ? parseInt(parsed.fields['fontSize'], 10) : undefined,
          fontColor: parsed.fields['fontColor'] || undefined,
          strokeColor: parsed.fields['strokeColor'] || undefined,
          fontsDir
        });

        const host = req.headers.host || `localhost:${PORT}`;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          filename: outputFilename,
          downloadUrl: `http://${host}/output/${outputFilename}`,
          duration: result.duration,
          sceneDurations: result.sceneDurations
        }));
        console.log(`[VBS Worker] Recap SUCCESS (${result.duration.toFixed(1)}s)`);
      } catch (err) {
        console.error('[VBS Worker] Recap render failed:', err.message);
        fail(500, err.message);
      } finally {
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
// Each scene's footage is fitted to the real length of its own narration clip,
// scenes are joined, narration is laid underneath and subtitles are timed from
// the actual narration lengths.
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
  return [w - (w % 2), h - (h % 2)];
}

function recapSrtTime(sec) {
  const ms = Math.max(0, Math.round(sec * 1000));
  const p = (n, l = 2) => String(n).padStart(l, '0');
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor((ms % 3600000) / 60000))}:${p(Math.floor((ms % 60000) / 1000))},${p(ms % 1000, 3)}`;
}

function splitNarration(text, maxChars = 46) {
  const sentences = text.split(/(?<=[။!?.\n])\s*/u).map(s => s.trim()).filter(Boolean);
  const pieces = [];
  for (const s of sentences) {
    if ([...s].length <= maxChars) { pieces.push(s); continue; }
    let cur = '';
    for (const w of s.split(/\s+/)) {
      if ([...(cur + ' ' + w)].length > maxChars && cur) { pieces.push(cur.trim()); cur = w; }
      else cur = cur ? cur + ' ' + w : w;
    }
    if (cur.trim()) pieces.push(cur.trim());
  }
  return pieces.length ? pieces : [text.trim()];
}

function buildRecapSrt(items) {
  const blocks = [];
  let n = 1;
  for (const it of items) {
    if (!it.narration.trim()) continue;
    const pieces = splitNarration(it.narration);
    const totalChars = pieces.reduce((a, p) => a + [...p].length, 0) || 1;
    let t = it.offset;
    for (const piece of pieces) {
      const end = Math.min(it.offset + it.duration, t + ([...piece].length / totalChars) * it.duration);
      blocks.push(`${n++}\n${recapSrtTime(t)} --> ${recapSrtTime(end)}\n${piece}\n`);
      t = end;
    }
  }
  return blocks.join('\n');
}

function recapHexToAss(hex, fallback) {
  const c = (hex || '').replace('#', '').trim();
  if (!/^[0-9a-fA-F]{6}$/.test(c)) return fallback;
  return `&H00${c.slice(4, 6)}${c.slice(2, 4)}${c.slice(0, 2)}`.toUpperCase();
}

function escapeFilterPath(p) {
  return p.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
}

async function renderRecap(opts) {
  const { videoPath, audioPaths, scenes, outputPath } = opts;
  const paddingSeconds = 0.25, minSpeed = 0.8, maxSpeed = 1.25, fps = 30;
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'recap-'));
  try {
    const sourceDuration = await probeDuration(videoPath);
    const [srcW, srcH] = await probeSize(videoPath);
    const res = opts.aspectRatio && RECAP_RESOLUTIONS[opts.aspectRatio] ? RECAP_RESOLUTIONS[opts.aspectRatio] : [srcW, srcH];
    const [outW, outH] = res;

    const sceneDurations = [], videoParts = [], audioParts = [];
    for (let i = 0; i < scenes.length; i++) {
      const sc = scenes[i];
      const start = Math.max(0, Math.min(sourceDuration - 0.1, Number(sc.start) || 0));
      const end = Math.max(start + 0.5, Math.min(sourceDuration, Number(sc.end) || start + 5));
      const clipLen = end - start;
      const target = (await probeDuration(audioPaths[i])) + paddingSeconds;

      const speed = clipLen / target;
      let cutLen = clipLen, factor, holdSeconds = 0;
      if (speed > maxSpeed) { cutLen = Math.min(clipLen, target * maxSpeed); factor = 1 / maxSpeed; }
      else if (speed < minSpeed) { factor = 1 / minSpeed; holdSeconds = Math.max(0, target - cutLen * factor); }
      else factor = 1 / speed;

      const vOut = path.join(work, `v_${i}.mp4`);
      const vf = [
        `setpts=(PTS-STARTPTS)*${factor.toFixed(6)}`,
        `fps=${fps}`,
        `scale=${outW}:${outH}:force_original_aspect_ratio=decrease`,
        `pad=${outW}:${outH}:(ow-iw)/2:(oh-ih)/2:black`,
        'setsar=1',
        holdSeconds > 0.02 ? `tpad=stop_mode=clone:stop_duration=${holdSeconds.toFixed(3)}` : null,
        'format=yuv420p'
      ].filter(Boolean).join(',');
      await runCmd('ffmpeg', ['-y', '-v', 'error', '-ss', start.toFixed(3), '-t', cutLen.toFixed(3), '-i', videoPath, '-an',
        '-vf', vf, '-t', target.toFixed(3), '-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-r', String(fps), vOut]);

      const aOut = path.join(work, `a_${i}.wav`);
      await runCmd('ffmpeg', ['-y', '-v', 'error', '-i', audioPaths[i],
        '-af', `apad=pad_dur=${paddingSeconds.toFixed(3)},atrim=0:${target.toFixed(3)},aresample=44100`, '-ac', '2', aOut]);

      videoParts.push(vOut); audioParts.push(aOut); sceneDurations.push(target);
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

    let subtitleFilter = null;
    if (opts.burnSubtitles) {
      let offset = 0;
      const srt = buildRecapSrt(scenes.map((sc, i) => {
        const it = { offset, duration: sceneDurations[i], narration: sc.narration || '' };
        offset += sceneDurations[i];
        return it;
      }));
      if (srt.trim()) {
        const srtPath = path.join(work, 'recap.srt');
        fs.writeFileSync(srtPath, srt, 'utf-8');
        const font = (opts.fontFamily || 'Noto Sans Myanmar').split(',')[0].replace(/['",:\\]/g, '').trim() || 'Noto Sans Myanmar';
        const px = Math.max(12, Math.min(200, Math.round(opts.fontSize || Math.min(outW, outH) * 0.05)));
        const size = Math.max(4, Math.round((px * 288) / outH));
        const style = [`FontName=${font}`, `FontSize=${size}`,
          `PrimaryColour=${recapHexToAss(opts.fontColor, '&H00FFFFFF')}`,
          `OutlineColour=${recapHexToAss(opts.strokeColor, '&H00000000')}`,
          'BorderStyle=3', 'Outline=2.5', 'MarginV=40'].join(',');
        const fontsDirPart = opts.fontsDir ? `:fontsdir='${escapeFilterPath(opts.fontsDir)}'` : '';
        subtitleFilter = `subtitles='${escapeFilterPath(srtPath)}':original_size=${outW}x${outH}${fontsDirPart}:force_style='${style}'`;
      }
    }

    const finalArgs = ['-y', '-v', 'error', '-i', joinedVideo, '-i', joinedAudio, '-map', '0:v:0', '-map', '1:a:0'];
    if (subtitleFilter) finalArgs.push('-vf', subtitleFilter, '-c:v', 'libx264', '-preset', 'fast', '-crf', '19', '-pix_fmt', 'yuv420p');
    else finalArgs.push('-c:v', 'copy');
    finalArgs.push('-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-shortest', outputPath);
    await runCmd('ffmpeg', finalArgs);

    return { duration: sceneDurations.reduce((a, b) => a + b, 0), sceneDurations };
  } finally {
    try { fs.rmSync(work, { recursive: true, force: true }); } catch {}
  }
}

server.requestTimeout = 0; // long uploads / renders must not be cut off
server.listen(PORT, '0.0.0.0', () => {
  console.log(`[VBS Worker] HTTP Server actively listening on 0.0.0.0:${PORT}`);
});

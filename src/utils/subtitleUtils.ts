import { SRTSubtitle } from "../types";

/**
 * Normalizes any timestamp or seconds number to strict CapCut SubRip format:
 * HH:MM:SS,mmm (e.g. 00:00:01,250)
 */
export function normalizeSrtTimestamp(time: string | number): string {
  if (typeof time === 'number') {
    const sec = Math.max(0, isNaN(time) ? 0 : time);
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    const ms = Math.floor((sec % 1) * 1000);
    const pad = (n: number, z = 2) => String(n).padStart(z, '0');
    return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms, 3)}`;
  }

  if (!time || typeof time !== 'string') return "00:00:00,000";

  const clean = time.trim().replace(/\./g, ',');
  const parts = clean.split(',');
  const hms = parts[0] || '00:00:00';
  const msRaw = parts[1] || '000';
  const ms = msRaw.padEnd(3, '0').slice(0, 3);

  const hmsParts = hms.split(':').map(Number);
  let h = 0, m = 0, s = 0;
  if (hmsParts.length === 3) {
    [h, m, s] = hmsParts;
  } else if (hmsParts.length === 2) {
    [m, s] = hmsParts;
  } else if (hmsParts.length === 1) {
    s = hmsParts[0];
  }

  const pad = (n: number, z = 2) => String(Math.floor(isNaN(n) ? 0 : n)).padStart(z, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)},${ms}`;
}

/**
 * Common Myanmar grammatical particles that serve as ideal natural phrase boundaries
 */
export const MYANMAR_PARTICLES = [
  'အတွက်', 'ကြောင့်', 'သောအခါ', 'သည့်အခါ', 'ပြီးနောက်', 
  'သည်', 'မှာ', '၏', 'ကို', 'သို့', 'မှ', 'ဖြင့်', 'တွင်', 'က', 
  'နှင့်', '၍', 'ပြီး', 'သော', 'စဉ်', 'လည်း', 'မည့်', 'မည်', 
  'ဖြစ်ပြီး', 'ဖြစ်သည်', 'ရုံ'
];

const PARTICLE_REGEX = new RegExp(`(${MYANMAR_PARTICLES.join('|')}|\\s+|[၊။!?])`, 'g');

/**
 * Splits Myanmar and general text into natural syllables and words safely.
 * Never breaks a Myanmar syllable in the middle of stacked consonants or combining diacritics.
 */
export function splitMyanmarWordsOrSyllables(text: string): string[] {
  if (!text) return [];

  // Split on natural particles, spaces, or punctuation while keeping delimiters
  const rawTokens = text.split(PARTICLE_REGEX).filter(Boolean);
  const result: string[] = [];

  for (const token of rawTokens) {
    if (/^\s+$/.test(token) || /^[၊။!?]$/.test(token)) {
      result.push(token);
      continue;
    }

    // If token is reasonably short (<= 8 chars), keep intact
    if (token.length <= 8) {
      result.push(token);
      continue;
    }

    // Break long unbroken Myanmar token at syllable boundaries
    let cur = '';
    for (let i = 0; i < token.length; i++) {
      const char = token[i];
      const code = char.charCodeAt(0);
      const prevChar = i > 0 ? token[i - 1] : '';
      const prevCode = prevChar ? prevChar.charCodeAt(0) : 0;

      // Base consonants (U+1000 - U+1021), independent vowels (U+1022 - U+102A), digits (U+1040 - U+1049)
      const isBaseChar = (code >= 0x1000 && code <= 0x102A) || (code >= 0x1040 && code <= 0x1049);
      const prevIsVirama = prevCode === 0x1039; // Stacked consonant killer

      // Break if we hit a base character (not stacked) and current segment has at least 5-6 chars
      if (isBaseChar && !prevIsVirama && cur.length >= 6) {
        result.push(cur);
        cur = char;
      } else {
        cur += char;
      }
    }
    if (cur) result.push(cur);
  }

  return result;
}

/**
 * Wraps a single block of text into balanced lines without exceeding maxLineChars.
 * Prevents "တစ်ကြောင်းထဲနဲ့ အများကြီးဖြစ်နေခြင်း" (single line with too much text).
 * Guarantees every single line is strictly <= maxLineChars.
 */
export function wrapTextIntoLines(text: string, maxLineChars = 30, maxLines = 2): string[] {
  const clean = text.trim();
  if (!clean) return [];

  // If already contains newlines, respect them but ensure each line is capped
  if (clean.includes('\n')) {
    const rawLines = clean.split('\n').map(l => l.trim()).filter(Boolean);
    const wrapped: string[] = [];
    for (const rLine of rawLines) {
      if (rLine.length <= maxLineChars) {
        wrapped.push(rLine);
      } else {
        wrapped.push(...wrapTextIntoLines(rLine, maxLineChars, maxLines));
      }
    }
    return wrapped;
  }

  if (clean.length <= maxLineChars) {
    return [clean];
  }

  // Tokenize at safe syllable/word boundaries
  const tokens = splitMyanmarWordsOrSyllables(clean);
  const lines: string[] = [];
  let currentLine = '';

  for (const token of tokens) {
    const isSpace = /^\s+$/.test(token);
    const candidate = currentLine + token;

    if (candidate.trim().length > maxLineChars) {
      if (currentLine.trim()) {
        lines.push(currentLine.trim());
      }
      currentLine = isSpace ? '' : token;
    } else {
      currentLine += token;
    }
  }

  if (currentLine.trim()) {
    lines.push(currentLine.trim());
  }

  // If we only have 2 lines and both are <= maxLineChars, return them
  if (lines.length <= maxLines) {
    return lines;
  }

  // If more lines were produced, ensure we don't truncate text, but if maxLines is strictly 2
  // and total text is short enough to balance into 2 lines <= maxLineChars:
  if (clean.length <= maxLineChars * 2) {
    const half = Math.ceil(clean.length / 2);
    let splitIdx = half;

    // Search nearest space, comma, or syllable boundary near half
    for (let delta = 0; delta < Math.floor(clean.length / 3); delta++) {
      const right = half + delta;
      const left = half - delta;
      if (clean[right] === ' ' || clean[right] === '၊') {
        splitIdx = right + 1;
        break;
      }
      if (clean[left] === ' ' || clean[left] === '၊') {
        splitIdx = left + 1;
        break;
      }
    }

    const line1 = clean.substring(0, splitIdx).trim();
    const line2 = clean.substring(splitIdx).trim();
    if (line1 && line2 && line1.length <= maxLineChars + 4 && line2.length <= maxLineChars + 4) {
      return [line1, line2];
    }
  }

  return lines;
}

/**
 * Splits a long sentence into 1 or more subtitle cue blocks.
 * Each cue block has at most 2 lines, and no line exceeds maxLineChars (default 30).
 */
export function splitSentenceIntoCueBlocks(sentence: string, maxCharsPerCue = 52, maxLineChars = 30): string[][] {
  const clean = sentence.trim();
  if (!clean) return [];

  if (clean.length <= maxCharsPerCue) {
    const lines = wrapTextIntoLines(clean, maxLineChars, 2);
    return [lines];
  }

  // Break sentence into sub-chunks at commas, spaces, or syllables
  const tokens = splitMyanmarWordsOrSyllables(clean);
  const blocks: string[][] = [];
  let curChunk = '';

  for (const token of tokens) {
    const candidate = curChunk + token;
    if (candidate.trim().length > maxCharsPerCue) {
      if (curChunk.trim()) {
        const lines = wrapTextIntoLines(curChunk.trim(), maxLineChars, 2);
        blocks.push(lines);
      }
      curChunk = /^\s+$/.test(token) ? '' : token;
    } else {
      curChunk += token;
    }
  }

  if (curChunk.trim()) {
    const lines = wrapTextIntoLines(curChunk.trim(), maxLineChars, 2);
    blocks.push(lines);
  }

  return blocks;
}

/**
 * Sanitizes and cleans any raw SRT subtitle text into strict CapCut-compatible format:
 * - HH:MM:SS,mmm comma milliseconds
 * - Sequential indices 1..N
 * - Long unbroken lines (>34 chars) wrapped into balanced 2-line cues
 * - CRLF line endings with exactly one blank line between cues
 * - Strips empty cues
 */
export function cleanAndFormatSrtForCapCut(rawSrt: string): string {
  if (!rawSrt || !rawSrt.trim()) return '';
  const normalized = rawSrt.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const rawBlocks = normalized.split(/\n\s*\n/).filter(b => b.trim().length > 0);

  const validSubs: SRTSubtitle[] = [];

  rawBlocks.forEach((block) => {
    const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length < 2) return;

    let timeLine = lines[1];
    let textLines = lines.slice(2);
    if (!timeLine.includes('-->') && lines[0].includes('-->')) {
      timeLine = lines[0];
      textLines = lines.slice(1);
    }

    const parts = timeLine.split('-->');
    if (parts.length === 2) {
      const startSec = parseTimestampToSeconds(parts[0]);
      let endSec = parseTimestampToSeconds(parts[1]);
      if (isNaN(startSec) || startSec < 0) return;
      if (isNaN(endSec) || endSec <= startSec) {
        endSec = startSec + 1.5;
      }

      const wrappedLines: string[] = [];
      textLines.forEach(l => {
        if (l.length > 32) {
          wrappedLines.push(...wrapTextIntoLines(l, 30, 2));
        } else {
          wrappedLines.push(l);
        }
      });

      const text = wrappedLines.join('\n').trim();
      if (!text) return;

      validSubs.push({
        index: validSubs.length + 1,
        startTime: normalizeSrtTimestamp(startSec),
        endTime: normalizeSrtTimestamp(endSec),
        text
      });
    }
  });

  return generateSRT(validSubs);
}

/**
 * Advanced Myanmar & Multi-Language Subtitle Chunker
 * Rules:
 * 1. Max 32-34 characters per line
 * 2. Max 2 lines per block
 * 3. Proportional timing based on characters + pause weights
 * 4. Never creates an oversized single line
 */
export function generateOptimizedSubtitles(text: string, totalDuration: number): SRTSubtitle[] {
  if (!text || text.trim().length === 0) return [];

  // 1. Initial split by major sentence delimiters (။, \n, !, ?)
  const rawSentences = text
    .split(/([။!?\n]+)/g)
    .filter(Boolean);

  const unifiedSentences: string[] = [];
  for (let i = 0; i < rawSentences.length; i++) {
    const part = rawSentences[i].trim();
    if (!part) continue;

    if (/[။!?\n]+/.test(part)) {
      if (unifiedSentences.length > 0) {
        unifiedSentences[unifiedSentences.length - 1] += ' ' + part.replace(/\n+/g, ' ');
      } else {
        unifiedSentences.push(part);
      }
    } else {
      unifiedSentences.push(part);
    }
  }

  // 2. Break sentences into clean 1-to-2 line blocks (max 54 chars per cue, max 32 chars per line)
  const finalBlocks: string[][] = [];

  for (const sentence of unifiedSentences) {
    // If sentence contains commas, also split clauses if long
    if (sentence.includes('၊') && sentence.length > 50) {
      const clauses = sentence.split(/(၊)/g).filter(Boolean);
      let curClause = '';
      for (const cl of clauses) {
        if (cl === '၊') {
          curClause += '၊';
          if (curClause.length >= 35) {
            finalBlocks.push(...splitSentenceIntoCueBlocks(curClause, 54, 32));
            curClause = '';
          }
        } else {
          curClause += cl;
        }
      }
      if (curClause.trim()) {
        finalBlocks.push(...splitSentenceIntoCueBlocks(curClause, 54, 32));
      }
    } else {
      finalBlocks.push(...splitSentenceIntoCueBlocks(sentence, 54, 32));
    }
  }

  if (finalBlocks.length === 0) return [];

  // 3. Calculate speech & pause weights for proportional, drift-free timing
  const weights: number[] = finalBlocks.map((lines) => {
    const blockText = lines.join(" ");
    let weight = Math.max(10, blockText.length);
    if (blockText.includes("။")) weight += 12; // sentence end pause
    if (blockText.includes("၊")) weight += 6;  // clause pause
    if (blockText.includes("...")) weight += 8;
    return weight;
  });

  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const subtitles: SRTSubtitle[] = [];
  let currentTime = 0;

  finalBlocks.forEach((lines, index) => {
    // Clean each line and join with \r\n
    const cleanLines = lines.map(l => l.trim()).filter(Boolean);
    const blockText = cleanLines.join("\r\n");
    const blockDuration = totalDuration * (weights[index] / Math.max(1, totalWeight));
    const isLast = index === finalBlocks.length - 1;
    const nextTime = isLast ? totalDuration : currentTime + blockDuration;

    subtitles.push({
      index: index + 1,
      startTime: normalizeSrtTimestamp(currentTime),
      endTime: normalizeSrtTimestamp(nextTime),
      text: blockText
    });

    currentTime = nextTime;
  });

  return subtitles;
}

export function generateSubtitlesFromTimestamps(text: string, totalDuration: number): SRTSubtitle[] {
  const markerRegex = /\[(\d{1,2}):(\d{1,2})\.(\d{3})\]\s*(.*?)(?=\s*\[|$)/gs;
  const subtitles: SRTSubtitle[] = [];
  let match;
  let index = 1;

  while ((match = markerRegex.exec(text)) !== null) {
    const minutes = parseInt(match[1]);
    const seconds = parseInt(match[2]);
    const milliseconds = parseInt(match[3]);
    const startTimeInSeconds = minutes * 60 + seconds + milliseconds / 1000;
    const content = match[4].trim();

    if (content) {
      // Ensure content is nicely wrapped if long
      const wrapped = wrapTextIntoLines(content, 32, 2).join('\r\n');
      subtitles.push({
        index: index++,
        startTime: normalizeSrtTimestamp(startTimeInSeconds),
        endTime: "",
        text: wrapped || content
      });
    }
  }

  // Set end times
  for (let i = 0; i < subtitles.length; i++) {
    if (i < subtitles.length - 1) {
      subtitles[i].endTime = subtitles[i + 1].startTime;
    } else {
      subtitles[i].endTime = normalizeSrtTimestamp(totalDuration);
    }

    const start = parseTimestampToSeconds(subtitles[i].startTime);
    const end = parseTimestampToSeconds(subtitles[i].endTime);
    if (end <= start) {
      subtitles[i].endTime = normalizeSrtTimestamp(start + 2);
    }

    if (end > start + 7) {
      subtitles[i].endTime = normalizeSrtTimestamp(start + 7);
    }
  }

  return subtitles;
}

/**
 * Generates 100% CapCut & NLE-compatible SubRip (.SRT) text.
 * Strict rules enforced:
 * 1. Sequential integer index (1, 2, 3...)
 * 2. Strict timestamp format: HH:MM:SS,mmm --> HH:MM:SS,mmm
 * 3. CRLF (\r\n) line breaks
 * 4. Exactly one empty line (\r\n\r\n) between blocks
 * 5. Strips empty cues and internal blank lines that break CapCut parser
 * 6. Guarantees end > start
 */
export function generateSRT(subtitles: SRTSubtitle[]): string {
  if (!subtitles || subtitles.length === 0) return "";

  const validSubs = subtitles.filter(s => s && s.text && s.text.trim().length > 0);
  if (validSubs.length === 0) return "";

  const blocks: string[] = [];

  validSubs.forEach((s) => {
    let startSec = parseTimestampToSeconds(s.startTime);
    let endSec = parseTimestampToSeconds(s.endTime);
    if (isNaN(startSec) || startSec < 0) startSec = 0;
    if (isNaN(endSec) || endSec <= startSec) {
      endSec = startSec + 1.5;
    }

    const startFormatted = normalizeSrtTimestamp(startSec);
    const endFormatted = normalizeSrtTimestamp(endSec);

    // Clean text lines: normalize line breaks, remove blank lines inside cue
    const textLines = s.text
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 0);

    if (textLines.length === 0) return;

    const blockIndex = blocks.length + 1;
    const blockContent = `${blockIndex}\r\n${startFormatted} --> ${endFormatted}\r\n${textLines.join('\r\n')}`;
    blocks.push(blockContent);
  });

  if (blocks.length === 0) return "";

  // CapCut requires sequential blocks separated by CRLF blank line, plus trailing CRLF
  return blocks.join('\r\n\r\n') + '\r\n\r\n';
}

/**
 * Creates a CapCut-ready Blob with UTF-8 BOM (\uFEFF) and MIME type text/plain;charset=utf-8.
 * UTF-8 BOM is required by Windows/CapCut Desktop to read Myanmar Unicode without decoding corruption.
 * text/plain MIME type prevents mobile browsers from appending .txt or failing CapCut file intent.
 */
export function createSrtBlob(srtContent: string): Blob {
  const normalized = srtContent.replace(/\r?\n/g, '\r\n');
  const withBom = normalized.startsWith('\uFEFF') ? normalized : `\uFEFF${normalized}`;
  return new Blob([withBom], { type: 'text/plain;charset=utf-8' });
}

/**
 * Universal browser file download helper for CapCut-compatible SRT.
 */
export function downloadSrtFile(srtContent: string, fileName: string): void {
  if (!srtContent || srtContent.trim().length === 0) return;
  const safeName = fileName.toLowerCase().endsWith('.srt') ? fileName : `${fileName}.srt`;
  const blob = createSrtBlob(srtContent);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.style.display = 'none';
  link.href = url;
  link.download = safeName;
  document.body.appendChild(link);
  link.click();
  setTimeout(() => {
    if (document.body.contains(link)) {
      document.body.removeChild(link);
    }
    URL.revokeObjectURL(url);
  }, 200);
}

export function generateASS(subtitles: SRTSubtitle[]): string {
  const header = `[Script Info]\r\nScriptType: v4.00+\r\nCollisions: Normal\r\nPlayResX: 1280\r\nPlayResY: 720\r\n\r\n[V4+ Styles]\r\nFormat: Name, Fontname, Fontsize, PrimaryColour, Bold, Italic, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV\r\nStyle: Default,Arial,40,&H00FFFFFF,0,0,1,2,0,2,10,10,10\r\n\r\n[Events]\r\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\r\n`;

  const formatASSTime = (timeStr: string) => {
    const clean = normalizeSrtTimestamp(timeStr);
    const [hms, ms] = clean.split(',');
    const [h, m, s] = hms.split(':');
    const centiseconds = Math.floor(parseInt(ms) / 10).toString().padStart(2, '0');
    return `${parseInt(h)}:${m}:${s}.${centiseconds}`;
  };

  const lines = subtitles.map(s => {
    const startTime = formatASSTime(s.startTime);
    const endTime = formatASSTime(s.endTime);
    const cleanText = s.text.replace(/\r\n/g, '\\N').replace(/\n/g, '\\N').trim();
    return `Dialogue: 0,${startTime},${endTime},Default,,0,0,0,,${cleanText}`;
  });

  return header + lines.join('\r\n');
}

export function generateLRC(subtitles: SRTSubtitle[]): string {
  const formatLRCTime = (timeStr: string) => {
    const clean = normalizeSrtTimestamp(timeStr);
    const [hms, ms] = clean.split(',');
    const [h, m, s] = hms.split(':');
    const totalMinutes = parseInt(h) * 60 + parseInt(m);
    const centiseconds = Math.floor(parseInt(ms) / 10).toString().padStart(2, '0');
    return `[${totalMinutes.toString().padStart(2, '0')}:${s}.${centiseconds}]`;
  };

  return subtitles.map(s => {
    const startTime = formatLRCTime(s.startTime);
    const cleanText = s.text.replace(/\r\n/g, ' ').replace(/\n/g, ' ');
    return `${startTime}${cleanText}`;
  }).join('\r\n');
}

export function parseTimestampToSeconds(timestamp: string): number {
  if (!timestamp) return 0;
  const clean = timestamp.trim().replace(/\./g, ',');
  const [hms, ms = '0'] = clean.split(',');
  const parts = hms.split(':').map(Number);
  if (parts.length === 3) {
    const [h, m, s] = parts;
    return (h || 0) * 3600 + (m || 0) * 60 + (s || 0) + (Number(ms) / 1000);
  } else if (parts.length === 2) {
    const [m, s] = parts;
    return (m || 0) * 60 + (s || 0) + (Number(ms) / 1000);
  }
  return 0;
}

/**
 * Shifts an entire SRT text content by offsetSeconds (+ or -),
 * preserving exact block numbers and formatting.
 */
export function shiftSrtContent(srtText: string, offsetSeconds: number): string {
  if (!srtText || offsetSeconds === 0) return srtText;
  const raw = srtText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const blocks = raw.split(/\n\s*\n/).filter(b => b.trim().length > 0);

  const shiftedBlocks: string[] = [];

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length < 2) continue;

    let timeLineIdx = 1;
    if (!lines[0].match(/^\d+$/)) {
      timeLineIdx = 0;
    }

    const timeParts = lines[timeLineIdx].split('-->');
    if (timeParts.length === 2) {
      const origStart = parseTimestampToSeconds(timeParts[0]);
      const origEnd = parseTimestampToSeconds(timeParts[1]);

      const newStart = Math.max(0, origStart + offsetSeconds);
      const newEnd = Math.max(newStart + 0.1, origEnd + offsetSeconds);

      lines[timeLineIdx] = `${normalizeSrtTimestamp(newStart)} --> ${normalizeSrtTimestamp(newEnd)}`;
      lines[0] = String(shiftedBlocks.length + 1);
      shiftedBlocks.push(lines.join('\r\n'));
    }
  }

  return shiftedBlocks.join('\r\n\r\n') + '\r\n\r\n';
}

/**
 * Shifts subtitle timestamps by offsetSeconds when audio is trimmed,
 * and discards subtitles that fall beyond maxDuration.
 */
export function shiftSubtitles(
  subtitles: SRTSubtitle[], 
  offsetSeconds: number, 
  maxDuration?: number
): SRTSubtitle[] {
  if (offsetSeconds <= 0 && !maxDuration) return subtitles;

  let validIndex = 1;
  const result: SRTSubtitle[] = [];

  for (const sub of subtitles) {
    const origStart = parseTimestampToSeconds(sub.startTime);
    const origEnd = parseTimestampToSeconds(sub.endTime);

    if (origEnd <= offsetSeconds) continue;

    const shiftedStart = Math.max(0, origStart - offsetSeconds);
    const shiftedEnd = Math.max(0, origEnd - offsetSeconds);

    if (maxDuration !== undefined && shiftedStart >= maxDuration) continue;

    const finalEnd = maxDuration !== undefined ? Math.min(maxDuration, shiftedEnd) : shiftedEnd;

    if (finalEnd > shiftedStart) {
      result.push({
        index: validIndex++,
        startTime: normalizeSrtTimestamp(shiftedStart),
        endTime: normalizeSrtTimestamp(finalEnd),
        text: sub.text
      });
    }
  }

  return result;
}

import { SRTSubtitle } from "../types";
import { formatTime } from "./audioUtils";

/**
 * Advanced Myanmar Subtitle Chunker
 * Rules: 
 * 1. Max 35 characters per line
 * 2. Max 2 lines per block
 * 3. Max duration per block: 3.5 seconds
 * 4. Split at ။, ၊, or space
 */

export function generateOptimizedSubtitles(text: string, totalDuration: number): SRTSubtitle[] {
  const blocks: string[] = [];
  
  // 1. Initial split by major punctuation to keep sentences together where possible
  const segments = text.split(/([။၊])/g);
  let currentBlockText = "";
  
  for (let i = 0; i < segments.length; i++) {
    const part = segments[i];
    if (!part) continue;
    
    // If it's punctuation, attach to previous text
    if (part === "။" || part === "၊") {
      if (blocks.length > 0) {
        blocks[blocks.length - 1] += part;
      } else {
        currentBlockText += part;
      }
      continue;
    }

    // Split part into words/chunks by space
    const words = part.split(/\s+/);
    for (const word of words) {
      if (!word) continue;
      
      // Check if adding this word exceeds limits (rough check for block size)
      // We aim for roughly 70 chars per 2-line block (35 * 2)
      if ((currentBlockText + " " + word).length > 60) {
        if (currentBlockText) blocks.push(currentBlockText.trim());
        currentBlockText = word;
      } else {
        currentBlockText += (currentBlockText ? " " : "") + word;
      }
    }
  }
  
  if (currentBlockText) blocks.push(currentBlockText.trim());

  // 2. Refine blocks into 2-line structure with 35 char lines
  const refinedBlocks: string[][] = []; // [line1, line2][]
  
  for (const block of blocks) {
    const lines: string[] = [];
    const words = block.split(/\s+/);
    let currentLine = "";

    for (const word of words) {
      if ((currentLine + " " + word).trim().length > 35) {
        if (currentLine) lines.push(currentLine.trim());
        currentLine = word;
      } else {
        currentLine += (currentLine ? " " : "") + word;
      }
    }
    if (currentLine) lines.push(currentLine.trim());

    // Group lines into 2-line blocks
    for (let i = 0; i < lines.length; i += 2) {
      const pair = [lines[i]];
      if (lines[i+1]) pair.push(lines[i+1]);
      refinedBlocks.push(pair);
    }
  }

  // 3. Split blocks so no block exceeds recommended reading speed or character limit (~55 chars)
  const maxCharsPerBlock = 55;
  const finalBlocks: string[][] = [];

  for (const pair of refinedBlocks) {
    const combined = pair.join(" ");
    if (combined.length > maxCharsPerBlock) {
      // Split into single line blocks
      for (const line of pair) {
        if (line.length > maxCharsPerBlock) {
          const words = line.split(/\s+/);
          let current = "";
          for (const w of words) {
            if ((current + " " + w).trim().length > 35) {
              if (current) finalBlocks.push([current.trim()]);
              current = w;
            } else {
              current += (current ? " " : "") + w;
            }
          }
          if (current) finalBlocks.push([current.trim()]);
        } else {
          finalBlocks.push([line]);
        }
      }
    } else {
      finalBlocks.push(pair);
    }
  }

  if (finalBlocks.length === 0) return [];

  // 4. Calculate speech & pause weights for proportional, drift-free timing
  // In Myanmar language:
  // "။" indicates a sentence end pause (~0.4s - 0.5s)
  // "၊" indicates a clause pause (~0.2s - 0.3s)
  const weights: number[] = finalBlocks.map((lines) => {
    const text = lines.join(" ");
    let weight = Math.max(8, text.length);
    if (text.includes("။")) weight += 10; // pause bonus
    if (text.includes("၊")) weight += 5;
    if (text.includes("...")) weight += 8;
    return weight;
  });

  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const subtitles: SRTSubtitle[] = [];
  let currentTime = 0;

  finalBlocks.forEach((lines, index) => {
    const blockText = lines.join("\r\n");
    const blockDuration = totalDuration * (weights[index] / Math.max(1, totalWeight));
    const isLast = index === finalBlocks.length - 1;
    const nextTime = isLast ? totalDuration : currentTime + blockDuration;

    subtitles.push({
      index: index + 1,
      startTime: formatTime(currentTime),
      endTime: formatTime(nextTime),
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
      subtitles.push({
        index: index++,
        startTime: formatTime(startTimeInSeconds),
        endTime: "", // Will be filled next
        text: content
      });
    }
  }

  // Set end times
  for (let i = 0; i < subtitles.length; i++) {
    if (i < subtitles.length - 1) {
       subtitles[i].endTime = subtitles[i + 1].startTime;
    } else {
       subtitles[i].endTime = formatTime(totalDuration);
    }
    
    // Safety check: if end time < start time (due to malformed input)
    const start = parseTimestampToSeconds(subtitles[i].startTime);
    const end = parseTimestampToSeconds(subtitles[i].endTime);
    if (end <= start) {
      subtitles[i].endTime = formatTime(start + 2); // Default 2s duration
    }
    
    // Max duration cap to prevent overlap issues
    if (end > start + 7) {
      subtitles[i].endTime = formatTime(start + 7);
    }
  }

  return subtitles;
}

export function generateSRT(subtitles: SRTSubtitle[]): string {
  if (!subtitles || subtitles.length === 0) return "";
  
  return subtitles
    .filter(s => s.text && s.text.trim().length > 0)
    .map(s => {
      // Ensure strict format: Index\r\nTime --> Time\r\nText\r\n
      // Index must be an integer, HH:MM:SS,mmm format for times
      // Comma separator for milliseconds is standard for SubRip
      // CapCut is very strict about HH:MM:SS,mmm format
      const startTime = s.startTime.replace(/\./g, ',');
      const endTime = s.endTime.replace(/\./g, ',');
      // Force CRLF for the text lines inside the block
      const text = s.text.trim().replace(/\r?\n/g, '\r\n');
      return `${s.index}\r\n${startTime} --> ${endTime}\r\n${text}\r\n`;
    })
    .join('\r\n'); // Ensures exactly one blank line between blocks as requested by CapCut
}

export function generateASS(subtitles: SRTSubtitle[]): string {
  const header = `[Script Info]\r\nScriptType: v4.00+\r\nCollisions: Normal\r\nPlayResX: 1280\r\nPlayResY: 720\r\n\r\n[V4+ Styles]\r\nFormat: Name, Fontname, Fontsize, PrimaryColour, Bold, Italic, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV\r\nStyle: Default,Arial,40,&H00FFFFFF,0,0,1,2,0,2,10,10,10\r\n\r\n[Events]\r\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\r\n`;
  
  const formatASSTime = (timeStr: string) => {
    // Input is HH:MM:SS,mmm
    const [hms, ms] = timeStr.split(',');
    const [h, m, s] = hms.split(':');
    const centiseconds = Math.floor(parseInt(ms) / 10).toString().padStart(2, '0');
    // ASS format often drops leading zero on hours if it's 0, but H:MM:SS.CC is standard
    return `${parseInt(h)}:${m}:${s}.${centiseconds}`;
  };

  const lines = subtitles.map(s => {
    const startTime = formatASSTime(s.startTime);
    const endTime = formatASSTime(s.endTime);
    // Remove \r\n from text for ASS and replace with \N
    const cleanText = s.text.replace(/\r\n/g, '\\N').replace(/\n/g, '\\N').trim();
    return `Dialogue: 0,${startTime},${endTime},Default,,0,0,0,,${cleanText}`;
  });

  return header + lines.join('\r\n');
}

export function generateLRC(subtitles: SRTSubtitle[]): string {
  const formatLRCTime = (timeStr: string) => {
    // Input is HH:MM:SS,mmm
    const [hms, ms] = timeStr.split(',');
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

export interface SrtCue {
  index: number;
  start: string;
  end: string;
  text: string;
  speaker?: string;
}

export function parseSrtToCues(srtText: string): SrtCue[] {
  if (!srtText) return [];
  // Strip UTF-8 BOM and clean
  const clean = srtText.replace(/^\uFEFF/, '').trim();
  if (!clean || clean.startsWith('<') || clean.toLowerCase().includes('<!doctype') || clean.toLowerCase().includes('<html')) {
    return [];
  }

  const raw = clean.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const blocks = raw.split(/\n\s*\n/).filter(b => b.trim().length > 0);

  const cues: SrtCue[] = [];

  // Attempt 1: Standard block-by-block parsing
  for (const block of blocks) {
    const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length >= 2) {
      const timeLineIdx = lines.findIndex(l => /-->|->|–>|—>/.test(l));
      if (timeLineIdx !== -1) {
        const timeLine = lines[timeLineIdx];
        const textLines = lines.slice(timeLineIdx + 1);
        let index = cues.length + 1;
        if (timeLineIdx > 0) {
          const parsedIdx = parseInt(lines[0].replace(/[^\d]/g, ''), 10);
          if (!isNaN(parsedIdx)) index = parsedIdx;
        }

        const timeParts = timeLine.split(/\s*(?:-->|->|–>|—>)\s*/);
        if (timeParts.length >= 2) {
          const start = timeParts[0].trim();
          const end = timeParts[1].trim();
          let fullText = textLines.join(' ').trim();
          let speaker: string | undefined;

          const speakerMatch = fullText.match(/^\[(?:Speaker\s+)?([^\]]+)\]:\s*(.*)$/i);
          if (speakerMatch) {
            speaker = speakerMatch[1];
            fullText = speakerMatch[2];
          }

          cues.push({
            index,
            start,
            end,
            text: fullText,
            speaker
          });
        }
      }
    }
  }

  // Attempt 2: If block splitting found 0 cues, use full regex scanner across raw text
  if (cues.length === 0) {
    const regex = /(?:(\d+)\s*\n)?([0-9:,\.\s]+)\s*(?:-->|->|–>|—>)\s*([0-9:,\.\s]+)\s*\n([\s\S]*?)(?=(?:\n\s*\d+\s*\n|\n\s*[0-9:,\.]+\s*(?:-->|->)|\n\s*$|$))/gi;
    let match: RegExpExecArray | null;
    let counter = 1;
    while ((match = regex.exec(raw)) !== null) {
      const idx = match[1] ? parseInt(match[1], 10) : counter++;
      const start = match[2].trim();
      const end = match[3].trim();
      let cueText = match[4].replace(/\n/g, ' ').trim();
      let speaker: string | undefined;

      const speakerMatch = cueText.match(/^\[(?:Speaker\s+)?([^\]]+)\]:\s*(.*)$/i);
      if (speakerMatch) {
        speaker = speakerMatch[1];
        cueText = speakerMatch[2];
      }

      if (cueText) {
        cues.push({
          index: idx,
          start,
          end,
          text: cueText,
          speaker
        });
      }
    }
  }

  return cues;
}

export function parseTimestampToSeconds(timestamp: string): number {
  if (!timestamp) return 0;
  const clean = timestamp.trim().replace(/\./g, ',');
  const [hms, ms = '0'] = clean.split(',');
  const parts = hms.split(':').map(Number);
  if (parts.length === 3) {
    const [h, m, s] = parts;
    return h * 3600 + m * 60 + s + (Number(ms) / 1000);
  } else if (parts.length === 2) {
    const [m, s] = parts;
    return m * 60 + s + (Number(ms) / 1000);
  }
  return 0;
}

/**
 * Shifts an entire SRT text content by offsetSeconds (+ or -),
 * preserving exact block numbers and formatting.
 */
export function shiftSrtContent(srtText: string, offsetSeconds: number): string {
  if (!srtText || offsetSeconds === 0) return srtText;
  const raw = srtText.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const blocks = raw.split(/\n\s*\n/).filter(b => b.trim().length > 0);

  const shiftedBlocks: string[] = [];

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length < 2) continue;

    const timeLineIdx = lines.findIndex(l => /-->|->|–>|—>/.test(l));
    if (timeLineIdx !== -1) {
      const timeParts = lines[timeLineIdx].split(/\s*(?:-->|->|–>|—>)\s*/);
      if (timeParts.length >= 2) {
        const origStart = parseTimestampToSeconds(timeParts[0]);
        const origEnd = parseTimestampToSeconds(timeParts[1]);

        const newStart = Math.max(0, origStart + offsetSeconds);
        const newEnd = Math.max(newStart + 0.1, origEnd + offsetSeconds);

        lines[timeLineIdx] = `${formatTime(newStart).replace(/\./g, ',')} --> ${formatTime(newEnd).replace(/\./g, ',')}`;
        lines[0] = String(shiftedBlocks.length + 1);
        shiftedBlocks.push(lines.join('\r\n'));
      }
    }
  }

  return shiftedBlocks.join('\r\n\r\n') + '\r\n';
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

    // If subtitle ended before trim point, skip
    if (origEnd <= offsetSeconds) continue;

    const shiftedStart = Math.max(0, origStart - offsetSeconds);
    const shiftedEnd = Math.max(0, origEnd - offsetSeconds);

    if (maxDuration !== undefined && shiftedStart >= maxDuration) continue;

    const finalEnd = maxDuration !== undefined ? Math.min(maxDuration, shiftedEnd) : shiftedEnd;

    if (finalEnd > shiftedStart) {
      result.push({
        index: validIndex++,
        startTime: formatTime(shiftedStart),
        endTime: formatTime(finalEnd),
        text: sub.text
      });
    }
  }

  return result;
}

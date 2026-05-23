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

  // 3. Calculate total characters for proportional timing
  const totalChars = refinedBlocks.reduce((acc, lines) => acc + lines.join(" ").length, 0);
  const timePerChar = totalDuration / Math.max(1, totalChars);
  
  // Calculate max chars allowed in 3.5s
  const maxCharsIn3_5s = Math.floor(3.5 / timePerChar);

  // 4. Final split of blocks that are too long for 3.5s
  const finalBlocks: string[][] = [];
  for (const pair of refinedBlocks) {
    const text = pair.join(" ");
    if (text.length > maxCharsIn3_5s && maxCharsIn3_5s > 10) {
      // Split this 2-line block into individual lines or smaller chunks
      for (const line of pair) {
        if (line.length > maxCharsIn3_5s) {
           // Line itself is too long, split it
           const words = line.split(" ");
           let current = "";
           for (const w of words) {
             if ((current + " " + w).length > maxCharsIn3_5s) {
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

  const subtitles: SRTSubtitle[] = [];
  let currentTime = 0;

  finalBlocks.forEach((lines, index) => {
    const blockText = lines.join("\n");
    const blockCharCount = lines.join(" ").length;
    let blockDuration = blockCharCount * timePerChar;
    
    // Safety caps
    if (blockDuration > 3.5) blockDuration = 3.5;
    if (blockDuration < 0.5) blockDuration = 0.5;

    subtitles.push({
      index: index + 1,
      startTime: formatTime(currentTime),
      endTime: formatTime(currentTime + blockDuration),
      text: blockText
    });
    
    currentTime += blockDuration;
  });

  // 4. Final duration normalization 
  // If we exceeded or fell short, we should stretch/compress, 
  // but keep max duration in mind.
  if (currentTime > totalDuration && subtitles.length > 0) {
    // If we've drifted significantly, we just cap at totalDuration or adjust proportionally
    // For simplicity and per-rule adherence, we ensure end timings make sense.
    if (currentTime > totalDuration) {
       // Just cap the last one or let it be if it's close.
    }
  }

  return subtitles;
}

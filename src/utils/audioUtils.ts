import * as lamejs from 'lamejs';

/**
 * Converts raw PCM data (16-bit, mono, 24000Hz) to a WAV file Blob.
 * Strictly follow the 44-byte header requirement.
 */
export function pcmToWav(pcmData: Uint8Array, sampleRate: number = 24000): Blob {
  const header = new ArrayBuffer(44);
  const view = new DataView(header);

  // RIFF identifier
  writeString(view, 0, 'RIFF');
  // File length
  view.setUint32(4, 36 + pcmData.length, true);
  // RIFF type
  writeString(view, 8, 'WAVE');
  // Format chunk identifier
  writeString(view, 12, 'fmt ');
  // Format chunk length
  view.setUint32(16, 16, true);
  // Sample format (1 is PCM)
  view.setUint16(20, 1, true);
  // Channel count
  view.setUint16(22, 1, true);
  // Sample rate
  view.setUint32(24, sampleRate, true);
  // Byte rate (sampleRate * blockAlign)
  view.setUint32(28, sampleRate * 2, true);
  // Block align (channelCount * bytesPerSample)
  view.setUint16(32, 2, true);
  // Bits per sample
  view.setUint16(34, 16, true);
  // Data chunk identifier
  writeString(view, 36, 'data');
  // Data chunk length
  view.setUint32(40, pcmData.length, true);

  console.log(`audioUtils: Generated WAV with ${pcmData.length} bytes of PCM data. Total size: ${header.byteLength + pcmData.length} bytes.`);

  return new Blob([header, pcmData], { type: 'audio/wav' });
}

/**
 * Converts raw PCM data (16-bit, mono, 24000Hz) to an MP3 file Blob.
 */
export function pcmToMp3(pcmData: Uint8Array, sampleRate: number = 24000): Blob {
  // Ensure the length is even for 16-bit PCM
  const length = Math.floor(pcmData.length / 2);
  const pcmShorts = new Int16Array(pcmData.buffer, pcmData.byteOffset, length);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mp3encoder = new (lamejs as any).Mp3Encoder(1, sampleRate, 128);
  const mp3Data = [];
  
  const sampleBlockSize = 1152;
  for (let i = 0; i < pcmShorts.length; i += sampleBlockSize) {
    const sampleChunk = pcmShorts.subarray(i, i + sampleBlockSize);
    const mp3buf = mp3encoder.encodeBuffer(sampleChunk);
    if (mp3buf.length > 0) {
      mp3Data.push(new Uint8Array(mp3buf));
    }
  }
  
  const mp3buf = mp3encoder.flush();
  if (mp3buf.length > 0) {
    mp3Data.push(new Uint8Array(mp3buf));
  }
  
  return new Blob(mp3Data, { type: 'audio/mpeg' });
}

/**
 * Converts base64 PCM data to a WAV Blob.
 */
export function pcmBase64ToWav(base64: string, sampleRate: number = 24000): Blob {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return pcmToWav(bytes, sampleRate);
}

/**
 * Converts an AudioBuffer to a WAV Blob.
 */
export function audioBufferToWav(buffer: AudioBuffer): Blob {
  const numOfChan = buffer.numberOfChannels;
  const length = buffer.length * numOfChan * 2 + 44;
  const buffer_out = new ArrayBuffer(length);
  const view = new DataView(buffer_out);
  const channels = [];
  let i;
  let sample;
  let offset = 0;
  let pos = 0;

  function setUint16(data: number) {
    view.setUint16(pos, data, true);
    pos += 2;
  }

  function setUint32(data: number) {
    view.setUint32(pos, data, true);
    pos += 4;
  }

  // write WAVE header
  setUint32(0x46464952);                         // "RIFF"
  setUint32(length - 8);                         // file length - 8
  setUint32(0x45564157);                         // "WAVE"

  setUint32(0x20746d66);                         // "fmt " chunk
  setUint32(16);                                 // length = 16
  setUint16(1);                                  // PCM (uncompressed)
  setUint16(numOfChan);
  setUint32(buffer.sampleRate);
  setUint32(buffer.sampleRate * 2 * numOfChan);  // avg. bytes/sec
  setUint16(numOfChan * 2);                      // block-align
  setUint16(16);                                 // 16-bit (hardcoded)

  setUint32(0x61746164);                         // "data" - chunk
  setUint32(length - pos - 4);                   // chunk length

  // write interleaved data
  for (i = 0; i < buffer.numberOfChannels; i++) {
    channels.push(buffer.getChannelData(i));
  }

  while (pos < length) {
    for (i = 0; i < numOfChan; i++) {             // interleave channels
      sample = Math.max(-1, Math.min(1, channels[i][offset])); // clamp
      sample = (sample < 0 ? sample * 0x8000 : sample * 0x7FFF) | 0; // scale to 16-bit signed int
      view.setInt16(pos, sample, true);          // write 16-bit sample
      pos += 2;
    }
    offset++;                                     // next source sample
  }

  return new Blob([buffer_out], { type: "audio/wav" });
}

/**
 * Converts an AudioBuffer to an MP3 Blob.
 */
export function audioBufferToMp3(buffer: AudioBuffer): Blob {
  const numberOfChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mp3encoder = new (lamejs as any).Mp3Encoder(numberOfChannels, sampleRate, 128);
  const mp3Data = [];

  const left = buffer.getChannelData(0);
  const right = numberOfChannels > 1 ? buffer.getChannelData(1) : null;

  // Convert Float32 to Int16
  const toInt16 = (f32: Float32Array) => {
    const i16 = new Int16Array(f32.length);
    for (let i = 0; i < f32.length; i++) {
        const s = Math.max(-1, Math.min(1, f32[i]));
        i16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return i16;
  };

  const leftI16 = toInt16(left);
  const rightI16 = right ? toInt16(right) : null;

  const sampleBlockSize = 1152;
  for (let i = 0; i < leftI16.length; i += sampleBlockSize) {
    const leftChunk = leftI16.subarray(i, i + sampleBlockSize);
    let mp3buf;
    if (rightI16) {
      const rightChunk = rightI16.subarray(i, i + sampleBlockSize);
      mp3buf = mp3encoder.encodeBuffer(leftChunk, rightChunk);
    } else {
      mp3buf = mp3encoder.encodeBuffer(leftChunk);
    }
    if (mp3buf.length > 0) {
      mp3Data.push(new Uint8Array(mp3buf));
    }
  }

  const mp3buf = mp3encoder.flush();
  if (mp3buf.length > 0) {
    mp3Data.push(new Uint8Array(mp3buf));
  }

  return new Blob(mp3Data, { type: 'audio/mpeg' });
}

function writeString(view: DataView, offset: number, string: string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

export function parseSRTTime(timeStr: string): number {
  const parts = timeStr.trim().split(':');
  if (parts.length < 3) return 0;
  const h = parseFloat(parts[0]);
  const m = parseFloat(parts[1]);
  const secondsAndMs = parts[2].split(',');
  const s = parseFloat(secondsAndMs[0]);
  const ms = secondsAndMs.length > 1 ? parseFloat(secondsAndMs[1]) : 0;
  return h * 3600 + m * 60 + s + ms / 1000;
}

/**
 * Applies speed, pitch, and volume adjustments using OfflineAudioContext.
 * Uses native preservesPitch for high-quality time-stretching.
 * 
 * @param audioBlob The source audio blob (MP3 or WAV)
 * @param config Processing options: speed (0.5x-2x), pitch (-10 to +10 semitones), volume (0dB to +20dB)
 */
export async function renderProcessedAudio(
  audioBlob: Blob, 
  config: { speed: number; pitch: number; volume: number }
): Promise<{ blob: Blob; duration: number }> {
  const { speed = 1.0, pitch = 0, volume = 0 } = config;
  
  console.log(`audioUtils: Rendering processed audio (Speed: ${speed}x, Pitch: ${pitch}, Volume: ${volume}dB)`);
  
  const arrayBuffer = await audioBlob.arrayBuffer();
  const AudioContextClass = (window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext) as typeof AudioContext;
  const audioCtx = new AudioContextClass();
  const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
  await audioCtx.close();
  
  // Calculate output duration based on speed
  const outputLength = Math.ceil(audioBuffer.length / speed);
  const sampleRate = audioBuffer.sampleRate;
  const numberOfChannels = audioBuffer.numberOfChannels;
  
  const offlineCtx = new OfflineAudioContext(
    numberOfChannels,
    outputLength,
    sampleRate
  );
  
  const source = offlineCtx.createBufferSource();
  source.buffer = audioBuffer;
  
  // 1. Apply Speed (Playback Rate)
  source.playbackRate.setValueAtTime(speed, offlineCtx.currentTime);
  
  // 2. Apply Pitch (Tone)
  // We use detune for semitones (1 semitone = 100 cents)
  // To keep speed and pitch independent, we use preservesPitch
  if ('preservesPitch' in source) {
    (source as AudioBufferSourceNode & { preservesPitch: boolean }).preservesPitch = true;
    source.detune.setValueAtTime(pitch * 100, offlineCtx.currentTime);
  } else {
    // Fallback: If preservesPitch is not supported, detune will change speed too
    // but at least it still shifts the pitch.
    source.detune.setValueAtTime(pitch * 100, offlineCtx.currentTime);
  }
  
  // 3. Apply Volume Booster (Gain)
  // gain = 10^(dB/20)
  const gainNode = offlineCtx.createGain();
  const gainValue = Math.pow(10, volume / 20);
  gainNode.gain.setValueAtTime(gainValue, offlineCtx.currentTime);
  
  // Chain: Source -> Gain -> Destination
  source.connect(gainNode);
  gainNode.connect(offlineCtx.destination);
  
  source.start(0);
  
  const renderedBuffer = await offlineCtx.startRendering();
  console.log(`audioUtils: Rendered duration: ${renderedBuffer.duration}s`);
  
  // Convert Float32 to Int16 for WAV
  const channelData = renderedBuffer.getChannelData(0);
  const pcmInt16 = new Int16Array(channelData.length);
  for (let i = 0; i < channelData.length; i++) {
    const s = Math.max(-1, Math.min(1, channelData[i]));
    pcmInt16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }
  
  const finalBlob = pcmToWav(new Uint8Array(pcmInt16.buffer), sampleRate);
  return { blob: finalBlob, duration: renderedBuffer.duration };
}


export function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);

  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')},${ms.toString().padStart(3, '0')}`;
}

/**
 * Myanmar specific duration estimation
 * Average syllable = ~2.5 Unicode chars in Myanmar script
 * Myanmar avg speaking rate: ~3.5 syllables/sec at 1x
 */
export const estimateMyanmarDuration = (text: string, speed: number): number => {
  const charCount = text.replace(/\s/g, '').length || 0;
  if (charCount === 0) return 0;
  
  // Basic check for Myanmar characters
  const isBurmese = /[\u1000-\u109F]/.test(text);
  
  if (isBurmese) {
    const syllables = charCount / 2.5;
    const baseDuration = syllables / 3.5; // seconds at 1x
    return baseDuration / speed;
  } else {
    // English/Latin fallback
    const wordCount = text.trim().split(/\s+/).filter(w => w.length > 0).length;
    const baseDuration = wordCount * 0.4; // avg speed for English
    return baseDuration / speed;
  }
};

/**
 * Format duration for Myanmar display
 */
export const formatMyanmarDuration = (seconds: number): string => {
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  if (mins === 0) return `${secs} စက္ကန့်`;
  return `${mins} မိနစ် ${secs} စက္ကန့်`;
};

export async function applyAudioEffects(bytes: Uint8Array, effects: Record<string, boolean | number | string>): Promise<Uint8Array> {
  // Stub for audio effects mapping
  console.log("Applying mock effects to audio data...", effects);
  return bytes;
}

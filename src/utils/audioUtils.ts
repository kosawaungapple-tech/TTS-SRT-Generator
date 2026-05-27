import { AudioEffects } from '../types';

/**
 * Converts raw PCM data (16-bit, mono, 24000Hz) to a WAV file Blob.
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

  return new Blob([header, pcmData], { type: 'audio/wav' });
}

/**
 * Applies post-processing voice effects to raw PCM data.
 */
export async function applyAudioEffects(
  pcmData: Uint8Array,
  effects: AudioEffects,
  sampleRate: number = 24000
): Promise<Uint8Array> {
  // If no effects are enabled, return original data
  if (!effects.echo.enabled && !effects.reverb.enabled && !effects.pitchShift.enabled && !effects.chorus.enabled) {
    return pcmData;
  }

  // Convert 16-bit PCM to Float32
  const floatData = new Float32Array(pcmData.length / 2);
  for (let i = 0; i < floatData.length; i++) {
    const s16 = (pcmData[i * 2 + 1] << 8) | pcmData[i * 2];
    floatData[i] = (s16 >= 0x8000 ? s16 - 0x10000 : s16) / 0x8000;
  }

  // Create OfflineAudioContext
  // Note: Pitch shift via playbackRate changes duration, so we might need a longer context
  const durationMultiplier = effects.pitchShift.enabled ? Math.pow(2, -effects.pitchShift.semitones / 12) : 1;
  const outputLength = Math.ceil(floatData.length * durationMultiplier);
  
  const offlineCtx = new OfflineAudioContext(1, outputLength + sampleRate, sampleRate); // Add 1s buffer for tails
  const source = offlineCtx.createBufferSource();
  const buffer = offlineCtx.createBuffer(1, floatData.length, sampleRate);
  buffer.copyToChannel(floatData, 0);
  source.buffer = buffer;

  let lastNode: AudioNode = source;

  // Pitch Shift (Simple playbackRate adjustment)
  if (effects.pitchShift.enabled) {
    source.playbackRate.value = Math.pow(2, effects.pitchShift.semitones / 12);
  }

  // Echo
  if (effects.echo.enabled) {
    const delay = offlineCtx.createDelay();
    delay.delayTime.value = effects.echo.delay;
    const feedback = offlineCtx.createGain();
    feedback.gain.value = effects.echo.feedback;
    
    delay.connect(feedback);
    feedback.connect(delay);
    
    const echoGain = offlineCtx.createGain();
    echoGain.gain.value = 0.5;
    delay.connect(echoGain);
    
    const mainGain = offlineCtx.createGain();
    mainGain.gain.value = 1.0;
    
    const merger = offlineCtx.createGain();
    lastNode.connect(mainGain);
    lastNode.connect(delay);
    
    mainGain.connect(merger);
    echoGain.connect(merger);
    lastNode = merger;
  }

  // Reverb (Algorithmic approximation)
  if (effects.reverb.enabled) {
    const reverbGain = offlineCtx.createGain();
    reverbGain.gain.value = effects.reverb.mix;
    
    // Create parallel comb filters
    const delayTimes = [0.029, 0.037, 0.041, 0.043];
    const combFilters = delayTimes.map(dt => {
      const d = offlineCtx.createDelay();
      d.delayTime.value = dt;
      const f = offlineCtx.createGain();
      f.gain.value = 0.7 * (1 - effects.reverb.decay / 10); // Simple decay mapping
      d.connect(f);
      f.connect(d);
      return d;
    });
    
    const reverbMerger = offlineCtx.createGain();
    combFilters.forEach(cf => {
      lastNode.connect(cf);
      cf.connect(reverbMerger);
    });
    
    const finalMerger = offlineCtx.createGain();
    lastNode.connect(finalMerger);
    reverbMerger.connect(reverbGain);
    reverbGain.connect(finalMerger);
    lastNode = finalMerger;
  }

  // Chorus
  if (effects.chorus.enabled) {
    const chorusDelay = offlineCtx.createDelay();
    chorusDelay.delayTime.value = 0.03;
    
    const osc = offlineCtx.createOscillator();
    osc.frequency.value = effects.chorus.rate;
    const depth = offlineCtx.createGain();
    depth.gain.value = 0.002 * effects.chorus.depth;
    
    osc.connect(depth);
    depth.connect(chorusDelay.delayTime);
    osc.start();
    
    const chorusGain = offlineCtx.createGain();
    chorusGain.gain.value = 0.5;
    chorusDelay.connect(chorusGain);
    
    const merger = offlineCtx.createGain();
    lastNode.connect(merger);
    chorusGain.connect(merger);
    lastNode = merger;
  }

  lastNode.connect(offlineCtx.destination);
  source.start();

  const renderedBuffer = await offlineCtx.startRendering();
  const outputFloatData = renderedBuffer.getChannelData(0);

  // Convert back to 16-bit PCM
  const outputPcmData = new Uint8Array(outputFloatData.length * 2);
  for (let i = 0; i < outputFloatData.length; i++) {
    const s = Math.max(-1, Math.min(1, outputFloatData[i]));
    const s16 = s < 0 ? s * 0x8000 : s * 0x7FFF;
    outputPcmData[i * 2] = s16 & 0xFF;
    outputPcmData[i * 2 + 1] = (s16 >> 8) & 0xFF;
  }

  return outputPcmData;
}

function writeString(view: DataView, offset: number, string: string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

export function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);

  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')},${ms.toString().padStart(3, '0')}`;
}

// Web Audio API Procedural Ambience & BGM Synthesizer for Story Audiobooks
// Generates realistic ambient soundscapes in real-time without external audio files,
// and supports offline mixing of Voice + BGM into a single master WAV.

import { audioBufferToWav } from './audioUtils';

export type AmbienceType = 'none' | 'rain' | 'forest' | 'mystery' | 'piano' | 'ocean' | 'zen';

export interface AmbienceTrack {
  id: AmbienceType;
  name: string;
  nameMm: string;
  icon: string;
  description: string;
  descriptionMm: string;
}

export const AMBIENCE_TRACKS: AmbienceTrack[] = [
  {
    id: 'none',
    name: 'Silent (No BGM)',
    nameMm: 'အသံတိတ် (နောက်ခံမပါ)',
    icon: '🔇',
    description: 'Clean voice narration without background sound',
    descriptionMm: 'နောက်ခံသံမပါဘဲ စကားပြောသံ သီးသန့်'
  },
  {
    id: 'rain',
    name: 'Rain & Thunder',
    nameMm: 'မိုးသည်းထန်သံနှင့် မိုးခြိမ်းသံ',
    icon: '🌧️',
    description: 'Moody rainfall with soft distant thunder for horror & emotional stories',
    descriptionMm: 'သရဲဝတ္ထုနှင့် ဝမ်းနည်းဖွယ် ဇာတ်လမ်းများအတွက်'
  },
  {
    id: 'mystery',
    name: 'Deep Mystery Drone',
    nameMm: 'သည်းထိတ်ရင်ဖို နက်နဲသောအသံ',
    icon: '🕯️',
    description: 'Dark resonant cinematic pad for suspense and supernatural tales',
    descriptionMm: 'လျှို့ဝှက်ဆန်းကြယ်နှင့် သည်းထိတ်ရင်ဖို ဇာတ်လမ်းများအတွက်'
  },
  {
    id: 'forest',
    name: 'Night Forest & Crickets',
    nameMm: 'ညအချိန် တောနက်သံနှင့် ပုစဉ်းသံ',
    icon: '🌲',
    description: 'Peaceful nocturnal forest atmosphere with soft cricket chirps',
    descriptionMm: 'သဘာဝပုံပြင်များနှင့် ခရီးသွားဇာတ်လမ်းများအတွက်'
  },
  {
    id: 'piano',
    name: 'Soft Melodic Piano',
    nameMm: 'ညင်သာသော စန္ဒယားသံ',
    icon: '🎹',
    description: 'Gentle ambient chords for romance, drama, and heartfelt audiobooks',
    descriptionMm: 'အချစ်ဝတ္ထုနှင့် ရသစုံ စိတ်ခံစားမှုဇာတ်လမ်းများအတွက်'
  },
  {
    id: 'ocean',
    name: 'Ocean Waves & Wind',
    nameMm: 'ပင်လယ်လှိုင်းသံနှင့် လေညင်း',
    icon: '🌊',
    description: 'Relaxing rhythmic ocean swells and gentle coastal breeze',
    descriptionMm: 'စိတ်အေးချမ်းစေသော ပင်လယ်လှိုင်းသံနှင့် လေပြေ'
  },
  {
    id: 'zen',
    name: 'Zen Bell & Wind Chimes',
    nameMm: 'ဘုရားစင် ခေါင်းလောင်းသံနှင့် လေချွန်သံ',
    icon: '🔔',
    description: 'Sacred meditation singing bowl and soft chime resonance for Dhamma & reflections',
    descriptionMm: 'တရားတော်နှင့် အတွေးအမြင် စာအုပ်များအတွက် အထူးသင့်လျော်သည်'
  }
];

class AmbienceSynthesizer {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private isRunning: boolean = false;
  private currentType: AmbienceType = 'none';
  private stopFns: (() => void)[] = [];
  private volume: number = 0.35; // Default 35%

  private getAudioContext(): AudioContext {
    if (!this.ctx || this.ctx.state === 'closed') {
      const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioContextClass();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
    return this.ctx;
  }

  public setVolume(vol: number) {
    this.volume = Math.max(0, Math.min(1, vol));
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.05);
    }
  }

  public getVolume(): number {
    return this.volume;
  }

  public getCurrentType(): AmbienceType {
    return this.currentType;
  }

  public isPlaying(): boolean {
    return this.isRunning && this.currentType !== 'none';
  }

  public stop() {
    this.stopFns.forEach(fn => {
      try { fn(); } catch (e) { console.error('Error stopping track node:', e); }
    });
    this.stopFns = [];
    this.isRunning = false;
    this.currentType = 'none';
  }

  public play(type: AmbienceType) {
    this.stop();
    if (type === 'none') return;

    try {
      const ctx = this.getAudioContext();
      this.masterGain = ctx.createGain();
      this.masterGain.gain.setValueAtTime(0.01, ctx.currentTime);
      this.masterGain.gain.linearRampToValueAtTime(this.volume, ctx.currentTime + 1.2);
      this.masterGain.connect(ctx.destination);

      this.currentType = type;
      this.isRunning = true;

      switch (type) {
        case 'rain':
          this.buildRainSoundscape(ctx, this.masterGain);
          break;
        case 'mystery':
          this.buildMysterySoundscape(ctx, this.masterGain);
          break;
        case 'forest':
          this.buildForestSoundscape(ctx, this.masterGain);
          break;
        case 'piano':
          this.buildPianoSoundscape(ctx, this.masterGain);
          break;
        case 'ocean':
          this.buildOceanSoundscape(ctx, this.masterGain);
          break;
        case 'zen':
          this.buildZenSoundscape(ctx, this.masterGain);
          break;
      }
    } catch (err) {
      console.error('Failed to start ambience synthesizer:', err);
    }
  }

  /**
   * Mixes a voice audio blob with selected procedural ambience BGM into a single master WAV.
   */
  public async mixVoiceWithAmbience(
    voiceBlob: Blob, 
    type: AmbienceType, 
    ambienceVolume: number = 0.35, 
    voiceVolume: number = 1.0
  ): Promise<Blob> {
    if (type === 'none') {
      return voiceBlob;
    }

    const tempCtx = this.getAudioContext();
    const arrayBuf = await voiceBlob.arrayBuffer();
    const voiceBuffer = await tempCtx.decodeAudioData(arrayBuf);

    const sampleRate = voiceBuffer.sampleRate;
    const duration = voiceBuffer.duration;
    const totalDuration = duration + 1.5; // slight tail fade out

    const offlineCtx = new OfflineAudioContext(2, Math.ceil(sampleRate * totalDuration), sampleRate);

    // 1. Voice Source
    const voiceSource = offlineCtx.createBufferSource();
    voiceSource.buffer = voiceBuffer;

    const voiceGain = offlineCtx.createGain();
    voiceGain.gain.value = voiceVolume;
    voiceSource.connect(voiceGain);
    voiceGain.connect(offlineCtx.destination);

    // 2. Ambience Destination
    const ambGain = offlineCtx.createGain();
    ambGain.gain.setValueAtTime(0.01, 0);
    ambGain.gain.linearRampToValueAtTime(ambienceVolume, 1.0);
    ambGain.gain.setValueAtTime(ambienceVolume, duration);
    ambGain.gain.linearRampToValueAtTime(0.001, totalDuration);
    ambGain.connect(offlineCtx.destination);

    // 3. Attach Soundscape Nodes to offline context
    switch (type) {
      case 'rain':
        this.buildRainSoundscape(offlineCtx, ambGain);
        break;
      case 'mystery':
        this.buildMysterySoundscape(offlineCtx, ambGain);
        break;
      case 'forest':
        this.buildForestSoundscape(offlineCtx, ambGain);
        break;
      case 'piano':
        this.buildPianoSoundscape(offlineCtx, ambGain);
        break;
      case 'ocean':
        this.buildOceanSoundscape(offlineCtx, ambGain);
        break;
      case 'zen':
        this.buildZenSoundscape(offlineCtx, ambGain);
        break;
    }

    voiceSource.start(0.4); // Start voice slightly after ambience sets in

    const renderedBuffer = await offlineCtx.startRendering();
    return audioBufferToWav(renderedBuffer);
  }

  // --- SOUND ENGINES ---

  private buildRainSoundscape(ctx: BaseAudioContext, destination: AudioNode) {
    const bufferSize = ctx.sampleRate * 2;
    const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      b3 = 0.86650 * b3 + white * 0.3104856;
      b4 = 0.55000 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.0168980;
      output[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.05;
      b6 = white * 0.115926;
    }

    const whiteNoise = ctx.createBufferSource();
    whiteNoise.buffer = noiseBuffer;
    whiteNoise.loop = true;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1100;

    const rainGain = ctx.createGain();
    rainGain.gain.value = 0.8;

    whiteNoise.connect(filter);
    filter.connect(rainGain);
    rainGain.connect(destination);
    whiteNoise.start();

    // Occasional low rumble thunder
    const thunderOsc = ctx.createOscillator();
    thunderOsc.type = 'sine';
    thunderOsc.frequency.value = 45;

    const thunderFilter = ctx.createBiquadFilter();
    thunderFilter.type = 'lowpass';
    thunderFilter.frequency.value = 80;

    const thunderGain = ctx.createGain();
    thunderGain.gain.value = 0;

    thunderOsc.connect(thunderFilter);
    thunderFilter.connect(thunderGain);
    thunderGain.connect(destination);
    thunderOsc.start();

    const thunderTimes = [4, 16, 32, 52, 76, 102, 130, 165, 205, 250, 300];
    thunderTimes.forEach(t => {
      thunderGain.gain.setValueAtTime(0, t);
      thunderGain.gain.linearRampToValueAtTime(0.35, t + 1.5);
      thunderGain.gain.linearRampToValueAtTime(0, t + 5.0);
    });

    this.stopFns.push(() => {
      try { whiteNoise.stop(); } catch {}
      try { thunderOsc.stop(); } catch {}
    });
  }

  private buildMysterySoundscape(ctx: BaseAudioContext, destination: AudioNode) {
    const osc1 = ctx.createOscillator();
    osc1.type = 'sawtooth';
    osc1.frequency.value = 55;

    const osc2 = ctx.createOscillator();
    osc2.type = 'sine';
    osc2.frequency.value = 82.4;

    const osc3 = ctx.createOscillator();
    osc3.type = 'sawtooth';
    osc3.frequency.value = 54.6;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 320;
    filter.Q.value = 4;

    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.12;

    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 180;

    lfo.connect(lfoGain);
    lfoGain.connect(filter.frequency);

    const padGain = ctx.createGain();
    padGain.gain.value = 0.35;

    osc1.connect(filter);
    osc2.connect(filter);
    osc3.connect(filter);
    filter.connect(padGain);
    padGain.connect(destination);

    osc1.start();
    osc2.start();
    osc3.start();
    lfo.start();

    this.stopFns.push(() => {
      try { osc1.stop(); } catch {}
      try { osc2.stop(); } catch {}
      try { osc3.stop(); } catch {}
      try { lfo.stop(); } catch {}
    });
  }

  private buildForestSoundscape(ctx: BaseAudioContext, destination: AudioNode) {
    const bufferSize = ctx.sampleRate * 2;
    const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      output[i] = (Math.random() * 2 - 1) * 0.04;
    }
    const windSource = ctx.createBufferSource();
    windSource.buffer = noiseBuffer;
    windSource.loop = true;

    const windFilter = ctx.createBiquadFilter();
    windFilter.type = 'bandpass';
    windFilter.frequency.value = 450;
    windFilter.Q.value = 1.5;

    const windGain = ctx.createGain();
    windGain.gain.value = 0.25;

    windSource.connect(windFilter);
    windFilter.connect(windGain);
    windGain.connect(destination);
    windSource.start();

    const cricketOsc = ctx.createOscillator();
    cricketOsc.type = 'sine';
    cricketOsc.frequency.value = 4600;

    const cricketMod = ctx.createOscillator();
    cricketMod.type = 'square';
    cricketMod.frequency.value = 16;

    const modGain = ctx.createGain();
    modGain.gain.value = 800;
    cricketMod.connect(modGain);
    modGain.connect(cricketOsc.frequency);

    const cricketGain = ctx.createGain();
    cricketGain.gain.value = 0.03;

    cricketOsc.connect(cricketGain);
    cricketGain.connect(destination);

    cricketOsc.start();
    cricketMod.start();

    this.stopFns.push(() => {
      try { windSource.stop(); } catch {}
      try { cricketOsc.stop(); } catch {}
      try { cricketMod.stop(); } catch {}
    });
  }

  private buildPianoSoundscape(ctx: BaseAudioContext, destination: AudioNode) {
    const chords = [
      [130.81, 164.81, 196.00, 246.94], // C major
      [110.00, 146.83, 164.81, 220.00], // A minor
      [174.61, 220.00, 261.63, 329.63]  // F major
    ];

    const oscNodes: { osc: OscillatorNode; gain: GainNode }[] = [];

    for (let i = 0; i < 4; i++) {
      const osc = ctx.createOscillator();
      osc.type = i % 2 === 0 ? 'sine' : 'triangle';
      osc.frequency.value = chords[0][i];

      const gain = ctx.createGain();
      gain.gain.value = 0.08;

      osc.connect(gain);
      gain.connect(destination);
      osc.start();
      oscNodes.push({ osc, gain });
    }

    // Schedule chord transitions every 6 seconds up to 10 minutes
    for (let t = 0; t < 600; t += 6) {
      const chordIdx = Math.floor(t / 6) % chords.length;
      const targetChord = chords[chordIdx];
      oscNodes.forEach((node, i) => {
        node.osc.frequency.setValueAtTime(targetChord[i], t);
      });
    }

    this.stopFns.push(() => {
      oscNodes.forEach(n => {
        try { n.osc.stop(); } catch {}
      });
    });
  }

  private buildOceanSoundscape(ctx: BaseAudioContext, destination: AudioNode) {
    const bufferSize = ctx.sampleRate * 2;
    const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      output[i] = (Math.random() * 2 - 1) * 0.08;
    }

    const oceanNoise = ctx.createBufferSource();
    oceanNoise.buffer = noiseBuffer;
    oceanNoise.loop = true;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 400;

    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.14;

    const lfoFilterGain = ctx.createGain();
    lfoFilterGain.gain.value = 350;
    lfo.connect(lfoFilterGain);
    lfoFilterGain.connect(filter.frequency);

    const waveGain = ctx.createGain();
    waveGain.gain.value = 0.45;

    oceanNoise.connect(filter);
    filter.connect(waveGain);
    waveGain.connect(destination);

    oceanNoise.start();
    lfo.start();

    this.stopFns.push(() => {
      try { oceanNoise.stop(); } catch {}
      try { lfo.stop(); } catch {}
    });
  }

  private buildZenSoundscape(ctx: BaseAudioContext, destination: AudioNode) {
    const harmonics = [432, 864, 1296, 216];
    const oscs: OscillatorNode[] = [];
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 432;
    filter.Q.value = 8;

    const zenGain = ctx.createGain();
    zenGain.gain.value = 0.22;

    harmonics.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;
      
      const oscGain = ctx.createGain();
      oscGain.gain.value = idx === 0 ? 0.4 : 0.15 / (idx + 1);

      osc.connect(oscGain);
      oscGain.connect(filter);
      osc.start();
      oscs.push(osc);
    });

    filter.connect(zenGain);
    zenGain.connect(destination);

    const bellTimes = [2, 12, 24, 38, 54, 72, 92, 114, 138, 164, 192, 222, 256, 292, 330];
    bellTimes.forEach(t => {
      zenGain.gain.setValueAtTime(0.35, t);
      zenGain.gain.exponentialRampToValueAtTime(0.08, t + 4.5);
    });

    this.stopFns.push(() => {
      oscs.forEach(o => {
        try { o.stop(); } catch {}
      });
    });
  }
}

export const ambienceSynthesizer = new AmbienceSynthesizer();

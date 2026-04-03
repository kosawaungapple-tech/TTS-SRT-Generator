import { VoiceOption } from './types';

export const VOICE_OPTIONS: VoiceOption[] = [
  { id: 'zephyr', name: 'Burmese Female (အမျိုးသမီး) - Zephyr', gender: 'female', voiceName: 'Zephyr' },
  { id: 'kore', name: 'Burmese Male (အမျိုးသား) - Kore', gender: 'male', voiceName: 'Kore' },
  { id: 'puck', name: 'Burmese Male (အမျိုးသား) - Puck', gender: 'male', voiceName: 'Puck' },
  { id: 'charon', name: 'Burmese Male (အမျိုးသား) - Charon', gender: 'male', voiceName: 'Charon' },
  { id: 'fenrir', name: 'Burmese Male (အမျိုးသား) - Fenrir', gender: 'male', voiceName: 'Fenrir' },
];

export const MODEL_OPTIONS = [
  { id: 'gemini-2.5-flash-preview-tts', name: 'Gemini 2.5 Flash (Latest)' },
];

// Define which voices are supported by which models
const STABLE_VOICES = ['zephyr', 'kore', 'puck', 'charon', 'fenrir'];

export const MODEL_VOICE_MAPPING: Record<string, string[]> = {
  'gemini-2.5-flash-preview-tts': STABLE_VOICES,
};

export const DEFAULT_RULES = [
  { id: '1', original: 'Vlogs By Saw', replacement: 'ဗလော့ ဘိုင် စော' },
  { id: '2', original: 'AI', replacement: 'အေအိုင်' },
  { id: '3', original: 'မေတ္တာ', replacement: 'မစ်တာ' },
  { id: '4', original: 'သစ္စာ', replacement: 'သစ်စာ' },
  { id: '5', original: 'ပြဿနာ', replacement: 'ပရတ်သနာ' },
  { id: '6', original: 'ဥက္က', replacement: 'အုတ်က' },
  { id: '7', original: 'ဦးနှောက်', replacement: 'အုန်းနှောက်' },
  { id: '8', original: 'တက္ကသိုလ်', replacement: 'တက်ကသိုလ်' },
];

export const GEMINI_MODELS = {
  VERIFY: 'gemini-3-flash-preview',
  LIVE: 'gemini-2.5-flash-native-audio-preview-12-2025',
  TTS: 'gemini-2.5-flash-preview-tts',
  REWRITE: 'gemini-2.0-flash',
};

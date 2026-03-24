import { VoiceOption } from './types';

export const VOICE_OPTIONS: VoiceOption[] = [
  { id: 'zephyr', name: 'Burmese Female (အမျိုးသမီး) - Zephyr', gender: 'female', voiceName: 'Zephyr' },
  { id: 'leda', name: 'Burmese Female (အမျိုးသမီး) - Leda', gender: 'female', voiceName: 'Leda' },
  { id: 'aoede', name: 'Burmese Female (အမျိုးသမီး) - Aoede', gender: 'female', voiceName: 'Aoede' },
  { id: 'kore', name: 'Burmese Male (အမျိုးသား) - Kore', gender: 'male', voiceName: 'Kore' },
  { id: 'puck', name: 'Burmese Male (အမျိုးသား) - Puck', gender: 'male', voiceName: 'Puck' },
  { id: 'charon', name: 'Burmese Male (အမျိုးသား) - Charon', gender: 'male', voiceName: 'Charon' },
  { id: 'en-US-Standard-A', name: 'English (US) - Female A', gender: 'female', voiceName: 'en-US-Standard-A' },
  { id: 'en-US-Standard-B', name: 'English (US) - Male B', gender: 'male', voiceName: 'en-US-Standard-B' },
  { id: 'en-GB-Standard-A', name: 'English (UK) - Female A', gender: 'female', voiceName: 'en-GB-Standard-A' },
  { id: 'en-GB-Standard-B', name: 'English (UK) - Male B', gender: 'male', voiceName: 'en-GB-Standard-B' },
  { id: 'hi-IN-Standard-A', name: 'Hindi (IN) - Female A', gender: 'female', voiceName: 'hi-IN-Standard-A' },
  { id: 'hi-IN-Standard-B', name: 'Hindi (IN) - Male B', gender: 'male', voiceName: 'hi-IN-Standard-B' },
  { id: 'cmn-CN-Standard-A', name: 'Chinese (CN) - Female A', gender: 'female', voiceName: 'cmn-CN-Standard-A' },
  { id: 'cmn-CN-Standard-B', name: 'Chinese (CN) - Male B', gender: 'male', voiceName: 'cmn-CN-Standard-B' },
];

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
};

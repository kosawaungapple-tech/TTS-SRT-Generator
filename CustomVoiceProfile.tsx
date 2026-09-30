import React, { useState, useRef, useEffect } from 'react';
import { Mic, Upload, Trash2, Square, CheckCircle2, AlertCircle } from 'lucide-react';
import { useLanguage } from '../contexts/LanguageContext';

interface CustomVoiceProfileProps {
  onProfileChange: (base64: string | null) => void;
  initialProfile?: string | null;
}

export const CustomVoiceProfile: React.FC<CustomVoiceProfileProps> = ({ onProfileChange, initialProfile }) => {
  const { t } = useLanguage();
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [audioBase64, setAudioBase64] = useState<string | null>(initialProfile || null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (initialProfile) {
      try {
        const blob = base64ToBlob(initialProfile, 'audio/webm');
        setAudioUrl(URL.createObjectURL(blob));
      } catch (e) {
        console.error("Failed to load initial profile:", e);
      }
    }
  }, [initialProfile]);

  const base64ToBlob = (base64: string, mime: string) => {
    const byteString = atob(base64);
    const ab = new ArrayBuffer(byteString.length);
    const ia = new Uint8Array(ab);
    for (let i = 0; i < byteString.length; i++) {
      ia[i] = byteString.charCodeAt(i);
    }
    return new Blob([ab], { type: mime });
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(chunksRef.current, { type: 'audio/webm' });
        if (audioBlob.size < 1000) {
            setError(t('voiceConfig.voiceProfile.tooShort'));
            return;
        }
        
        const reader = new FileReader();
        reader.onloadend = () => {
          const base64 = (reader.result as string).split(',')[1];
          setAudioBase64(base64);
          onProfileChange(base64);
          setAudioUrl(URL.createObjectURL(audioBlob));
        };
        reader.readAsDataURL(audioBlob);
        
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
      setRecordingTime(0);
      setError(null);

      timerRef.current = window.setInterval(() => {
        setRecordingTime(prev => {
          if (prev >= 30) {
            stopRecording();
            return 30;
          }
          return prev + 1;
        });
      }, 1000);
    } catch (err) {
      console.error("Recording failed:", err);
      setError(t('voiceConfig.voiceProfile.accessDenied'));
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (timerRef.current) clearInterval(timerRef.current);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 10 * 1024 * 1024) {
      setError(t('voiceConfig.voiceProfile.fileLarge'));
      return;
    }

    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = (reader.result as string).split(',')[1];
      setAudioBase64(base64);
      onProfileChange(base64);
      setAudioUrl(URL.createObjectURL(file));
      setError(null);
    };
    reader.readAsDataURL(file);
  };

  const clearProfile = () => {
    setAudioBase64(null);
    setAudioUrl(null);
    onProfileChange(null);
    setError(null);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{t('voiceConfig.voiceProfile.title')}</h3>
        {audioBase64 && (
          <button 
            onClick={clearProfile}
            className="text-red-400 hover:text-red-500 transition-colors p-1"
          >
            <Trash2 size={16} />
          </button>
        )}
      </div>

      {!audioBase64 ? (
        <div className="grid grid-cols-2 gap-4">
          <button
            onClick={isRecording ? stopRecording : startRecording}
            className={`flex flex-col items-center justify-center gap-3 p-6 rounded-2xl border-2 border-dashed transition-all ${
              isRecording 
                ? 'bg-red-500/10 border-red-500 text-red-500' 
                : 'bg-white/5 border-white/10 text-slate-400 hover:border-amber-400/50 hover:text-amber-500'
            }`}
          >
            {isRecording ? <Square size={24} /> : <Mic size={24} />}
            <span className="text-[10px] font-bold uppercase tracking-wider">
              {isRecording ? `${t('voiceConfig.voiceProfile.stop')} (${recordingTime}s)` : t('voiceConfig.voiceProfile.record')}
            </span>
          </button>

          <label className="flex flex-col items-center justify-center gap-3 p-6 rounded-2xl border-2 border-dashed bg-white/5 border-white/10 text-slate-400 hover:border-amber-400/50 hover:text-amber-500 cursor-pointer transition-all">
            <Upload size={24} />
            <span className="text-[10px] font-bold uppercase tracking-wider">{t('voiceConfig.voiceProfile.upload')}</span>
            <input type="file" accept="audio/*" className="hidden" onChange={handleFileUpload} />
          </label>
        </div>
      ) : (
        <div className="bg-amber-400/10 border border-amber-400/20 rounded-2xl p-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 shrink-0">
            <div className="p-2 bg-amber-400 rounded-full text-black">
              <CheckCircle2 size={20} />
            </div>
            <div>
              <p className="text-sm font-bold text-white">{t('voiceConfig.voiceProfile.ready')}</p>
              <p className="text-[10px] text-slate-400 uppercase tracking-tight">{t('voiceConfig.voiceProfile.usingCloning')}</p>
            </div>
          </div>
          {audioUrl && (
            <div className="flex-1 max-w-[200px]">
              <audio src={audioUrl} controls className="h-8 w-full" />
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 text-red-400 text-[10px] font-bold uppercase tracking-wider bg-red-400/5 p-2 rounded-lg border border-red-400/10">
          <AlertCircle size={14} />
          {error}
        </div>
      )}
      
      <p className="text-[9px] text-slate-500 leading-relaxed italic">
        {t('voiceConfig.voiceProfile.bestResult')}
      </p>
    </div>
  );
};

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Play, Pause } from 'lucide-react';
import { SUBTITLE_PRESETS } from '../utils/subtitlePresets';
import type { LogoPosition } from '../utils/recapLogo';

export interface PreviewSegment { start: number; end: number }

interface Props {
  srcUrl: string | null;
  thumb: string | null;
  srcRatio: number;
  aspect: string;
  framing: 'blurred-fit' | 'cover' | 'letterbox';
  blurAmount: number;
  textLayers?: { text: string; start: number; end: number; x: number; y: number; size: number; color: string; stroke: boolean; box: boolean }[];
  adjust?: { zoom: number; panX: number; panY: number; brightness: number; contrast: number; saturation: number };
  subPreset: string;
  subY: number;
  subScale: number;
  /** Band of the source video to blur (fractions of the source height). */
  blurBand?: { y: number; h: number } | null;
  logoImg: HTMLImageElement | null;
  logoText: string;
  logoPos: LogoPosition;
  logoSize: number;
  logoOpacity: number;
  /** The finished recap (voice, subtitles, scene timing). Absent = plain source preview. */
  recap?: {
    voiceoverUrl: string;
    cues: { start: number; end: number; text: string }[];
    duration: number;
    sceneTimes: { start: number; dur: number }[];
    segments: PreviewSegment[];
    hasVideoTimes: boolean;
  } | null;
  isMm: boolean;
}

const fmt = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

/** Plays the recap itself: the generated voiceover, the generated subtitles and the matching source footage. */
export const RecapPreview: React.FC<Props> = p => {
  const audioRef = useRef<HTMLAudioElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const recap = p.recap || null;
  const total = recap?.duration || 0;

  const ratio = p.aspect === '9:16' ? 9 / 16 : p.aspect === '1:1' ? 1 : p.aspect === '4:5' ? 4 / 5 : p.aspect === 'original' ? p.srcRatio || 16 / 9 : 16 / 9;
  const pr = SUBTITLE_PRESETS.find(x => x.id === p.subPreset) || SUBTITLE_PRESETS[0];
  const cq = (px: number) => `${((px * 100) / 1280).toFixed(3)}cqw`;
  const showBlur = p.framing === 'blurred-fit' && p.aspect !== 'original';

  // Keeps the source video on the footage that belongs to the narration being heard (same speed rule as the render).
  const syncVideo = useCallback((T: number) => {
    const v = videoRef.current;
    if (!v || !recap) return;
    const n = recap.sceneTimes.length;
    let i = 0;
    for (let k = 0; k < n; k++) if (T >= recap.sceneTimes[k].start) i = k;
    const sc = recap.sceneTimes[i];
    const seg = recap.segments[i];
    let target: number;
    let rate = 1;
    if (recap.hasVideoTimes && seg && sc) {
      const clip = Math.max(0.5, seg.end - seg.start);
      const span = sc.dur + 0.25;
      rate = Math.max(0.8, Math.min(1.25, clip / span));
      target = seg.start + Math.max(0, T - sc.start) * rate;
    } else {
      const d = v.duration || 1;
      target = (T / Math.max(1, total)) * d;
    }
    if (Math.abs(v.currentTime - target) > 0.5) v.currentTime = target;
    if (Math.abs(v.playbackRate - rate) > 0.01) v.playbackRate = rate;
  }, [recap, total]);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      const a = audioRef.current;
      if (a) {
        setTime(a.currentTime);
        syncVideo(a.currentTime);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, syncVideo]);

  useEffect(() => {
    // new recap -> back to the start
    setPlaying(false);
    setTime(0);
  }, [recap?.voiceoverUrl]);

  const toggle = () => {
    const a = audioRef.current;
    const v = videoRef.current;
    if (!recap || !a) {
      if (v) { if (v.paused) { void v.play(); setPlaying(true); } else { v.pause(); setPlaying(false); } }
      return;
    }
    if (playing) {
      a.pause(); v?.pause(); setPlaying(false);
    } else {
      syncVideo(a.currentTime);
      void a.play();
      void v?.play();
      setPlaying(true);
    }
  };

  const seek = (T: number) => {
    const a = audioRef.current;
    if (a) a.currentTime = T;
    setTime(T);
    syncVideo(T);
  };

  const cue = recap ? recap.cues.find(c => time >= c.start && time < c.end) : null;
  const sample = cue ? cue.text : recap ? '' : (p.isMm ? 'ဥပမာ စာတန်းထိုး' : 'Sample subtitle');

  return (
    <div>
      <div
        className="relative mx-auto overflow-hidden rounded-xl border border-white/15 bg-black"
        style={{ aspectRatio: String(ratio), width: `min(100%, ${Math.round(380 * ratio)}px)`, containerType: 'inline-size' }}
      >
        {showBlur && p.thumb && (
          <img src={p.thumb} alt="" className="absolute inset-0 w-full h-full object-cover" style={{ filter: `blur(${Math.round(p.blurAmount / 4)}px) brightness(0.65)`, transform: 'scale(1.2)' }} />
        )}
        {p.srcUrl ? (
          <video
            ref={videoRef}
            src={p.srcUrl}
            poster={p.thumb || undefined}
            muted
            playsInline
            preload="auto"
            controls={!recap}
            className="absolute inset-0 w-full h-full"
            style={{
              objectFit: p.framing === 'cover' && p.aspect !== 'original' ? 'cover' : 'contain',
              ...(p.adjust ? {
                transform: `scale(${p.adjust.zoom}) translate(${(-p.adjust.panX * (p.adjust.zoom - 1) / (2 * p.adjust.zoom) * 100).toFixed(2)}%, ${(-p.adjust.panY * (p.adjust.zoom - 1) / (2 * p.adjust.zoom) * 100).toFixed(2)}%)`,
                filter: `brightness(${1 + p.adjust.brightness}) contrast(${p.adjust.contrast}) saturate(${p.adjust.saturation})`,
              } : {}),
            }}
          />
        ) : p.thumb ? (
          <img src={p.thumb} alt="" className="absolute inset-0 w-full h-full" style={{ objectFit: p.framing === 'cover' ? 'cover' : 'contain' }} />
        ) : null}

        {p.blurBand && (() => {
          // where the source picture sits inside the frame (it is fitted, not stretched)
          const sr = p.srcRatio || 16 / 9;
          const fill = p.framing === 'cover' && p.aspect !== 'original';
          let w = 100, h = 100;
          if (!fill) { if (sr > ratio) h = (ratio / sr) * 100; else w = (sr / ratio) * 100; }
          else { if (sr > ratio) w = (sr / ratio) * 100; else h = (ratio / sr) * 100; }
          const top = (100 - h) / 2 + (p.blurBand!.y * h);
          return (
            <div
              className="absolute pointer-events-none border border-dashed border-sky-300/70"
              style={{ left: `${(100 - w) / 2}%`, width: `${w}%`, top: `${top}%`, height: `${p.blurBand!.h * h}%`, backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)' }}
            />
          );
        })()}

        {sample && (
          <div
            className="absolute left-0 right-0 text-center px-[4%] font-black leading-tight pointer-events-none"
            style={{
              top: `${p.subY}%`,
              transform: 'translateY(-50%)',
              fontSize: cq(pr.style.fontSize * p.subScale),
              color: pr.style.fontColor,
              WebkitTextStroke: pr.style.strokeWidth > 0 ? `${cq(pr.style.strokeWidth)} ${pr.style.strokeColor}` : undefined,
              paintOrder: 'stroke fill',
              background: pr.style.bgBoxEnabled ? pr.style.bgBoxColor : undefined,
              width: pr.style.bgBoxEnabled ? 'fit-content' : undefined,
              margin: pr.style.bgBoxEnabled ? '0 auto' : undefined,
              borderRadius: pr.style.bgBoxEnabled ? '8px' : undefined,
            }}
          >
            {sample}
          </div>
        )}

        {recap && p.textLayers?.filter(l => l.text.trim() && time >= l.start && time < l.end).map((l, i) => (
          <div
            key={i}
            className="absolute pointer-events-none font-black leading-tight text-center"
            style={{
              left: `${l.x}%`, top: `${l.y}%`, transform: 'translate(-50%, -50%)', maxWidth: '90%',
              fontSize: `${l.size}cqw`, color: l.color,
              WebkitTextStroke: l.stroke ? '0.3cqw #000' : undefined, paintOrder: 'stroke fill',
              background: l.box ? 'rgba(0,0,0,0.6)' : undefined, padding: l.box ? '0.4cqw 1.2cqw' : undefined, borderRadius: l.box ? '1cqw' : undefined,
            }}
          >{l.text}</div>
        ))}

        {(p.logoImg || p.logoText.trim()) && (
          <div
            className="absolute flex flex-col items-center pointer-events-none"
            style={{
              opacity: p.logoOpacity,
              width: `${p.logoSize}%`,
              [p.logoPos[0] === 't' ? 'top' : 'bottom']: '3%',
              [p.logoPos[1] === 'l' ? 'left' : 'right']: '3%',
            } as React.CSSProperties}
          >
            {p.logoImg && <img src={p.logoImg.src} alt="" className="w-full h-auto" />}
            {p.logoText.trim() && (
              <span className="font-black text-white text-center" style={{ fontSize: `${(p.logoSize * 0.28).toFixed(2)}cqw`, WebkitTextStroke: '0.4cqw #000', paintOrder: 'stroke fill' }}>{p.logoText.trim()}</span>
            )}
          </div>
        )}
      </div>

      {recap ? (
        <div className="mt-3 mx-auto flex items-center gap-3" style={{ width: `min(100%, ${Math.round(380 * ratio)}px)` }}>
          <button type="button" onClick={toggle} className="shrink-0 w-10 h-10 rounded-full bg-emerald-400 text-black flex items-center justify-center">
            {playing ? <Pause size={18} /> : <Play size={18} />}
          </button>
          <input type="range" min={0} max={Math.max(1, total)} step={0.1} value={time} onChange={e => seek(Number(e.target.value))} className="flex-1 h-2 accent-emerald-400" />
          <span className="text-[11px] font-mono text-slate-300">{fmt(time)} / {fmt(total)}</span>
          <audio
            ref={audioRef}
            src={recap.voiceoverUrl}
            preload="auto"
            onEnded={() => { setPlaying(false); videoRef.current?.pause(); }}
          />
        </div>
      ) : (
        <p className="mt-2 text-[11px] text-slate-500 text-center">{p.isMm ? 'Recap ပြီးမှ အသံနဲ့ စာတန်းပါတဲ့ ကြိုကြည့်ကို ကြည့်လို့ရမယ်။' : 'After the recap is made you can preview it here with voice and subtitles.'}</p>
      )}
    </div>
  );
};

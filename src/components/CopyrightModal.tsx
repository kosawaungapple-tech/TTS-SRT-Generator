import React, { useState } from 'react';
import { 
  ShieldAlert, ShieldCheck, X, CheckCircle2, AlertTriangle, 
  Sparkles, Sliders, EyeOff, Wand2, ArrowRight
} from 'lucide-react';

export interface CopyrightModalProps {
  isOpen: boolean;
  onClose: () => void;
  isMm: boolean;
  onApplyFullProtection?: () => void;
  blurSubtitlesOn?: boolean;
  onToggleBlurSubtitles?: (val: boolean) => void;
  blurSubY?: number;
  onChangeBlurSubY?: (val: number) => void;
  blurSubH?: number;
  onChangeBlurSubH?: (val: number) => void;
  hasVideo?: boolean;
  scriptText?: string;
  onNavigateToVideoEditor?: () => void;
}

export const CopyrightModal: React.FC<CopyrightModalProps> = ({
  isOpen,
  onClose,
  isMm,
  onApplyFullProtection,
  blurSubtitlesOn = false,
  onToggleBlurSubtitles,
  blurSubY = 80,
  onChangeBlurSubY,
  blurSubH = 16,
  onChangeBlurSubH,
  hasVideo = true,
  scriptText,
  onNavigateToVideoEditor,
}) => {
  const [activeTab, setActiveTab] = useState<'checklist' | 'blur' | 'guide'>('checklist');

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      <div 
        className="w-full max-w-2xl bg-slate-900 border border-amber-500/30 rounded-3xl shadow-2xl shadow-black/80 overflow-hidden flex flex-col max-h-[90vh]"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 sm:p-6 border-b border-white/10 bg-gradient-to-r from-amber-500/10 via-orange-500/5 to-transparent">
          <div className="flex items-center gap-3.5">
            <div className="w-11 h-11 rounded-2xl bg-amber-400/20 border border-amber-400/40 grid place-items-center text-amber-300 shadow-md shadow-amber-400/10">
              <ShieldAlert size={22} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base sm:text-lg font-black text-white">
                  {isMm ? 'Recap မူပိုင်ခွင့် (Copyright) ကာကွယ်ရေးစနစ်' : 'Recap Anti-Copyright Suite'}
                </h3>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase bg-amber-400/20 text-amber-300 border border-amber-400/30">
                  Bot Shield
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                {isMm 
                  ? 'YouTube / Facebook / TikTok Copyright Bot များ ရှောင်ရှားနိုင်ရန် စစ်ဆေးမှုနှင့် ပြင်ဆင်ချက်များ' 
                  : 'Bypass Content ID and Rights Manager automated recap detection'}
              </p>
            </div>
          </div>
          <button 
            type="button"
            onClick={onClose}
            className="w-9 h-9 rounded-xl bg-white/5 hover:bg-white/15 text-slate-400 hover:text-white grid place-items-center transition"
          >
            <X size={18} />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="flex items-center gap-2 px-6 pt-3 border-b border-white/5 bg-slate-950/40">
          <button
            type="button"
            onClick={() => setActiveTab('checklist')}
            className={`pb-3 text-xs font-bold border-b-2 transition flex items-center gap-1.5 ${
              activeTab === 'checklist' 
                ? 'border-amber-400 text-amber-300' 
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <CheckCircle2 size={14} />
            {isMm ? 'စစ်ဆေးချက်နှင့် Preset' : 'Checklist & Preset'}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('blur')}
            className={`pb-3 text-xs font-bold border-b-2 transition flex items-center gap-1.5 ${
              activeTab === 'blur' 
                ? 'border-amber-400 text-amber-300' 
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <EyeOff size={14} />
            {isMm ? 'မူရင်းစာတန်းထိုး Blur လုပ်ခြင်း' : 'Blur Subtitles'}
            {blurSubtitlesOn && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('guide')}
            className={`pb-3 text-xs font-bold border-b-2 transition flex items-center gap-1.5 ${
              activeTab === 'guide' 
                ? 'border-amber-400 text-amber-300' 
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Sliders size={14} />
            {isMm ? 'ကာကွယ်နည်းလမ်းညွှန်' : 'Rules & Tips'}
          </button>
        </div>

        {/* Content Body */}
        <div className="p-5 sm:p-6 space-y-4 overflow-y-auto max-h-[calc(90vh-170px)]">
          {activeTab === 'checklist' && (
            <div className="space-y-4">
              {/* Quick 1-Click Action */}
              {onApplyFullProtection && (
                <div className="p-4 rounded-2xl bg-gradient-to-r from-amber-500/20 via-orange-500/10 to-transparent border border-amber-500/30">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2 text-sm font-bold text-amber-300">
                        <Sparkles size={16} />
                        {isMm ? '1-Click မူပိုင်ခွင့်လွတ် အပြည့်အစုံ ဖွင့်မည်' : '1-Click Anti-Copyright Auto Preset'}
                      </div>
                      <p className="text-xs text-slate-300 mt-1">
                        {isMm 
                          ? 'မူရင်းစာတန်းထိုး Blur၊ နောက်ခံ ဘေးဘောင် Blur၊ Cinematic Contrast နှင့် Video Framing ကို တစ်ချက်တည်းဖြင့် အသင့်သတ်မှတ်ပေးမည်။' 
                          : 'Applies subtitle blur, blurred-fit aspect padding, cinematic contrast filter, and safe framing in one tap.'}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        onApplyFullProtection();
                        onClose();
                      }}
                      className="shrink-0 px-4 py-2.5 rounded-xl bg-amber-400 hover:bg-amber-300 text-black text-xs font-black flex items-center justify-center gap-2 transition active:scale-95 shadow-md shadow-amber-400/20"
                    >
                      <Wand2 size={14} />
                      {isMm ? 'ချက်ချင်း သတ်မှတ်မည်' : 'Apply Now'}
                    </button>
                  </div>
                </div>
              )}

              {/* Bot Detection Factors Checklist */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                    {isMm ? 'မူပိုင်ခွင့် ကာကွယ်ရေး အချက်အလက်များ' : 'Copyright Protection Matrix'}
                  </div>
                  {hasVideo && (
                    <span className="text-[10px] text-emerald-400 font-bold bg-emerald-400/10 px-2 py-0.5 rounded-full border border-emerald-400/20">
                      {isMm ? 'ဗီဒီယို စစ်ဆေးပြီး ✓' : 'Video loaded ✓'}
                    </span>
                  )}
                </div>

                {scriptText && (
                  <div className="p-3 rounded-xl bg-violet-500/10 border border-violet-500/20 text-xs text-slate-300">
                    <span className="font-bold text-violet-300">
                      {isMm ? '📝 Recap ဇာတ်ညွှန်း:' : '📝 Recap Script:'}
                    </span>{' '}
                    {isMm 
                      ? 'ရုပ်ရှင်အသံအစား ကိုယ်ပိုင် ဇာတ်လမ်းပြန်ပြော ဇာတ်ညွှန်းဖြစ်သည့်အတွက် မူပိုင်ခွင့် (Fair Use Transformation) စံနှုန်းနှင့် ကိုက်ညီပါသည်။' 
                      : 'Transformed narrative storytelling passes Fair Use threshold.'}
                  </div>
                )}

                {/* 1. Subtitle Blur */}
                <div className="p-3.5 rounded-xl bg-white/[0.03] border border-white/5 flex items-start gap-3">
                  <div className={`mt-0.5 p-1 rounded-lg ${blurSubtitlesOn ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'}`}>
                    {blurSubtitlesOn ? <ShieldCheck size={16} /> : <AlertTriangle size={16} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-white">
                        {isMm ? '၁။ မူရင်းစာတန်းထိုးများကို Blur လုပ်ခြင်း' : '1. Blur Burned-in Original Subtitles'}
                      </span>
                      {onToggleBlurSubtitles && (
                        <button
                          type="button"
                          onClick={() => onToggleBlurSubtitles(!blurSubtitlesOn)}
                          className={`text-[11px] font-bold px-2 py-0.5 rounded-md border transition ${
                            blurSubtitlesOn 
                              ? 'bg-emerald-400/20 text-emerald-300 border-emerald-400/40' 
                              : 'bg-white/10 text-slate-300 border-white/10 hover:bg-white/20'
                          }`}
                        >
                          {blurSubtitlesOn ? (isMm ? 'ဖွင့်ထားသည် ✓' : 'Enabled ✓') : (isMm ? 'ဖွင့်မည်' : 'Enable')}
                        </button>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      {isMm 
                        ? 'မူရင်းဗီဒီယိုမှာပါတဲ့ တရုတ်/အင်္ဂလိပ် မူရင်းစာတန်းတွေကို Blur Bar ဖြင့် ဖျောက်ထားခြင်းဖြင့် OCR scan မိခြင်းကို ကာကွယ်ပေးသည်။' 
                        : 'Prevents video OCR bots from detecting identical source subtitle text.'}
                    </p>
                  </div>
                </div>

                {/* 2. Visual Framing */}
                <div className="p-3.5 rounded-xl bg-white/[0.03] border border-white/5 flex items-start gap-3">
                  <div className="mt-0.5 p-1 rounded-lg bg-emerald-500/20 text-emerald-400">
                    <ShieldCheck size={16} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="text-xs font-bold text-white">
                      {isMm ? '၂။ ဗီဒီယို အချိုးအစားနှင့် နောက်ခံ Blur ဘောင်' : '2. Aspect Framing & Blurred Background'}
                    </span>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      {isMm 
                        ? '16:9 မူရင်းဗီဒီယိုကို 9:16 Shorts သို့မဟုတ် 1:1 စတုရန်းပြောင်းပြီး နောက်ခံကို Blurred Mirror ထည့်သွင်းခြင်းဖြင့် Visual Frame တူညီမှုကို လျှော့ချသည်။' 
                        : 'Changing aspect to 9:16/1:1 with blurred mirror padding breaks automated frame-matching hashes.'}
                    </p>
                  </div>
                </div>

                {/* 3. Audio / Narration */}
                <div className="p-3.5 rounded-xl bg-white/[0.03] border border-white/5 flex items-start gap-3">
                  <div className="mt-0.5 p-1 rounded-lg bg-emerald-500/20 text-emerald-400">
                    <ShieldCheck size={16} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="text-xs font-bold text-white">
                      {isMm ? '၃။ AI မြန်မာအသံသစ်နှင့် နောက်ခံ BGM Ducking' : '3. Fresh AI Burmese Voiceover & BGM'}
                    </span>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      {isMm 
                        ? 'မူရင်းရုပ်ရှင်အသံအစား Recap ဇာတ်လမ်းပြန်ပြော အသံသစ်ထပ်ထည့်ထားသောကြောင့် Audio Fingerprint လုံးဝပြောင်းလဲသွားသည်။' 
                        : 'Replaces original dialogue audio with fresh narrative storytelling voiceover.'}
                    </p>
                  </div>
                </div>

                {/* 4. Color Grading */}
                <div className="p-3.5 rounded-xl bg-white/[0.03] border border-white/5 flex items-start gap-3">
                  <div className="mt-0.5 p-1 rounded-lg bg-emerald-500/20 text-emerald-400">
                    <ShieldCheck size={16} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="text-xs font-bold text-white">
                      {isMm ? '၄။ Cinematic Contrast & Color Grading LUT' : '4. Cinematic Contrast & Color Grading'}
                    </span>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      {isMm 
                        ? 'ရုပ်ရှင်အရောင်ကို Contrast မြှင့်ခြင်း သို့မဟုတ် Teal & Orange လေသံပြောင်းပေးခြင်းဖြင့် ပုံရိပ်တူညီမှု ရာခိုင်နှုန်းကို ကာကွယ်သည်။' 
                        : 'Subtle color grading changes pixel histogram values without degrading viewer experience.'}
                    </p>
                  </div>
                </div>

                {/* 5. Speed Modulation */}
                <div className="p-3.5 rounded-xl bg-white/[0.03] border border-white/5 flex items-start gap-3">
                  <div className="mt-0.5 p-1 rounded-lg bg-emerald-500/20 text-emerald-400">
                    <ShieldCheck size={16} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="text-xs font-bold text-white">
                      {isMm ? '၅။ စည်းချက်နှင့် အမြန်နှုန်း ညှိချက် (1.05x - 1.08x Pacing)' : '5. Pacing Speed Modulation'}
                    </span>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      {isMm 
                        ? 'ဗီဒီယိုအပိုင်းများကို အတိုအရှည် ညှိဖြတ်တောက်ပြီး နှုန်း အနည်းငယ်မြှင့်ခြင်းဖြင့် Frame Timing Hash ကို ကျော်လွှားနိုင်သည်။' 
                        : 'Altering frame playback rate disrupts fixed-interval frame-rate fingerprinting.'}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'blur' && (
            <div className="space-y-4">
              <div className="p-4 rounded-2xl bg-white/[0.04] border border-white/10">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <EyeOff size={18} className="text-amber-400" />
                    <span className="text-sm font-bold text-white">
                      {isMm ? 'မူရင်းဗီဒီယိုထဲက စာတန်း/စာသား Blur ပြုလုပ်ခြင်း' : 'Blur Burned-in Original Subtitles'}
                    </span>
                  </div>
                  {onToggleBlurSubtitles && (
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input 
                        type="checkbox" 
                        checked={blurSubtitlesOn} 
                        onChange={e => onToggleBlurSubtitles(e.target.checked)} 
                        className="sr-only peer" 
                      />
                      <div className="w-11 h-6 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-amber-400"></div>
                    </label>
                  )}
                </div>

                <p className="text-xs text-slate-400 leading-relaxed">
                  {isMm 
                    ? 'ရုပ်ရှင်/ဗီဒီယို မူရင်းထဲတွင် မြှုပ်နှံထားသည့် တရုတ်၊ အင်္ဂလိပ် စာတန်းထိုးများ (Burned-in Subtitles) ကို မှုန်ဝါးသွားစေရန် နေရာသတ်မှတ်နိုင်ပါသည်။' 
                    : 'Place an adjustable horizontal blur bar over the burned-in hardcoded subtitles of the original film.'}
                </p>

                {blurSubtitlesOn && onChangeBlurSubY && onChangeBlurSubH && (
                  <div className="mt-4 pt-4 border-t border-white/10 space-y-4">
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-xs font-medium text-slate-300">
                          {isMm ? 'Blur အမြင့် အနေအထား (Position Y %)' : 'Position Y (from top %)'}
                        </span>
                        <span className="text-xs font-mono font-bold text-amber-300">{blurSubY}%</span>
                      </div>
                      <input 
                        type="range" 
                        min={0} 
                        max={95} 
                        step={1} 
                        value={blurSubY} 
                        onChange={e => onChangeBlurSubY(Number(e.target.value))} 
                        className="w-full h-2 rounded-full accent-amber-400 bg-slate-700" 
                      />
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-xs font-medium text-slate-300">
                          {isMm ? 'Blur ဘား အကျယ်အမြင့် (Band Height %)' : 'Blur Height %'}
                        </span>
                        <span className="text-xs font-mono font-bold text-amber-300">{blurSubH}%</span>
                      </div>
                      <input 
                        type="range" 
                        min={5} 
                        max={40} 
                        step={1} 
                        value={blurSubH} 
                        onChange={e => onChangeBlurSubH(Number(e.target.value))} 
                        className="w-full h-2 rounded-full accent-amber-400 bg-slate-700" 
                      />
                    </div>

                    <div className="p-3 rounded-xl bg-amber-400/10 border border-amber-400/20 text-[11px] text-amber-200 leading-relaxed">
                      💡 {isMm 
                        ? 'ဗီဒီယိုကြိုကြည့် (Preview) ထဲတွင် မှုန်ဝါးသည့်ဘားကို မူရင်းစာတန်းပေါ် တည့်တည့်ကျအောင် ချိန်ညှိပါ။ Recap ဗီဒီယို render လုပ်ရာတွင် ဤ blur ဘားကို ထည့်သွင်းပေးပါမည်။' 
                        : 'Adjust the slider while checking the video preview. When you render the recap video, this blur band is permanently applied.'}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'guide' && (
            <div className="space-y-3">
              <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/5 space-y-2">
                <h4 className="text-xs font-bold text-amber-300 uppercase tracking-wider">
                  {isMm ? 'ရုပ်ရှင် Recap မူပိုင်ခွင့် လွတ်ကင်းစေရေး လျှို့ဝှက်ချက် ၅ ချက်' : '5 Pro Rules for Recap Monetization'}
                </h4>
                <ul className="text-xs text-slate-300 space-y-2 list-disc list-inside">
                  <li>
                    <strong className="text-white">{isMm ? '၁။ ဇာတ်ကွက်တစ်ခုကို ၅ စက္ကန့်ထက် ပိုမထားပါနှင့်' : '1. Keep scene clips under 5-7 seconds'}:</strong>{' '}
                    {isMm ? 'ဇာတ်ကွက်ရှည်ကြီးတွေထက် အတိုလေးတွေ ဖြတ်ဆက်ပြောပါ' : 'Rapid cuts break continuous visual fingerprint matching.'}
                  </li>
                  <li>
                    <strong className="text-white">{isMm ? '၂။ မူရင်းစာတန်းထိုးကို အမြဲ Blur လုပ်ပါ' : '2. Always blur burned-in source text'}:</strong>{' '}
                    {isMm ? 'YouTube OCR Bot သည် စာတန်းများကို scan ဖတ်ပြီး မူရင်းရုပ်ရှင်ကို ရှာဖွေနိုင်ပါသည်' : 'Prevents text-based visual crawler matches.'}
                  </li>
                  <li>
                    <strong className="text-white">{isMm ? '၃။ မူရင်းရုပ်ရှင်အသံကို လုံးဝ ပိတ်ပါ သို့မဟုတ် လျှော့ပါ' : '3. Mute or duck original movie audio'}:</strong>{' '}
                    {isMm ? 'ရုပ်ရှင်နောက်ခံတေးသည် Audio Match အမိဆုံးဖြစ်ပါသည်' : 'Soundtrack matching triggers 90% of automated strikes.'}
                  </li>
                  <li>
                    <strong className="text-white">{isMm ? '၄။ ကိုယ်ပိုင် မြန်မာစာတန်းထိုး ထပ်ထည့်ပါ' : '4. Burn your own styled subtitles'}:</strong>{' '}
                    {isMm ? 'အောက်ခြေ သို့မဟုတ် အလယ်တွင် စာတန်းအသစ်ဖုံးအုပ်ထားခြင်းက ဗီဒီယို pixel များကို အသစ်ဖြစ်စေပါသည်' : 'Dynamic animated subtitles alter frame pixels.'}
                  </li>
                  <li>
                    <strong className="text-white">{isMm ? '၅။ Channel Watermark သို့မဟုတ် Logo ထည့်ပါ' : '5. Add your channel logo & overlay'}:</strong>{' '}
                    {isMm ? 'ထောင့်တွင် Logo သို့မဟုတ် စာသားထည့်ခြင်းက မူရင်းနှင့် ကွဲပြားစေပါသည်' : 'Permanent visual stamps confirm transformed content.'}
                  </li>
                </ul>
              </div>

              {onNavigateToVideoEditor && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onNavigateToVideoEditor();
                  }}
                  className="w-full p-3.5 rounded-2xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-bold text-white flex items-center justify-between transition"
                >
                  <span className="flex items-center gap-2">
                    <Sliders size={16} className="text-amber-400" />
                    {isMm ? 'Video Studio ထဲရှိ Anti-Copyright Tools များသို့ သွားမည်' : 'Open Full Video Studio Anti-Copyright Suite'}
                  </span>
                  <ArrowRight size={14} className="text-slate-400" />
                </button>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 sm:p-5 border-t border-white/10 bg-slate-950/60 flex items-center justify-between">
          <div className="text-[11px] text-slate-400">
            {isMm ? '🛡️ Safe Recap Protection Engine' : '🛡️ Safe Recap Protection Engine'}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-white text-xs font-bold transition"
          >
            {isMm ? 'ပိတ်မည်' : 'Close'}
          </button>
        </div>
      </div>
    </div>
  );
};

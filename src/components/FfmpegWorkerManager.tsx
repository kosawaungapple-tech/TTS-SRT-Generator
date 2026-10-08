import React, { useState, useEffect } from 'react';
import {
  CheckCircle2,
  XCircle,
  RefreshCw,
  Download,
  Copy,
  Check,
  Server,
  Laptop,
  Terminal,
  Info
} from 'lucide-react';
import { WorkerEngineService, WorkerHealthInfo } from '../services/workerEngineService';
import { useLanguage } from '../contexts/LanguageContext';
import { downloadSetupScript } from '../utils/engineSetupGenerator';

interface FfmpegWorkerManagerProps {
  onToast?: (message: string, type?: 'success' | 'error' | 'info') => void;
}

export const FfmpegWorkerManager: React.FC<FfmpegWorkerManagerProps> = ({
  onToast
}) => {
  const { isMm } = useLanguage();
  const [health, setHealth] = useState<WorkerHealthInfo>(WorkerEngineService.getHealth());
  const [workerUrl, setWorkerUrl] = useState<string>(WorkerEngineService.getWorkerUrl());
  const [isChecking, setIsChecking] = useState<boolean>(false);
  const [copiedCmd, setCopiedCmd] = useState<boolean>(false);

  useEffect(() => {
    const unsubscribe = WorkerEngineService.subscribe((h) => {
      setHealth(h);
    });
    return unsubscribe;
  }, []);

  const handleTestPing = async () => {
    setIsChecking(true);
    try {
      const res = await WorkerEngineService.checkHealthNow();
      if (res.status === 'online') {
        if (onToast) onToast(isMm ? '🟢 Local PC FFmpeg Worker ချိတ်ဆက်မှု အောင်မြင်ပါသည်!' : '🟢 Local PC Worker is ONLINE!', 'success');
      } else {
        if (onToast) onToast(isMm ? '🔴 Worker မတွေ့ပါ (Computer ပိတ်ထားပါသလား သို့မဟုတ် Worker မဖွင့်ရသေးပါလား စစ်ဆေးပါ)' : '🔴 Worker is OFFLINE (Check if runner is started)', 'error');
      }
    } finally {
      setIsChecking(false);
    }
  };

  const handleSaveUrl = () => {
    WorkerEngineService.setWorkerUrl(workerUrl);
    if (onToast) onToast(isMm ? 'Worker URL သိမ်းဆည်းပြီးပါပြီ' : 'Worker URL saved', 'success');
  };

  const handleCopyCommand = (cmd: string) => {
    navigator.clipboard.writeText(cmd);
    setCopiedCmd(true);
    setTimeout(() => setCopiedCmd(false), 2000);
    if (onToast) onToast(isMm ? 'Command ကို ကူးယူပြီးပါပြီ 📋' : 'Command copied to clipboard!', 'success');
  };

  const formatUptime = (sec?: number) => {
    if (!sec) return 'Just started';
    const mins = Math.floor(sec / 60);
    const hrs = Math.floor(mins / 60);
    if (hrs > 0) return `${hrs}h ${mins % 60}m`;
    return `${mins}m ${sec % 60}s`;
  };

  const handleDownloadSetup = (type: 'windows' | 'mac' | 'linux') => {
    const adminCode = localStorage.getItem('vbs_access_code') || 'saw_vlogs_2026';
    const appOrigin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';
    downloadSetupScript(type, {
      appOrigin,
      projectId: 'ai-studio-remix',
      adminCode,
      port: 5005
    });
    if (onToast) onToast(isMm ? `🎬 ${type === 'windows' ? 'Windows (.bat)' : 'Mac/Linux (.sh)'} Engine Setup ဒေါင်းလုဒ်ဆွဲပြီးပါပြီ!` : `🎬 Downloaded ${type === 'windows' ? 'Windows (.bat)' : 'Mac/Linux (.sh)'} Engine Setup!`, 'success');
  };

  const currentHost = typeof window !== 'undefined' ? window.location.origin : '';
  const quickCurlCmd = `curl -O ${currentHost}/worker/vbs-ffmpeg-worker.js && node vbs-ffmpeg-worker.js`;

  const isOnline = health.status === 'online';

  return (
    <div className="space-y-6">
      {/* 1. Real-time Status Card */}
      <div className="premium-glass rounded-[32px] p-6 sm:p-7 shadow-2xl border border-white/10 relative overflow-hidden bg-gradient-to-br from-black/80 via-slate-950/70 to-black/90">
        <div className={`absolute top-0 right-0 w-80 h-80 rounded-full blur-[100px] -z-10 pointer-events-none ${isOnline ? 'bg-emerald-500/15' : 'bg-rose-500/15'}`} />

        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 pb-6 border-b border-white/10">
          <div className="flex items-start gap-4">
            <div className={`p-3.5 rounded-2xl border shadow-xl shrink-0 ${
              isOnline
                ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-400 shadow-emerald-500/10'
                : 'bg-rose-500/20 border-rose-500/40 text-rose-400 shadow-rose-500/10'
            }`}>
              <Laptop size={28} />
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-3 flex-wrap">
                <h3 className="text-xl sm:text-2xl font-black text-white tracking-tight">
                  {isMm ? 'Dedicated FFmpeg Worker Engine' : 'Dedicated FFmpeg Worker Engine'}
                </h3>
                <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black uppercase tracking-wider border shadow-sm ${
                  isOnline
                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                    : 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                }`}>
                  <span className={`w-2 h-2 rounded-full ${isOnline ? 'bg-emerald-400 animate-pulse' : 'bg-rose-500'}`} />
                  {isOnline
                    ? (isMm ? 'ONLINE (ချိတ်ဆက်ထားသည်)' : 'ONLINE')
                    : (isMm ? 'OFFLINE (ကွန်ပျူတာ ပိတ်ထားသည်)' : 'OFFLINE')}
                </span>
              </div>
              <p className="text-xs sm:text-sm text-slate-400 max-w-2xl">
                {isMm
                  ? 'သင့် Computer သို့မဟုတ် VPS Server ပေါ်တွင် Native FFmpeg ဖြင့် ဗီဒီယိုကို Frame တိုင်း တိကျစွာ Render လုပ်ပေးသည့် ကြားခံ Engine ဖြစ်ပါသည်။ Computer ဖွင့်ထားပါက Online ဖြစ်နေမည်ဖြစ်ပြီး ပိတ်ထားပါက Offline ဟု အလိုအလျောက် ပြသပေးပါသည်။'
                  : 'Run native FFmpeg on your personal computer or VPS for 100% Zero-Stutter, full-speed video exports. Shows Online when your PC is running and Offline when shut down.'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleTestPing}
              disabled={isChecking}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 text-white text-xs font-bold border border-white/10 transition-all active:scale-95 disabled:opacity-50"
            >
              <RefreshCw size={14} className={isChecking ? 'animate-spin text-amber-400' : ''} />
              <span>{isMm ? 'ပြန်လည်စစ်ဆေးမည်' : 'Check Status'}</span>
            </button>
          </div>
        </div>

        {/* Live Diagnostics & System Specs */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-6">
          <div className="p-4 rounded-2xl bg-white/5 border border-white/5 space-y-1">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
              {isMm ? 'ချိတ်ဆက်လိပ်စာ (URL)' : 'Worker URL'}
            </span>
            <p className="text-xs sm:text-sm font-mono font-bold text-amber-300 truncate" title={workerUrl}>
              {workerUrl}
            </p>
          </div>

          <div className="p-4 rounded-2xl bg-white/5 border border-white/5 space-y-1">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
              {isMm ? 'စက်အခြေအနေ (Status)' : 'Device Status'}
            </span>
            <div className="flex items-center gap-1.5">
              {isOnline ? (
                <>
                  <CheckCircle2 size={14} className="text-emerald-400 shrink-0" />
                  <span className="text-xs sm:text-sm font-bold text-emerald-400">
                    {health.hostname || 'Active & Ready'}
                  </span>
                </>
              ) : (
                <>
                  <XCircle size={14} className="text-rose-400 shrink-0" />
                  <span className="text-xs sm:text-sm font-bold text-rose-400">
                    {isMm ? 'မတွေ့ပါ (Offline)' : 'Unreachable'}
                  </span>
                </>
              )}
            </div>
          </div>

          <div className="p-4 rounded-2xl bg-white/5 border border-white/5 space-y-1">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
              FFmpeg Version
            </span>
            <p className="text-xs sm:text-sm font-mono text-slate-300 truncate" title={health.ffmpegVersion || 'N/A'}>
              {isOnline ? (health.ffmpegAvailable ? 'Native FFmpeg Ready 🟢' : 'Not installed in PATH') : 'Offline'}
            </p>
          </div>

          <div className="p-4 rounded-2xl bg-white/5 border border-white/5 space-y-1">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
              {isMm ? 'စက်ဖွင့်ထားချိန် (Uptime)' : 'Uptime'}
            </span>
            <p className="text-xs sm:text-sm font-bold text-slate-300">
              {isOnline ? formatUptime(health.uptimeSeconds) : '0m'}
            </p>
          </div>
        </div>
      </div>

      {/* 2. One-Click Installers for Local PC */}
      <div className="premium-glass rounded-[32px] p-6 sm:p-7 shadow-2xl border border-white/10 space-y-5">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-amber-400/20 text-amber-300 border border-amber-400/30">
            <Download size={20} />
          </div>
          <div>
            <h4 className="text-lg font-bold text-white">
              {isMm ? 'သင့် Computer တွင် တင်ရန် One-Click Download ဖိုင်များ' : 'One-Click Download & Launch Files'}
            </h4>
            <p className="text-xs text-slate-400">
              {isMm
                ? 'သင့် Windows သို့မဟုတ် Mac ကွန်ပျူတာပေါ်တွင် ဒေါင်းလုဒ်ဆွဲပြီး တစ်ချက်နှိပ်ရုံဖြင့် Worker Engine စတင်နိုင်ပါသည်'
                : 'Download and double-click to start the dedicated worker engine on your computer.'}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Windows .bat */}
          <div className="p-5 rounded-2xl bg-white/5 hover:bg-white/[0.08] border border-white/10 transition-all space-y-4 flex flex-col justify-between group">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="px-2.5 py-0.5 rounded-lg bg-blue-500/20 text-blue-300 border border-blue-500/30 text-[10px] font-black uppercase">
                  Windows 1-Click
                </span>
                <span className="text-xs text-slate-400 font-mono">.BAT</span>
              </div>
              <h5 className="font-bold text-white text-sm">run-worker-windows.bat</h5>
              <p className="text-xs text-slate-400 leading-relaxed">
                {isMm
                  ? 'Windows ကွန်ပျူတာအတွက် အသင့်သုံး Batch file ဖြစ်သည်။ Download ဆွဲပြီး Double-click နှိပ်ရုံဖြင့် အလိုအလျောက် စတင်ပါမည်။'
                  : 'Double-click to automatically check Node.js, verify FFmpeg, and start worker on Port 5005.'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => handleDownloadSetup('windows')}
              className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl bg-blue-500 hover:bg-blue-400 text-white font-bold text-xs shadow-lg shadow-blue-500/20 transition-all active:scale-95"
            >
              <Download size={14} />
              <span>{isMm ? 'Download Engine Setup (.bat)' : 'Download Engine Setup (.bat)'}</span>
            </button>
          </div>

          {/* Mac / Linux .sh */}
          <div className="p-5 rounded-2xl bg-white/5 hover:bg-white/[0.08] border border-white/10 transition-all space-y-4 flex flex-col justify-between group">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="px-2.5 py-0.5 rounded-lg bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[10px] font-black uppercase">
                  Mac & Linux
                </span>
                <span className="text-xs text-slate-400 font-mono">.SH</span>
              </div>
              <h5 className="font-bold text-white text-sm">run-worker-mac-linux.sh</h5>
              <p className="text-xs text-slate-400 leading-relaxed">
                {isMm
                  ? 'Macbook သို့မဟုတ် Linux စက်များအတွက် Bash script ဖြစ်သည်။ Terminal မှ bash ဖြင့် လွယ်ကူစွာ run နိုင်ပါသည်။'
                  : 'Shell script for macOS and Linux. Starts worker engine with native ffmpeg.'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => handleDownloadSetup('mac')}
              className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-white font-bold text-xs shadow-lg shadow-emerald-500/20 transition-all active:scale-95"
            >
              <Download size={14} />
              <span>{isMm ? 'Download Engine Setup (.sh)' : 'Download Engine Setup (.sh)'}</span>
            </button>
          </div>

          {/* Standalone JS */}
          <div className="p-5 rounded-2xl bg-white/5 hover:bg-white/[0.08] border border-white/10 transition-all space-y-4 flex flex-col justify-between group">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="px-2.5 py-0.5 rounded-lg bg-amber-500/20 text-amber-300 border border-amber-500/30 text-[10px] font-black uppercase">
                  Standalone / VPS
                </span>
                <span className="text-xs text-slate-400 font-mono">.JS</span>
              </div>
              <h5 className="font-bold text-white text-sm">vbs-ffmpeg-worker.js</h5>
              <p className="text-xs text-slate-400 leading-relaxed">
                {isMm
                  ? 'ပြင်ပ Dependency မလိုသော သီးသန့် Node.js Worker ဖြစ်သည်။ ကွန်ပျူတာ သို့မဟုတ် VPS ပေါ်တွင် node ဖြင့် တိုက်ရိုက် run နိုင်ပါသည်။'
                  : 'Zero-dependency standalone Node.js file. Run directly via node vbs-ffmpeg-worker.js.'}
              </p>
            </div>
            <a
              href="/api/worker/download/js"
              download="vbs-ffmpeg-worker.js"
              className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl bg-amber-400 hover:bg-amber-300 text-black font-extrabold text-xs shadow-lg shadow-amber-400/20 transition-all active:scale-95"
            >
              <Download size={14} />
              <span>{isMm ? 'Worker Script (.js) ဒေါင်းမည်' : 'Download Worker (.js)'}</span>
            </a>
          </div>
        </div>

        {/* Quick Terminal Copy */}
        <div className="p-4 rounded-2xl bg-black/60 border border-white/10 space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-400 font-bold">
            <span className="flex items-center gap-1.5">
              <Terminal size={14} className="text-amber-400" />
              <span>{isMm ? 'Terminal / Command Prompt မှ 1-Click Run ရန် Command:' : '1-Click Quick Terminal Command:'}</span>
            </span>
            <button
              type="button"
              onClick={() => handleCopyCommand(quickCurlCmd)}
              className="flex items-center gap-1 text-[11px] text-amber-400 hover:text-amber-300 transition-colors"
            >
              {copiedCmd ? <Check size={12} /> : <Copy size={12} />}
              <span>{copiedCmd ? (isMm ? 'ကူးယူပြီးပါပြီ' : 'Copied') : (isMm ? 'Copy ကူးမည်' : 'Copy Command')}</span>
            </button>
          </div>
          <pre className="text-xs font-mono text-emerald-400 overflow-x-auto p-2.5 bg-black/80 rounded-xl border border-white/5 select-all">
            {quickCurlCmd}
          </pre>
        </div>
      </div>

      {/* 3. Worker URL Configuration (Local PC vs Future VPS) */}
      <div className="premium-glass rounded-[32px] p-6 sm:p-7 shadow-2xl border border-white/10 space-y-5">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-purple-500/20 text-purple-300 border border-purple-500/30">
              <Server size={20} />
            </div>
            <div>
              <h4 className="text-lg font-bold text-white">
                {isMm ? 'Worker URL သတ်မှတ်ခြင်း (Local PC သို့မဟုတ် နောင်တွင် VPS)' : 'Worker URL Settings'}
              </h4>
              <p className="text-xs text-slate-400">
                {isMm
                  ? 'လောလောဆယ် သင့် PC အတွက် http://localhost:5005 ဟုထားပါ။ နောင်တွင် VPS server ဝယ်ယူပါက VPS ၏ IP/Domain ကို ဤနေရာတွင် ထည့်သွင်းနိုင်ပါသည်'
                  : 'Default is http://localhost:5005 for local PC. In future when you purchase a VPS, enter your VPS address here.'}
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setWorkerUrl('http://localhost:5005')}
            className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-white text-xs font-bold border border-white/10 transition-colors"
          >
            💻 Local PC (localhost:5005)
          </button>
          {health.lanIps && health.lanIps.length > 0 ? (
            health.lanIps.map(ip => (
              <button
                key={ip}
                type="button"
                onClick={() => setWorkerUrl(`http://${ip}:5005`)}
                className="px-3 py-1.5 rounded-lg bg-blue-500/10 hover:bg-blue-500/20 text-blue-300 text-xs font-bold border border-blue-500/20 transition-colors"
              >
                📱 Phone/Tablet Wi-Fi ({ip}:5005)
              </button>
            ))
          ) : (
            <button
              type="button"
              onClick={() => setWorkerUrl('http://192.168.1.100:5005')}
              className="px-3 py-1.5 rounded-lg bg-blue-500/10 hover:bg-blue-500/20 text-blue-300 text-xs font-bold border border-blue-500/20 transition-colors"
            >
              📱 Phone/Tablet (192.168.x.x:5005)
            </button>
          )}
        </div>

        <div className="flex flex-col sm:flex-row items-center gap-3">
          <input
            type="text"
            value={workerUrl}
            onChange={(e) => setWorkerUrl(e.target.value)}
            placeholder="http://localhost:5005 or http://192.168.1.XX:5005"
            className="w-full bg-slate-900 border border-white/10 rounded-xl px-4 py-3 text-sm text-white font-mono focus:outline-none focus:ring-2 focus:ring-amber-400/50"
          />
          <button
            type="button"
            onClick={handleSaveUrl}
            className="w-full sm:w-auto px-6 py-3 rounded-xl bg-amber-400 hover:bg-amber-300 text-black font-extrabold text-xs shrink-0 shadow-lg shadow-amber-400/20 transition-all active:scale-95"
          >
            {isMm ? 'သိမ်းဆည်းပြီး စမ်းသပ်မည်' : 'Save & Connect'}
          </button>
        </div>

        {health.lanIps && health.lanIps.length > 0 && (
          <div className="p-3.5 rounded-xl bg-blue-500/10 border border-blue-500/20 space-y-2 text-xs text-blue-200">
            <div className="flex items-center justify-between">
              <span className="font-bold flex items-center gap-1.5">
                📱 {isMm ? 'အခြား Device များ (ဖုန်း/တက်ဘလက်) မှ ချိတ်ဆက်ရန် Wi-Fi IP များ (နှိပ်၍ အသုံးပြုနိုင်ပါသည်):' : 'Click to connect from Phone / Tablet on same Wi-Fi:'}
              </span>
            </div>
            <div className="flex flex-wrap gap-2 pt-1 font-mono">
              {health.lanIps.map(ip => (
                <button
                  key={ip}
                  type="button"
                  onClick={() => {
                    const target = `http://${ip}:5005`;
                    setWorkerUrl(target);
                    WorkerEngineService.setWorkerUrl(target);
                    if (onToast) onToast(isMm ? `Worker URL ကို ${target} သို့ ပြောင်းလဲချိတ်ဆက်လိုက်ပါပြီ!` : `Set Worker URL to ${target}`, 'success');
                  }}
                  className="px-2.5 py-1.5 rounded-lg bg-black/60 hover:bg-blue-600/30 text-white border border-blue-500/40 hover:border-blue-400 transition-all flex items-center gap-1.5 cursor-pointer active:scale-95 text-xs"
                >
                  <span>🔗 http://{ip}:5005</span>
                  <span className="text-[10px] text-blue-300 font-sans">({isMm ? 'ချိတ်မည်' : 'Connect'})</span>
                </button>
              ))}
            </div>
            <p className="text-[11px] text-slate-300 leading-relaxed pt-1">
              {isMm
                ? '💡 ဖုန်း/တက်ဘလက်တွင် HTTPS ဖြင့် အသုံးပြုနေပါကလည်း Built-in Smart Server Proxy က Mixed-Content ကန့်သတ်ချက်ကို အလိုအလျောက် ဖြေရှင်းပေးမည်ဖြစ်ပြီး သင့် PC Worker မှ 100% Zero-Stutter Render လုပ်ပေးပါမည်။'
                : '💡 Cross-Device Smart Proxy automatically routes renders from phone/tablet without Mixed-Content issues.'}
            </p>
          </div>
        )}

        {/* Helpful Tips in Burmese */}
        <div className="p-4 rounded-2xl bg-amber-400/10 border border-amber-400/20 space-y-2 text-xs text-amber-200 leading-relaxed">
          <div className="flex items-center gap-1.5 font-bold text-amber-300">
            <Info size={15} />
            <span>{isMm ? '💡 အသုံးပြုပုံ လမ်းညွှန်ချက် အနှစ်ချုပ်:' : '💡 Quick Guide:'}</span>
          </div>
          <ul className="list-disc list-inside space-y-1 text-slate-300">
            <li>
              <strong>Windows:</strong> <code>run-worker-windows.bat</code> ဖိုင်နှင့် <code>vbs-ffmpeg-worker.js</code> ဖိုင်ကို Folder တစ်ခုတည်းတွင် ထားပြီး Double-click နှိပ်ရုံဖြင့် Worker ပွင့်လာပါမည်။
            </li>
            <li>
              <strong>Online အခြေအနေ:</strong> ကွန်ပျူတာ ဖွင့်ထားပြီး Worker run ထားသည့်အချိန်တွင် Video Edit Studio တွင် <code>🟢 Local PC Engine: ONLINE</code> ဟု အလိုအလျောက် ပြသပေးမည်ဖြစ်ပြီး ကွန်ပျူတာ ပိတ်ထားပါက <code>🔴 OFFLINE</code> ဟု ပြပေးပါမည်။
            </li>
            <li>
              <strong>Zero-Stutter အကျိုးကျေးဇူး:</strong> သင့် Computer ပေါ်ရှိ Native FFmpeg ဖြင့် ဗီဒီယိုကို တိုက်ရိုက် Render လုပ်ပေးသဖြင့် Browser ကဲ့သို့ Frame drop လုံးဝမဖြစ်တော့ဘဲ ၁၀၀% မထစ်သော မူရင်း HD Video ကို အလျင်မြန်ဆုံး ရရှိပါမည်။
            </li>
            <li>
              <strong>နောင်တွင် VPS သို့ ပြောင်းလဲခြင်း:</strong> VPS Server ဝယ်ယူပြီးပါက ဤ script အတိုင်း VPS ပေါ်တွင် တင်ပြီး အပေါ်က Worker URL နေရာတွင် သင့် VPS IP/Domain ကို ပြောင်းထည့်လိုက်ရုံဖြင့် အမြဲတမ်း ၂၄ နာရီ Online ဖြစ်နေပါမည်။
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
};

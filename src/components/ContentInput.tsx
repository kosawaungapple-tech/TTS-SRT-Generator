import React from 'react';
import { Trash2, Clipboard } from 'lucide-react';

interface ContentInputProps {
  text: string;
  setText: (text: string) => void;
  isDarkMode: boolean;
}

export const ContentInput: React.FC<ContentInputProps> = ({ text, setText, isDarkMode }) => {
  const handlePaste = async () => {
    try {
      const clipboardText = await navigator.clipboard.readText();
      setText(text + clipboardText);
    } catch (err) {
      console.error('Failed to read clipboard');
    }
  };

  return (
    <div className="bg-slate-50 border border-slate-200 dark:bg-slate-900 dark:border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl transition-all duration-300 hover:neon-border-purple">
      <div className="flex items-center justify-between mb-6 border-b border-slate-200 dark:border-slate-800 pb-4">
        <h2 className="text-sm font-bold flex items-center gap-2 text-slate-900 dark:text-white font-mono uppercase tracking-widest">
          <div className="w-2 h-2 bg-brand-purple rounded-full animate-pulse shadow-[0_0_8px_rgba(139,92,246,0.8)]" />
          ဇာတ်လမ်းအကျဉ်း
          <span className="text-[10px] bg-brand-purple/20 text-brand-purple px-2 py-0.5 rounded-full font-mono border border-brand-purple/30">
            MY / EN
          </span>
        </h2>
        <div className="flex gap-4">
          <button
            onClick={handlePaste}
            className="flex items-center gap-1.5 text-[10px] font-bold text-slate-500 dark:text-slate-400 hover:text-brand-purple dark:hover:text-brand-purple transition-colors font-mono uppercase tracking-wider btn-pulse"
          >
            <Clipboard size={14} /> ကူးယူမည်
          </button>
          <button
            onClick={() => setText('')}
            className="flex items-center gap-1.5 text-[10px] font-bold text-slate-500 dark:text-slate-400 hover:text-red-500 dark:hover:text-red-400 transition-colors font-mono uppercase tracking-wider btn-pulse"
          >
            <Trash2 size={14} /> ဖျက်မည်
          </button>
        </div>
      </div>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="စာသားများကို ဤနေရာတွင် ရိုက်ထည့်ပါ..."
        style={{ 
          backgroundColor: isDarkMode ? '#020617' : '#ffffff', 
          color: isDarkMode ? '#f1f5f9' : '#0f172a' 
        }}
        className="w-full h-80 bg-white border border-slate-200 dark:bg-slate-950 dark:border-slate-800 rounded-2xl p-6 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-purple/50 resize-none custom-scrollbar transition-all duration-300 font-sans text-sm leading-relaxed"
      />

      <div className="mt-3 flex justify-end">
        <span className="text-xs text-slate-500 dark:text-slate-400 font-mono">
          {text.length} လုံး
        </span>
      </div>
    </div>
  );
};

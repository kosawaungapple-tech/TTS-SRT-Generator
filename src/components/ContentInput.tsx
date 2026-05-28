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
    <div className="bg-slate-50 border border-slate-200 dark:bg-slate-900 dark:border-slate-800 rounded-2xl p-6 shadow-xl transition-colors duration-300">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold flex items-center gap-2 text-slate-900 dark:text-white">
          Content Input
          <span className="text-[10px] bg-brand-purple/20 text-brand-purple px-2 py-0.5 rounded-full font-medium">
            MY / EN / ZH
          </span>
        </h2>
        <div className="flex gap-2">
          <button
            onClick={handlePaste}
            className="flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors"
          >
            <Clipboard size={14} /> Paste
          </button>
          <button
            onClick={() => setText('')}
            className="flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-red-500 dark:hover:text-red-400 transition-colors"
          >
            <Trash2 size={14} /> Clear
          </button>
        </div>
      </div>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="စာသားများကို ဤနေရာတွင် ရိုက်ထည့်ပါ... (Enter text here...)"
        style={{ 
          backgroundColor: isDarkMode ? '#020617' : '#ffffff', 
          color: isDarkMode ? '#f1f5f9' : '#0f172a' 
        }}
        className="w-full h-64 bg-white border border-slate-200 dark:bg-slate-950 dark:border-slate-800 rounded-xl p-4 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-purple/50 resize-none custom-scrollbar transition-colors duration-300"
      />

      <div className="mt-3 flex justify-end">
        <span className="text-xs text-slate-500 dark:text-slate-400 font-mono">
          {text.length} characters
        </span>
      </div>
    </div>
  );
};

import React, { useState } from 'react';
import { Trash2, Clipboard, Sparkles, RefreshCw } from 'lucide-react';
import { GoogleGenAI } from "@google/genai";

interface ContentInputProps {
  text: string;
  setText: (text: string) => void;
  isDarkMode: boolean;
  getApiKey: () => string | null;
  showToast: (message: string, type: 'success' | 'error') => void;
}

export const ContentInput: React.FC<ContentInputProps> = ({ text, setText, isDarkMode, getApiKey, showToast }) => {
  const [isRewriting, setIsRewriting] = useState(false);

  const handlePaste = async () => {
    try {
      const clipboardText = await navigator.clipboard.readText();
      setText(text + clipboardText);
    } catch (err) {
      console.error('Failed to read clipboard');
    }
  };

  const handleRewrite = async () => {
    if (!text.trim()) return;
    
    const apiKey = getApiKey();
    if (!apiKey) {
      showToast('ကျေးဇူးပြု၍ Settings တွင် API Key အရင်ထည့်သွင်းပါ။ (No API Key found. Please add one in Settings.)', 'error');
      return;
    }

    setIsRewriting(true);
    try {
      const ai = new GoogleGenAI({ apiKey });
      
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `You are a professional Burmese content creator. Paraphrase the following text to be unique, engaging, and copyright-safe. Use a natural storytelling tone. Original text: ${text}`,
      });

      const rewrittenText = response.text;
      if (rewrittenText) {
        setText(rewrittenText);
        showToast('စာသားကို အောင်မြင်စွာ ပြန်လည်ရေးသားပြီးပါပြီ။ (Text rewritten successfully!)', 'success');
      }
    } catch (err) {
      console.error('Rewriting failed:', err);
      showToast('Rewrite failed. Please check your connection.', 'error');
    } finally {
      setIsRewriting(false);
    }
  };

  return (
    <div className="bg-slate-50 border border-slate-200 dark:bg-slate-900 dark:border-slate-800 rounded-2xl p-6 shadow-xl transition-colors duration-300">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
        <h2 className="text-lg font-semibold flex items-center gap-2 text-slate-900 dark:text-white">
          Content Input
          <span className="text-[10px] bg-brand-purple/20 text-brand-purple px-2 py-0.5 rounded-full font-medium">
            MY / EN / ZH
          </span>
        </h2>
        
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={handleRewrite}
            disabled={isRewriting || !text.trim()}
            className="flex items-center gap-2 px-4 py-2 bg-brand-purple text-white rounded-xl text-xs font-bold hover:bg-brand-purple/90 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-md shadow-brand-purple/20"
          >
            {isRewriting ? (
              <RefreshCw size={14} className="animate-spin" />
            ) : (
              <Sparkles size={14} />
            )}
            {isRewriting ? 'Rewriting...' : 'Rewrite with AI'}
          </button>

          <div className="h-4 w-[1px] bg-slate-200 dark:bg-slate-800 hidden sm:block" />

          <div className="flex gap-3">
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

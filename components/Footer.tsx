import React from 'react';
import { Youtube, ExternalLink } from 'lucide-react';

export const Footer: React.FC = () => {
  return (
    <footer className="w-full py-8 px-4 mt-auto border-t border-slate-200 dark:border-slate-800 transition-colors duration-300">
      <div className="container mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="flex flex-col items-center md:items-start gap-1">
          <p className="text-[10px] sm:text-xs text-slate-500 dark:text-slate-400 font-medium text-center md:text-left">
            Created by <span className="text-brand-purple font-bold">Saw</span> © 2026 <span className="mx-2 hidden sm:inline text-slate-300 dark:text-slate-700">|</span> <span className="block sm:inline text-[9px] sm:text-[10px] text-slate-400 dark:text-slate-500 uppercase tracking-widest font-semibold">Vlogs By Saw - Narration Engine</span>
          </p>
        </div>

        <div className="flex items-center gap-4">
          <a
            href="https://youtube.com/@vlogsbysaw"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 px-3 py-1.5 bg-red-500/10 text-red-500 border border-red-500/20 rounded-full text-[10px] font-bold uppercase tracking-wider hover:bg-red-50 hover:text-white transition-all group"
          >
            <Youtube size={14} className="w-3.5 h-3.5 flex-shrink-0" />
            Vlogs By Saw
            <ExternalLink size={10} className="w-2.5 h-2.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
          </a>
        </div>
      </div>
    </footer>
  );
};

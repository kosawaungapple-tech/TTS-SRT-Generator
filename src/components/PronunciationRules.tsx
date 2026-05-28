import React from 'react';
import { ExternalLink, ShieldCheck, Info, Plus } from 'lucide-react';
import { PronunciationRule } from '../types';

interface PronunciationRulesProps {
  rules: PronunciationRule[];
  globalRules: PronunciationRule[];
  customRules: string;
  setCustomRules: (rules: string) => void;
  isAdmin: boolean;
  onOpenTools: () => void;
  showCustomRules?: boolean;
}

export const PronunciationRules: React.FC<PronunciationRulesProps> = ({
  rules,
  globalRules,
  customRules,
  setCustomRules,
  isAdmin,
  onOpenTools,
  showCustomRules = true,
}) => {
  return (
    <div className="bg-white/50 backdrop-blur dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-8 shadow-2xl transition-colors duration-300">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-bold text-slate-900 dark:text-white">Default Pronunciation Rules</h2>
          <span className="px-2 py-0.5 bg-brand-purple/20 text-brand-purple border border-brand-purple/30 rounded-lg text-[10px] font-bold uppercase tracking-wider">
            Built-in
          </span>
        </div>
        <button
          onClick={onOpenTools}
          className="flex items-center gap-2 text-xs font-bold text-brand-purple hover:text-brand-purple/80 transition-colors uppercase tracking-widest"
        >
          {isAdmin ? 'Manage Rules' : 'View Settings'} <ExternalLink size={14} />
        </button>
      </div>

      <div className={`overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-800 ${showCustomRules ? 'mb-8' : ''}`}>
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-50 dark:bg-white/5 border-b border-slate-200 dark:border-white/5">
              <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Original Text</th>
              <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Replacement (Myanmar)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-white/5">
            {rules.map((rule) => (
              <tr key={rule.id} className="hover:bg-slate-50 dark:hover:bg-white/5 transition-colors group">
                <td className="px-6 py-4">
                  <span className="text-sm font-medium text-slate-700 dark:text-slate-100 group-hover:text-slate-900 dark:group-hover:text-white transition-colors">{rule.original}</span>
                </td>
                <td className="px-6 py-4">
                  <span className="text-sm font-bold text-brand-purple">{rule.replacement}</span>
                </td>
              </tr>
            ))}
            {globalRules.map((rule) => (
              <tr key={rule.id} className="hover:bg-slate-50 dark:hover:bg-white/5 transition-colors group bg-brand-purple/5">
                <td className="px-6 py-4 flex items-center gap-3">
                  <span className="text-sm font-medium text-slate-700 dark:text-slate-100 group-hover:text-slate-900 dark:group-hover:text-white transition-colors">{rule.original}</span>
                  <span className="px-1.5 py-0.5 bg-brand-purple/20 text-brand-purple rounded text-[8px] font-bold uppercase">Global</span>
                </td>
                <td className="px-6 py-4">
                  <span className="text-sm font-bold text-brand-purple">{rule.replacement}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showCustomRules && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 text-[10px] font-bold text-slate-500 uppercase tracking-widest">
              <Plus size={12} className="text-brand-purple" />
              Custom User Rules
            </label>
            <div className="flex items-center gap-1.5 text-[9px] text-slate-500 italic">
              <Info size={10} />
              Regex supported. Format: "Original -&gt; Replacement"
            </div>
          </div>
          <textarea
            value={customRules}
            onChange={(e) => setCustomRules(e.target.value)}
            placeholder="Example: 'Vlogs By Saw' -> 'ဗလော့ ဘိုင် စော'"
            className="w-full h-32 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 text-sm font-mono text-slate-900 dark:text-slate-200 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-purple/50 resize-none custom-scrollbar transition-all"
          />
        </div>
      )}
    </div>
  );
};

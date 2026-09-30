import React from 'react';
import { ExternalLink, ShieldCheck, Info, Plus } from 'lucide-react';
import { PronunciationRule } from '../types';
import { useLanguage } from '../contexts/LanguageContext';

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
  const { t } = useLanguage();

  return (
    <div className="glass-card rounded-[32px] p-6 sm:p-8 shadow-2xl transition-all duration-300">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div className="flex items-center gap-4">
          <div className="p-2 bg-brand-purple/10 rounded-lg text-brand-purple">
            <ShieldCheck size={20} />
          </div>
          <div>
            <h2 className="text-xl font-bold text-slate-900 dark:text-white tracking-tight">{t('rules.title')}</h2>
            <p className="text-[10px] text-slate-500 dark:text-slate-400 font-bold uppercase tracking-widest mt-1">{t('rules.subtitle')}</p>
          </div>
        </div>
        <button
          onClick={onOpenTools}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold text-brand-purple hover:bg-brand-purple/10 transition-all border border-brand-purple/20"
        >
          {isAdmin ? t('rules.manage') : t('rules.view')} <ExternalLink size={14} />
        </button>
      </div>

      <div className={`overflow-hidden rounded-[20px] border border-slate-200/50 dark:border-slate-800/50 shadow-sm ${showCustomRules ? 'mb-10' : ''}`}>
        <div className="overflow-x-auto custom-scrollbar">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/50 dark:bg-white/5 border-b border-slate-200/50 dark:border-white/5">
                <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em]">{t('rules.original')}</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em]">{t('rules.replacement')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200/50 dark:divide-white/5">
              {rules.map((rule) => (
                <tr key={rule.id} className="hover:bg-slate-50/30 dark:hover:bg-white/5 transition-colors group">
                  <td className="px-6 py-4">
                    <span className="text-sm font-bold text-slate-700 dark:text-slate-200 group-hover:text-brand-purple transition-colors">{rule.original}</span>
                  </td>
                  <td className="px-6 py-4">
                    <span className="text-sm font-bold text-brand-purple bg-brand-purple/10 px-3 py-1 rounded-lg border border-brand-purple/20">{rule.replacement}</span>
                  </td>
                </tr>
              ))}
              {globalRules.map((rule) => (
                <tr key={rule.id} className="hover:bg-slate-50/30 dark:hover:bg-white/5 transition-colors group bg-brand-purple/5">
                  <td className="px-6 py-4 flex items-center gap-3">
                    <span className="text-sm font-bold text-slate-700 dark:text-slate-200 group-hover:text-brand-purple transition-colors">{rule.original}</span>
                    <span className="px-2 py-0.5 bg-brand-purple/20 text-brand-purple rounded-full text-[8px] font-bold uppercase tracking-wider">{t('rules.global')}</span>
                  </td>
                  <td className="px-6 py-4">
                    <span className="text-sm font-bold text-brand-purple bg-brand-purple/10 px-3 py-1 rounded-lg border border-brand-purple/20">{rule.replacement}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showCustomRules && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 text-[10px] font-bold text-slate-500 uppercase tracking-widest">
              <Plus size={12} className="text-brand-purple" />
              {t('rules.custom')}
            </label>
            <div className="flex items-center gap-1.5 text-[9px] text-slate-500 italic">
              <Info size={10} />
              {t('rules.regexSupported')}
            </div>
          </div>
          <textarea
            value={customRules}
            onChange={(e) => setCustomRules(e.target.value)}
            placeholder={t('rules.placeholder')}
            className="w-full h-32 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 text-sm font-mono text-slate-900 dark:text-slate-200 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-purple/50 resize-none custom-scrollbar transition-all"
          />
        </div>
      )}
    </div>
  );
};

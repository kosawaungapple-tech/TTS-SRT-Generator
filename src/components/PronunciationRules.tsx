import React, { useState } from 'react';
import { ExternalLink, ShieldCheck, Info, Plus, Trash2, Edit2, Save, X } from 'lucide-react';
import { PronunciationRule } from '../types';

interface PronunciationRulesProps {
  rules: PronunciationRule[];
  globalRules: PronunciationRule[];
  customRules: string;
  setCustomRules: (rules: string) => void;
  isAdmin: boolean;
  onOpenTools: () => void;
  onAddGlobalRule?: (original: string, replacement: string) => void;
  onUpdateGlobalRule?: (id: string, original: string, replacement: string) => void;
  onDeleteGlobalRule?: (id: string) => void;
  showCustomRules?: boolean;
}

export const PronunciationRules: React.FC<PronunciationRulesProps> = ({
  rules,
  globalRules,
  customRules,
  setCustomRules,
  isAdmin,
  onOpenTools,
  onAddGlobalRule,
  onUpdateGlobalRule,
  onDeleteGlobalRule,
  showCustomRules = true,
}) => {
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [newOriginal, setNewOriginal] = useState('');
  const [newReplacement, setNewReplacement] = useState('');

  const handleAdd = () => {
    if (newOriginal.trim() && newReplacement.trim()) {
      onAddGlobalRule?.(newOriginal.trim(), newReplacement.trim());
      setNewOriginal('');
      setNewReplacement('');
      setIsAdding(false);
    }
  };

  const handleEdit = (rule: PronunciationRule) => {
    setEditingId(rule.id);
    setNewOriginal(rule.original);
    setNewReplacement(rule.replacement);
  };

  const handleUpdate = () => {
    if (editingId && newOriginal.trim() && newReplacement.trim()) {
      onUpdateGlobalRule?.(editingId, newOriginal.trim(), newReplacement.trim());
      setEditingId(null);
      setNewOriginal('');
      setNewReplacement('');
    }
  };

  const cancelAction = () => {
    setIsAdding(false);
    setEditingId(null);
    setNewOriginal('');
    setNewReplacement('');
  };

  return (
    <div className="bg-white/50 backdrop-blur dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-8 shadow-2xl transition-colors duration-300">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-bold text-slate-900 dark:text-white">Pronunciation Rules</h2>
          <span className="px-2 py-0.5 bg-brand-purple/20 text-brand-purple border border-brand-purple/30 rounded-lg text-[10px] font-bold uppercase tracking-wider">
            Active Rules
          </span>
        </div>
        <div className="flex items-center gap-4">
          {isAdmin && !isAdding && !editingId && (
            <button
              onClick={() => setIsAdding(true)}
              className="flex items-center gap-2 px-4 py-2 bg-brand-purple/10 text-brand-purple rounded-xl text-xs font-bold hover:bg-brand-purple/20 transition-all border border-brand-purple/20"
            >
              <Plus size={14} /> Add Rule
            </button>
          )}
          <button
            onClick={onOpenTools}
            className="flex items-center gap-2 text-xs font-bold text-brand-purple hover:text-brand-purple/80 transition-colors uppercase tracking-widest"
          >
            {isAdmin ? 'Manage Rules' : 'View Settings'} <ExternalLink size={14} />
          </button>
        </div>
      </div>

      {isAdmin && (isAdding || editingId) && (
        <div className="mb-8 p-6 bg-brand-purple/5 border border-brand-purple/20 rounded-2xl animate-in fade-in slide-in-from-top-4 duration-300">
          <h3 className="text-sm font-bold text-brand-purple mb-4 flex items-center gap-2">
            {editingId ? <Edit2 size={16} /> : <Plus size={16} />} 
            {editingId ? 'Edit Global Rule' : 'Add New Global Rule'}
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest ml-1">Original Text</label>
              <input
                type="text"
                placeholder="e.g. Vlogs By Saw"
                value={newOriginal}
                onChange={(e) => setNewOriginal(e.target.value)}
                className="w-full bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand-purple/50 transition-all"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest ml-1">Replacement (Myanmar)</label>
              <input
                type="text"
                placeholder="e.g. ဗလော့ ဘိုင် စော"
                value={newReplacement}
                onChange={(e) => setNewReplacement(e.target.value)}
                className="w-full bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand-purple/50 transition-all"
              />
            </div>
          </div>
          <div className="flex justify-end gap-3">
            <button 
              onClick={cancelAction}
              className="px-4 py-2 text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 text-xs font-bold transition-all"
            >
              Cancel
            </button>
            <button 
              onClick={editingId ? handleUpdate : handleAdd}
              className="px-6 py-2 bg-brand-purple text-white rounded-xl text-xs font-bold hover:bg-brand-purple/90 transition-all shadow-lg shadow-brand-purple/20 flex items-center gap-2"
            >
              {editingId ? <Save size={14} /> : <Plus size={14} />}
              {editingId ? 'Update Rule' : 'Add Rule'}
            </button>
          </div>
        </div>
      )}

      <div className={`overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-800 ${showCustomRules ? 'mb-8' : ''}`}>
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-50 dark:bg-white/5 border-b border-slate-200 dark:border-white/5">
              <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Original Text</th>
              <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Replacement (Myanmar)</th>
              {isAdmin && <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest text-right">Actions</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-white/5">
            {rules.map((rule) => (
              <tr key={rule.id} className="hover:bg-slate-50 dark:hover:bg-white/5 transition-colors group">
                <td className="px-6 py-4 flex items-center gap-3">
                  <span className="text-sm font-medium text-slate-700 dark:text-slate-100 group-hover:text-slate-900 dark:group-hover:text-white transition-colors">{rule.original}</span>
                  <span className="px-1.5 py-0.5 bg-slate-100 dark:bg-white/10 text-slate-500 rounded text-[8px] font-bold uppercase">Built-in</span>
                </td>
                <td className="px-6 py-4">
                  <span className="text-sm font-bold text-brand-purple">{rule.replacement}</span>
                </td>
                {isAdmin && <td className="px-6 py-4 text-right"></td>}
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
                {isAdmin && (
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => handleEdit(rule)}
                        className="p-2 text-slate-400 hover:text-brand-purple hover:bg-brand-purple/10 rounded-lg transition-all"
                        title="Edit Rule"
                      >
                        <Edit2 size={16} />
                      </button>
                      <button
                        onClick={() => onDeleteGlobalRule?.(rule.id)}
                        className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-500/10 rounded-lg transition-all"
                        title="Delete Rule"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                )}
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

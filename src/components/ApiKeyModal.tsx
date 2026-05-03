import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Eye, Plus, Trash2, ShieldCheck } from 'lucide-react';
import { apiChannelManager, ApiChannel } from '../services/apiChannelManager';

interface ApiKeyModalProps {
  isOpen: boolean;
  onClose: () => void;
  role?: 'admin' | 'user' | string;
  membershipStatus?: 'standard' | 'premium' | null;
  vbsId?: string | null;
  allowAdminKeys?: boolean;
}

export const ApiKeyModal: React.FC<ApiKeyModalProps> = ({ isOpen, onClose, role, membershipStatus, allowAdminKeys = true }) => {
  const isAdmin = role === 'admin';
  const isPremium = membershipStatus === 'premium' || isAdmin;
  
  // State for both views
  const [adminChannels, setAdminChannels] = useState<ApiChannel[]>([]);
  const [userChannel, setUserChannel] = useState<ApiChannel | null>(null);
  const [settings, setSettings] = useState(apiChannelManager.getSettings());
  const [newKey, setNewKey] = useState('');
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const handleUpdate = () => {
      setAdminChannels(apiChannelManager.getAdminChannels());
      setUserChannel(apiChannelManager.getUserChannel());
      
      const currentSettings = apiChannelManager.getSettings();
      // Force personal mode if admin pool is disabled globally or user is not premium
      if ((!allowAdminKeys || !isPremium) && currentSettings.useAdminKeys && !isAdmin) {
        console.log("ApiKeyModal: Admin Pool restricted, forcing Personal Mode");
        apiChannelManager.updateSettings({ useAdminKeys: false });
        setSettings({ ...currentSettings, useAdminKeys: false });
      } else {
        setSettings(currentSettings);
      }
    };

    if (isOpen) {
      handleUpdate();
    }

    window.addEventListener('storage', handleUpdate);
    return () => window.removeEventListener('storage', handleUpdate);
  }, [isOpen, isPremium]);

  const handleAddAdminChannel = () => {
    if (!newKey.trim()) return;
    apiChannelManager.addAdminChannel(newKey);
    setAdminChannels(apiChannelManager.getAdminChannels());
    setNewKey('');
  };

  const handleSetUserChannel = () => {
    if (!newKey.trim()) return;
    apiChannelManager.setUserChannel(newKey);
    setUserChannel(apiChannelManager.getUserChannel());
    setNewKey('');
  };

  const handleDeleteAdminChannel = (id: string) => {
    apiChannelManager.deleteAdminChannel(id);
    setAdminChannels(apiChannelManager.getAdminChannels());
    setSettings(apiChannelManager.getSettings());
  };

  const handleToggleAdminKeySharing = () => {
    const newVal = !settings.allowSharedKeys;
    apiChannelManager.updateSettings({ allowSharedKeys: newVal });
    setSettings(prev => ({ ...prev, allowSharedKeys: newVal }));
  };

  const handleToggleSpecificChannelSharing = (id: string) => {
    apiChannelManager.toggleSharedChannel(id);
    setSettings(apiChannelManager.getSettings());
  };

  const handleModeChange = (mode: 'admin' | 'personal') => {
    const newVal = mode === 'admin';
    apiChannelManager.updateSettings({ useAdminKeys: newVal });
    setSettings(prev => ({ ...prev, useAdminKeys: newVal }));
    localStorage.setItem("useAdminKeyPool", JSON.stringify(newVal));
    localStorage.setItem("keyMode", mode);
  };

  const toggleShowKey = (id: string) => {
    setShowKeys(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const maskKey = (key: string) => {
    if (key.length <= 8) return "****" + key.slice(-4);
    return key.slice(0, 4) + "...." + key.slice(-4);
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-[#020617]/80 backdrop-blur-sm"
          />
          
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="relative w-full max-w-2xl bg-white dark:bg-slate-900 rounded-[32px] shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col max-h-[90vh]"
          >
            {/* Header */}
            <div className="px-8 py-6 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-white/[0.02]">
              <div className="flex items-center">
                <div>
                  <h2 className="text-xl font-bold text-slate-900 dark:text-white">API Key Manager ({isAdmin ? 'Admin' : 'User'})</h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400 font-medium uppercase tracking-wider">
                    {isAdmin ? 'Manage Global API Channels' : 'Manage Personal API Key'}
                  </p>
                </div>
              </div>
              <button 
                type="button"
                onClick={onClose}
                className="p-2 hover:bg-slate-200 dark:hover:bg-white/10 rounded-full transition-colors text-slate-400 hover:text-slate-600 dark:hover:text-white"
              >
                <X size={20} />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 p-8 space-y-6 overflow-y-auto custom-scrollbar">
              
              {/* ADMIN VIEW */}
              {isAdmin && (
                <div className="space-y-6">
                   <div className="flex items-center justify-between p-4 bg-brand-purple/5 border border-brand-purple/20 rounded-2xl">
                     <div>
                        <h4 className="text-sm font-bold text-slate-800 dark:text-white">Shared Key Mode</h4>
                        <p className="text-[10px] text-slate-500 font-medium">Allow users to utilize your admin API channels when their keys fail.</p>
                     </div>
                     <button
                        onClick={handleToggleAdminKeySharing}
                        className={`w-12 h-6 rounded-full transition-all relative ${settings.allowSharedKeys ? 'bg-brand-purple' : 'bg-slate-300 dark:bg-slate-700'}`}
                     >
                        <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${settings.allowSharedKeys ? 'left-7' : 'left-1'}`} />
                     </button>
                   </div>

                   <div className="space-y-4">
                     <label className="text-xs font-bold text-slate-400 uppercase tracking-widest">Admin Channels</label>
                     <div className="space-y-2">
                        {adminChannels.map(ch => (
                           <div key={ch.id} className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-200 dark:border-slate-800 flex items-center justify-between">
                             <div className="flex-1 truncate pr-4">
                               <div className="flex items-center gap-2 mb-1">
                                  <span className="text-xs font-bold text-slate-700 dark:text-slate-200">{ch.label}</span>
                                  {settings.sharedChannelIds.includes(ch.id) && (
                                     <span className="text-[9px] bg-emerald-500/10 text-emerald-500 px-1.5 py-0.5 rounded-md font-bold uppercase">Shared</span>
                                  )}
                               </div>
                               <div className="font-mono text-[11px] text-slate-400">
                                  {showKeys[ch.id] ? ch.key : maskKey(ch.key)}
                               </div>
                             </div>
                             <div className="flex items-center gap-2">
                                <button 
                                  onClick={() => handleToggleSpecificChannelSharing(ch.id)}
                                  className={`p-2 rounded-lg transition-colors ${settings.sharedChannelIds.includes(ch.id) ? 'bg-emerald-500/10 text-emerald-500' : 'bg-slate-100 dark:bg-white/5 text-slate-400'}`}
                                  title="Toggle Sharing"
                                >
                                  <ShieldCheck size={16} />
                                </button>
                                <button onClick={() => toggleShowKey(ch.id)} className="p-2 text-slate-400 hover:text-slate-600"><Eye size={16} /></button>
                                <button onClick={() => handleDeleteAdminChannel(ch.id)} className="p-2 text-slate-400 hover:text-rose-500"><Trash2 size={16} /></button>
                             </div>
                           </div>
                        ))}
                     </div>
                     <div className="flex gap-2">
                        <input
                          type="password"
                          value={newKey}
                          onChange={(e) => setNewKey(e.target.value)}
                          placeholder="Add new Admin key..."
                          className="flex-1 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-2.5 text-sm"
                        />
                        <button onClick={handleAddAdminChannel} className="bg-brand-purple text-white px-4 rounded-xl font-bold text-sm"><Plus size={18} /></button>
                     </div>
                   </div>
                </div>
              )}

              {/* PREFERENCES & USER VIEW */}
              <div className="space-y-6">
                 {/* Only show pool option if allowed globally or for admins, and only for premium users */}
                 {(allowAdminKeys || isAdmin) && (isAdmin || isPremium) && (
                   <div className="space-y-2">
                     <label className="text-xs font-bold text-slate-400 uppercase tracking-widest block mb-2">API Key Mode</label>
                     <div className="flex bg-slate-100 dark:bg-slate-950 rounded-[18px] overflow-hidden p-1 border border-slate-200 dark:border-slate-800 shadow-inner">
                       <button 
                          onClick={() => handleModeChange('admin')}
                          className={`flex-1 py-3 text-xs font-black uppercase tracking-tight transition-all rounded-[14px] ${settings.useAdminKeys ? 'bg-[#F5C518] text-black shadow-lg shadow-amber-400/20' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 opacity-60'}`}
                       >
                          Admin Pool
                       </button>
                       <button 
                          onClick={() => handleModeChange('personal')}
                          className={`flex-1 py-3 text-xs font-black uppercase tracking-tight transition-all rounded-[14px] ${!settings.useAdminKeys ? 'bg-[#F5C518] text-black shadow-lg shadow-amber-400/20' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 opacity-60'}`}
                       >
                          Personal Key
                       </button>
                     </div>
                   </div>
                 )}

                 {/* Key Connection Status Indicator */}
                 <div className="px-1 pt-1">
                    {settings.useAdminKeys ? (
                      <div className="flex flex-col gap-0.5">
                        <div className="flex items-center gap-2 py-1">
                          <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                          <span className="text-[11px] font-bold text-emerald-500">
                             ✓ Admin Key Pool သုံးနေသည်
                          </span>
                        </div>
                        <p className="text-[10px] text-slate-500 font-medium pl-3.5">Auto-rotate between {adminChannels.length || 5} admin keys</p>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 py-1">
                        {userChannel ? (
                          <>
                            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                            <span className="text-[11px] font-bold text-emerald-500">✓ Personal Key သုံးနေသည်</span>
                          </>
                        ) : (
                          <>
                            <div className="w-1.5 h-1.5 rounded-full bg-[#F5C518] shadow-[0_0_8px_rgba(245,197,24,0.4)]" />
                            <span className="text-[11px] font-bold text-[#F5C518]">⚠ Personal Key မထည့်ရသေးပါ</span>
                          </>
                        )}
                      </div>
                    )}
                 </div>

                 {!isAdmin && !settings.useAdminKeys && (
                   <motion.div 
                     initial={{ opacity: 0, y: 10 }}
                     animate={{ opacity: 1, y: 0 }}
                     className="space-y-4 pt-2"
                   >
                     <label className="text-xs font-bold text-slate-400 uppercase tracking-widest">Personal Channel</label>
                     {userChannel ? (
                        <div className="p-5 bg-slate-50 dark:bg-slate-900 rounded-[28px] border border-slate-200 dark:border-slate-800 flex items-center justify-between group">
                           <div className="flex-1 truncate pr-4">
                              <span className="text-xs font-bold block mb-1 text-slate-700 dark:text-slate-200">Personal Gemini Key</span>
                              <div className="font-mono text-[11px] text-slate-400">{maskKey(userChannel.key)}</div>
                           </div>
                           <button onClick={() => { apiChannelManager.clearUserChannel(); setUserChannel(null); }} className="p-3 bg-rose-500/10 text-rose-500 rounded-xl hover:bg-rose-500 hover:text-white transition-all"><Trash2 size={16} /></button>
                        </div>
                     ) : (
                        <div className="flex gap-2">
                           <input
                             type="password"
                             value={newKey}
                             onChange={(e) => setNewKey(e.target.value)}
                             placeholder="Enter personal Gemini key..."
                             className="flex-1 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-5 py-3 text-sm focus:ring-2 focus:ring-[#F5C518]/20 outline-none transition-all"
                           />
                           <button onClick={handleSetUserChannel} className="bg-[#F5C518] text-black px-6 rounded-xl font-black text-sm hover:scale-105 active:scale-95 transition-all shadow-lg shadow-[#F5C518]/20"><Plus size={22} /></button>
                        </div>
                     )}
                   </motion.div>
                 )}
              </div>

            </div>
            
            {/* Footer */}
            <div className="px-8 py-6 bg-slate-50 dark:bg-white/[0.02] border-t border-slate-100 dark:border-slate-800">
               <p className="text-[10px] text-center text-slate-500 dark:text-slate-400 font-medium uppercase tracking-widest">
                  Key Security: All keys are stored locally on your device.
               </p>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Eye, Plus, Trash2, ShieldCheck } from 'lucide-react';
import { apiChannelManager, ApiChannel } from '../services/apiChannelManager';

interface ApiKeyModalProps {
  isOpen: boolean;
  onClose: () => void;
  role?: 'admin' | 'user' | string;
  membershipStatus?: 'standard' | 'premium' | null;
}

export const ApiKeyModal: React.FC<ApiKeyModalProps> = ({ isOpen, onClose, role, membershipStatus }) => {
  const isAdmin = role === 'admin';
  const isPremium = membershipStatus === 'premium' || isAdmin;
  
  // State for both views
  const [adminChannels, setAdminChannels] = useState<ApiChannel[]>([]);
  const [userChannel, setUserChannel] = useState<ApiChannel | null>(null);
  const [settings, setSettings] = useState(apiChannelManager.getSettings());
  
  const [newKey, setNewKey] = useState('');
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (isOpen) {
      setAdminChannels(apiChannelManager.getAdminChannels());
      setUserChannel(apiChannelManager.getUserChannel());
      const currentSettings = apiChannelManager.getSettings();
      
      // Force disable useAdminKeys if user is not premium and it was somehow enabled
      if (!isPremium && currentSettings.useAdminKeys) {
        apiChannelManager.updateSettings({ useAdminKeys: false });
        setSettings({ ...currentSettings, useAdminKeys: false });
      } else {
        setSettings(currentSettings);
      }
    }
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

  const handleToggleUseAdminKeys = () => {
    const newVal = !settings.useAdminKeys;
    apiChannelManager.updateSettings({ useAdminKeys: newVal });
    setSettings(prev => ({ ...prev, useAdminKeys: newVal }));
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
                 <div className={`flex items-center justify-between p-4 rounded-2xl border transition-all ${
                   !settings.allowSharedKeys || !isPremium 
                     ? 'opacity-50 grayscale' 
                     : 'bg-brand-purple/5 border-brand-purple/20'
                 } ${!settings.allowSharedKeys ? 'pointer-events-none' : ''}`}>
                   <div>
                      <h4 className="text-sm font-bold text-slate-800 dark:text-white">Use Admin Key Pool</h4>
                      <p className="text-[10px] text-slate-500 font-medium">Auto-switch to premium admin keys if personal key reaches limit.</p>
                      {!isPremium && (
                        <p className="text-[10px] text-amber-600 dark:text-amber-500 font-bold mt-1.5 flex items-center gap-1.5">
                          <ShieldCheck size={10} />
                          Premium အသုံးပြုသူများသာ အသုံးပြုနိုင်သည်
                        </p>
                      )}
                   </div>
                   <button
                      onClick={handleToggleUseAdminKeys}
                      disabled={!settings.allowSharedKeys || !isPremium}
                      className={`w-12 h-6 rounded-full transition-all relative ${
                        settings.useAdminKeys && settings.allowSharedKeys && isPremium 
                          ? 'bg-brand-purple' 
                          : 'bg-slate-300 dark:bg-slate-700'
                      } ${!isPremium ? 'cursor-not-allowed opacity-50' : ''}`}
                   >
                      <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${
                        settings.useAdminKeys && settings.allowSharedKeys && isPremium ? 'left-7' : 'left-1'
                      }`} />
                   </button>
                 </div>

                 {!isAdmin && (
                   <div className="space-y-4">
                     <label className="text-xs font-bold text-slate-400 uppercase tracking-widest">Personal Channel</label>
                     {userChannel ? (
                        <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-200 dark:border-slate-800 flex items-center justify-between">
                           <div className="flex-1 truncate pr-4">
                              <span className="text-xs font-bold block mb-1 text-slate-700 dark:text-slate-200">Personal Key</span>
                              <div className="font-mono text-[11px] text-slate-400">{maskKey(userChannel.key)}</div>
                           </div>
                           <button onClick={() => { apiChannelManager.clearUserChannel(); setUserChannel(null); }} className="p-2 text-slate-400 hover:text-rose-500"><Trash2 size={16} /></button>
                        </div>
                     ) : (
                        <div className="flex gap-2">
                           <input
                             type="password"
                             value={newKey}
                             onChange={(e) => setNewKey(e.target.value)}
                             placeholder="Enter personal Gemini key..."
                             className="flex-1 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-2.5 text-sm"
                           />
                           <button onClick={handleSetUserChannel} className="bg-brand-purple text-white px-4 rounded-xl font-bold text-sm"><Plus size={18} /></button>
                        </div>
                     )}
                   </div>
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

import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { 
  ShieldCheck, 
  UserPlus, 
  Trash2, 
  CheckCircle2, 
  XCircle, 
  Plus, 
  Search, 
  Key,
  Calendar,
  User,
  AlertCircle,
  RefreshCw,
  Lock,
  Settings,
  Database,
  Send,
  Eye,
  EyeOff,
  Save,
  Languages,
  Edit3,
  Zap
} from 'lucide-react';
import { AppUser, Config, PronunciationRule } from '../types';
import { db, collection, onSnapshot, query, orderBy, setDoc, doc, deleteDoc, updateDoc, handleFirestoreError, OperationType, getDoc, auth } from '../firebase';
import { Toast, ToastType } from './Toast';

interface AdminDashboardProps {
  isAuthReady: boolean;
  isSessionSynced: boolean;
  setIsSessionSynced: (synced: boolean) => void;
  systemConfig: Config;
  onUpdateSystemConfig?: (updates: Partial<Config>) => Promise<void>;
  onLogout?: () => void;
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({ isAuthReady, isSessionSynced, setIsSessionSynced, systemConfig: globalConfig, onUpdateSystemConfig, onLogout }) => {
  const [users, setUsers] = useState<AppUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [newId, setNewId] = useState('');
  const [newName, setNewName] = useState('');
  const [newExpiryDays, setNewExpiryDays] = useState('30');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeletingUser, setIsDeletingUser] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  
  // Toast State
  const [toast, setToast] = useState<{ message: string; type: ToastType; isVisible: boolean }>({
    message: '',
    type: 'success',
    isVisible: false
  });
  
  // Admin Auth Protection
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [adminPassword, setAdminPassword] = useState('');
  const [activeTab, setActiveTab] = useState<'users' | 'system' | 'rules'>('users');

  // System Settings State
  const [localConfig, setLocalConfig] = useState<Config>(globalConfig);
  const [isSavingSystem, setIsSavingSystem] = useState(false);
  const [showSecrets, setShowSecrets] = useState(false);

  // Pronunciation Rules State
  const [rules, setRules] = useState<PronunciationRule[]>([]);
  const [newRuleOriginal, setNewRuleOriginal] = useState('');
  const [newRuleReplacement, setNewRuleReplacement] = useState('');
  const [isSavingRule, setIsSavingRule] = useState(false);
  const [isDeletingRule, setIsDeletingRule] = useState<string | null>(null);
  const [isRulesLoading, setIsRulesLoading] = useState(true);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [syncTimeoutReached, setSyncTimeoutReached] = useState(false);

  useEffect(() => {
    if (isAuthenticated && !isSessionSynced) {
      const timer = setTimeout(() => {
        setSyncTimeoutReached(true);
      }, 2000);
      return () => clearTimeout(timer);
    } else if (isSessionSynced) {
      setSyncTimeoutReached(true);
    }
  }, [isAuthenticated, isSessionSynced]);

  useEffect(() => {
    const isAdmin = localStorage.getItem('vbs_isAdmin') === 'true';
    const accessCode = localStorage.getItem('vbs_access_code');
    
    if (isAdmin || accessCode === 'saw_vlogs_2026') {
      setIsAuthenticated(true);
      if (accessCode === 'saw_vlogs_2026') {
        localStorage.setItem('vbs_isAdmin', 'true');
      }
    } else if (isAuthReady && auth.currentUser?.email === "specialmyanmar95@gmail.com" && auth.currentUser?.emailVerified) {
      setIsAuthenticated(true);
      localStorage.setItem('vbs_isAdmin', 'true');
    }
  }, [isAuthReady]);

  const formatDate = (date: any) => {
    if (!date) return 'N/A';
    try {
      return new Date(date).toLocaleString();
    } catch (e) {
      return 'Invalid Date';
    }
  };

  const handleAdminAuth = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setAuthError(null);
    if (adminPassword === "saw_vlogs_2026") {
      setIsAuthenticated(true);
      localStorage.setItem('vbs_isAdmin', 'true');
    } else {
      setAuthError("စကားဝှက် မှားယွင်းနေပါသည်။ (Incorrect Password).");
    }
  };

  useEffect(() => {
    const isMasterAdmin = localStorage.getItem('vbs_access_code') === 'saw_vlogs_2026';
    if (!isAuthenticated) return;
    
    // If not ready, and not master admin, wait.
    // If master admin, we try anyway to be fast.
    if (!isAuthReady && !isMasterAdmin) return;
    
    // If not synced, and not master admin, and timeout not reached, wait.
    if (!isSessionSynced && !isMasterAdmin && !syncTimeoutReached) return;

    const q = query(collection(db, 'users'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const fetchedUsers = snapshot.docs.map(doc => ({
        ...doc.data()
      } as AppUser));
      setUsers(fetchedUsers);
      setIsLoading(false);
    }, (err) => {
      // Only show error if we are actually ready and synced
      if (isAuthReady && (isSessionSynced || isMasterAdmin)) {
        handleFirestoreError(err, OperationType.LIST, 'users');
      }
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, [isAuthenticated, isAuthReady, isSessionSynced, syncTimeoutReached]);

  useEffect(() => {
    const isMasterAdmin = localStorage.getItem('vbs_access_code') === 'saw_vlogs_2026';
    if (!isAuthenticated) return;
    
    // If not ready, and not master admin, wait.
    // If master admin, we try anyway to be fast.
    if (!isAuthReady && !isMasterAdmin) return;
    
    // Force fetch if master admin OR if timeout reached
    if (!isSessionSynced && !isMasterAdmin && !syncTimeoutReached) return;

    const unsubscribe = onSnapshot(collection(db, 'globalRules'), (snapshot) => {
      const fetchedRules = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as PronunciationRule[];
      setRules(fetchedRules);
      setIsRulesLoading(false);
    }, (err) => {
      // Only show error if we are actually ready and synced
      if (isAuthReady && (isSessionSynced || isMasterAdmin)) {
        handleFirestoreError(err, OperationType.LIST, 'globalRules');
      }
      setIsRulesLoading(false);
    });

    return () => unsubscribe();
  }, [isAuthenticated, isAuthReady, isSessionSynced, syncTimeoutReached]);

  const handleCreateRule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRuleOriginal.trim() || !newRuleReplacement.trim()) return;

    setIsSavingRule(true);
    try {
      if (editingRuleId) {
        await updateDoc(doc(db, 'globalRules', editingRuleId), {
          original: newRuleOriginal.trim(),
          replacement: newRuleReplacement.trim()
        });
        setToast({ message: 'Rule updated successfully!', type: 'success', isVisible: true });
      } else {
        const ruleId = `rule_${Date.now()}`;
        await setDoc(doc(db, 'globalRules', ruleId), {
          original: newRuleOriginal.trim(),
          replacement: newRuleReplacement.trim(),
          createdAt: new Date().toISOString()
        });
        setToast({ message: 'Rule added successfully!', type: 'success', isVisible: true });
      }
      setNewRuleOriginal('');
      setNewRuleReplacement('');
      setEditingRuleId(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, editingRuleId ? `globalRules/${editingRuleId}` : 'globalRules');
      setToast({ message: editingRuleId ? 'Failed to update rule' : 'Failed to add rule', type: 'error', isVisible: true });
    } finally {
      setIsSavingRule(false);
    }
  };

  const handleEditRule = (rule: PronunciationRule) => {
    setNewRuleOriginal(rule.original);
    setNewRuleReplacement(rule.replacement);
    setEditingRuleId(rule.id);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const cancelEditRule = () => {
    setNewRuleOriginal('');
    setNewRuleReplacement('');
    setEditingRuleId(null);
  };

  const handleDeleteRule = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this rule?')) return;
    setIsDeletingRule(id);
    try {
      await deleteDoc(doc(db, 'globalRules', id));
      setToast({ message: 'စည်းမျဉ်းကို ဖျက်သိမ်းပြီးပါပြီ။ ✅', type: 'success', isVisible: true });
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `globalRules/${id}`);
      setToast({ message: 'Failed to delete rule', type: 'error', isVisible: true });
    } finally {
      setIsDeletingRule(null);
    }
  };

  useEffect(() => {
    if (globalConfig) {
      setLocalConfig(globalConfig);
    }
  }, [globalConfig]);

  const handleSaveSystemConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingSystem(true);
    try {
      await setDoc(doc(db, 'config', 'main'), {
        ...localConfig,
        updatedAt: new Date().toISOString()
      });
      
      setToast({
        message: 'Gemini API Key ကို သိမ်းဆည်းပြီးပါပြီ။ ✅',
        type: 'success',
        isVisible: true
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'config/main');
      setToast({
        message: 'Failed to save system settings.',
        type: 'error',
        isVisible: true
      });
    } finally {
      setIsSavingSystem(false);
    }
  };

  const ensureAdminSession = async () => {
    const isMasterAdmin = localStorage.getItem('vbs_access_code') === 'saw_vlogs_2026';
    if (isMasterAdmin && !isSessionSynced && auth.currentUser) {
      try {
        await setDoc(doc(db, 'sessions', auth.currentUser.uid), {
          accessCode: 'saw_vlogs_2026',
          createdAt: new Date().toISOString()
        });
        setIsSessionSynced(true);
        return true;
      } catch (e) {
        console.error('Failed to ensure admin session:', e);
        return false;
      }
    }
    return isSessionSynced || isMasterAdmin;
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newId.trim() || isSubmitting) return;

    const isMasterAdmin = localStorage.getItem('vbs_access_code') === 'saw_vlogs_2026';
    
    // FORCE USER CREATION (BYPASS SYNC CHECK FOR MASTER ADMIN)
    if (!isSessionSynced && !isMasterAdmin) {
      setToast({
        message: 'Error: Session not synced. Please wait or refresh.',
        type: 'error',
        isVisible: true
      });
      return;
    }

    setIsSubmitting(true);

    try {
      // Background session sync for master admin if not already synced
      if (isMasterAdmin && !isSessionSynced && auth.currentUser) {
        setDoc(doc(db, 'sessions', auth.currentUser.uid), {
          accessCode: 'saw_vlogs_2026',
          createdAt: new Date().toISOString()
        }).then(() => {
          setIsSessionSynced(true);
          console.log('Background session sync successful');
        }).catch(err => {
          console.error('Background session sync failed:', err);
        });
      }

      const id = newId.trim();
      const expiryDate = new Date();
      expiryDate.setDate(expiryDate.getDate() + parseInt(newExpiryDays));

      const newUser: AppUser = {
        id,
        name: newName.trim() || id,
        isActive: true,
        createdAt: new Date().toISOString(),
        expiryDate: expiryDate.toISOString()
      };

      console.log(`Attempting to create user: ${id} (Master Admin: ${isMasterAdmin})`);
      await setDoc(doc(db, 'users', id), newUser);
      
      setNewId('');
      setNewName('');
      setNewExpiryDays('30');
      setToast({
        message: 'User ID Created Successfully! 🎉',
        type: 'success',
        isVisible: true
      });
    } catch (err: any) {
      // LOG EXACT FIREBASE ERROR MESSAGE
      console.error("CRITICAL FIRESTORE ERROR (User Creation):", err);
      console.error("Error Code:", err.code);
      console.error("Error Message:", err.message);
      
      // If it's a permission error and we are master admin, it might be because the background sync hasn't finished.
      // We try one more time with AWAIT if it failed initially.
      if (err.code === 'permission-denied' && isMasterAdmin && auth.currentUser) {
        try {
          console.log('Permission denied. Retrying with explicit session sync wait...');
          await setDoc(doc(db, 'sessions', auth.currentUser.uid), {
            accessCode: 'saw_vlogs_2026',
            createdAt: new Date().toISOString()
          });
          setIsSessionSynced(true);
          
          // Retry user creation
          const id = newId.trim();
          const expiryDate = new Date();
          expiryDate.setDate(expiryDate.getDate() + parseInt(newExpiryDays));
          const newUser: AppUser = {
            id,
            name: newName.trim() || id,
            isActive: true,
            createdAt: new Date().toISOString(),
            expiryDate: expiryDate.toISOString()
          };
          await setDoc(doc(db, 'users', id), newUser);
          
          setNewId('');
          setNewName('');
          setNewExpiryDays('30');
          setToast({
            message: 'User ID Created Successfully (after retry)! 🎉',
            type: 'success',
            isVisible: true
          });
          return;
        } catch (retryErr: any) {
          console.error('Retry failed:', retryErr);
        }
      }

      handleFirestoreError(err, OperationType.WRITE, `users/${newId.trim()}`);
      setToast({
        message: `Error: ${err.message || 'Could not create ID.'}`,
        type: 'error',
        isVisible: true
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleExtendExpiry = async (id: string, currentExpiry: string, days: number) => {
    try {
      await ensureAdminSession();
      const newDate = new Date(currentExpiry);
      const baseDate = newDate < new Date() ? new Date() : newDate;
      baseDate.setDate(baseDate.getDate() + days);
      
      await updateDoc(doc(db, 'users', id), {
        expiryDate: baseDate.toISOString()
      });
      
      setToast({
        message: 'သက်တမ်းတိုးခြင်း အောင်မြင်ပါသည်။ ✅',
        type: 'success',
        isVisible: true
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${id}`);
      setToast({
        message: 'Failed to extend expiry.',
        type: 'error',
        isVisible: true
      });
    }
  };

  const handleUpdateExpiryDate = async (id: string, newDateStr: string) => {
    if (!newDateStr) return;
    try {
      await ensureAdminSession();
      const newDate = new Date(newDateStr);
      // Set to end of day to be generous
      newDate.setHours(23, 59, 59, 999);
      
      await updateDoc(doc(db, 'users', id), {
        expiryDate: newDate.toISOString()
      });
      
      setToast({
        message: 'Expiry date updated! 📅',
        type: 'success',
        isVisible: true
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${id}`);
    }
  };

  const handleToggleStatus = async (id: string, currentStatus: boolean) => {
    try {
      await ensureAdminSession();
      await updateDoc(doc(db, 'users', id), {
        isActive: !currentStatus
      });
      setToast({
        message: 'User Status Updated!',
        type: 'success',
        isVisible: true
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${id}`);
      setToast({
        message: 'Failed to update user status.',
        type: 'error',
        isVisible: true
      });
    }
  };

  const handleDeleteUser = async (id: string) => {
    if (!window.confirm(`Are you sure you want to delete User ID: ${id}?`)) return;

    setIsDeletingUser(id);
    try {
      await ensureAdminSession();
      await deleteDoc(doc(db, 'users', id));
      setToast({
        message: 'User ID Deleted Successfully!',
        type: 'success',
        isVisible: true
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `users/${id}`);
      setToast({
        message: 'Failed to delete User ID.',
        type: 'error',
        isVisible: true
      });
    } finally {
      setIsDeletingUser(null);
    }
  };

  const filteredUsers = users.filter(u => 
    u.id.toLowerCase().includes(searchQuery.toLowerCase()) || 
    u.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (!isAuthenticated) {
    return (
      <div className="flex flex-col items-center justify-center py-20 px-4">
        <motion.div 
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="w-full max-w-md bg-white/50 backdrop-blur dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-8 shadow-2xl transition-colors duration-300"
        >
          <div className="flex flex-col items-center mb-8">
            <div className="w-16 h-16 bg-brand-purple/20 text-brand-purple rounded-2xl flex items-center justify-center mb-4 border border-brand-purple/20">
              <Lock size={32} />
            </div>
            <h2 className="text-2xl font-bold text-slate-900 dark:text-white">Admin Access</h2>
            <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">Enter admin password to continue</p>
          </div>

          <form onSubmit={handleAdminAuth} className="space-y-6">
            <div className="space-y-2">
              <div className="relative">
                <Key className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                <input
                  type="password"
                  value={adminPassword}
                  onChange={(e) => setAdminPassword(e.target.value)}
                  placeholder="Admin Password"
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl pl-12 pr-4 py-3.5 text-sm text-slate-900 dark:text-slate-200 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-purple/50 transition-all"
                  required
                />
              </div>
            </div>

            {authError && (
              <p className="text-red-500 text-xs font-bold flex items-center gap-1 px-2">
                <AlertCircle size={12} /> {authError}
              </p>
            )}

            <button
              type="submit"
              className="w-full py-4 bg-brand-purple text-white rounded-2xl font-bold hover:bg-brand-purple/90 transition-all shadow-lg shadow-brand-purple/20 flex items-center justify-center gap-2"
            >
              <ShieldCheck size={20} /> Sign In
            </button>
          </form>
        </motion.div>
      </div>
    );
  }

  return (
    <>
      <div className="max-w-6xl mx-auto space-y-8 p-4">
      {/* Header */}
      <div className="bg-white/50 backdrop-blur dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 sm:p-8 shadow-2xl transition-colors duration-300">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-6 text-center sm:text-left">
          <div className="flex flex-col sm:flex-row items-center gap-4 sm:gap-6">
            <div className="w-14 h-14 sm:w-16 sm:h-16 bg-brand-purple/20 text-brand-purple rounded-2xl flex items-center justify-center shadow-inner border border-brand-purple/20 shrink-0">
              <ShieldCheck size={28} className="sm:w-8 sm:h-8" />
            </div>
            <div>
              <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white">Admin Dashboard</h2>
              <div className="flex items-center gap-3 mt-1">
                <p className="text-slate-500 dark:text-slate-400 text-xs sm:text-sm">Manage Authorized Access Codes (User IDs)</p>
                <div className="h-3 w-[1px] bg-slate-300 dark:bg-slate-700 hidden sm:block" />
                <p className="text-brand-purple text-xs sm:text-sm font-bold flex items-center gap-1.5">
                  <Zap size={14} fill="currentColor" /> {globalConfig.total_generations || 0} Generations
                </p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3 w-full sm:w-auto">
            <div className="flex bg-slate-100 dark:bg-slate-900/50 p-1 rounded-xl border border-slate-200 dark:border-slate-800">
              <button
                onClick={() => setActiveTab('users')}
                className={`px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-2 ${activeTab === 'users' ? 'bg-white dark:bg-slate-800 text-brand-purple shadow-sm' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
              >
                <User size={14} /> Users
              </button>
              <button
                onClick={() => setActiveTab('system')}
                className={`px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-2 ${activeTab === 'system' ? 'bg-white dark:bg-slate-800 text-brand-purple shadow-sm' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
              >
                <Settings size={14} /> System
              </button>
              <button
                onClick={() => setActiveTab('rules')}
                className={`px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-2 ${activeTab === 'rules' ? 'bg-white dark:bg-slate-800 text-brand-purple shadow-sm' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
              >
                <Languages size={14} /> Rules
              </button>
            </div>
            <button 
              onClick={() => {
                if (onLogout) {
                  onLogout();
                } else {
                  setIsAuthenticated(false);
                  localStorage.removeItem('vbs_isAdmin');
                }
              }}
              className="px-4 py-2.5 bg-slate-100 dark:bg-slate-900/50 hover:bg-slate-200 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-500 dark:text-slate-400 text-sm font-bold transition-all"
            >
              Sign Out
            </button>
          </div>
        </div>
      </div>

      {/* Session Sync Status Warning */}
      {!isSessionSynced && isAuthenticated && !syncTimeoutReached && localStorage.getItem('vbs_access_code') !== 'saw_vlogs_2026' && (
        <div className="mb-6 p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/30 rounded-xl flex items-center gap-3 text-amber-800 dark:text-amber-200">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <div className="text-sm">
            <p className="font-bold">Session Sync Pending...</p>
            <p className="opacity-80">Firestore permissions may be limited until the session is fully synced. Please wait a few seconds.</p>
          </div>
        </div>
      )}

      {activeTab === 'users' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Create Form */}
        <div className="lg:col-span-4">
          <div className="bg-white/50 backdrop-blur dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 sm:p-6 shadow-2xl sticky top-8 transition-colors duration-300">
            <div className="flex items-center gap-3 mb-6">
              <UserPlus className="text-brand-purple" size={20} />
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">Create New User</h3>
            </div>

            <form onSubmit={handleCreateUser} className="space-y-4">
              <div className="space-y-2">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest px-1">Access ID</label>
                <div className="relative">
                  <Key className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                  <input
                    type="text"
                    value={newId}
                    onChange={(e) => setNewId(e.target.value)}
                    placeholder="e.g. VIP-0001"
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl pl-12 pr-4 py-3.5 text-sm text-slate-900 dark:text-slate-200 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-purple/50 transition-all"
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest px-1">User Name</label>
                <div className="relative">
                  <User className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                  <input
                    type="text"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="e.g. John Doe"
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl pl-12 pr-4 py-3.5 text-sm text-slate-900 dark:text-slate-200 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-purple/50 transition-all"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest px-1">Expiry (Days)</label>
                <div className="relative">
                  <Calendar className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                  <input
                    type="number"
                    value={newExpiryDays}
                    onChange={(e) => setNewExpiryDays(e.target.value)}
                    placeholder="30"
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl pl-12 pr-4 py-3.5 text-sm text-slate-900 dark:text-slate-200 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-purple/50 transition-all"
                    required
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={isSubmitting || !newId.trim()}
                className="w-full py-4 bg-brand-purple text-white rounded-xl font-bold hover:bg-brand-purple/90 transition-all shadow-lg shadow-brand-purple/20 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed active:scale-95"
              >
                {isSubmitting ? <RefreshCw size={18} className="animate-spin" /> : <Plus size={18} />}
                Create User
              </button>
            </form>
          </div>
        </div>

        {/* List Table */}
        <div className="lg:col-span-8">
          <div className="bg-white/50 backdrop-blur dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 sm:p-6 shadow-2xl transition-colors duration-300">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
              <div className="flex items-center gap-3">
                <Key className="text-brand-purple" size={20} />
                <h3 className="text-lg font-bold text-slate-900 dark:text-white">Global Users</h3>
                <span className="px-2 py-0.5 bg-brand-purple/20 text-brand-purple border border-brand-purple/30 rounded-lg text-[9px] font-bold uppercase">
                  {users.length} Total
                </span>
              </div>

              <div className="relative flex-1 max-w-full md:max-w-xs flex items-center gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
                  <input
                    type="text"
                    placeholder="Search IDs or notes..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg pl-10 pr-4 py-2.5 text-xs text-slate-900 dark:text-slate-200 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-purple/50 transition-all"
                  />
                </div>
                <button
                  onClick={() => {
                    setIsLoading(true);
                    // The onSnapshot will handle the refresh automatically if we just trigger a re-render or wait
                    // But we can also manually re-fetch if needed. 
                    // Since it's onSnapshot, it should be real-time.
                    setTimeout(() => setIsLoading(false), 500);
                  }}
                  className="p-2.5 bg-slate-100 dark:bg-slate-900/50 hover:bg-slate-200 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-500 transition-all"
                  title="Refresh List"
                >
                  <RefreshCw size={16} className={isLoading ? 'animate-spin' : ''} />
                </button>
              </div>
            </div>

            {isLoading ? (
              <div className="flex items-center justify-center py-20">
                <div className="w-8 h-8 border-2 border-brand-purple/20 border-t-brand-purple rounded-full animate-spin" />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-white/5">
                      <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Access ID</th>
                      <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Name</th>
                      <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Expiry</th>
                      <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Status</th>
                      <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-widest text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-white/5">
                    {filteredUsers.map((u) => (
                      <tr key={u.id} className="hover:bg-slate-50 dark:hover:bg-white/5 transition-colors group">
                        <td className="px-4 py-4">
                          <span className="font-mono text-sm text-slate-900 dark:text-white bg-slate-100 dark:bg-white/5 px-2 py-1 rounded border border-slate-200 dark:border-white/10">
                            {u.id === 'saw_vlogs_2026' ? 'Commander Saw' : u.id}
                          </span>
                        </td>
                        <td className="px-4 py-4">
                          <span className="text-sm text-slate-700 dark:text-slate-300">{u.name || '—'}</span>
                        </td>
                        <td className="px-4 py-4">
                          <div className="flex flex-col gap-1">
                            <div className="relative group/date">
                              <div className="flex items-center gap-2 text-xs text-slate-500 cursor-pointer hover:text-brand-purple transition-colors p-1 -m-1 rounded hover:bg-slate-100 dark:hover:bg-white/5">
                                <Calendar size={12} />
                                {new Date(u.expiryDate).toLocaleDateString()}
                              </div>
                              <input 
                                type="date"
                                className="absolute inset-0 opacity-0 cursor-pointer"
                                onChange={(e) => handleUpdateExpiryDate(u.id, e.target.value)}
                                title="Change Expiry Date"
                              />
                            </div>
                            {new Date(u.expiryDate) < new Date() && (
                              <span className="text-[10px] text-red-500 font-bold uppercase">Expired</span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-4">
                          {u.isActive ? (
                            <span className="flex items-center gap-1.5 text-emerald-500 text-[10px] font-bold uppercase">
                              <CheckCircle2 size={12} /> Active
                            </span>
                          ) : (
                            <span className="flex items-center gap-1.5 text-red-500 text-[10px] font-bold uppercase">
                              <XCircle size={12} /> Inactive
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-4 text-right">
                          <div className="flex items-center justify-end gap-2">
                            {/* Quick Extend Buttons */}
                            <div className="flex items-center gap-1 mr-2">
                              <button
                                onClick={() => handleExtendExpiry(u.id, u.expiryDate, 30)}
                                className="px-2 py-1 text-[9px] font-bold bg-brand-purple/10 text-brand-purple rounded hover:bg-brand-purple hover:text-white transition-all border border-brand-purple/20"
                                title="+30 Days"
                              >
                                +30D
                              </button>
                              <button
                                onClick={() => handleExtendExpiry(u.id, u.expiryDate, 365)}
                                className="px-2 py-1 text-[9px] font-bold bg-blue-500/10 text-blue-500 rounded hover:bg-blue-500 hover:text-white transition-all border border-blue-500/20"
                                title="+1 Year"
                              >
                                +1Y
                              </button>
                            </div>

                            <div className="w-px h-4 bg-slate-200 dark:bg-slate-800 mx-1" />

                            <button
                              onClick={() => handleToggleStatus(u.id, u.isActive)}
                              className={`p-2 rounded-lg transition-all ${u.isActive ? 'text-amber-500 hover:bg-amber-500/10' : 'text-emerald-500 hover:bg-emerald-500/10'}`}
                              title={u.isActive ? 'Deactivate' : 'Activate'}
                            >
                              <RefreshCw size={16} />
                            </button>
                            <button
                              onClick={() => handleDeleteUser(u.id)}
                              disabled={isDeletingUser === u.id}
                              className="p-2 text-slate-500 hover:text-red-500 hover:bg-red-500/10 rounded-lg transition-all disabled:opacity-50"
                              title="Delete"
                            >
                              {isDeletingUser === u.id ? <RefreshCw size={16} className="animate-spin" /> : <Trash2 size={16} />}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {filteredUsers.length === 0 && (
                      <tr>
                        <td colSpan={5} className="py-10 text-center text-slate-500 italic text-sm">
                          No users found.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
      )}

      {activeTab === 'system' && (
        <div className="max-w-4xl mx-auto w-full">
          <div className="bg-white/50 backdrop-blur dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl transition-colors duration-300">
            <div className="flex items-center justify-between mb-8">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-brand-purple/20 text-brand-purple rounded-xl flex items-center justify-center border border-brand-purple/20">
                  <Settings size={20} />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-slate-900 dark:text-white">System Settings</h3>
                  <p className="text-slate-500 dark:text-slate-400 text-xs">Configure Global API Keys and System Status</p>
                </div>
              </div>
              <button
                onClick={() => setShowSecrets(!showSecrets)}
                className="flex items-center gap-2 px-4 py-2 bg-slate-100 dark:bg-slate-900/50 hover:bg-slate-200 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-500 dark:text-slate-400 text-xs font-bold transition-all"
              >
                {showSecrets ? <EyeOff size={14} /> : <Eye size={14} />}
                {showSecrets ? 'Hide Secrets' : 'Show Secrets'}
              </button>
            </div>

            <form onSubmit={handleSaveSystemConfig} className="space-y-8">
              {/* System Status Section */}
              <div className="space-y-6">
                <div className="flex items-center gap-2 pb-2 border-b border-slate-200 dark:border-white/5">
                  <RefreshCw size={16} className="text-brand-purple" />
                  <h4 className="text-sm font-bold text-slate-900 dark:text-white uppercase tracking-wider">System Status</h4>
                </div>
                
                <div className="flex items-center justify-between bg-slate-50 dark:bg-slate-900/50 p-4 rounded-2xl border border-slate-200 dark:border-slate-800">
                  <div>
                    <h5 className="text-sm font-bold text-slate-900 dark:text-white">System Live Switch</h5>
                    <p className="text-xs text-slate-500">When OFF, only Admins can access the generator.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setLocalConfig({ ...localConfig, isSystemLive: !localConfig.isSystemLive })}
                    className={`w-12 h-6 rounded-full transition-all relative ${localConfig.isSystemLive ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-700'}`}
                  >
                    <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${localConfig.isSystemLive ? 'left-7' : 'left-1'}`} />
                  </button>
                </div>
              </div>

              {/* Global API Keys Section */}
              <div className="space-y-6">
                <div className="flex items-center gap-2 pb-2 border-b border-slate-200 dark:border-white/5">
                  <Key size={16} className="text-brand-purple" />
                  <h4 className="text-sm font-bold text-slate-900 dark:text-white uppercase tracking-wider">Global API Keys</h4>
                </div>
                
                <div className="flex items-center justify-between bg-slate-50 dark:bg-slate-900/50 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 mb-4">
                  <div>
                    <h5 className="text-sm font-bold text-slate-900 dark:text-white">Allow Global Key Usage</h5>
                    <p className="text-xs text-slate-500">If enabled, users without their own API key will use these global keys.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setLocalConfig({ ...localConfig, allow_global_key: !localConfig.allow_global_key })}
                    className={`w-12 h-6 rounded-full transition-all relative ${localConfig.allow_global_key ? 'bg-brand-purple' : 'bg-slate-300 dark:bg-slate-700'}`}
                  >
                    <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${localConfig.allow_global_key ? 'left-7' : 'left-1'}`} />
                  </button>
                </div>

                <div className="grid grid-cols-1 gap-6">
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest px-1">Gemini API Key</label>
                    <input
                      type={showSecrets ? "text" : "password"}
                      value={localConfig.gemini_api_key || ''}
                      onChange={(e) => setLocalConfig({ ...localConfig, gemini_api_key: e.target.value })}
                      placeholder="AIzaSy..."
                      className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-3 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-purple/50 transition-all font-mono"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest px-1">RapidAPI Key</label>
                    <input
                      type={showSecrets ? "text" : "password"}
                      value={localConfig.rapidapi_key || ''}
                      onChange={(e) => setLocalConfig({ ...localConfig, rapidapi_key: e.target.value })}
                      placeholder="RapidAPI Key..."
                      className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-3 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-purple/50 transition-all font-mono"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest px-1">OpenAI API Key</label>
                    <input
                      type={showSecrets ? "text" : "password"}
                      value={localConfig.openai_api_key || ''}
                      onChange={(e) => setLocalConfig({ ...localConfig, openai_api_key: e.target.value })}
                      placeholder="sk-..."
                      className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-3 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-purple/50 transition-all font-mono"
                    />
                  </div>
                </div>
              </div>

              <div className="pt-4">
                <button
                  type="submit"
                  disabled={isSavingSystem}
                  className="w-full py-4 bg-brand-purple text-white rounded-2xl font-bold hover:bg-brand-purple/90 transition-all shadow-lg shadow-brand-purple/20 flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {isSavingSystem ? <RefreshCw size={20} className="animate-spin" /> : <Save size={20} />}
                  Save Global Configuration
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {activeTab === 'rules' && (
        <div className="max-w-4xl mx-auto w-full">
          <div className="bg-white/50 backdrop-blur dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl transition-colors duration-300">
            <div className="flex items-center justify-between mb-8">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-brand-purple/20 text-brand-purple rounded-xl flex items-center justify-center border border-brand-purple/20">
                  <Languages size={20} />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-slate-900 dark:text-white">Pronunciation Rules</h3>
                  <p className="text-slate-500 dark:text-slate-400 text-xs">Manage global text replacement rules for TTS</p>
                </div>
              </div>
            </div>

            <form onSubmit={handleCreateRule} className="space-y-6 mb-10">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest px-1">Original Text</label>
                  <input
                    type="text"
                    value={newRuleOriginal}
                    onChange={(e) => setNewRuleOriginal(e.target.value)}
                    placeholder="e.g. AI"
                    className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-3 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-purple/50 transition-all"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest px-1">Replacement Text</label>
                  <input
                    type="text"
                    value={newRuleReplacement}
                    onChange={(e) => setNewRuleReplacement(e.target.value)}
                    placeholder="e.g. Artificial Intelligence"
                    className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-3 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-purple/50 transition-all"
                    required
                  />
                </div>
              </div>
              <div className="flex gap-3">
                <button
                  type="submit"
                  disabled={isSavingRule}
                  className="flex-1 py-4 bg-brand-purple text-white rounded-2xl font-bold hover:bg-brand-purple/90 transition-all shadow-lg shadow-brand-purple/20 flex items-center justify-center gap-2 disabled:opacity-50 active:scale-95"
                >
                  {isSavingRule ? <RefreshCw size={20} className="animate-spin" /> : (editingRuleId ? <Save size={20} /> : <Plus size={20} />)}
                  {editingRuleId ? 'Update Pronunciation Rule' : 'Add Pronunciation Rule'}
                </button>
                {editingRuleId && (
                  <button
                    type="button"
                    onClick={cancelEditRule}
                    className="px-6 py-4 bg-slate-100 dark:bg-slate-900/50 text-slate-500 rounded-2xl font-bold hover:bg-slate-200 dark:hover:bg-slate-800 transition-all border border-slate-200 dark:border-slate-800"
                  >
                    Cancel
                  </button>
                )}
              </div>
            </form>

            <div className="space-y-4">
              <div className="flex items-center gap-2 pb-2 border-b border-slate-200 dark:border-white/5">
                <Edit3 size={16} className="text-brand-purple" />
                <h4 className="text-sm font-bold text-slate-900 dark:text-white uppercase tracking-wider">Active Rules ({rules.length})</h4>
              </div>

              {isRulesLoading ? (
                <div className="flex items-center justify-center py-10">
                  <RefreshCw size={24} className="text-brand-purple animate-spin" />
                </div>
              ) : rules.length === 0 ? (
                <div className="py-10 text-center text-slate-500 italic text-sm">
                  No pronunciation rules defined yet.
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-3">
                  {rules.map((rule) => (
                    <div key={rule.id} className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800 rounded-2xl group hover:border-brand-purple/30 transition-all">
                      <div className="flex items-center gap-4 overflow-hidden">
                        <div className="flex flex-col min-w-0">
                          <span className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-1">Original</span>
                          <span className="text-sm font-mono text-slate-900 dark:text-white truncate">{rule.original}</span>
                        </div>
                        <div className="h-8 w-px bg-slate-200 dark:bg-white/10" />
                        <div className="flex flex-col min-w-0">
                          <span className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-1">Replacement</span>
                          <span className="text-sm font-mono text-brand-purple truncate">{rule.replacement}</span>
                        </div>
                      </div>
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => handleEditRule(rule)}
                          className="p-2 text-slate-400 hover:text-brand-purple hover:bg-brand-purple/10 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                          title="Edit Rule"
                        >
                          <Edit3 size={18} />
                        </button>
                        <button
                          onClick={() => handleDeleteRule(rule.id)}
                          disabled={isDeletingRule === rule.id}
                          className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-500/10 rounded-lg transition-all opacity-0 group-hover:opacity-100 disabled:opacity-50"
                          title="Delete Rule"
                        >
                          {isDeletingRule === rule.id ? <RefreshCw size={18} className="animate-spin" /> : <Trash2 size={18} />}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>

      <Toast 
        message={toast.message}
        type={toast.type}
        isVisible={toast.isVisible}
        onClose={() => setToast(prev => ({ ...prev, isVisible: false }))}
      />
    </>
  );
};

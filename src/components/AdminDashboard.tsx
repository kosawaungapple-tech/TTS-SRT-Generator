import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { 
  Shield, 
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
  LogOut,
  Settings,
  Database,
  Send,
  Eye,
  EyeOff,
  Save,
  Languages,
  Edit3
} from 'lucide-react';
import { AuthorizedUser, User as RegisteredUser, SystemConfig, PronunciationRule } from '../types';
import { db, collection, onSnapshot, query, orderBy, setDoc, doc, deleteDoc, updateDoc, handleFirestoreError, OperationType, getDoc, auth } from '../firebase';
import { Toast, ToastType } from './Toast';

interface AdminDashboardProps {
  isAuthReady: boolean;
  isAdmin: boolean;
  isSessionSynced: boolean;
  onLogout: () => void;
  onConfigUpdate?: (config: SystemConfig) => void;
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({ isAuthReady, isAdmin, isSessionSynced, onLogout, onConfigUpdate }) => {
  const [authorizedUsers, setAuthorizedUsers] = useState<AuthorizedUser[]>([]);
  const [registeredUsers, setRegisteredUsers] = useState<RegisteredUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isUsersLoading, setIsUsersLoading] = useState(true);
  const [newId, setNewId] = useState('');
  const [newNote, setNewNote] = useState('');
  const [newExpiryDate, setNewExpiryDate] = useState('');
  const [newRole, setNewRole] = useState<'admin' | 'user'>('user');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeletingUser, setIsDeletingUser] = useState<string | null>(null);
  const [isVerifyingUser, setIsVerifyingUser] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  
  // Toast State
  const [toast, setToast] = useState<{ message: string; type: ToastType; isVisible: boolean }>({
    message: '',
    type: 'success',
    isVisible: false
  });
  
  const [activeTab, setActiveTab] = useState<'users' | 'system' | 'rules'>('users');

  // System Settings State
  const [systemConfig, setSystemConfig] = useState<SystemConfig>(() => {
    try {
      const saved = localStorage.getItem('vbs_system_config');
      let config: SystemConfig = saved ? JSON.parse(saved) : {
        firebase_project_id: '',
        firebase_api_key: '',
        firebase_auth_domain: '',
        firebase_app_id: '',
        telegram_bot_token: '',
        telegram_chat_id: '',
        rapidapi_key: '',
        gemini_api_key: '',
        openai_api_key: '',
        system_live: true
      };
      
      const rKey = localStorage.getItem('rapidapi_key');
      const gKey = localStorage.getItem('gemini_api_key');
      const oKey = localStorage.getItem('openai_api_key');
      const sLive = localStorage.getItem('system_live');
      
      if (rKey) config.rapidapi_key = rKey;
      if (gKey) config.gemini_api_key = gKey;
      if (oKey) config.openai_api_key = oKey;
      if (sLive !== null) config.system_live = sLive === 'true';
      
      return config;
    } catch (e) {
      console.error('Failed to initialize system config from localStorage:', e);
      return {
        firebase_project_id: '',
        firebase_api_key: '',
        firebase_auth_domain: '',
        firebase_app_id: '',
        telegram_bot_token: '',
        telegram_chat_id: '',
        rapidapi_key: '',
        gemini_api_key: '',
        openai_api_key: ''
      };
    }
  });
  const [isSavingSystem, setIsSavingSystem] = useState(false);
  const [isSystemLoading, setIsSystemLoading] = useState(true);
  const [showSecrets, setShowSecrets] = useState(false);
  const [showRapidKey, setShowRapidKey] = useState(false);
  const [showGeminiKey, setShowGeminiKey] = useState(false);
  const [showOpenAIKey, setShowOpenAIKey] = useState(false);

  // Pronunciation Rules State
  const [rules, setRules] = useState<PronunciationRule[]>([]);
  const [newRuleOriginal, setNewRuleOriginal] = useState('');
  const [newRuleReplacement, setNewRuleReplacement] = useState('');
  const [isSavingRule, setIsSavingRule] = useState(false);
  const [isDeletingRule, setIsDeletingRule] = useState<string | null>(null);
  const [isRulesLoading, setIsRulesLoading] = useState(true);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);

  useEffect(() => {
    // Authentication is now handled by the parent App component
    // This component is only rendered if the user is authenticated as admin
  }, []);

  const formatDate = (date: any) => {
    if (!date) return 'မရှိပါ';
    try {
      if (date && typeof date === 'object' && 'toDate' in date) {
        return date.toDate().toLocaleString('my-MM');
      }
      return new Date(date).toLocaleString('my-MM');
    } catch (e) {
      return 'မှားယွင်းသော ရက်စွဲ';
    }
  };


  useEffect(() => {
    // Load from localStorage
    const loadLocalData = () => {
      try {
        const savedAuth = localStorage.getItem('vbs_authorized_users');
        if (savedAuth) {
          setAuthorizedUsers(JSON.parse(savedAuth));
        }
        
        const savedReg = localStorage.getItem('vbs_registered_users');
        if (savedReg) {
          setRegisteredUsers(JSON.parse(savedReg));
        }
        
        const savedRules = localStorage.getItem('vbs_global_rules');
        if (savedRules) {
          setRules(JSON.parse(savedRules));
        }
      } catch (e) {
        console.error('Failed to load local data:', e);
      } finally {
        setIsLoading(false);
        setIsUsersLoading(false);
      }
    };

    loadLocalData();
  }, []);

  useEffect(() => {
    if (!isAuthReady || !isSessionSynced) return;

    // Listen for Access Codes (authorized_users)
    const qAuth = query(collection(db, 'authorized_users'), orderBy('createdAt', 'desc'));
    const unsubscribeAuth = onSnapshot(qAuth, (snapshot) => {
      const users = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      } as AuthorizedUser));
      setAuthorizedUsers(users);
      localStorage.setItem('vbs_authorized_users', JSON.stringify(users));
      setIsLoading(false);
    }, (err) => {
      console.error('Failed to load authorized users (Silent Fallback):', err);
      setIsLoading(false);
    });

    // Listen for Registered Users (users) - This might fail if not admin in Firestore
    const qReg = query(collection(db, 'users'), orderBy('createdAt', 'desc'));
    const unsubscribeReg = onSnapshot(qReg, (snapshot) => {
      const users = snapshot.docs.map(doc => ({
        uid: doc.id,
        ...doc.data()
      } as RegisteredUser));
      setRegisteredUsers(users);
      localStorage.setItem('vbs_registered_users', JSON.stringify(users));
      setIsUsersLoading(false);
    }, (err) => {
      console.error('Failed to load registered users (Silent Fallback):', err);
      setIsUsersLoading(false);
    });

    return () => {
      unsubscribeAuth();
      unsubscribeReg();
    };
  }, [isAuthReady, isSessionSynced]);

  useEffect(() => {
    if (!isAuthReady) return;

    const unsubscribe = onSnapshot(collection(db, 'globalRules'), (snapshot) => {
      const fetchedRules = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as PronunciationRule[];
      setRules(fetchedRules);
      localStorage.setItem('vbs_global_rules', JSON.stringify(fetchedRules));
      setIsRulesLoading(false);
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, 'globalRules');
      setIsRulesLoading(false);
    });

    return () => unsubscribe();
  }, [isAuthReady]);

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
        setToast({ message: 'စည်းမျဉ်းကို ပြင်ဆင်ပြီးပါပြီ!', type: 'success', isVisible: true });
    } else {
      const ruleId = `rule_${Date.now()}`;
      await setDoc(doc(db, 'globalRules', ruleId), {
        original: newRuleOriginal.trim(),
        replacement: newRuleReplacement.trim(),
        createdAt: new Date().toISOString()
      });
      setToast({ message: 'စည်းမျဉ်းအသစ် ထည့်သွင်းပြီးပါပြီ!', type: 'success', isVisible: true });
    }
    setNewRuleOriginal('');
    setNewRuleReplacement('');
    setEditingRuleId(null);
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, editingRuleId ? `globalRules/${editingRuleId}` : 'globalRules');
    setToast({ message: editingRuleId ? 'စည်းမျဉ်း ပြင်ဆင်ရန် မအောင်မြင်ပါ။' : 'စည်းမျဉ်းအသစ် ထည့်ရန် မအောင်မြင်ပါ။', type: 'error', isVisible: true });
  } finally {
    setIsSavingRule(false);
  }
};

  const handleEditRule = (rule: PronunciationRule) => {
    setNewRuleOriginal(rule.original);
    setNewRuleReplacement(rule.replacement);
    setEditingRuleId(rule.id);
    // Scroll to form
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const cancelEditRule = () => {
    setNewRuleOriginal('');
    setNewRuleReplacement('');
    setEditingRuleId(null);
  };

  const handleDeleteRule = async (id: string) => {
    if (!window.confirm('ဤစည်းမျဉ်းကို ဖျက်ရန် သေချာပါသလား?')) return;
    setIsDeletingRule(id);
    try {
      await deleteDoc(doc(db, 'globalRules', id));
      setToast({ message: 'စည်းမျဉ်းကို ဖျက်လိုက်ပါပြီ', type: 'success', isVisible: true });
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `globalRules/${id}`);
      setToast({ message: 'စည်းမျဉ်း ဖျက်ရန် မအောင်မြင်ပါ။', type: 'error', isVisible: true });
    } finally {
      setIsDeletingRule(null);
    }
  };

  useEffect(() => {
    const loadSystemConfig = () => {
      setIsSystemLoading(true);
      try {
        const saved = localStorage.getItem('vbs_system_config');
        let config: SystemConfig = saved ? JSON.parse(saved) : {
          firebase_project_id: '',
          firebase_api_key: '',
          firebase_auth_domain: '',
          firebase_app_id: '',
          telegram_bot_token: '',
          telegram_chat_id: '',
          rapidapi_key: '',
          gemini_api_key: '',
          openai_api_key: '',
          system_live: true
        };
        
        // Individual overrides if they exist (User preference for individual persistence)
        const rKey = localStorage.getItem('rapidapi_key');
        const gKey = localStorage.getItem('gemini_api_key');
        const oKey = localStorage.getItem('openai_api_key');
        const sLive = localStorage.getItem('system_live');
        
        if (rKey) config.rapidapi_key = rKey;
        if (gKey) config.gemini_api_key = gKey;
        if (oKey) config.openai_api_key = oKey;
        if (sLive !== null) config.system_live = sLive === 'true';
        
        setSystemConfig(config);
      } catch (err) {
        console.error('Failed to load system config from localStorage:', err);
      } finally {
        setIsSystemLoading(false);
      }
    };

    loadSystemConfig();
  }, []);

  const handleSaveSystemConfig = async () => {
    setIsSavingSystem(true);
    
    try {
      // Simulate network delay for visual feedback as requested
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Save directly to localStorage for immediate effect
      localStorage.setItem('vbs_system_config', JSON.stringify(systemConfig));
      
      // Save individual keys as requested
      localStorage.setItem('rapidapi_key', systemConfig.rapidapi_key || '');
      localStorage.setItem('gemini_api_key', systemConfig.gemini_api_key || '');
      localStorage.setItem('openai_api_key', systemConfig.openai_api_key || '');
      localStorage.setItem('system_live', String(systemConfig.system_live ?? true));
      
      if (onConfigUpdate) {
        onConfigUpdate(systemConfig);
      }
      
      setToast({
        message: 'ပြင်ဆင်ချက်များကို အောင်မြင်စွာ သိမ်းဆည်းပြီးပါပြီ။',
        type: 'success',
        isVisible: true
      });
      
      // Auto-hide toast
      setTimeout(() => {
        setToast(prev => ({ ...prev, isVisible: false }));
      }, 3000);
    } catch (err) {
      console.error('Failed to save system settings locally:', err);
      setToast({
        message: 'ပြင်ဆင်ချက်များကို သိမ်းဆည်းရန် မအောင်မြင်ပါ။',
        type: 'error',
        isVisible: true
      });
    } finally {
      setIsSavingSystem(false);
    }
  };

  const handleCreateId = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newId.trim() || isSubmitting) return;

    setIsSubmitting(true);

    try {
      const accessCode = newId.trim();
      
      if (editingUserId) {
        // Update existing user
        const updatedUsers = authorizedUsers.map(u => 
          u.id === editingUserId ? { 
            ...u, 
            id: accessCode, // Allow ID change if needed, though usually ID is the key
            note: newNote.trim(),
            role: newRole,
            expiryDate: newExpiryDate || undefined
          } : u
        );
        
        localStorage.setItem('vbs_authorized_users', JSON.stringify(updatedUsers));
        setAuthorizedUsers(updatedUsers as AuthorizedUser[]);
        
        // Sync to Firestore
        try {
          // If ID changed, we need to delete old and create new, or just update if ID same
          if (editingUserId !== accessCode) {
            await deleteDoc(doc(db, 'authorized_users', editingUserId));
            const updatedUser = updatedUsers.find(u => u.id === accessCode);
            if (updatedUser) {
              await setDoc(doc(db, 'authorized_users', accessCode), updatedUser);
            }
          } else {
            await updateDoc(doc(db, 'authorized_users', accessCode), {
              note: newNote.trim(),
              role: newRole,
              expiryDate: newExpiryDate || undefined
            });
          }
        } catch (fsErr) {
          console.warn('Firestore sync failed, but local save succeeded:', fsErr);
        }
        
        setToast({
          message: 'သက်တမ်းတိုးခြင်း အောင်မြင်ပါသည်။ ✨',
          type: 'success',
          isVisible: true
        });
        setEditingUserId(null);
      } else {
        // Create new user
        const newAuthorizedUser: AuthorizedUser = {
          id: accessCode,
          isActive: true,
          createdAt: new Date().toISOString(),
          note: newNote.trim(),
          role: newRole,
          expiryDate: newExpiryDate || undefined
        };

        // Update LocalStorage
        const updatedUsers = [newAuthorizedUser, ...authorizedUsers];
        localStorage.setItem('vbs_authorized_users', JSON.stringify(updatedUsers));
        setAuthorizedUsers(updatedUsers as AuthorizedUser[]);
        
        // Also sync to Firestore
        try {
          await setDoc(doc(db, 'authorized_users', accessCode), newAuthorizedUser);
        } catch (fsErr) {
          console.warn('Firestore sync failed, but local save succeeded:', fsErr);
        }
        
        setToast({
          message: 'အသုံးပြုသူ ID အသစ် ဖန်တီးပြီးပါပြီ! 🎉',
          type: 'success',
          isVisible: true
        });
      }
      
      setNewId('');
      setNewNote('');
      setNewExpiryDate('');
      setNewRole('user');
    } catch (err: any) {
      setToast({
        message: editingUserId ? 'ပြင်ဆင်ရန် မအောင်မြင်ပါ။' : 'အမှားအယွင်းရှိပါသည် - ID ဖန်တီး၍မရပါ။',
        type: 'error',
        isVisible: true
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEditId = (user: AuthorizedUser) => {
    setEditingUserId(user.id);
    setNewId(user.id);
    setNewNote(user.note || '');
    setNewRole(user.role || 'user');
    
    // Format date for input[type="date"]
    if (user.expiryDate) {
      const date = new Date(user.expiryDate);
      const formattedDate = date.toISOString().split('T')[0];
      setNewExpiryDate(formattedDate);
    } else {
      setNewExpiryDate('');
    }
    
    // Scroll to top of form
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleCancelEdit = () => {
    setEditingUserId(null);
    setNewId('');
    setNewNote('');
    setNewExpiryDate('');
    setNewRole('user');
  };

  const handleToggleStatus = async (id: string, currentStatus: boolean) => {
    try {
      // Update LocalStorage
      const updatedUsers = authorizedUsers.map(u => 
        u.id === id ? { ...u, isActive: !currentStatus } : u
      );
      localStorage.setItem('vbs_authorized_users', JSON.stringify(updatedUsers));
      setAuthorizedUsers(updatedUsers as AuthorizedUser[]);

      // Also sync to Firestore
      try {
        await updateDoc(doc(db, 'authorized_users', id), {
          isActive: !currentStatus
        });
      } catch (fsErr) {
        console.warn('Firestore update failed, but local update succeeded:', fsErr);
      }

      setToast({
        message: 'အသုံးပြုသူ အခြေအနေကို ပြောင်းလဲလိုက်ပါပြီ!',
        type: 'success',
        isVisible: true
      });
    } catch (err) {
      setToast({
        message: 'အသုံးပြုသူ အခြေအနေ ပြောင်းလဲရန် မအောင်မြင်ပါ။',
        type: 'error',
        isVisible: true
      });
    }
  };

  const handleToggleRole = async (id: string, currentRole: 'admin' | 'user') => {
    try {
      const nextRole = currentRole === 'admin' ? 'user' : 'admin';
      
      // Update LocalStorage
      const updatedUsers = authorizedUsers.map(u => 
        u.id === id ? { ...u, role: nextRole } : u
      );
      localStorage.setItem('vbs_authorized_users', JSON.stringify(updatedUsers));
      setAuthorizedUsers(updatedUsers as AuthorizedUser[]);

      // Also sync to Firestore
      try {
        await updateDoc(doc(db, 'authorized_users', id), {
          role: nextRole
        });
      } catch (fsErr) {
        console.warn('Firestore update failed, but local update succeeded:', fsErr);
      }

      setToast({
        message: 'အသုံးပြုသူ အဆင့်ကို ပြောင်းလဲလိုက်ပါပြီ!',
        type: 'success',
        isVisible: true
      });
    } catch (err) {
      setToast({
        message: 'အသုံးပြုသူ အဆင့် ပြောင်းလဲရန် မအောင်မြင်ပါ။',
        type: 'error',
        isVisible: true
      });
    }
  };

  const handleDeleteId = async (id: string) => {
    if (!window.confirm(`Access Code: ${id} ကို ဖျက်ရန် သေချာပါသလား?`)) return;

    setIsDeletingUser(id);
    try {
      // Update LocalStorage
      const updatedUsers = authorizedUsers.filter(u => u.id !== id);
      localStorage.setItem('vbs_authorized_users', JSON.stringify(updatedUsers));
      setAuthorizedUsers(updatedUsers as AuthorizedUser[]);

      // Also sync to Firestore
      try {
        await deleteDoc(doc(db, 'authorized_users', id));
      } catch (fsErr) {
        console.warn('Firestore delete failed, but local delete succeeded:', fsErr);
      }

      setToast({
        message: 'အသုံးပြုသူ ID ကို ဖျက်လိုက်ပါပြီ! 🎉',
        type: 'success',
        isVisible: true
      });
    } catch (err) {
      setToast({
        message: 'အသုံးပြုသူ ID ဖျက်ရန် မအောင်မြင်ပါ။',
        type: 'error',
        isVisible: true
      });
    } finally {
      setIsDeletingUser(null);
    }
  };

  const handleVerifyUser = async (uid: string) => {
    setIsVerifyingUser(uid);
    try {
      await updateDoc(doc(db, 'users', uid), {
        is_verified: true,
        pending_verification: false
      });
      setToast({
        message: 'အသုံးပြုသူကို အတည်ပြုပြီးပါပြီ! 🎉',
        type: 'success',
        isVisible: true
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${uid}`);
      setToast({
        message: 'အသုံးပြုသူ အတည်ပြုရန် မအောင်မြင်ပါ။',
        type: 'error',
        isVisible: true
      });
    } finally {
      setIsVerifyingUser(null);
    }
  };

  const handleToggleRegisteredUserRole = async (uid: string, currentRole: 'admin' | 'user') => {
    try {
      await updateDoc(doc(db, 'users', uid), {
        role: currentRole === 'admin' ? 'user' : 'admin'
      });
      setToast({
        message: `အသုံးပြုသူအဆင့်ကို ${currentRole === 'admin' ? 'အသုံးပြုသူ' : 'အက်ဒမင်'}သို့ ပြောင်းလဲလိုက်ပါပြီ! 🎉`,
        type: 'success',
        isVisible: true
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${uid}`);
      setToast({
        message: 'အသုံးပြုသူအဆင့် ပြောင်းလဲရန် မအောင်မြင်ပါ။',
        type: 'error',
        isVisible: true
      });
    }
  };

  const filteredUsers = authorizedUsers.filter(u => 
    u.id.toLowerCase().includes(searchQuery.toLowerCase()) || 
    (u.note || '').toLowerCase().includes(searchQuery.toLowerCase())
  );



  return (
    <>
      <div className="max-w-6xl mx-auto space-y-8 p-4">
      {/* Header */}
      <div className="bg-white/50 backdrop-blur dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 sm:p-8 shadow-2xl transition-colors duration-300">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-6 text-center sm:text-left">
          <div className="flex flex-col sm:flex-row items-center gap-4 sm:gap-6">
            <div className="w-14 h-14 sm:w-16 sm:h-16 bg-brand-purple/20 text-brand-purple rounded-2xl flex items-center justify-center shadow-[0_0_15px_rgba(168,85,247,0.3)] border border-brand-purple/20 shrink-0">
              <Shield size={28} className="sm:w-8 sm:h-8" />
            </div>
            <div>
              <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white font-mono tracking-tighter uppercase">ထိန်းချုပ်ရေးဗဟို</h2>
              <p className="text-slate-500 dark:text-slate-400 text-[10px] sm:text-xs mt-1 font-mono uppercase tracking-widest">စနစ်စီမံခန့်ခွဲမှုဌာန</p>
            </div>
          </div>
          <div className="flex items-center gap-3 w-full sm:w-auto">
            <div className="flex bg-slate-100 dark:bg-slate-950 p-1 rounded-xl border border-slate-200 dark:border-slate-800">
              <button
                onClick={() => setActiveTab('users')}
                className={`px-4 py-2 rounded-lg text-[10px] font-bold transition-all flex items-center gap-2 font-mono uppercase tracking-wider ${activeTab === 'users' ? 'bg-white dark:bg-slate-800 text-brand-purple shadow-[0_0_10px_rgba(168,85,247,0.2)]' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
              >
                <User size={14} /> အသုံးပြုသူများ
              </button>
              <button
                onClick={() => setActiveTab('system')}
                className={`px-4 py-2 rounded-lg text-[10px] font-bold transition-all flex items-center gap-2 font-mono uppercase tracking-wider ${activeTab === 'system' ? 'bg-white dark:bg-slate-800 text-brand-purple shadow-[0_0_10px_rgba(168,85,247,0.2)]' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
              >
                <Settings size={14} /> စနစ်ပြင်ဆင်ချက်
              </button>
              <button
                onClick={() => setActiveTab('rules')}
                className={`px-4 py-2 rounded-lg text-[10px] font-bold transition-all flex items-center gap-2 font-mono uppercase tracking-wider ${activeTab === 'rules' ? 'bg-white dark:bg-slate-800 text-brand-purple shadow-[0_0_10px_rgba(168,85,247,0.2)]' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
              >
                <Languages size={14} /> စည်းမျဉ်းများ
              </button>
            </div>
            <button 
              onClick={onLogout}
              className="px-4 py-2.5 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 rounded-xl text-red-500 text-[10px] font-bold transition-all flex items-center gap-2 font-mono uppercase tracking-widest hover:shadow-[0_0_15px_rgba(239,68,68,0.2)]"
            >
              <LogOut size={16} /> ထွက်ရန်
            </button>
          </div>
        </div>
      </div>

      {activeTab === 'users' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Create Form */}
        <div className="lg:col-span-4">
          <div className="bg-white/50 backdrop-blur dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 sm:p-6 shadow-2xl sticky top-8 transition-colors duration-300 neon-border-purple">
            <div className="flex items-center gap-3 mb-6">
              <UserPlus className="text-brand-purple" size={20} />
              <h3 className="text-lg font-bold text-slate-900 dark:text-white font-mono uppercase tracking-tighter">
                {editingUserId ? 'အသုံးပြုသူ ပြင်ဆင်ရန်' : 'အသုံးပြုသူအသစ် ထည့်ရန်'}
              </h3>
            </div>

            <form onSubmit={handleCreateId} className="space-y-4">
              <div className="space-y-2">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest px-1 font-mono">အသုံးပြုသူ ID (Access Code)</label>
                <div className="relative">
                  <Key className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                  <input
                    type="text"
                    value={newId}
                    onChange={(e) => setNewId(e.target.value)}
                    placeholder="ဥပမာ - USER-12345"
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl pl-12 pr-4 py-3.5 text-sm text-slate-900 dark:text-slate-200 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-purple/50 transition-all font-mono"
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest px-1 font-mono">မှတ်ချက် / အမည် (မထည့်လည်းရသည်)</label>
                <div className="relative">
                  <User className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                  <input
                    type="text"
                    value={newNote}
                    onChange={(e) => setNewNote(e.target.value)}
                    placeholder="ဥပမာ - စောရန်အောင်"
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl pl-12 pr-4 py-3.5 text-sm text-slate-900 dark:text-slate-200 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-purple/50 transition-all font-mono"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest px-1 font-mono">သက်တမ်းကုန်ဆုံးမည့်ရက် (Expiry Date)</label>
                <div className="relative">
                  <Calendar className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                  <input
                    type="date"
                    value={newExpiryDate}
                    onChange={(e) => setNewExpiryDate(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl pl-12 pr-4 py-3.5 text-sm text-slate-900 dark:text-slate-200 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-purple/50 transition-all font-mono"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest px-1 font-mono">အဆင့်သတ်မှတ်ချက်</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setNewRole('user')}
                    className={`py-3 rounded-xl text-[10px] font-bold border transition-all font-mono uppercase tracking-widest ${newRole === 'user' ? 'bg-brand-purple border-brand-purple text-white shadow-[0_0_15px_rgba(168,85,247,0.3)]' : 'bg-slate-100 dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-800'}`}
                  >
                    အသုံးပြုသူ
                  </button>
                  <button
                    type="button"
                    onClick={() => setNewRole('admin')}
                    className={`py-3 rounded-xl text-[10px] font-bold border transition-all font-mono uppercase tracking-widest ${newRole === 'admin' ? 'bg-brand-purple border-brand-purple text-white shadow-[0_0_15px_rgba(168,85,247,0.3)]' : 'bg-slate-100 dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-800'}`}
                  >
                    အက်ဒမင်
                  </button>
                </div>
              </div>

              <div className="flex flex-col gap-3">
                <button
                  type="submit"
                  disabled={isSubmitting || !newId.trim()}
                  className="w-full py-4 bg-brand-purple text-white rounded-xl font-bold hover:bg-brand-purple/90 transition-all shadow-lg shadow-brand-purple/20 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed active:scale-95 font-mono uppercase tracking-widest hover:shadow-[0_0_20px_rgba(168,85,247,0.4)] btn-pulse"
                >
                  {isSubmitting ? <RefreshCw size={18} className="animate-spin" /> : (editingUserId ? <Save size={18} /> : <Plus size={18} />)}
                  {editingUserId ? 'ပြင်ဆင်ချက်များ သိမ်းမည်' : 'အသုံးပြုသူသစ် ဖန်တီးမည်'}
                </button>
                
                {editingUserId && (
                  <button
                    type="button"
                    onClick={handleCancelEdit}
                    className="w-full py-3 bg-slate-100 dark:bg-slate-800 text-slate-500 rounded-xl font-bold hover:bg-slate-200 dark:hover:bg-slate-700 transition-all flex items-center justify-center gap-2 font-mono uppercase tracking-widest text-[10px]"
                  >
                    <XCircle size={14} /> မလုပ်တော့ပါ (Cancel)
                  </button>
                )}
              </div>
            </form>
          </div>
        </div>

        {/* List Table */}
        <div className="lg:col-span-8">
          <div className="bg-white/50 backdrop-blur dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 sm:p-6 shadow-2xl transition-colors duration-300">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
              <div className="flex items-center gap-3">
                <Key className="text-brand-purple" size={20} />
                <h3 className="text-lg font-bold text-slate-900 dark:text-white">လက်ရှိ အသုံးပြုသူ ID များ</h3>
                <span className="px-2 py-0.5 bg-brand-purple/20 text-brand-purple border border-brand-purple/30 rounded-lg text-[9px] font-bold uppercase">
                  စုစုပေါင်း {authorizedUsers.length} ခု
                </span>
              </div>

              <div className="relative flex-1 max-w-full md:max-w-xs">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
                <input
                  type="text"
                  placeholder="ID သို့မဟုတ် မှတ်ချက်ဖြင့် ရှာဖွေရန်..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg pl-10 pr-4 py-2.5 text-xs text-slate-900 dark:text-slate-200 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-purple/50 transition-all"
                />
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
                      <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-widest">ID</th>
                      <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-widest">အမည်</th>
                      <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Role</th>
                      <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-widest">ဖန်တီးသည့်ရက်</th>
                      <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-widest">သက်တမ်းကုန်ရက်</th>
                      <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-widest text-right">လုပ်ဆောင်ချက် (Actions)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-white/5">
                    {filteredUsers.map((u) => (
                      <tr key={u.id} className="hover:bg-slate-50 dark:hover:bg-white/5 transition-colors group">
                        <td className="px-4 py-4">
                          <span className="font-mono text-sm text-slate-900 dark:text-white bg-slate-100 dark:bg-white/5 px-2 py-1 rounded border border-slate-200 dark:border-white/10">{u.id}</span>
                        </td>
                        <td className="px-4 py-4">
                          <span className="text-sm text-slate-700 dark:text-slate-300">{u.note || '—'}</span>
                        </td>
                        <td className="px-4 py-4">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border ${u.role === 'admin' ? 'bg-brand-purple/20 text-brand-purple border-brand-purple/30' : 'bg-slate-100 dark:bg-white/10 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-white/10'}`}>
                            {u.role === 'admin' ? 'အက်ဒမင်' : 'အသုံးပြုသူ'}
                          </span>
                        </td>
                        <td className="px-4 py-4">
                          <div className="flex items-center gap-2 text-xs text-slate-500">
                            <Calendar size={12} />
                            {new Date(u.createdAt).toLocaleDateString()}
                          </div>
                        </td>
                        <td className="px-4 py-4">
                          <div className="flex items-center gap-2 text-xs text-slate-500">
                            <Calendar size={12} />
                            {u.expiryDate ? new Date(u.expiryDate).toLocaleDateString() : 'မရှိပါ'}
                          </div>
                        </td>
                        <td className="px-4 py-4 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => handleEditId(u)}
                              className="p-2 text-slate-500 hover:text-brand-purple hover:bg-brand-purple/10 rounded-lg transition-all"
                              title="ပြင်ဆင်မည်"
                            >
                              <Edit3 size={16} />
                            </button>
                            <button
                              onClick={() => handleToggleRole(u.id, u.role || 'user')}
                              className="p-2 text-slate-500 hover:text-brand-purple hover:bg-brand-purple/10 rounded-lg transition-all"
                              title="အဆင့်ပြောင်းရန်"
                            >
                              <Shield size={16} />
                            </button>
                            <button
                              onClick={() => handleToggleStatus(u.id, u.isActive)}
                              className={`p-2 rounded-lg transition-all ${u.isActive ? 'text-amber-500 hover:bg-amber-500/10' : 'text-emerald-500 hover:bg-emerald-500/10'}`}
                              title={u.isActive ? 'ပိတ်ရန်' : 'ဖွင့်ရန်'}
                            >
                              <RefreshCw size={16} />
                            </button>
                            <button
                              onClick={() => handleDeleteId(u.id)}
                              disabled={isDeletingUser === u.id}
                              className="p-2 text-red-500 hover:bg-red-500/10 rounded-lg transition-all disabled:opacity-50"
                              title="ဖျက်မည်"
                            >
                              {isDeletingUser === u.id ? <RefreshCw size={16} className="animate-spin" /> : <Trash2 size={16} />}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {filteredUsers.length === 0 && (
                      <tr>
                        <td colSpan={6} className="py-10 text-center text-slate-500 italic text-sm">
                          ရှာဖွေမှုနှင့် ကိုက်ညီသော အသုံးပြုသူ မရှိပါ။
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Registered Users Section */}
          <div className="bg-white/50 backdrop-blur dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-2xl mt-8 transition-colors duration-300">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
              <div className="flex items-center gap-3">
                <User className="text-brand-purple" size={20} />
                <h3 className="text-lg font-bold text-slate-900 dark:text-white">မှတ်ပုံတင်ထားသော အသုံးပြုသူများ</h3>
                <span className="px-2 py-0.5 bg-brand-purple/20 text-brand-purple border border-brand-purple/30 rounded-lg text-[10px] font-bold uppercase">
                  စုစုပေါင်း {registeredUsers.length} ဦး
                </span>
              </div>
            </div>

            {isUsersLoading ? (
              <div className="flex items-center justify-center py-20">
                <div className="w-8 h-8 border-2 border-brand-purple/20 border-t-brand-purple rounded-full animate-spin" />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-white/5">
                      <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-widest">အသုံးပြုသူ</th>
                      <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-widest">အဆင့်</th>
                      <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-widest">အတည်ပြုချက်</th>
                      <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-widest">စတင်ဝင်ရောက်သည့်ရက်</th>
                      <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-widest">နောက်ဆုံးဝင်ရောက်မှု</th>
                      <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-widest text-right">လုပ်ဆောင်ချက်</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-white/5">
                    {registeredUsers.map((user) => (
                      <tr key={user.uid} className="hover:bg-slate-50 dark:hover:bg-white/5 transition-colors group">
                        <td className="px-4 py-4">
                          <div className="flex flex-col">
                            <span className="text-sm text-slate-900 dark:text-white font-medium">{user.email}</span>
                            <span className="text-[10px] text-slate-500 font-mono">{user.uid}</span>
                          </div>
                        </td>
                        <td className="px-4 py-4">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border ${user.role === 'admin' ? 'bg-brand-purple/20 text-brand-purple border-brand-purple/30' : 'bg-slate-100 dark:bg-white/10 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-white/10'}`}>
                            {user.role === 'admin' ? 'အက်ဒမင်' : 'အသုံးပြုသူ'}
                          </span>
                        </td>
                        <td className="px-4 py-4">
                          {user.is_verified ? (
                            <span className="flex items-center gap-1.5 text-emerald-500 text-[10px] font-bold uppercase">
                              <CheckCircle2 size={12} /> အတည်ပြုပြီး
                            </span>
                          ) : user.pending_verification ? (
                            <span className="flex items-center gap-1.5 text-amber-500 text-[10px] font-bold uppercase">
                              <RefreshCw size={12} className="animate-spin" /> စောင့်ဆိုင်းဆဲ
                            </span>
                          ) : (
                            <span className="flex items-center gap-1.5 text-slate-500 text-[10px] font-bold uppercase">
                              <XCircle size={12} /> အတည်မပြုရသေး
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-4">
                          <div className="flex flex-col">
                            <span className="text-[10px] text-slate-500 dark:text-slate-400 font-mono">{formatDate(user.createdAt)}</span>
                          </div>
                        </td>
                        <td className="px-4 py-4">
                          <div className="flex flex-col">
                            <span className="text-[10px] text-slate-500 dark:text-slate-400 font-mono">{formatDate(user.lastSignInAt)}</span>
                          </div>
                        </td>
                        <td className="px-4 py-4 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={() => handleToggleRegisteredUserRole(user.uid, user.role)}
                              className="p-2 text-slate-500 hover:text-brand-purple hover:bg-brand-purple/10 rounded-lg transition-all"
                              title="အဆင့်ပြောင်းရန်"
                            >
                              <Shield size={16} />
                            </button>
                            {!user.is_verified && (
                              <button
                                onClick={() => handleVerifyUser(user.uid)}
                                disabled={isVerifyingUser === user.uid}
                                className="px-3 py-1.5 bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500 hover:text-white border border-emerald-500/20 rounded-lg text-[10px] font-bold uppercase transition-all disabled:opacity-50 flex items-center gap-2"
                              >
                                {isVerifyingUser === user.uid && <RefreshCw size={12} className="animate-spin" />}
                                အတည်ပြုမည်
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                    {registeredUsers.length === 0 && (
                      <tr>
                        <td colSpan={6} className="py-10 text-center text-slate-500 italic text-sm">
                          မှတ်ပုံတင်ထားသော အသုံးပြုသူ မရှိသေးပါ။
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
        <div className="bg-white/50 backdrop-blur dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl transition-colors duration-300 neon-border-blue">
          <div className="flex items-center gap-3 mb-8">
            <Settings className="text-brand-purple" size={24} />
            <h3 className="text-xl font-bold text-slate-900 dark:text-white font-mono uppercase tracking-tighter">စနစ်ဆိုင်ရာ API Keys များ</h3>
          </div>

          <form onSubmit={(e) => e.preventDefault()} className="space-y-8">
            {/* System Live Switch */}
            <div className="p-6 bg-slate-50 dark:bg-slate-950/50 rounded-2xl border border-slate-200 dark:border-slate-800 flex items-center justify-between group transition-all duration-500 hover:border-brand-purple/30">
              <div className="space-y-1">
                <h4 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full animate-pulse ${systemConfig.system_live ? 'bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.8)]' : 'bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.8)]'}`} />
                  စနစ်ကို အသုံးပြုခွင့်ပေးမည်
                </h4>
                <p className="text-[10px] text-slate-500 font-medium uppercase tracking-wider">Enable System for Users</p>
              </div>
              <button
                type="button"
                onClick={() => setSystemConfig({ ...systemConfig, system_live: !systemConfig.system_live })}
                className={`relative w-14 h-7 rounded-full transition-all duration-500 p-1 ${
                  systemConfig.system_live 
                    ? 'bg-green-500 shadow-[0_0_15px_rgba(34,197,94,0.4)]' 
                    : 'bg-slate-300 dark:bg-slate-800'
                }`}
              >
                <div className={`w-5 h-5 bg-white rounded-full shadow-lg transition-all duration-500 transform ${
                  systemConfig.system_live ? 'translate-x-7' : 'translate-x-0'
                }`} />
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {/* RapidAPI Key */}
              <div className="space-y-3">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest px-1 font-mono flex items-center gap-2">
                  <Database size={12} /> RapidAPI Key (YouTube Transcript အတွက်)
                </label>
                <div className="relative">
                  <Key className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                  <input
                    type={showRapidKey ? "text" : "password"}
                    value={systemConfig.rapidapi_key || ''}
                    onChange={(e) => setSystemConfig({ ...systemConfig, rapidapi_key: e.target.value })}
                    placeholder="RapidAPI Key ထည့်ပါ"
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl pl-12 pr-12 py-4 text-sm text-slate-900 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-purple/50 transition-all font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowRapidKey(!showRapidKey)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 hover:text-brand-purple transition-colors"
                  >
                    {showRapidKey ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>

              {/* Gemini API Key */}
              <div className="space-y-3">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest px-1 font-mono flex items-center gap-2">
                  <Send size={12} /> Gemini API Key (AI စနစ်အတွက်)
                </label>
                <div className="relative">
                  <Key className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                  <input
                    type={showGeminiKey ? "text" : "password"}
                    value={systemConfig.gemini_api_key || ''}
                    onChange={(e) => setSystemConfig({ ...systemConfig, gemini_api_key: e.target.value })}
                    placeholder="Gemini API Key ထည့်ပါ"
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl pl-12 pr-12 py-4 text-sm text-slate-900 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-purple/50 transition-all font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowGeminiKey(!showGeminiKey)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 hover:text-brand-purple transition-colors"
                  >
                    {showGeminiKey ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>

              {/* OpenAI API Key */}
              <div className="space-y-3">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest px-1 font-mono flex items-center gap-2">
                  <Send size={12} /> OpenAI API Key (TTS အတွက်)
                </label>
                <div className="relative">
                  <Key className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                  <input
                    type={showOpenAIKey ? "text" : "password"}
                    value={systemConfig.openai_api_key || ''}
                    onChange={(e) => setSystemConfig({ ...systemConfig, openai_api_key: e.target.value })}
                    placeholder="OpenAI API Key ထည့်ပါ"
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl pl-12 pr-12 py-4 text-sm text-slate-900 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-purple/50 transition-all font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowOpenAIKey(!showOpenAIKey)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 hover:text-brand-purple transition-colors"
                  >
                    {showOpenAIKey ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>
            </div>

            <div className="pt-6 border-t border-slate-200 dark:border-white/5">
              <button
                type="button"
                onClick={handleSaveSystemConfig}
                disabled={isSavingSystem}
                className="px-8 py-4 bg-brand-purple text-white rounded-xl font-bold hover:bg-brand-purple/90 transition-all shadow-lg shadow-brand-purple/20 flex items-center gap-3 disabled:opacity-50 active:scale-95 font-mono uppercase tracking-widest hover:shadow-[0_0_20px_rgba(168,85,247,0.4)] btn-pulse"
              >
                {isSavingSystem ? <RefreshCw size={20} className="animate-spin" /> : <Save size={20} />}
                ပြင်ဆင်ချက်များ သိမ်းဆည်းမည်
              </button>
            </div>
          </form>
        </div>
      )}

      {activeTab === 'rules' && (
        <div className="space-y-8">
          <div className="bg-white/50 backdrop-blur dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl transition-colors duration-300 neon-border-purple">
            <div className="flex items-center gap-3 mb-8">
              <Languages className="text-brand-purple" size={24} />
              <h3 className="text-xl font-bold text-slate-900 dark:text-white font-mono uppercase tracking-tighter">
                {editingRuleId ? 'စည်းမျဉ်း ပြင်ဆင်ရန်' : 'စည်းမျဉ်းအသစ် ထည့်ရန်'}
              </h3>
            </div>

            <form onSubmit={handleCreateRule} className="grid grid-cols-1 md:grid-cols-12 gap-6 items-end">
              <div className="md:col-span-5 space-y-2">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest px-1 font-mono">မူရင်းစာသား (Original)</label>
                <input
                  type="text"
                  value={newRuleOriginal}
                  onChange={(e) => setNewRuleOriginal(e.target.value)}
                  placeholder="ဥပမာ - ChatGPT"
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-4 text-sm text-slate-900 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-purple/50 transition-all font-mono"
                  required
                />
              </div>
              <div className="md:col-span-5 space-y-2">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest px-1 font-mono">အစားထိုးရန် (Replacement)</label>
                <input
                  type="text"
                  value={newRuleReplacement}
                  onChange={(e) => setNewRuleReplacement(e.target.value)}
                  placeholder="ဥပမာ - ချတ် ဂျီပီတီ"
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-4 text-sm text-slate-900 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-purple/50 transition-all font-mono"
                  required
                />
              </div>
              <div className="md:col-span-2 flex gap-2">
                <button
                  type="submit"
                  disabled={isSavingRule}
                  className="flex-1 py-4 bg-brand-purple text-white rounded-xl font-bold hover:bg-brand-purple/90 transition-all shadow-lg shadow-brand-purple/20 flex items-center justify-center gap-2 disabled:opacity-50 active:scale-95 font-mono uppercase tracking-widest btn-pulse"
                >
                  {isSavingRule ? <RefreshCw size={18} className="animate-spin" /> : editingRuleId ? <Save size={18} /> : <Plus size={18} />}
                  {editingRuleId ? 'သိမ်းမည်' : 'ထည့်မည်'}
                </button>
                {editingRuleId && (
                  <button
                    type="button"
                    onClick={cancelEditRule}
                    className="p-4 bg-slate-100 dark:bg-slate-800 text-slate-500 rounded-xl hover:bg-slate-200 dark:hover:bg-slate-700 transition-all"
                  >
                    <XCircle size={18} />
                  </button>
                )}
              </div>
            </form>
          </div>

          <div className="bg-white/50 backdrop-blur dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-2xl transition-colors duration-300">
            <div className="flex items-center gap-3 mb-6">
              <Database className="text-brand-purple" size={20} />
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">လက်ရှိ စည်းမျဉ်းများ</h3>
              <span className="px-2 py-0.5 bg-brand-purple/20 text-brand-purple border border-brand-purple/30 rounded-lg text-[10px] font-bold uppercase">
                {rules.length} ခု
              </span>
            </div>

            {isRulesLoading ? (
              <div className="flex items-center justify-center py-20">
                <div className="w-8 h-8 border-2 border-brand-purple/20 border-t-brand-purple rounded-full animate-spin" />
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {rules.map((rule) => (
                  <div key={rule.id} className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 flex items-center justify-between group hover:border-brand-purple/30 transition-all">
                    <div className="flex flex-col">
                      <span className="text-xs font-bold text-slate-900 dark:text-white font-mono">{rule.original}</span>
                      <span className="text-[10px] text-slate-500 font-mono mt-1">→ {rule.replacement}</span>
                    </div>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => handleEditRule(rule)}
                        className="p-2 text-slate-400 hover:text-brand-purple hover:bg-brand-purple/10 rounded-lg transition-all"
                      >
                        <Edit3 size={14} />
                      </button>
                      <button
                        onClick={() => handleDeleteRule(rule.id)}
                        disabled={isDeletingRule === rule.id}
                        className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-500/10 rounded-lg transition-all"
                      >
                        {isDeletingRule === rule.id ? <RefreshCw size={14} className="animate-spin" /> : <Trash2 size={14} />}
                      </button>
                    </div>
                  </div>
                ))}
                {rules.length === 0 && (
                  <div className="col-span-full py-10 text-center text-slate-500 italic text-sm">
                    စည်းမျဉ်းများ မရှိသေးပါ။
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
      </div>

      {toast.isVisible && (
        <Toast 
          message={toast.message} 
          type={toast.type} 
          isVisible={toast.isVisible}
          onClose={() => setToast(prev => ({ ...prev, isVisible: false }))} 
        />
      )}
    </>
  );
};

export default AdminDashboard;

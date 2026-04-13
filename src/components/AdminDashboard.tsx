import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { 
  ShieldCheck, 
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
  Mic2,
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
  Edit3
} from 'lucide-react';
import { AuthorizedUser, User as RegisteredUser, SystemConfig, PronunciationRule, GlobalSettings } from '../types';
import { db, collection, onSnapshot, query, orderBy, setDoc, doc, deleteDoc, updateDoc, handleFirestoreError, OperationType, getDoc, auth, googleProvider, signInWithPopup } from '../firebase';
import { Toast, ToastType } from './Toast';
import { Modal, ModalType } from './Modal';

interface AdminDashboardProps {
  isAuthReady: boolean;
  onAdminLogin?: (code: string) => void;
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({ isAuthReady, onAdminLogin }) => {
  const [authorizedUsers, setAuthorizedUsers] = useState<AuthorizedUser[]>([]);
  const [registeredUsers, setRegisteredUsers] = useState<RegisteredUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isUsersLoading, setIsUsersLoading] = useState(true);
  const [newId, setNewId] = useState('');
  const [newNote, setNewNote] = useState('');
  const [newRole, setNewRole] = useState<'admin' | 'user'>('user');
  const [newExpiryDate, setNewExpiryDate] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeletingUser, setIsDeletingUser] = useState<string | null>(null);
  const [isVerifyingUser, setIsVerifyingUser] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [newPassword, setNewPassword] = useState('');
  
  // Toast State
  const [toast, setToast] = useState<{ message: string; type: ToastType; isVisible: boolean }>({
    message: '',
    type: 'success',
    isVisible: false
  });
  
  // Admin Auth Protection
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [adminIdInput, setAdminIdInput] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'users' | 'system' | 'rules'>('users');

  // System Settings State
  const [systemConfig, setSystemConfig] = useState<SystemConfig>({
    firebase_project_id: '',
    firebase_api_key: '',
    firebase_auth_domain: '',
    firebase_app_id: '',
    telegram_bot_token: '',
    telegram_chat_id: ''
  });
  const [globalSettings, setGlobalSettings] = useState<GlobalSettings>({
    allow_admin_keys: false,
    total_generations: 0,
    api_keys: ['']
  });
  const [isSavingSystem, setIsSavingSystem] = useState(false);
  const [isSavingKeys, setIsSavingKeys] = useState(false);
  const [isSystemLoading, setIsSystemLoading] = useState(true);
  const [showSecrets, setShowSecrets] = useState(false);

  // Pronunciation Rules State
  const [rules, setRules] = useState<PronunciationRule[]>([]);
  const [newRuleOriginal, setNewRuleOriginal] = useState('');
  const [newRuleReplacement, setNewRuleReplacement] = useState('');
  const [isSavingRule, setIsSavingRule] = useState(false);
  const [isDeletingRule, setIsDeletingRule] = useState<string | null>(null);
  const [isRulesLoading, setIsRulesLoading] = useState(true);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [isSessionSynced, setIsSessionSynced] = useState(false);

  // Modal State
  const [modal, setModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    type: ModalType;
    confirmText?: string;
    cancelText?: string;
    placeholder?: string;
    defaultValue?: string;
    inputType?: 'text' | 'password' | 'date';
    onConfirm?: (value?: string) => void;
  }>({
    isOpen: false,
    title: '',
    message: '',
    type: 'alert',
  });

  const openModal = (config: Partial<Omit<typeof modal, 'isOpen'>> & { title: string; message: string }) => {
    setModal({
      isOpen: true,
      title: config.title,
      message: config.message,
      type: config.type || 'alert',
      confirmText: config.confirmText || 'Confirm',
      cancelText: config.cancelText || 'Cancel',
      placeholder: config.placeholder || 'Enter value...',
      defaultValue: config.defaultValue || '',
      inputType: config.inputType || 'text',
      onConfirm: config.onConfirm,
    });
  };

  useEffect(() => {
    const savedAdminAuth = localStorage.getItem('vbs_admin_auth');
    if (savedAdminAuth === 'saw_vlogs_2026') {
      setIsAuthenticated(true);
      
      // Ensure session is synced on mount if already authenticated
      if (isAuthReady && auth.currentUser) {
        setDoc(doc(db, 'sessions', auth.currentUser.uid), {
          accessCode: 'saw_vlogs_2026',
          createdAt: new Date().toISOString()
        })
        .then(() => {
          setIsSessionSynced(true);
          if (onAdminLogin) onAdminLogin('saw_vlogs_2026');
        })
        .catch(err => {
          console.error('Failed to sync admin session on mount:', err);
          // Still set synced if it's a permission error on the session itself (unlikely)
          // but we want to try listing anyway if we think we are admin
          setIsSessionSynced(true); 
          if (onAdminLogin) onAdminLogin('saw_vlogs_2026');
        });
      } else if (isAuthReady) {
        setIsSessionSynced(true);
        if (onAdminLogin) onAdminLogin('saw_vlogs_2026');
      }
    }
  }, [isAuthReady]);

  const formatDate = (date: any) => {
    if (!date) return 'N/A';
    try {
      if (date && typeof date === 'object' && 'toDate' in date) {
        return date.toDate().toLocaleString();
      }
      return new Date(date).toLocaleString();
    } catch (e) {
      return 'Invalid Date';
    }
  };

  const handleAdminAuth = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setAuthError(null);
    
    if (adminIdInput === 'saw_vlogs_2026') {
      setIsAuthenticated(true);
      localStorage.setItem('vbs_admin_auth', 'saw_vlogs_2026');
      localStorage.setItem('vbs_access_granted', 'true');
      localStorage.setItem('vbs_access_code', 'saw_vlogs_2026');
      
      // Sync session for security rules
      if (auth.currentUser) {
        try {
          await setDoc(doc(db, 'sessions', auth.currentUser.uid), {
            accessCode: 'saw_vlogs_2026',
            createdAt: new Date().toISOString()
          });
          console.log('Admin session synced successfully.');
          setIsSessionSynced(true);
          if (onAdminLogin) onAdminLogin('saw_vlogs_2026');
        } catch (e) {
          console.error('Failed to sync admin session:', e);
          setIsSessionSynced(true); // Proceed anyway
          if (onAdminLogin) onAdminLogin('saw_vlogs_2026');
        }
      } else {
        setIsSessionSynced(true);
        if (onAdminLogin) onAdminLogin('saw_vlogs_2026');
      }
      
      setToast({
        message: 'Admin Access Granted! 🛡️',
        type: 'success',
        isVisible: true
      });
    } else {
      setAuthError("Unauthorized Access: Admin Only");
      setToast({
        message: 'Unauthorized Access: Admin Only',
        type: 'error',
        isVisible: true
      });
    }
  };

  const handleAdminLogout = () => {
    setIsAuthenticated(false);
    localStorage.removeItem('vbs_admin_auth');
  };

  useEffect(() => {
    if (!isAuthenticated || !isAuthReady || !isSessionSynced) return;

    const q = query(collection(db, 'vlogs_users'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const users = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      } as AuthorizedUser));
      setAuthorizedUsers(users);
      setIsLoading(false);
    }, (err) => {
      setIsLoading(false);
      handleFirestoreError(err, OperationType.LIST, 'vlogs_users');
    });

    return () => unsubscribe();
  }, [isAuthenticated, isAuthReady, isSessionSynced]);

  useEffect(() => {
    if (!isAuthenticated || !isAuthReady || !isSessionSynced) return;

    const q = query(collection(db, 'users'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const users = snapshot.docs.map(doc => ({
        uid: doc.id,
        ...doc.data()
      } as RegisteredUser));
      setRegisteredUsers(users);
      setIsUsersLoading(false);
    }, (err) => {
      setIsUsersLoading(false);
      handleFirestoreError(err, OperationType.LIST, 'users');
    });

    return () => unsubscribe();
  }, [isAuthenticated, isAuthReady, isSessionSynced]);

  useEffect(() => {
    if (!isAuthenticated || !isAuthReady || !isSessionSynced) return;

    const unsubscribe = onSnapshot(collection(db, 'globalRules'), (snapshot) => {
      const fetchedRules = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as PronunciationRule[];
      setRules(fetchedRules);
      setIsRulesLoading(false);
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, 'globalRules');
      setIsRulesLoading(false);
    });

    return () => unsubscribe();
  }, [isAuthenticated, isAuthReady, isSessionSynced]);

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
    // Scroll to form
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const cancelEditRule = () => {
    setNewRuleOriginal('');
    setNewRuleReplacement('');
    setEditingRuleId(null);
  };

  const handleDeleteRule = async (id: string) => {
    openModal({
      title: 'Delete Rule',
      message: 'Are you sure you want to delete this pronunciation rule?',
      type: 'confirm',
      confirmText: 'Delete',
      onConfirm: async () => {
        setIsDeletingRule(id);
        try {
          await deleteDoc(doc(db, 'globalRules', id));
          setToast({ message: 'Rule deleted', type: 'success', isVisible: true });
        } catch (error) {
          handleFirestoreError(error, OperationType.DELETE, `globalRules/${id}`);
          setToast({ message: 'Failed to delete rule', type: 'error', isVisible: true });
        } finally {
          setIsDeletingRule(null);
        }
      }
    });
  };

  useEffect(() => {
    if (!isAuthenticated || !isAuthReady) return;

    const fetchSystemConfig = async () => {
      setIsSystemLoading(true);
      try {
        const docRef = doc(db, 'system_config', 'main');
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          setSystemConfig(docSnap.data() as SystemConfig);
        }

        const globalRef = doc(db, 'settings', 'global');
        const globalSnap = await getDoc(globalRef);
        if (globalSnap.exists()) {
          const data = globalSnap.data() as GlobalSettings;
          setGlobalSettings({
            ...data,
            api_keys: data.api_keys || ['']
          });
        }
      } catch (err) {
        console.error('Failed to fetch system config:', err);
      } finally {
        setIsSystemLoading(false);
      }
    };

    fetchSystemConfig();
  }, [isAuthenticated, isAuthReady]);

  const handleSaveSystemConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingSystem(true);
    try {
      await setDoc(doc(db, 'system_config', 'main'), {
        ...systemConfig,
        updatedAt: new Date().toISOString()
      });
      
      // Save to localStorage for immediate effect on next reload
      localStorage.setItem('vbs_system_config', JSON.stringify(systemConfig));
      
      setToast({
        message: 'System Settings Saved Successfully! 🚀',
        type: 'success',
        isVisible: true
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'system_config/main');
      setToast({
        message: 'Failed to save system settings.',
        type: 'error',
        isVisible: true
      });
    } finally {
      setIsSavingSystem(false);
    }
  };

  const handleSaveGlobalSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingKeys(true);
    try {
      await setDoc(doc(db, 'settings', 'global'), {
        ...globalSettings,
        updatedAt: new Date().toISOString()
      });
      setToast({
        message: 'API Key Settings Saved! 🔑',
        type: 'success',
        isVisible: true
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'settings/global');
      setToast({
        message: 'Failed to save API key settings.',
        type: 'error',
        isVisible: true
      });
    } finally {
      setIsSavingKeys(false);
    }
  };

  const generateRandomPassword = () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
    let password = '';
    for (let i = 0; i < 12; i++) {
      password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    setNewPassword(password);
  };

  const handleCreateId = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newId.trim() || isSubmitting) return;

    setIsSubmitting(true);

    try {
      const accessCode = newId.trim();
      const newAuthorizedUser = {
        id: accessCode, // Include id
        userId: accessCode, // Explicitly set userId as requested
        isActive: true,
        createdAt: new Date().toISOString(),
        note: newNote.trim(),
        role: newRole,
        password: newPassword.trim() || null,
        expiryDate: newExpiryDate || null
      };

      await setDoc(doc(db, 'vlogs_users', accessCode), newAuthorizedUser);
      
      setNewId('');
      setNewNote('');
      setNewPassword('');
      setNewExpiryDate('');
      setNewRole('user');
      setToast({
        message: 'User ID Created Successfully! 🎉',
        type: 'success',
        isVisible: true
      });
    } catch (err: any) {
      handleFirestoreError(err, OperationType.CREATE, `vlogs_users/${newId.trim()}`);
      setToast({
        message: 'Error: Could not create ID. Please try again.',
        type: 'error',
        isVisible: true
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUpdatePassword = async (id: string) => {
    openModal({
      title: 'Update Password',
      message: 'Enter a new password for this user:',
      type: 'prompt',
      inputType: 'password',
      placeholder: 'New password...',
      confirmText: 'Update',
      onConfirm: async (password) => {
        if (!password) return;
        try {
          await updateDoc(doc(db, 'vlogs_users', id), {
            password: password.trim() || null
          });
          setToast({
            message: 'User Password Updated!',
            type: 'success',
            isVisible: true
          });
        } catch (err) {
          handleFirestoreError(err, OperationType.UPDATE, `vlogs_users/${id}`);
          setToast({
            message: 'Failed to update user password.',
            type: 'error',
            isVisible: true
          });
        }
      }
    });
  };

  const handleExtendExpiry = async (id: string, currentExpiry: string | undefined) => {
    try {
      const now = new Date();
      let baseDate = now;
      
      if (currentExpiry) {
        const current = new Date(currentExpiry);
        if (current > now) {
          baseDate = current;
        }
      }
      
      const newExpiry = new Date(baseDate);
      newExpiry.setDate(newExpiry.getDate() + 30);
      
      await updateDoc(doc(db, 'vlogs_users', id), {
        expiryDate: newExpiry.toISOString()
      });
      
      setToast({
        message: 'Subscription Extended 30 Days! 📅',
        type: 'success',
        isVisible: true
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `vlogs_users/${id}`);
      setToast({
        message: 'Failed to extend subscription.',
        type: 'error',
        isVisible: true
      });
    }
  };

  const handleSetCustomExpiry = async (id: string) => {
    openModal({
      title: 'Set Expiry Date',
      message: 'Enter custom expiry date (YYYY-MM-DD):',
      type: 'prompt',
      inputType: 'date',
      confirmText: 'Set Expiry',
      onConfirm: async (dateStr) => {
        if (!dateStr) return;
        
        try {
          const date = new Date(dateStr);
          if (isNaN(date.getTime())) {
            openModal({
              title: 'Invalid Date',
              message: 'Invalid date format. Please use YYYY-MM-DD.',
              type: 'error'
            });
            return;
          }
          
          await updateDoc(doc(db, 'vlogs_users', id), {
            expiryDate: date.toISOString()
          });
          
          setToast({
            message: 'Custom Expiry Date Set! 📅',
            type: 'success',
            isVisible: true
          });
        } catch (err) {
          handleFirestoreError(err, OperationType.UPDATE, `vlogs_users/${id}`);
          setToast({
            message: 'Failed to set custom expiry date.',
            type: 'error',
            isVisible: true
          });
        }
      }
    });
  };

  const handleToggleStatus = async (id: string, currentStatus: boolean) => {
    try {
      await updateDoc(doc(db, 'vlogs_users', id), {
        isActive: !currentStatus
      });
      setToast({
        message: 'User Status Updated!',
        type: 'success',
        isVisible: true
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `vlogs_users/${id}`);
      setToast({
        message: 'Failed to update user status.',
        type: 'error',
        isVisible: true
      });
    }
  };

  const handleToggleRole = async (id: string, currentRole: 'admin' | 'user') => {
    try {
      await updateDoc(doc(db, 'vlogs_users', id), {
        role: currentRole === 'admin' ? 'user' : 'admin'
      });
      setToast({
        message: 'User Role Updated!',
        type: 'success',
        isVisible: true
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `vlogs_users/${id}`);
      setToast({
        message: 'Failed to update user role.',
        type: 'error',
        isVisible: true
      });
    }
  };

  const handleDeleteId = async (id: string) => {
    openModal({
      title: 'Delete User ID',
      message: `Are you sure you want to delete Access Code: ${id}?`,
      type: 'confirm',
      confirmText: 'Delete',
      onConfirm: async () => {
        setIsDeletingUser(id);
        try {
          await deleteDoc(doc(db, 'vlogs_users', id));
          setToast({
            message: 'User ID Deleted Successfully!',
            type: 'success',
            isVisible: true
          });
        } catch (err) {
          handleFirestoreError(err, OperationType.DELETE, `vlogs_users/${id}`);
          setToast({
            message: 'Failed to delete User ID.',
            type: 'error',
            isVisible: true
          });
        } finally {
          setIsDeletingUser(null);
        }
      }
    });
  };

  const handleVerifyUser = async (uid: string) => {
    setIsVerifyingUser(uid);
    try {
      await updateDoc(doc(db, 'users', uid), {
        is_verified: true,
        pending_verification: false
      });
      setToast({
        message: 'User Verified Successfully! 🎉',
        type: 'success',
        isVisible: true
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${uid}`);
      setToast({
        message: 'Failed to verify user.',
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
        message: `User role updated to ${currentRole === 'admin' ? 'user' : 'admin'}! 🎉`,
        type: 'success',
        isVisible: true
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${uid}`);
      setToast({
        message: 'Failed to update user role.',
        type: 'error',
        isVisible: true
      });
    }
  };

  const filteredUsers = authorizedUsers.filter(u => 
    u.id.toLowerCase().includes(searchQuery.toLowerCase()) || 
    (u.note || '').toLowerCase().includes(searchQuery.toLowerCase())
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
            <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">Enter Admin ID to continue</p>
          </div>

          <form onSubmit={handleAdminAuth} className="space-y-6">
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest px-1">Admin ID</label>
              <div className="relative">
                <Shield className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={20} />
                <input
                  type="password"
                  value={adminIdInput}
                  onChange={(e) => setAdminIdInput(e.target.value)}
                  placeholder="Enter Admin ID"
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl pl-12 pr-4 py-4 text-sm text-slate-900 dark:text-slate-200 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-purple/50 transition-all"
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
              <ShieldCheck size={20} /> Verify Access
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
              <p className="text-slate-500 dark:text-slate-400 text-xs sm:text-sm mt-1">Manage Authorized Access Codes (User IDs)</p>
            </div>
          </div>
          <div className="flex items-center gap-2 sm:gap-3 w-full sm:w-auto overflow-hidden">
            <div className="flex flex-nowrap overflow-x-auto no-scrollbar bg-slate-100 dark:bg-slate-900/50 p-1 rounded-xl border border-slate-200 dark:border-slate-800 flex-1 sm:flex-initial">
              <button
                onClick={() => {
                  window.history.pushState({}, '', '/');
                  window.dispatchEvent(new PopStateEvent('popstate'));
                }}
                className="px-3 sm:px-4 py-2 rounded-lg text-[10px] sm:text-xs font-bold transition-all flex items-center gap-1.5 sm:gap-2 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 whitespace-nowrap"
              >
                <Mic2 size={14} /> Generator
              </button>
              <button
                onClick={() => setActiveTab('users')}
                className={`px-3 sm:px-4 py-2 rounded-lg text-[10px] sm:text-xs font-bold transition-all flex items-center gap-1.5 sm:gap-2 whitespace-nowrap ${activeTab === 'users' ? 'bg-white dark:bg-slate-800 text-brand-purple shadow-sm' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
              >
                <User size={14} /> Users
              </button>
              <button
                onClick={() => setActiveTab('system')}
                className={`px-3 sm:px-4 py-2 rounded-lg text-[10px] sm:text-xs font-bold transition-all flex items-center gap-1.5 sm:gap-2 whitespace-nowrap ${activeTab === 'system' ? 'bg-white dark:bg-slate-800 text-brand-purple shadow-sm' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
              >
                <Settings size={14} /> System
              </button>
              <button
                onClick={() => setActiveTab('rules')}
                className={`px-3 sm:px-4 py-2 rounded-lg text-[10px] sm:text-xs font-bold transition-all flex items-center gap-1.5 sm:gap-2 whitespace-nowrap ${activeTab === 'rules' ? 'bg-white dark:bg-slate-800 text-brand-purple shadow-sm' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
              >
                <Languages size={14} /> Rules
              </button>
            </div>
            <button 
              onClick={handleAdminLogout}
              className="px-3 sm:px-4 py-2 sm:py-2.5 bg-slate-100 dark:bg-slate-900/50 hover:bg-slate-200 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-500 dark:text-slate-400 text-[10px] sm:text-sm font-bold transition-all whitespace-nowrap"
            >
              Lock
            </button>
          </div>
        </div>
      </div>

      {activeTab === 'users' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Create Form */}
        <div className="lg:col-span-4">
          <div className="bg-white/50 backdrop-blur dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 sm:p-6 shadow-2xl sticky top-8 transition-colors duration-300">
            <div className="flex items-center gap-3 mb-6">
              <UserPlus className="text-brand-purple" size={20} />
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">Create New User ID</h3>
            </div>

            <form onSubmit={handleCreateId} className="space-y-4">
              <div className="space-y-2">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest px-1">Access Code (User ID)</label>
                <div className="relative">
                  <Key className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                  <input
                    type="text"
                    value={newId}
                    onChange={(e) => setNewId(e.target.value)}
                    placeholder="e.g. USER-12345"
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl pl-12 pr-4 py-3.5 text-sm text-slate-900 dark:text-slate-200 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-purple/50 transition-all"
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest px-1">Note / Name (Optional)</label>
                <div className="relative">
                  <User className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                  <input
                    type="text"
                    value={newNote}
                    onChange={(e) => setNewNote(e.target.value)}
                    placeholder="e.g. Saw Yan Aung"
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl pl-12 pr-4 py-3.5 text-sm text-slate-900 dark:text-slate-200 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-purple/50 transition-all"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex justify-between items-center px-1">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Password (Optional)</label>
                  <button 
                    type="button"
                    onClick={generateRandomPassword}
                    className="text-[10px] font-bold text-brand-purple hover:underline flex items-center gap-1"
                  >
                    <RefreshCw size={10} /> Generate
                  </button>
                </div>
                <div className="relative">
                  <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                  <input
                    type="text"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Enter or generate password"
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl pl-12 pr-4 py-3.5 text-sm font-mono text-slate-900 dark:text-slate-200 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-purple/50 transition-all"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest px-1">Expiry Date (Optional)</label>
                <div className="relative">
                  <Calendar className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                  <input
                    type="date"
                    value={newExpiryDate}
                    onChange={(e) => setNewExpiryDate(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl pl-12 pr-4 py-3.5 text-sm text-slate-900 dark:text-slate-200 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-purple/50 transition-all"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest px-1">Initial Role</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setNewRole('user')}
                    className={`py-3 rounded-xl text-xs font-bold border transition-all ${newRole === 'user' ? 'bg-brand-purple border-brand-purple text-white' : 'bg-slate-100 dark:bg-slate-900/50 border-slate-200 dark:border-slate-800 text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-800'}`}
                  >
                    User
                  </button>
                  <button
                    type="button"
                    onClick={() => setNewRole('admin')}
                    className={`py-3 rounded-xl text-xs font-bold border transition-all ${newRole === 'admin' ? 'bg-brand-purple border-brand-purple text-white' : 'bg-slate-100 dark:bg-slate-900/50 border-slate-200 dark:border-slate-800 text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-800'}`}
                  >
                    Admin
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={isSubmitting || !newId.trim()}
                className="w-full py-4 bg-brand-purple text-white rounded-xl font-bold hover:bg-brand-purple/90 transition-all shadow-lg shadow-brand-purple/20 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed active:scale-95"
              >
                {isSubmitting ? <RefreshCw size={18} className="animate-spin" /> : <Plus size={18} />}
                Create User ID
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
                <h3 className="text-lg font-bold text-slate-900 dark:text-white">Existing User IDs</h3>
                <span className="px-2 py-0.5 bg-brand-purple/20 text-brand-purple border border-brand-purple/30 rounded-lg text-[9px] font-bold uppercase">
                  {authorizedUsers.length} Total
                </span>
              </div>

              <div className="relative flex-1 max-w-full md:max-w-xs">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
                <input
                  type="text"
                  placeholder="Search IDs or notes..."
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
                      <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Access Code</th>
                      <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Note</th>
                      <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Password</th>
                      <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Role</th>
                      <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Expiry Date</th>
                      <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Status</th>
                      <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-widest text-right">Actions</th>
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
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs text-slate-600 dark:text-slate-400">
                              {u.password ? '••••••••' : '—'}
                            </span>
                            {u.password && (
                              <button 
                                onClick={() => openModal({
                                  title: 'User Password',
                                  message: `Password for ${u.id}: ${u.password || 'No password set'}`,
                                  type: 'info'
                                })}
                                className="text-slate-400 hover:text-brand-purple"
                                title="View Password"
                              >
                                <Eye size={12} />
                              </button>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-4">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border ${u.role === 'admin' ? 'bg-brand-purple/20 text-brand-purple border-brand-purple/30' : 'bg-slate-100 dark:bg-white/10 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-white/10'}`}>
                            {u.role || 'user'}
                          </span>
                        </td>
                        <td className="px-4 py-4">
                          <div className="flex flex-col gap-1">
                            <div className="flex items-center gap-2 text-xs text-slate-500">
                              <Calendar size={12} />
                              {u.expiryDate ? (
                                <span className={new Date(u.expiryDate) < new Date() ? 'text-red-500 font-bold' : 'text-emerald-500'}>
                                  {new Date(u.expiryDate).toLocaleDateString()}
                                </span>
                              ) : (
                                <span>No Expiry</span>
                              )}
                            </div>
                            {u.expiryDate && new Date(u.expiryDate) < new Date() && (
                              <span className="text-[9px] text-red-500 font-bold uppercase tracking-tighter">Expired</span>
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
                              <XCircle size={12} /> Deactivated
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-4 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={() => handleExtendExpiry(u.id, u.expiryDate)}
                              className="p-2 text-slate-500 hover:text-emerald-500 hover:bg-emerald-500/10 rounded-lg transition-all"
                              title="Extend 30 Days"
                            >
                              <Calendar size={16} />
                            </button>
                            <button
                              onClick={() => handleSetCustomExpiry(u.id)}
                              className="p-2 text-slate-500 hover:text-brand-purple hover:bg-brand-purple/10 rounded-lg transition-all"
                              title="Set Custom Expiry"
                            >
                              <Edit3 size={16} />
                            </button>
                            <button
                              onClick={() => handleUpdatePassword(u.id)}
                              className="p-2 text-slate-500 hover:text-brand-purple hover:bg-brand-purple/10 rounded-lg transition-all"
                              title="Update Password"
                            >
                              <Lock size={16} />
                            </button>
                            <button
                              onClick={() => handleToggleRole(u.id, u.role || 'user')}
                              className="p-2 text-slate-500 hover:text-brand-purple hover:bg-brand-purple/10 rounded-lg transition-all"
                              title="Toggle Role"
                            >
                              <ShieldCheck size={16} />
                            </button>
                            <button
                              onClick={() => handleToggleStatus(u.id, u.isActive)}
                              className={`p-2 rounded-lg transition-all ${u.isActive ? 'text-amber-500 hover:bg-amber-500/10' : 'text-emerald-500 hover:bg-emerald-500/10'}`}
                              title={u.isActive ? 'Deactivate' : 'Activate'}
                            >
                              <RefreshCw size={16} />
                            </button>
                            <button
                              onClick={() => handleDeleteId(u.id)}
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
                        <td colSpan={6} className="py-10 text-center text-slate-500 italic text-sm">
                          No Access Codes found matching your search.
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
                <h3 className="text-lg font-bold text-slate-900 dark:text-white">Registered Users</h3>
                <span className="px-2 py-0.5 bg-brand-purple/20 text-brand-purple border border-brand-purple/30 rounded-lg text-[10px] font-bold uppercase">
                  {registeredUsers.length} Total
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
                      <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-widest">User</th>
                      <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Role</th>
                      <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Verification</th>
                      <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Joined</th>
                      <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Last Activity</th>
                      <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-widest text-right">Actions</th>
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
                            {user.role}
                          </span>
                        </td>
                        <td className="px-4 py-4">
                          {user.is_verified ? (
                            <span className="flex items-center gap-1.5 text-emerald-500 text-[10px] font-bold uppercase">
                              <CheckCircle2 size={12} /> Verified
                            </span>
                          ) : user.pending_verification ? (
                            <span className="flex items-center gap-1.5 text-amber-500 text-[10px] font-bold uppercase">
                              <RefreshCw size={12} className="animate-spin" /> Pending
                            </span>
                          ) : (
                            <span className="flex items-center gap-1.5 text-slate-500 text-[10px] font-bold uppercase">
                              <XCircle size={12} /> Not Verified
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
                              title="Toggle Role"
                            >
                              <ShieldCheck size={16} />
                            </button>
                            {!user.is_verified && (
                              <button
                                onClick={() => handleVerifyUser(user.uid)}
                                disabled={isVerifyingUser === user.uid}
                                className="px-3 py-1.5 bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500 hover:text-white border border-emerald-500/20 rounded-lg text-[10px] font-bold uppercase transition-all disabled:opacity-50 flex items-center gap-2"
                              >
                                {isVerifyingUser === user.uid && <RefreshCw size={12} className="animate-spin" />}
                                Verify
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                    {registeredUsers.length === 0 && (
                      <tr>
                        <td colSpan={6} className="py-10 text-center text-slate-500 italic text-sm">
                          No registered users found.
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
        <div className="max-w-4xl mx-auto w-full space-y-8">
          {/* API Key Rotation & Switch */}
          <div className="bg-white/50 backdrop-blur dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl transition-colors duration-300">
            <div className="flex items-center gap-3 mb-8">
              <div className="w-10 h-10 bg-brand-purple/20 text-brand-purple rounded-xl flex items-center justify-center border border-brand-purple/20">
                <Key size={20} />
              </div>
              <div>
                <h3 className="text-xl font-bold text-slate-900 dark:text-white">API Key Rotation & Switch</h3>
                <p className="text-slate-500 dark:text-slate-400 text-xs">Manage multiple keys for auto-switching on rate limits</p>
              </div>
            </div>

            <form onSubmit={handleSaveGlobalSettings} className="space-y-6">
              <div className="bg-slate-50 dark:bg-slate-950/50 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 space-y-6">
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <h4 className="text-sm font-bold text-slate-900 dark:text-white">Allow Users to use Admin API Keys</h4>
                    <p className="text-xs text-slate-500 dark:text-slate-400">If ON, the system uses rotated Admin keys. If OFF, users must provide their own.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setGlobalSettings({ ...globalSettings, allow_admin_keys: !globalSettings.allow_admin_keys })}
                    className={`w-12 h-6 rounded-full transition-all relative ${globalSettings.allow_admin_keys ? 'bg-brand-purple' : 'bg-slate-300 dark:bg-slate-700'}`}
                  >
                    <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${globalSettings.allow_admin_keys ? 'left-7' : 'left-1'}`} />
                  </button>
                </div>

                <div className="space-y-4">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest px-1">Google AI Studio API Keys (One per line)</label>
                  <textarea
                    value={globalSettings.api_keys?.join('\n')}
                    onChange={(e) => setGlobalSettings({ ...globalSettings, api_keys: e.target.value.split('\n') })}
                    placeholder="Paste your API keys here, one per line..."
                    className="w-full h-32 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-3 text-sm font-mono text-slate-900 dark:text-slate-200 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-purple/50 transition-all resize-none"
                  />
                  <p className="text-[10px] text-slate-500 italic px-1">
                    The system will automatically switch to the next key if a 429 (Rate Limit) error occurs.
                  </p>
                </div>

                <button
                  type="submit"
                  disabled={isSavingKeys}
                  className="w-full py-3.5 bg-brand-purple hover:bg-brand-purple/90 text-white rounded-xl text-sm font-bold shadow-lg shadow-brand-purple/20 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {isSavingKeys ? <RefreshCw size={18} className="animate-spin" /> : <Save size={18} />}
                  Save API Key Settings
                </button>
              </div>
            </form>
          </div>

          <div className="bg-white/50 backdrop-blur dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl transition-colors duration-300">
            <div className="flex items-center justify-between mb-8">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-brand-purple/20 text-brand-purple rounded-xl flex items-center justify-center border border-brand-purple/20">
                  <Settings size={20} />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-slate-900 dark:text-white">Firebase & Telegram Settings</h3>
                  <p className="text-slate-500 dark:text-slate-400 text-xs">Configure Infrastructure Integrations</p>
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
              {isSystemLoading ? (
                <div className="flex items-center justify-center py-20">
                  <RefreshCw size={32} className="text-brand-purple animate-spin" />
                </div>
              ) : (
                <>
                  {/* Firebase Section */}
              <div className="space-y-6">
                <div className="flex items-center gap-2 pb-2 border-b border-slate-200 dark:border-white/5">
                  <Database size={16} className="text-brand-purple" />
                  <h4 className="text-sm font-bold text-slate-900 dark:text-white uppercase tracking-wider">Firebase Configuration</h4>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest px-1">Project ID</label>
                    <input
                      type="text"
                      value={systemConfig.firebase_project_id}
                      onChange={(e) => setSystemConfig({ ...systemConfig, firebase_project_id: e.target.value })}
                      placeholder="e.g. my-project-123"
                      className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-3 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-purple/50 transition-all"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest px-1">API Key</label>
                    <input
                      type={showSecrets ? "text" : "password"}
                      value={systemConfig.firebase_api_key}
                      onChange={(e) => setSystemConfig({ ...systemConfig, firebase_api_key: e.target.value })}
                      placeholder="AIzaSy..."
                      className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-3 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-purple/50 transition-all font-mono"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest px-1">Auth Domain</label>
                    <input
                      type="text"
                      value={systemConfig.firebase_auth_domain}
                      onChange={(e) => setSystemConfig({ ...systemConfig, firebase_auth_domain: e.target.value })}
                      placeholder="my-project.firebaseapp.com"
                      className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-3 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-purple/50 transition-all"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest px-1">App ID</label>
                    <input
                      type="text"
                      value={systemConfig.firebase_app_id}
                      onChange={(e) => setSystemConfig({ ...systemConfig, firebase_app_id: e.target.value })}
                      placeholder="1:123456789:web:abcdef"
                      className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-3 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-purple/50 transition-all"
                    />
                  </div>
                </div>
              </div>

              {/* Telegram Section */}
              <div className="space-y-6">
                <div className="flex items-center gap-2 pb-2 border-b border-slate-200 dark:border-white/5">
                  <Send size={16} className="text-brand-purple" />
                  <h4 className="text-sm font-bold text-slate-900 dark:text-white uppercase tracking-wider">Telegram Notifications</h4>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest px-1">Bot Token</label>
                    <input
                      type={showSecrets ? "text" : "password"}
                      value={systemConfig.telegram_bot_token}
                      onChange={(e) => setSystemConfig({ ...systemConfig, telegram_bot_token: e.target.value })}
                      placeholder="123456789:ABC..."
                      className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-3 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-purple/50 transition-all font-mono"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest px-1">Chat ID</label>
                    <input
                      type="text"
                      value={systemConfig.telegram_chat_id}
                      onChange={(e) => setSystemConfig({ ...systemConfig, telegram_chat_id: e.target.value })}
                      placeholder="e.g. -100123456789"
                      className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-3 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-purple/50 transition-all"
                    />
                  </div>
                </div>
              </div>

              {/* Debug & Testing Section */}
              <div className="space-y-6">
                <div className="flex items-center gap-2 pb-2 border-b border-slate-200 dark:border-white/5">
                  <RefreshCw size={16} className="text-brand-purple" />
                  <h4 className="text-sm font-bold text-slate-900 dark:text-white uppercase tracking-wider">Debug & Testing</h4>
                </div>
                
                <div className="flex items-center justify-between bg-slate-50 dark:bg-slate-900/50 p-4 rounded-2xl border border-slate-200 dark:border-slate-800">
                  <div>
                    <h5 className="text-sm font-bold text-slate-900 dark:text-white">Mock Generation Mode</h5>
                    <p className="text-xs text-slate-500">Enable this to test UI transitions without calling the real Gemini API.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSystemConfig({ ...systemConfig, mock_mode: !systemConfig.mock_mode })}
                    className={`w-12 h-6 rounded-full transition-all relative ${systemConfig.mock_mode ? 'bg-brand-purple' : 'bg-slate-300 dark:bg-slate-700'}`}
                  >
                    <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${systemConfig.mock_mode ? 'left-7' : 'left-1'}`} />
                  </button>
                </div>
              </div>

              <div className="pt-6">
                <button
                  type="submit"
                  disabled={isSavingSystem}
                  className="w-full py-4 bg-brand-purple text-white rounded-2xl font-bold hover:bg-brand-purple/90 transition-all shadow-lg shadow-brand-purple/20 flex items-center justify-center gap-2 disabled:opacity-50 active:scale-95"
                >
                  {isSavingSystem ? <RefreshCw size={20} className="animate-spin" /> : <Save size={20} />}
                  Save System Configuration
                </button>
                <p className="text-center text-[10px] text-slate-500 mt-4 italic">
                  Note: Changes to Firebase settings may require an app reload to take full effect.
                </p>
              </div>
                </>
              )}
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
      <Modal
        isOpen={modal.isOpen}
        onClose={() => setModal({ ...modal, isOpen: false })}
        onConfirm={modal.onConfirm}
        title={modal.title}
        message={modal.message}
        type={modal.type}
        confirmText={modal.confirmText}
        cancelText={modal.cancelText}
        placeholder={modal.placeholder}
        defaultValue={modal.defaultValue}
        inputType={modal.inputType}
      />
    </>
  );
};

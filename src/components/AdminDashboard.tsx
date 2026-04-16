import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  ShieldCheck, 
  ShieldAlert,
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
  Edit3,
  FileVideo,
  Sparkles,
  History,
  X,
  LogIn
} from 'lucide-react';
import { AuthorizedUser, User as RegisteredUser, SystemConfig, PronunciationRule, GlobalSettings, VBSUserControl, ActivityLog } from '../types';
import { db, collection, onSnapshot, query, orderBy, setDoc, doc, deleteDoc, updateDoc, handleFirestoreError, OperationType, getDoc, auth, googleProvider, signInWithPopup, where, limit, getDocs } from '../firebase';
import { GeminiTTSService } from '../services/geminiService';
import { Toast, ToastType } from './Toast';
import { Modal, ModalType } from './Modal';
import { useLanguage } from '../contexts/LanguageContext';

interface AdminDashboardProps {
  isAuthReady: boolean;
  onAdminLogin?: (code: string) => void;
  configOnly?: boolean;
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({ isAuthReady, onAdminLogin, configOnly = false }) => {
  const { t } = useLanguage();
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
  const [vbsUsers, setVbsUsers] = useState<VBSUserControl[]>([]);
  const [isVbsUsersLoading, setIsVbsUsersLoading] = useState(true);
  const [editingExpiryUser, setEditingExpiryUser] = useState<string | null>(null);
  const [expiryDateInput, setExpiryDateInput] = useState('');
  
  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>([]);
  const [selectedUserLogs, setSelectedUserLogs] = useState<string | null>(null);
  const [isLogsLoading, setIsLogsLoading] = useState(false);

  const timeSince = (date: Date) => {
    const seconds = Math.floor((new Date().getTime() - date.getTime()) / 1000);
    if (seconds < 0) return "Just now";
    let interval = seconds / 31536000;
    if (interval > 1) return Math.floor(interval) + " years";
    interval = seconds / 2592000;
    if (interval > 1) return Math.floor(interval) + " months";
    interval = seconds / 86400;
    if (interval > 1) return Math.floor(interval) + " days";
    interval = seconds / 3600;
    if (interval > 1) return Math.floor(interval) + " hours";
    interval = seconds / 60;
    if (interval > 1) return Math.floor(interval) + " minutes";
    return Math.floor(seconds) + " seconds";
  };

  const handleShowActivityLogs = async (vbsId: string) => {
    setSelectedUserLogs(vbsId);
    setIsLogsLoading(true);
    try {
      const q = query(
        collection(db, 'activity_logs'), 
        where('vbsId', '==', vbsId), 
        orderBy('createdAt', 'desc'),
        limit(50)
      );
      const snapshot = await getDocs(q);
      const logs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ActivityLog));
      setActivityLogs(logs);
    } catch (err) {
      console.error("Failed to fetch logs:", err);
      setToast({ message: t('errors.generic'), type: 'error', isVisible: true });
    } finally {
      setIsLogsLoading(false);
    }
  };

  useEffect(() => {
    const q = query(collection(db, 'user_controls'), orderBy('updatedAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const users = snapshot.docs.map(doc => doc.data() as VBSUserControl);
      setVbsUsers(users);
      setIsVbsUsersLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'user_controls');
    });
    return () => unsubscribe();
  }, []);

  const handleUpdateVbsUser = async (vbsId: string, updates: Partial<VBSUserControl>) => {
    try {
      await setDoc(doc(db, 'user_controls', vbsId), {
        ...updates,
        vbsId: vbsId, // Ensure ID is present if creating
        updatedAt: new Date()
      }, { merge: true });

      // Sync expiryDate to vlogs_users if present
      if (updates.expiryDate !== undefined) {
        await updateDoc(doc(db, 'vlogs_users', vbsId), {
          expiryDate: updates.expiryDate
        }).catch(() => {}); // Ignore if doc doesn't exist
      }
    } catch (err) {
      console.error("Failed to update user:", err);
    }
  };

  const [searchQuery, setSearchQuery] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [visiblePasswords, setVisiblePasswords] = useState<Set<string>>(new Set());
  
  const togglePasswordVisibility = (id: string) => {
    const newSet = new Set(visiblePasswords);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setVisiblePasswords(newSet);
  };

  const NO_EXPIRY_LABEL = "သက်တမ်းအကန့်အသတ်မရှိ";

  const renderExpiry = (expiryDate: string | null | undefined) => {
    const isNoExpiry = !expiryDate;
    
    if (isNoExpiry) {
      return (
        <span className="flex items-center gap-2 text-[11px] font-bold text-amber-500 whitespace-nowrap bg-amber-500/5 px-2 py-1 rounded-md border border-amber-500/10">
          <Calendar size={12} className="shrink-0" />
          {t('admin.expiryUnlimited')}
        </span>
      );
    }

    try {
      const d = new Date(expiryDate as string);
      if (isNaN(d.getTime())) {
        return (
          <span className="flex items-center gap-2 text-[11px] font-bold text-amber-500 whitespace-nowrap bg-amber-500/5 px-2 py-1 rounded-md border border-amber-500/10">
            <Calendar size={12} className="shrink-0" />
            {NO_EXPIRY_LABEL}
          </span>
        );
      }

      const isExpired = d.getTime() < Date.now();
      const day = d.getDate().toString().padStart(2, '0');
      const month = (d.getMonth() + 1).toString().padStart(2, '0');
      const year = d.getFullYear();
      const formatted = `${day}/${month}/${year}`;

      return (
        <div className="flex flex-col gap-1 items-start">
          <span className={`flex items-center gap-2 text-[11px] font-bold whitespace-nowrap px-2 py-1 rounded-md border ${
            isExpired 
              ? 'text-rose-500 bg-rose-500/5 border-rose-500/10' 
              : 'text-emerald-400 bg-emerald-400/5 border-emerald-400/20 shadow-[0_0_10px_rgba(52,211,153,0.1)]'
          }`}>
            <Calendar size={12} className="shrink-0" />
            {formatted}
          </span>
          {isExpired && (
            <span className="text-[8px] text-rose-500 font-black uppercase tracking-widest ml-1 animate-pulse">
              {t('admin.expired')}
            </span>
          )}
        </div>
      );
    } catch (e) {
      return <span className="text-xs text-slate-400">Invalid</span>;
    }
  };

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
    
    // Sync api_keys array with individual keys for backward compatibility
    const keys = [
      globalSettings.primary_key || '',
      globalSettings.secondary_key || '',
      globalSettings.backup_key || ''
    ].filter(k => k.trim());

    try {
      await setDoc(doc(db, 'settings', 'global'), {
        ...globalSettings,
        api_keys: keys,
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
      
      // Also initialize user_controls to sync expiry and initial settings
      await setDoc(doc(db, 'user_controls', accessCode), {
        vbsId: accessCode,
        dailyUsage: 0,
        lastUsedDate: new Date().toDateString(),
        isUnlimited: newRole === 'admin',
        membershipStatus: newRole === 'admin' ? 'premium' : 'standard',
        isBlocked: false,
        expiryDate: newExpiryDate || null,
        updatedAt: new Date()
      });
      
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
    const user = authorizedUsers.find(u => u.id === id);
    openModal({
      title: 'Update Password',
      message: 'Enter a new password for this user:',
      type: 'prompt',
      inputType: 'text',
      defaultValue: user?.password || '',
      placeholder: 'New password...',
      confirmText: 'Update',
      onConfirm: async (password) => {
        if (!password) return;
        try {
          await updateDoc(doc(db, 'vlogs_users', id), {
            password: password.trim() || null
          });
          setToast({
            message: 'Password Updated ✨',
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
      const isoExpiry = newExpiry.toISOString();
      
      await updateDoc(doc(db, 'vlogs_users', id), {
        expiryDate: isoExpiry
      });

      // Sync to user_controls
      await setDoc(doc(db, 'user_controls', id), {
        expiryDate: isoExpiry,
        vbsId: id,
        updatedAt: new Date()
      }, { merge: true });
      
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
          
          const isoExpiry = date.toISOString();

          await updateDoc(doc(db, 'vlogs_users', id), {
            expiryDate: isoExpiry
          });

          // Sync to user_controls
          await setDoc(doc(db, 'user_controls', id), {
            expiryDate: isoExpiry,
            vbsId: id,
            updatedAt: new Date()
          }, { merge: true });
          
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
            <h2 className="text-2xl font-bold text-slate-900 dark:text-white">{t('admin.authTitle')}</h2>
            <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">{t('admin.authSubtitle')}</p>
          </div>

          <form onSubmit={handleAdminAuth} className="space-y-6">
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest px-1">{t('admin.roleLabel')}</label>
              <div className="relative">
                <Shield className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={20} />
                <input
                  type="password"
                  value={adminIdInput}
                  onChange={(e) => setAdminIdInput(e.target.value)}
                  placeholder={t('admin.enterCode')}
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
              <ShieldCheck size={20} /> {t('admin.unlockBtn')}
            </button>
          </form>
        </motion.div>
      </div>
    );
  }

  return (
    <>
      <div className="max-w-6xl mx-auto space-y-8 p-4 relative">
      <div className="absolute top-0 right-0 w-64 h-64 bg-brand-purple/5 blur-[100px] -z-10" />
      
      {/* Header */}
      <div className="premium-glass rounded-[32px] p-5 sm:p-8 shadow-2xl transition-all duration-300 neon-glow-indigo">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-6 text-center sm:text-left">
          <div className="flex flex-col sm:flex-row items-center gap-4 sm:gap-6">
            <div className="w-14 h-14 sm:w-16 sm:h-16 bg-brand-purple/20 text-brand-purple rounded-2xl flex items-center justify-center shadow-inner border border-brand-purple/20 shrink-0">
              <ShieldCheck size={28} className="sm:w-8 sm:h-8" />
            </div>
            <div>
              <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white">{t('admin.title')}</h2>
              <p className="text-slate-500 dark:text-slate-400 text-xs sm:text-sm mt-1">{t('admin.subtitle') || t('admin.idSettings')}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 sm:gap-3 w-full sm:w-auto overflow-hidden">
            {!configOnly && (
              <div className="flex flex-nowrap overflow-x-auto no-scrollbar bg-slate-100 dark:bg-slate-900/50 p-1 rounded-xl border border-slate-200 dark:border-slate-800 flex-1 sm:flex-initial">
                <button
                  onClick={() => {
                    window.history.pushState({}, '', '/');
                    window.dispatchEvent(new Event('popstate'));
                  }}
                  className="px-3 sm:px-4 py-2 rounded-lg text-[10px] sm:text-xs font-bold transition-all flex items-center gap-1.5 sm:gap-2 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 whitespace-nowrap"
                >
                  <Mic2 size={14} /> {t('nav.studio')}
                </button>
                <button
                  onClick={() => setActiveTab('users')}
                  className={`px-3 sm:px-4 py-2 rounded-lg text-[10px] sm:text-xs font-bold transition-all flex items-center gap-1.5 sm:gap-2 whitespace-nowrap ${activeTab === 'users' ? 'bg-white dark:bg-slate-800 text-brand-purple shadow-sm' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
                >
                  <User size={14} /> {t('admin.userManagement')}
                </button>
                <button
                  onClick={() => setActiveTab('system')}
                  className={`px-3 sm:px-4 py-2 rounded-lg text-[10px] sm:text-xs font-bold transition-all flex items-center gap-1.5 sm:gap-2 whitespace-nowrap ${activeTab === 'system' ? 'bg-white dark:bg-slate-800 text-brand-purple shadow-sm' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
                >
                  <Settings size={14} /> {t('admin.systemSettings')}
                </button>
                <button
                  onClick={() => setActiveTab('rules')}
                  className={`px-3 sm:px-4 py-2 rounded-lg text-[10px] sm:text-xs font-bold transition-all flex items-center gap-1.5 sm:gap-2 whitespace-nowrap ${activeTab === 'rules' ? 'bg-white dark:bg-slate-800 text-brand-purple shadow-sm' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
                >
                  <Languages size={14} /> {t('admin.pronunciationRules')}
                </button>
              </div>
            )}
            <button 
              onClick={handleAdminLogout}
              className="px-3 sm:px-4 py-2 sm:py-2.5 bg-slate-100 dark:bg-slate-900/50 hover:bg-slate-200 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-500 dark:text-slate-400 text-[10px] sm:text-sm font-bold transition-all whitespace-nowrap"
            >
              {configOnly ? 'Exit Config' : 'Lock'}
            </button>
          </div>
        </div>
      </div>

      {activeTab === 'users' && !configOnly && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Create Form */}
        <div className="lg:col-span-4">
          <div className="premium-glass rounded-[32px] p-5 sm:p-6 shadow-2xl sticky top-8 transition-all duration-300 border border-white/5">
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
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest px-1">{t('admin.roleLabel')}</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setNewRole('user')}
                    className={`py-3 rounded-xl text-xs font-bold border transition-all ${newRole === 'user' ? 'bg-brand-purple border-brand-purple text-white' : 'bg-slate-100 dark:bg-slate-900/50 border-slate-200 dark:border-slate-800 text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-800'}`}
                  >
                    {t('admin.userRole')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setNewRole('admin')}
                    className={`py-3 rounded-xl text-xs font-bold border transition-all ${newRole === 'admin' ? 'bg-brand-purple border-brand-purple text-white' : 'bg-slate-100 dark:bg-slate-900/50 border-slate-200 dark:border-slate-800 text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-800'}`}
                  >
                    {t('admin.adminRole')}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={isSubmitting || !newId.trim()}
                className="w-full py-4 bg-brand-purple text-white rounded-xl font-bold hover:bg-brand-purple/90 transition-all shadow-lg shadow-brand-purple/20 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed active:scale-95"
              >
                {isSubmitting ? (
                  <div className="flex items-center gap-0.5 h-4">
                    {[...Array(3)].map((_, i) => (
                      <motion.div
                        key={i}
                        className="w-0.5 bg-white rounded-full"
                        animate={{
                          height: [4, 12, 4],
                        }}
                        transition={{
                          duration: 0.6,
                          repeat: Infinity,
                          delay: i * 0.1,
                        }}
                      />
                    ))}
                  </div>
                ) : <Plus size={18} />}
                {t('admin.createBtn')}
              </button>
            </form>
          </div>
        </div>

        {/* List Table */}
        <div className="lg:col-span-8">
          <div className="premium-glass rounded-[32px] p-5 sm:p-6 shadow-2xl transition-all duration-300 border border-white/5">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
              <div className="flex items-center gap-3">
                <Key className="text-brand-purple" size={20} />
                <h3 className="text-lg font-bold text-slate-900 dark:text-white">{t('admin.userList')}</h3>
                <span className="px-2 py-0.5 bg-brand-purple/20 text-brand-purple border border-brand-purple/30 rounded-lg text-[9px] font-bold uppercase">
                  {authorizedUsers.length} {t('admin.stats')}
                </span>
              </div>

              <div className="relative flex-1 max-w-full md:max-w-xs">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
                <input
                  type="text"
                  placeholder={t('admin.searchIds')}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg pl-10 pr-4 py-2.5 text-xs text-slate-900 dark:text-slate-200 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-purple/50 transition-all"
                />
              </div>
            </div>

            {isLoading ? (
              <div className="flex items-center justify-center py-20">
                <div className="w-8 h-8 border-2 border-brand-purple/20 border-t-brand-purple rounded-full animate-spin" />
                <p className="ml-3 text-xs font-bold text-slate-500 uppercase tracking-widest">{t('common.loading')}...</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-white/5">
                      <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-widest">{t('admin.id')}</th>
                      <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-widest">{t('admin.note')}</th>
                      <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-widest">{t('admin.passwordLabel')}</th>
                      <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-widest">{t('admin.usage')}</th>
                      <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-widest">{t('admin.membership')}</th>
                      <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-widest text-center">{t('admin.premiumAccess')}</th>
                      <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-widest">{t('admin.expiry')}</th>
                      <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-widest">{t('admin.status')}</th>
                      <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-widest text-right">{t('admin.actions')}</th>
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
                          <div className="flex items-center gap-2 group/pass">
                            <span className="font-mono text-xs text-slate-900 dark:text-white bg-slate-100 dark:bg-white/5 px-2 py-1 rounded border border-slate-200 dark:border-white/10 min-w-[100px] text-center">
                              {visiblePasswords.has(u.id) ? (u.password || '—') : '••••••••'}
                            </span>
                            <button 
                              onClick={() => togglePasswordVisibility(u.id)}
                              className="p-1.5 text-slate-400 hover:text-brand-purple hover:bg-brand-purple/10 rounded transition-all"
                              title={visiblePasswords.has(u.id) ? "Hide Password" : "Show Password"}
                            >
                              {visiblePasswords.has(u.id) ? <EyeOff size={14} /> : <Eye size={14} />}
                            </button>
                          </div>
                        </td>
                        <td className="px-4 py-4 whitespace-nowrap">
                          {(() => {
                            const userCtrl = vbsUsers.find(vc => vc.vbsId === u.id);
                            const lastLogin = userCtrl?.lastLoginAt ? new Date(userCtrl.lastLoginAt) : null;
                            const isActiveNow = lastLogin && (new Date().getTime() - lastLogin.getTime() < 300000); // 5 mins
                            const isToday = userCtrl?.lastUsedDate === new Date().toDateString();
                            
                            return (
                              <div className="flex flex-col gap-1.5 min-w-[140px]">
                                <div className="flex items-center gap-2">
                                  <span className="text-xs font-bold text-brand-purple">
                                    {isToday ? (userCtrl.dailyTasks || 0) : 0} ယနေ့အသုံးပြုမှု
                                  </span>
                                  <button 
                                    onClick={() => handleShowActivityLogs(u.id)}
                                    className="p-1 text-slate-400 hover:text-brand-purple hover:bg-brand-purple/10 rounded transition-all"
                                    title="View detailed logs"
                                  >
                                    <Eye size={12} />
                                  </button>
                                </div>
                                <div className="flex items-center gap-2">
                                  {isActiveNow ? (
                                    <span className="flex items-center gap-1.5 px-2 py-0.5 bg-emerald-500/10 text-emerald-500 rounded-full text-[9px] font-bold border border-emerald-500/20">
                                      <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
                                      Active Now
                                    </span>
                                  ) : (
                                    <span className="text-[10px] text-slate-500 dark:text-slate-400 font-medium whitespace-nowrap">
                                      နောက်ဆုံးအသုံးပြုမှု: {lastLogin ? timeSince(lastLogin) + " ago" : "Never"}
                                    </span>
                                  )}
                                </div>
                              </div>
                            );
                          })()}
                        </td>
                        <td className="px-4 py-4">
                          {(() => {
                            const userCtrl = vbsUsers.find(vc => vc.vbsId === u.id);
                            const isPremium = userCtrl?.membershipStatus === 'premium' || u.id === 'saw_vlogs_2026';
                            return (
                              <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border flex items-center gap-1.5 w-fit ${isPremium ? 'bg-amber-500/10 text-amber-500 border-amber-500/20 shadow-[0_0_10px_rgba(245,158,11,0.2)]' : 'bg-slate-100 dark:bg-white/10 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-white/10'}`}>
                                {isPremium ? (
                                  <>
                                    <Sparkles size={10} className="animate-pulse" />
                                    Premium (အဆင့်မြင့်)
                                  </>
                                ) : (
                                  'Standard (သာမန်)'
                                )}
                              </span>
                            );
                          })()}
                        </td>
                        <td className="px-4 py-4">
                          <div className="flex justify-center">
                            {(() => {
                              const userCtrl = vbsUsers.find(vc => vc.vbsId === u.id);
                              const isPremium = userCtrl?.membershipStatus === 'premium';
                              const isAdminSelf = u.id === 'saw_vlogs_2026';
                              
                              return (
                                <button
                                  onClick={async () => {
                                    if (isAdminSelf) return;
                                    const nextStatus = isPremium ? 'standard' : 'premium';
                                    try {
                                      await handleUpdateVbsUser(u.id, { membershipStatus: nextStatus });
                                      setToast({
                                        message: `[${u.id}] ကို ${nextStatus === 'premium' ? 'Premium သို့ မြှင့်တင်ပြီးပါပြီ ✨' : 'Standard သို့ ပြောင်းလဲပြီးပါပြီ 📋'}`,
                                        type: 'success',
                                        isVisible: true
                                      });
                                    } catch (err) {
                                      console.error("Failed to toggle premium:", err);
                                      setToast({
                                        message: 'Update failed.',
                                        type: 'error',
                                        isVisible: true
                                      });
                                    }
                                  }}
                                  disabled={isAdminSelf}
                                  className={`relative w-11 h-6 transition-all duration-300 rounded-full p-1 border ${
                                    isAdminSelf ? 'opacity-50 cursor-not-allowed grayscale' : 'cursor-pointer'
                                  } ${
                                    isPremium || isAdminSelf
                                      ? 'bg-brand-purple/20 border-brand-purple/40 shadow-[0_0_15px_rgba(168,85,247,0.3)]' 
                                      : 'bg-slate-200 dark:bg-slate-800 border-slate-300 dark:border-slate-700'
                                  }`}
                                >
                                  <motion.div
                                    animate={{ 
                                      x: (isPremium || isAdminSelf) ? 20 : 0,
                                      backgroundColor: (isPremium || isAdminSelf) ? '#a855f7' : '#94a3b8'
                                    }}
                                    transition={{ type: "spring", stiffness: 500, damping: 30 }}
                                    className="w-4 h-4 rounded-full shadow-lg"
                                  />
                                </button>
                              );
                            })()}
                          </div>
                        </td>
                        <td className="px-4 py-4">
                          {renderExpiry(u.expiryDate)}
                        </td>
                        <td className="px-4 py-4">
                          {u.isActive ? (
                            <span className="flex items-center gap-1.5 text-emerald-500 text-[10px] font-bold uppercase">
                              <CheckCircle2 size={12} /> {t('admin.active')}
                            </span>
                          ) : (
                            <span className="flex items-center gap-1.5 text-red-500 text-[10px] font-bold uppercase">
                              <XCircle size={12} /> {t('admin.deactivated')}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-4 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={() => handleExtendExpiry(u.id, u.expiryDate)}
                              className="p-2 text-slate-500 hover:text-emerald-500 hover:bg-emerald-500/10 rounded-lg transition-all"
                              title={t('admin.extend30Days')}
                            >
                              <Calendar size={16} />
                            </button>
                            <button
                              onClick={() => handleSetCustomExpiry(u.id)}
                              className="p-2 text-slate-500 hover:text-brand-purple hover:bg-brand-purple/10 rounded-lg transition-all"
                              title={t('admin.setCustomExpiry')}
                            >
                              <Edit3 size={16} />
                            </button>
                            <button
                              onClick={() => handleUpdatePassword(u.id)}
                              className="p-2 text-slate-500 hover:text-brand-purple hover:bg-brand-purple/10 rounded-lg transition-all"
                              title={t('admin.updatePassword')}
                            >
                              <Lock size={16} />
                            </button>
                            <button
                              onClick={() => {
                                const userCtrl = vbsUsers.find(vc => vc.vbsId === u.id);
                                handleUpdateVbsUser(u.id, { isUnlimited: !userCtrl?.isUnlimited });
                              }}
                              className={`p-2 rounded-lg transition-all border ${vbsUsers.find(vc => vc.vbsId === u.id)?.isUnlimited ? 'bg-emerald-500 text-white border-emerald-500' : 'bg-slate-100 dark:bg-white/5 text-slate-500 border-slate-200 dark:border-white/10 hover:border-emerald-500/50 hover:text-emerald-500'}`}
                              title={t('admin.toggleVIP')}
                            >
                              <Sparkles size={16} />
                            </button>
                            <button
                              onClick={() => handleUpdateVbsUser(u.id, { dailyUsage: 0, lastUsedDate: new Date().toDateString() })}
                              className="p-2 text-blue-500 hover:bg-blue-500/10 rounded-lg transition-all"
                              title={t('admin.resetUsage')}
                            >
                              <RefreshCw size={16} />
                            </button>
                            <button
                              onClick={() => handleToggleRole(u.id, u.role || 'user')}
                              className="p-2 text-slate-500 hover:text-brand-purple hover:bg-brand-purple/10 rounded-lg transition-all"
                              title={t('admin.toggleRole')}
                            >
                              <ShieldCheck size={16} />
                            </button>
                            <button
                              onClick={() => handleToggleStatus(u.id, u.isActive)}
                              className={`p-2 rounded-lg transition-all ${u.isActive ? 'text-amber-500 hover:bg-amber-500/10' : 'text-emerald-500 hover:bg-emerald-500/10'}`}
                              title={u.isActive ? t('admin.deactivate') : t('admin.activate')}
                            >
                              <RefreshCw size={16} />
                            </button>
                            <button
                              onClick={() => handleDeleteId(u.id)}
                              disabled={isDeletingUser === u.id}
                              className="p-2 text-slate-500 hover:text-red-500 hover:bg-red-500/10 rounded-lg transition-all disabled:opacity-50"
                              title={t('history.delete')}
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
                <h3 className="text-lg font-bold text-slate-900 dark:text-white">{t('admin.registeredUsers')}</h3>
                <span className="px-2 py-0.5 bg-brand-purple/20 text-brand-purple border border-brand-purple/30 rounded-lg text-[10px] font-bold uppercase">
                  {registeredUsers.length} {t('admin.stats')}
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
                      <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-widest">{t('admin.user')}</th>
                      <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-widest">{t('admin.roleLabel')}</th>
                      <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-widest">{t('admin.verification')}</th>
                      <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-widest">{t('admin.joined')}</th>
                      <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-widest">{t('admin.lastActivity')}</th>
                      <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-widest text-right">{t('admin.actions')}</th>
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

      {activeTab === 'system' && !configOnly && (
        <div className="max-w-4xl mx-auto w-full space-y-8">
          {/* API Key Rotation & Switch */}
          <div className="premium-glass rounded-[32px] p-6 sm:p-8 shadow-2xl transition-all duration-300 border border-white/5">
            <div className="flex items-center gap-3 mb-8">
              <div className="w-10 h-10 bg-brand-purple/20 text-brand-purple rounded-xl flex items-center justify-center border border-brand-purple/20">
                <Key size={20} />
              </div>
              <div>
                <h3 className="text-xl font-bold text-slate-900 dark:text-white">{t('admin.apiKeyRotation')}</h3>
                <p className="text-slate-500 dark:text-slate-400 text-xs">{t('admin.apiKeyRotationDesc')}</p>
              </div>
            </div>

            <form onSubmit={handleSaveGlobalSettings} className="space-y-6">
              <div className="bg-slate-50 dark:bg-slate-950/50 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 space-y-6">
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <h4 className="text-sm font-bold text-slate-900 dark:text-white">{t('admin.allowAdminKeys')}</h4>
                    <p className="text-xs text-slate-500 dark:text-slate-400">{t('admin.allowAdminKeysDesc')}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setGlobalSettings({ ...globalSettings, allow_admin_keys: !globalSettings.allow_admin_keys })}
                    className={`w-12 h-6 rounded-full transition-all relative ${globalSettings.allow_admin_keys ? 'bg-brand-purple' : 'bg-slate-300 dark:bg-slate-700'}`}
                  >
                    <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${globalSettings.allow_admin_keys ? 'left-7' : 'left-1'}`} />
                  </button>
                </div>

                <div className="space-y-6">
                  <div className="grid grid-cols-1 gap-4">
                    {/* Primary Key */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between px-1">
                        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{t('admin.primaryKey')}</label>
                        <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full uppercase ${GeminiTTSService.getActiveKeyIndex() === 0 ? 'text-brand-purple bg-brand-purple/10' : 'text-slate-400 bg-slate-100 dark:bg-slate-800'}`}>
                          {GeminiTTSService.getActiveKeyIndex() === 0 ? t('admin.active') : t('admin.standby')}
                        </span>
                      </div>
                      <input
                        type={showSecrets ? "text" : "password"}
                        value={globalSettings.primary_key || ''}
                        onChange={(e) => setGlobalSettings({ ...globalSettings, primary_key: e.target.value })}
                        placeholder="Enter Primary Gemini API Key..."
                        className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-3 text-sm font-mono text-slate-900 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-purple/50 transition-all"
                      />
                    </div>

                    {/* Secondary Key */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between px-1">
                        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{t('admin.secondaryKey')}</label>
                        <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full uppercase ${GeminiTTSService.getActiveKeyIndex() === 1 ? 'text-brand-purple bg-brand-purple/10' : 'text-slate-400 bg-slate-100 dark:bg-slate-800'}`}>
                          {GeminiTTSService.getActiveKeyIndex() === 1 ? t('admin.active') : t('admin.backup1')}
                        </span>
                      </div>
                      <input
                        type={showSecrets ? "text" : "password"}
                        value={globalSettings.secondary_key || ''}
                        onChange={(e) => setGlobalSettings({ ...globalSettings, secondary_key: e.target.value })}
                        placeholder="Enter Secondary Gemini API Key..."
                        className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-3 text-sm font-mono text-slate-900 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-purple/50 transition-all"
                      />
                    </div>

                    {/* Backup Key */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between px-1">
                        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{t('admin.backupKey')}</label>
                        <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full uppercase ${GeminiTTSService.getActiveKeyIndex() === 2 ? 'text-brand-purple bg-brand-purple/10' : 'text-slate-400 bg-slate-100 dark:bg-slate-800'}`}>
                          {GeminiTTSService.getActiveKeyIndex() === 2 ? t('admin.active') : t('admin.backup2')}
                        </span>
                      </div>
                      <input
                        type={showSecrets ? "text" : "password"}
                        value={globalSettings.backup_key || ''}
                        onChange={(e) => setGlobalSettings({ ...globalSettings, backup_key: e.target.value })}
                        placeholder="Enter Backup Gemini API Key..."
                        className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-3 text-sm font-mono text-slate-900 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-purple/50 transition-all"
                      />
                    </div>
                  </div>

                  <p className="text-[10px] text-slate-500 italic px-1">
                    {t('admin.keyRotationDesc')}
                  </p>
                </div>

                <button
                  type="submit"
                  disabled={isSavingKeys}
                  className="w-full py-3.5 bg-brand-purple hover:bg-brand-purple/90 text-white rounded-xl text-sm font-bold shadow-lg shadow-brand-purple/20 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {isSavingKeys ? (
                    <div className="flex items-center gap-0.5 h-4">
                      {[...Array(3)].map((_, i) => (
                        <motion.div
                          key={i}
                          className="w-0.5 bg-white rounded-full"
                          animate={{
                            height: [4, 12, 4],
                          }}
                          transition={{
                            duration: 0.6,
                            repeat: Infinity,
                            delay: i * 0.1,
                          }}
                        />
                      ))}
                    </div>
                  ) : <Save size={18} />}
                  {t('admin.saveSettings')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {configOnly && (
        <div className="max-w-4xl mx-auto w-full space-y-12">
          <div className="bg-amber-500/10 border border-amber-500/20 rounded-2xl p-4 flex items-center gap-3 text-amber-600 mb-8">
              <Shield size={20} />
              <p className="text-xs font-bold uppercase tracking-widest">Infrastructure Configuration Mode</p>
            </div>
          
          {/* Firebase & Telegram Settings */}
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
                    <div className="flex items-center justify-center gap-1 h-10">
                      {[...Array(5)].map((_, i) => (
                        <motion.div
                          key={i}
                          className="w-1 bg-brand-purple rounded-full"
                          animate={{
                            height: [10, 30, 10],
                            opacity: [0.5, 1, 0.5],
                          }}
                          transition={{
                            duration: 0.8,
                            repeat: Infinity,
                            delay: i * 0.1,
                          }}
                        />
                      ))}
                    </div>
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
                    {isSavingSystem ? (
                      <div className="flex items-center gap-0.5 h-5">
                        {[...Array(3)].map((_, i) => (
                          <motion.div
                            key={i}
                            className="w-1 bg-white rounded-full"
                            animate={{
                              height: [6, 16, 6],
                            }}
                            transition={{
                              duration: 0.6,
                              repeat: Infinity,
                              delay: i * 0.1,
                            }}
                          />
                        ))}
                      </div>
                    ) : <Save size={20} />}
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

      {activeTab === 'rules' && !configOnly && (
        <div className="max-w-4xl mx-auto w-full">
          <div className="premium-glass rounded-[32px] p-6 sm:p-8 shadow-2xl transition-all duration-300 border border-white/5">
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
                  <div className="flex items-center justify-center gap-1 h-8">
                    {[...Array(4)].map((_, i) => (
                      <motion.div
                        key={i}
                        className="w-1 bg-brand-purple rounded-full"
                        animate={{
                          height: [8, 24, 8],
                          opacity: [0.5, 1, 0.5],
                        }}
                        transition={{
                          duration: 0.8,
                          repeat: Infinity,
                          delay: i * 0.1,
                        }}
                      />
                    ))}
                  </div>
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

      {/* Activity Logs Modal */}
      <AnimatePresence>
        {selectedUserLogs && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 sm:p-6">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedUserLogs(null)}
              className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-2xl bg-white dark:bg-slate-900 rounded-[32px] shadow-2xl border border-slate-200 dark:border-white/10 overflow-hidden flex flex-col max-h-[80vh]"
            >
              <div className="p-6 border-b border-slate-200 dark:border-white/5 flex items-center justify-between bg-slate-50/50 dark:bg-white/[0.02]">
                <div className="flex items-center gap-4">
                  <div className="p-3 bg-brand-purple/10 rounded-2xl text-brand-purple">
                    <History size={24} />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-slate-900 dark:text-white tracking-tight">လုပ်ဆောင်ချက်မှတ်တမ်းများ</h3>
                    <p className="text-xs text-slate-500 font-medium font-mono uppercase tracking-wider mt-1">User ID: {selectedUserLogs}</p>
                  </div>
                </div>
                <button 
                  onClick={() => setSelectedUserLogs(null)}
                  className="p-2 hover:bg-slate-200 dark:hover:bg-white/10 rounded-xl transition-all text-slate-500"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-6 custom-scrollbar space-y-4">
                {isLogsLoading ? (
                   <div className="flex flex-col items-center justify-center py-20 gap-4">
                     <RefreshCw size={32} className="text-brand-purple animate-spin" />
                     <p className="text-sm text-slate-500 font-bold uppercase tracking-widest animate-pulse">Loading Logs...</p>
                   </div>
                ) : activityLogs.length === 0 ? (
                   <div className="text-center py-20 bg-slate-50 dark:bg-white/5 rounded-3xl border border-dashed border-slate-200 dark:border-slate-800">
                     <p className="text-slate-500 italic">မှတ်တမ်းမရှိသေးပါ။ (No logs found for this user.)</p>
                   </div>
                ) : (
                  <div className="space-y-3">
                    {activityLogs.map((log) => (
                      <div key={log.id} className="p-4 bg-slate-50 dark:bg-white/5 rounded-2xl border border-slate-200 dark:border-white/10 flex items-start gap-4 hover:border-brand-purple/30 transition-all group">
                        <div className={`p-2 rounded-xl shrink-0 ${
                          log.type === 'login' ? 'bg-blue-500/10 text-blue-500' :
                          log.type === 'tts' ? 'bg-brand-purple/10 text-brand-purple' :
                          log.type === 'transcription' ? 'bg-amber-500/10 text-amber-500' :
                          'bg-emerald-500/10 text-emerald-500'
                        }`}>
                          {log.type === 'login' ? <LogIn size={16} /> :
                           log.type === 'tts' ? <Mic2 size={16} /> :
                           log.type === 'transcription' ? <FileVideo size={16} /> :
                           <CheckCircle2 size={16} />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-4 mb-1">
                            <span className="text-xs font-bold uppercase tracking-widest text-slate-400">
                              {log.type}
                            </span>
                            <span className="text-[10px] text-slate-500 font-medium">
                              {log.createdAt ? new Date(log.createdAt).toLocaleString() : '—'}
                            </span>
                          </div>
                          <p className="text-sm text-slate-700 dark:text-slate-300 font-medium leading-relaxed">
                            {log.details}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              
              <div className="p-6 border-t border-slate-200 dark:border-white/5 bg-slate-50/50 dark:bg-white/[0.02] flex justify-end">
                <button
                  onClick={() => setSelectedUserLogs(null)}
                  className="px-6 py-2.5 bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-xl font-bold text-sm hover:opacity-90 transition-all shadow-lg"
                >
                  Close
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

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

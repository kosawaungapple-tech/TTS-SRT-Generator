import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  ShieldCheck, 
  ShieldAlert,
  Shield,
  UserPlus, 
  Trash2, 
  CheckCircle2, 
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
  LogIn,
  Megaphone,
  Info,
  PartyPopper
} from 'lucide-react';
import { SystemConfig, PronunciationRule, GlobalSettings, VBSUserControl, ActivityLog, Announcement } from '../types';
import { db, collection, onSnapshot, query, orderBy, setDoc, doc, deleteDoc, updateDoc, handleFirestoreError, OperationType, getDoc, auth, where, limit, getDocs, serverTimestamp } from '../firebase';
import { GeminiTTSService } from '../services/geminiService';
import { Toast, ToastType } from './Toast';
import { Modal, ModalType } from './Modal';
import { useLanguage } from '../contexts/LanguageContext';

interface AdminDashboardProps {
  isAuthReady: boolean;
  onAdminLogin?: (code: string) => void;
  configOnly?: boolean;
  isSessionSynced: boolean;
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({ 
  isAuthReady, 
  onAdminLogin, 
  configOnly = false,
  isSessionSynced
}) => {
  const { t } = useLanguage();
  const [isLoading, setIsLoading] = useState(true);
  const [newId, setNewId] = useState('');
  const [newNote, setNewNote] = useState('');
  const [newRole, setNewRole] = useState<'admin' | 'user'>('user');
  const [newExpiryDate, setNewExpiryDate] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeletingUser, setIsDeletingUser] = useState<string | null>(null);
  const [vbsUsers, setVbsUsers] = useState<VBSUserControl[]>([]);
  const [fetchError, setFetchError] = useState<string | null>(null);
  
  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>([]);
  const [selectedUserLogs, setSelectedUserLogs] = useState<string | null>(null);
  const [isLogsLoading, setIsLogsLoading] = useState(false);

  const isAdmin = (code: string | null): boolean => {
    if (!code) return false;
    const ADMIN_CODE = import.meta.env.VITE_ADMIN_ACCESS_CODE || 'saw_vlogs_2026';
    return code === ADMIN_CODE;
  };

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

  const handleUpdateVbsUser = async (vbsId: string, updates: Partial<VBSUserControl>) => {
    try {
      await setDoc(doc(db, 'user_controls', vbsId), {
        ...updates,
        vbsId: vbsId, // Ensure ID is present if creating
        updatedAt: serverTimestamp()
      }, { merge: true });
    } catch (err) {
      console.error("Failed to update user:", err);
      // Fallback: If update fails, we could update local state or tell user
      setToast({ message: 'Update failed. Check permissions.', type: 'error', isVisible: true });
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
    } catch {
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
  const [activeTab, setActiveTab] = useState<'users' | 'system' | 'rules' | 'announcements'>('users');

  const [newAnnouncement, setNewAnnouncement] = useState<Partial<Announcement>>({
    message: '',
    type: 'info',
    isActive: true,
    dismissible: true,
    title: '',
    ctaLabel: '',
    ctaLink: '',
    scrollSpeed: 'normal'
  });
  const [isSavingAnnouncement, setIsSavingAnnouncement] = useState(false);
  const [editingAnnouncementId, setEditingAnnouncementId] = useState<string | null>(null);

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
    if (savedAdminAuth === 'true') {
      const adminCode = localStorage.getItem('vbs_access_code') || '';
      
      if (isAdmin(adminCode)) {
        setIsAuthenticated(true);
      } else {
        localStorage.removeItem('vbs_admin_auth');
        return;
      }
      
      // Ensure session is synced on mount if already authenticated
      if (isAuthReady && auth.currentUser && adminCode) {
        setDoc(doc(db, 'sessions', auth.currentUser.uid), {
          accessCode: adminCode,
          createdAt: serverTimestamp()
        })
        .then(() => {
          if (onAdminLogin) onAdminLogin(adminCode);
        })
        .catch(err => {
          console.error('Failed to sync admin session on mount:', err);
          if (onAdminLogin) onAdminLogin(adminCode);
        });
      } else if (isAuthReady && adminCode) {
        if (onAdminLogin) onAdminLogin(adminCode);
      }
    }
  }, [isAuthReady]);

  const handleAdminAuth = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setAuthError(null);
    setIsSubmitting(true);
    
    try {
      const code = adminIdInput.trim();
      
      if (isAdmin(code)) {
        setIsAuthenticated(true);
        localStorage.setItem('vbs_admin_auth', 'true');
        localStorage.setItem('vbs_access_granted', 'true');
        localStorage.setItem('vbs_access_code', code);
        
        if (auth.currentUser) {
          await setDoc(doc(db, 'sessions', auth.currentUser.uid), {
            accessCode: code,
            createdAt: serverTimestamp()
          });
        }
        
        if (onAdminLogin) onAdminLogin(code);
        
        setToast({
          message: 'Admin Access Granted! 🛡️',
          type: 'success',
          isVisible: true
        });
      } else {
        setAuthError("Unauthorized Access: Admin Privileges Required");
        setToast({
          message: 'Unauthorized Access',
          type: 'error',
          isVisible: true
        });
      }
    } catch (err) {
      console.error('Admin auth error:', err);
      setAuthError("Auth verification failed");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAdminLogout = () => {
    setIsAuthenticated(false);
    localStorage.removeItem('vbs_admin_auth');
  };

  useEffect(() => {
    // Wait for everything to be ready
    if (!isAuthenticated || !isAuthReady) {
      setIsLoading(true);
      return;
    }
    
    // Ensure we have an access code and it's properly synced
    const adminCode = localStorage.getItem('vbs_access_code') || '';
    if (!adminCode || !isAdmin(adminCode)) {
      setAuthError("Unauthorized: Not identified as Admin");
      setIsLoading(false);
      return;
    }

    if (!isSessionSynced) {
      console.log("AdminDashboard: Waiting for session sync to Firestore rules...");
      setIsLoading(true);
      return;
    }

    console.log("AdminDashboard: Initializing user_controls listener...");
    setIsLoading(true);
    const q = query(collection(db, 'user_controls'), orderBy('updatedAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const users = snapshot.docs.map(doc => doc.data() as VBSUserControl);
      setVbsUsers(users);
      setIsLoading(false);
      setFetchError(null);
      // Persist to localStorage for fallback
      localStorage.setItem('user_controls_fallback', JSON.stringify(users));
    }, (error) => {
      setIsLoading(false);
      const err = error as { code?: string; message?: string };
      console.error("Firestore Permission Error in AdminDashboard:", err);

      if (err.code === 'permission-denied' || err.message?.includes('permission')) {
        setFetchError('Firestore: Permission Denied. Please ensure you are logged in as Admin and your session is synced with valid accessCode.');
        // Use localStorage fallback
        const localData = localStorage.getItem('user_controls_fallback');
        if (localData) {
          try {
            setVbsUsers(JSON.parse(localData));
            setToast({ message: 'Using local data (Firestore Permission Denied)', type: 'warning', isVisible: true });
          } catch {
            setVbsUsers([]);
          }
        } else {
          setVbsUsers([]);
        }
      } else {
        setFetchError('Error loading users: ' + (err.message || 'Unknown error'));
      }
      handleFirestoreError(error, OperationType.LIST, 'user_controls');
    });

    return () => unsubscribe();
  }, [isAuthenticated, isAuthReady, isSessionSynced]);

  useEffect(() => {
    const adminCode = localStorage.getItem('vbs_access_code') || '';
    if (!isAuthenticated || !isAuthReady || !isSessionSynced || !isAdmin(adminCode)) return;

    const unsubscribe = onSnapshot(collection(db, 'globalRules'), (snapshot) => {
      const fetchedRules = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as PronunciationRule[];
      setRules(fetchedRules);
      setIsRulesLoading(false);
    }, (err) => {
      if (err.message.includes('permission')) {
        setToast({ message: 'Permission Denied: Admin role required for globalRules', type: 'error', isVisible: true });
      }
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
          createdAt: serverTimestamp()
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
    if (!isAuthenticated || !isAuthReady || !isSessionSynced) return;

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
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    setIsSavingSystem(true);
    try {
      await setDoc(doc(db, 'system_config', 'main'), {
        ...systemConfig,
        updatedAt: serverTimestamp()
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
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
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
        updatedAt: serverTimestamp()
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
      
      // Save directly to user_controls
      await setDoc(doc(db, 'user_controls', accessCode), {
        vbsId: accessCode,
        dailyUsage: 0,
        lastUsedDate: new Date().toDateString(),
        isUnlimited: newRole === 'admin',
        membershipStatus: newRole === 'admin' ? 'premium' : 'standard',
        isBlocked: false,
        expiryDate: newExpiryDate || null,
        role: newRole,
        note: newNote.trim(),
        password: newPassword.trim() || null,
        isActive: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
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
    } catch (err: unknown) {
      handleFirestoreError(err, OperationType.CREATE, `user_controls/${newId.trim()}`);
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
    const user = vbsUsers.find(u => u.vbsId === id);
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
          await updateDoc(doc(db, 'user_controls', id), {
            password: password.trim() || null,
            updatedAt: serverTimestamp()
          });
          setToast({
            message: 'Password Updated ✨',
            type: 'success',
            isVisible: true
          });
        } catch (err) {
          handleFirestoreError(err, OperationType.UPDATE, `user_controls/${id}`);
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
      
      await setDoc(doc(db, 'user_controls', id), {
        expiryDate: isoExpiry,
        vbsId: id,
        updatedAt: serverTimestamp()
      }, { merge: true });
      
      setToast({
        message: 'Subscription Extended 30 Days! 📅',
        type: 'success',
        isVisible: true
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `user_controls/${id}`);
      setToast({
        message: 'Failed to extend subscription.',
        type: 'error',
        isVisible: true
      });
    }
  };

  const handleSaveAnnouncement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAnnouncement.message?.trim()) return;

    setIsSavingAnnouncement(true);
    try {
      const announcements = globalSettings.announcements || [];
      let updatedAnnouncements: Announcement[];

      if (editingAnnouncementId) {
        updatedAnnouncements = announcements.map(a => 
          a.id === editingAnnouncementId 
            ? { ...a, ...newAnnouncement, id: a.id, createdAt: a.createdAt } as Announcement 
            : a
        );
        setToast({ message: 'Announcement updated!', type: 'success', isVisible: true });
      } else {
        const announcement: Announcement = {
          ...newAnnouncement,
          id: `ann_${Date.now()}`,
          createdAt: new Date().toISOString(),
        } as Announcement;
        updatedAnnouncements = [announcement, ...announcements];
        setToast({ message: 'Announcement created!', type: 'success', isVisible: true });
      }

      const updatedSettings = { ...globalSettings, announcements: updatedAnnouncements };
      setGlobalSettings(updatedSettings);
      
      // Save to Firestore
      try {
        await setDoc(doc(db, 'settings', 'global'), {
          ...updatedSettings,
          api_keys: updatedSettings.api_keys || [],
          updatedAt: serverTimestamp()
        });
      } catch (err: unknown) {
        const error = err as { message?: string; code?: string };
        if (error.message?.includes('permission') || error.code === 'permission-denied') {
          // Fallback to localStorage
          localStorage.setItem('vbs_offline_announcements', JSON.stringify(updatedAnnouncements));
          console.warn('Saved announcements to localStorage due to Firestore permissions');
          setToast({ 
            message: 'Firestore permission error — Local storage တွင် ယာယီသိမ်းဆည်းလိုက်ပါသည်။ (Firebase Console တွင် Rules update လုပ်ပါ သို့မဟုတ် user document တွင် role: \'admin\' ထည့်ပါ)', 
            type: 'warning', 
            isVisible: true 
          });
        } else {
          throw err;
        }
      }

      setNewAnnouncement({
        message: '',
        type: 'info',
        isActive: true,
        dismissible: true,
        title: '',
        ctaLabel: '',
        ctaLink: ''
      });
      setEditingAnnouncementId(null);
    } catch (error) {
      console.error("Failed to save announcement:", error);
      setToast({ message: 'Failed to save announcement', type: 'error', isVisible: true });
    } finally {
      setIsSavingAnnouncement(false);
    }
  };

  const handleDeleteAnnouncement = async (id: string) => {
    openModal({
      title: 'Delete Announcement',
      message: 'Are you sure you want to delete this announcement?',
      type: 'confirm',
      confirmText: 'Delete',
      onConfirm: async () => {
        try {
          const announcements = globalSettings.announcements || [];
          const updatedAnnouncements = announcements.filter(a => a.id !== id);
          
          const updatedSettings = { ...globalSettings, announcements: updatedAnnouncements };
          setGlobalSettings(updatedSettings);
          
          await setDoc(doc(db, 'settings', 'global'), {
            ...updatedSettings,
            api_keys: updatedSettings.api_keys || [],
            updatedAt: serverTimestamp()
          });

          setToast({ message: 'Announcement deleted', type: 'success', isVisible: true });
        } catch (error) {
          console.error("Failed to delete announcement:", error);
          setToast({ message: 'Failed to delete', type: 'error', isVisible: true });
        }
      }
    });
  };

  const handleEditAnnouncement = (ann: Announcement) => {
    setNewAnnouncement(ann);
    setEditingAnnouncementId(ann.id);
    window.scrollTo({ top: 0, behavior: 'smooth' });
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

          await updateDoc(doc(db, 'user_controls', id), {
            expiryDate: isoExpiry,
            updatedAt: serverTimestamp()
          });
          
          setToast({
            message: 'Custom Expiry Date Set! 📅',
            type: 'success',
            isVisible: true
          });
        } catch (err) {
          handleFirestoreError(err, OperationType.UPDATE, `user_controls/${id}`);
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
      await updateDoc(doc(db, 'user_controls', id), {
        isActive: !currentStatus,
        updatedAt: serverTimestamp()
      });
      setToast({
        message: 'User Status Updated!',
        type: 'success',
        isVisible: true
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `user_controls/${id}`);
      setToast({
        message: 'Failed to update user status.',
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
          await deleteDoc(doc(db, 'user_controls', id));
          setToast({
            message: 'User ID Deleted Successfully!',
            type: 'success',
            isVisible: true
          });
        } catch (err) {
          handleFirestoreError(err, OperationType.DELETE, `user_controls/${id}`);
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

  const filteredUsers = vbsUsers.filter(u => 
    u.vbsId !== 'saw_vlogs_2026' && (
      u.vbsId.toLowerCase().includes(searchQuery.toLowerCase()) || 
      (u.note || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (u.role || '').toLowerCase().includes(searchQuery.toLowerCase())
    )
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
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest px-1">{t('admin.idLabel')}</label>
              <div className="relative">
                <Shield className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={20} />
                <input
                  type="text"
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
                    type="button"
                    onClick={() => {
                      window.history.pushState({}, '', '/');
                      window.dispatchEvent(new Event('popstate'));
                    }}
                    className="px-3 sm:px-4 py-2 rounded-lg text-[10px] sm:text-xs font-bold transition-all flex items-center gap-1.5 sm:gap-2 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 whitespace-nowrap"
                  >
                  <Mic2 size={14} /> {t('nav.studio')}
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('users')}
                  className={`px-3 sm:px-4 py-2 rounded-lg text-[10px] sm:text-xs font-bold transition-all flex items-center gap-1.5 sm:gap-2 whitespace-nowrap ${activeTab === 'users' ? 'bg-white dark:bg-slate-800 text-brand-purple shadow-sm' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
                >
                  <User size={14} /> {t('admin.tabUsers') || 'Users'}
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('system')}
                  className={`px-3 sm:px-4 py-2 rounded-lg text-[10px] sm:text-xs font-bold transition-all flex items-center gap-1.5 sm:gap-2 whitespace-nowrap ${activeTab === 'system' ? 'bg-white dark:bg-slate-800 text-brand-purple shadow-sm' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
                >
                  <Settings size={14} /> {t('admin.tabSystem') || 'System'}
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('rules')}
                  className={`px-3 sm:px-4 py-2 rounded-lg text-[10px] sm:text-xs font-bold transition-all flex items-center gap-1.5 sm:gap-2 whitespace-nowrap ${activeTab === 'rules' ? 'bg-white dark:bg-slate-800 text-brand-purple shadow-sm' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
                >
                  <Languages size={14} /> {t('admin.tabRules') || 'Rules'}
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('announcements')}
                  className={`px-3 sm:px-4 py-2 rounded-lg text-[10px] sm:text-xs font-bold transition-all flex items-center gap-1.5 sm:gap-2 whitespace-nowrap ${activeTab === 'announcements' ? 'bg-white dark:bg-slate-800 text-brand-purple shadow-sm' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
                >
                  <Megaphone size={14} /> {t('admin.tabAnnouncements') || 'Announcements'}
                </button>
              </div>
            )}
            <button 
              type="button"
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
            {fetchError && (
              <div className="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-500">
                <div className="flex items-start gap-2 mb-2">
                  <ShieldAlert size={16} className="shrink-0 mt-0.5" />
                  <p className="text-xs font-bold leading-tight">{fetchError}</p>
                </div>
                {!isSessionSynced && (
                   <p className="text-[10px] opacity-80 mt-1">Waiting for session sync... (ခေတ္တစောင့်ဆိုင်းပေးပါ...)</p>
                )}
                <button 
                  onClick={() => window.location.reload()}
                  className="mt-2 text-[10px] font-black uppercase tracking-widest hover:underline"
                >
                  Retry / Reload
                </button>
              </div>
            )}
            
            <div className="flex items-center gap-3 mb-6">
              <div className="flex items-center gap-3 flex-1">
                <UserPlus className="text-brand-purple" size={20} />
                <h3 className="text-lg font-bold text-slate-900 dark:text-white">Create New User ID</h3>
              </div>
              {(!isAdmin(localStorage.getItem('vbs_access_code')) || !isSessionSynced) && (
                <div className="flex items-center gap-1.5 px-2 py-1 bg-amber-500/10 text-amber-500 rounded-md border border-amber-500/20 animate-pulse">
                  <Lock size={12} />
                  <span className="text-[9px] font-black uppercase">Locked</span>
                </div>
              )}
            </div>

            <form onSubmit={handleCreateId} className={`space-y-4 ${(!isAdmin(localStorage.getItem('vbs_access_code')) || !isSessionSynced) ? 'opacity-50 pointer-events-none' : ''}`}>
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
                  {filteredUsers.length} {t('admin.stats')}
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
                      <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-widest min-w-[140px]">{t('admin.id')}</th>
                      <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-widest min-w-[200px]">{t('admin.details')}</th>
                      <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-widest min-w-[150px]">{t('admin.usage')}</th>
                      <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-widest min-w-[180px]">{t('admin.membership')}</th>
                      <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-widest text-right">{t('admin.actions')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-white/5">
                    {filteredUsers.map((u) => (
                      <tr key={u.vbsId} className="hover:bg-slate-50 dark:hover:bg-white/5 transition-colors group">
                        <td className="px-4 py-4">
                          <div className="flex items-center gap-2">
                            <div className={`w-2 h-2 rounded-full shrink-0 ${u.isActive ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]'}`} title={u.isActive ? t('admin.active') : t('admin.deactivated')} />
                            {(u.role === 'admin' || u.vbsId.toLowerCase().includes('admin')) ? (
                              <span className="px-2 py-1 rounded-md bg-gradient-to-r from-purple-600/10 to-amber-500/10 text-purple-600 dark:text-purple-400 text-[9px] font-black uppercase tracking-tighter border border-purple-500/20 shadow-[0_0_15px_rgba(168,85,247,0.15)] flex items-center gap-1.5 whitespace-nowrap">
                                <ShieldCheck size={10} className="text-amber-500" /> {t('admin.adminRole')}
                              </span>
                            ) : (
                              <span className="font-mono text-sm text-slate-900 dark:text-white bg-slate-100 dark:bg-white/5 px-2 py-1 rounded border border-slate-200 dark:border-white/10 truncate max-w-[120px]" title={u.vbsId}>{u.vbsId}</span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-4">
                          <div className="flex flex-col gap-1.5 overflow-hidden">
                            <span className="text-sm text-slate-700 dark:text-slate-300 font-medium truncate" title={u.note || '—'}>{u.note || '—'}</span>
                            <div className="flex items-center gap-2 group/pass">
                              <span className="font-mono text-[10px] text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-white/5 px-1.5 py-0.5 rounded border border-slate-200 dark:border-white/5 min-w-[80px] text-center">
                                {visiblePasswords.has(u.vbsId) ? (u.password || '—') : '••••••••'}
                              </span>
                              <button 
                                onClick={() => togglePasswordVisibility(u.vbsId)}
                                className="p-1 text-slate-400 hover:text-brand-purple transition-all"
                              >
                                {visiblePasswords.has(u.vbsId) ? <EyeOff size={10} /> : <Eye size={10} />}
                              </button>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-4">
                          {(() => {
                            const lastLogin = u.lastLoginAt ? new Date(u.lastLoginAt) : null;
                            const isToday = u.lastUsedDate === new Date().toDateString();
                            
                            return (
                              <div className="flex flex-col gap-1 min-w-[130px]">
                                <span className="text-xs font-bold text-brand-purple flex items-center gap-1">
                                  {isToday ? (u.dailyTasks || 0) : 0} {t('admin.tasksToday')}
                                  <button onClick={() => handleShowActivityLogs(u.vbsId)} className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity"><Eye size={12} /></button>
                                </span>
                                <span className="text-[10px] text-slate-500 dark:text-slate-400 truncate">
                                  {lastLogin ? timeSince(lastLogin) + " ago" : "Never"}
                                </span>
                              </div>
                            );
                          })()}
                        </td>
                        <td className="px-4 py-4">
                          <div className="flex flex-col gap-2">
                            <div className="flex items-center gap-3">
                              {(() => {
                                const isAdmin = u.role === 'admin';
                                const isPremium = u.membershipStatus === 'premium' || isAdmin;
                                return (
                                  <>
                                    <div className="flex items-center gap-1.5 min-w-[80px]">
                                      <span className={`px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-[0.1em] border flex items-center gap-1 w-fit whitespace-nowrap ${isAdmin ? 'bg-amber-500/10 text-amber-500 border-amber-500/20' : (isPremium ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20' : 'bg-slate-100 dark:bg-white/10 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-white/10')}`}>
                                        {isAdmin ? t('admin.adminRole') : (isPremium ? 'PREMIUM' : 'STANDARD')}
                                      </span>
                                    </div>
                                    
                                    {/* Toggle Inline */}
                                    <button
                                      onClick={async () => {
                                        if (isAdmin) return;
                                        const nextStatus = isPremium ? 'standard' : 'premium';
                                        await handleUpdateVbsUser(u.vbsId, { membershipStatus: nextStatus });
                                      }}
                                      disabled={isAdmin}
                                      className={`relative w-8 h-4 transition-all duration-300 rounded-full p-0.5 border ${
                                        isAdmin ? 'opacity-30 grayscale cursor-not-allowed' : 'cursor-pointer'
                                      } ${isPremium || isAdmin ? 'bg-brand-purple/20 border-brand-purple/40' : 'bg-slate-200 dark:bg-slate-800 border-slate-300 dark:border-slate-700'}`}
                                    >
                                      <motion.div
                                        animate={{ x: (isPremium || isAdmin) ? 14 : 0 }}
                                        className={`w-2.5 h-2.5 rounded-full ${isPremium || isAdmin ? 'bg-brand-purple' : 'bg-slate-400'}`}
                                      />
                                    </button>
                                  </>
                                );
                              })()}
                            </div>
                            <div className="mt-1">
                              {renderExpiry(u.expiryDate)}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-4 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <button onClick={() => handleExtendExpiry(u.vbsId, u.expiryDate)} className="p-1.5 text-slate-400 hover:text-brand-purple hover:bg-slate-100 dark:hover:bg-white/5 rounded-lg transition-all" title={t('admin.extend30Days')}><Calendar size={14} /></button>
                            <button onClick={() => handleSetCustomExpiry(u.vbsId)} className="p-1.5 text-slate-400 hover:text-brand-purple hover:bg-slate-100 dark:hover:bg-white/5 rounded-lg transition-all" title={t('admin.setCustomExpiry')}><Edit3 size={14} /></button>
                            <button onClick={() => handleUpdatePassword(u.vbsId)} className="p-1.5 text-slate-400 hover:text-brand-purple hover:bg-slate-100 dark:hover:bg-white/5 rounded-lg transition-all" title={t('admin.updatePassword')}><Lock size={14} /></button>
                            <button
                              type="button"
                              onClick={() => {
                                handleUpdateVbsUser(u.vbsId, { isUnlimited: !u.isUnlimited });
                              }}
                              className={`p-1.5 rounded-lg transition-all ${u.isUnlimited ? 'text-emerald-500 bg-emerald-500/10' : 'text-slate-400 hover:text-emerald-500 hover:bg-slate-100 dark:hover:bg-white/5'}`}
                              title={t('admin.toggleVIP')}
                            >
                              <Sparkles size={14} />
                            </button>
                            <button 
                              type="button"
                              onClick={() => handleToggleStatus(u.vbsId, !!u.isActive)} className={`p-1.5 rounded-lg transition-all ${u.isActive ? 'text-amber-500 hover:bg-amber-500/10' : 'text-emerald-500 hover:bg-emerald-500/10'}`} title={u.isActive ? t('admin.deactivate') : t('admin.activate')}><RefreshCw size={14} /></button>
                            <button onClick={() => handleDeleteId(u.vbsId)} disabled={isDeletingUser === u.vbsId} className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-500/10 rounded-lg transition-all disabled:opacity-50" title={t('history.delete')}>{isDeletingUser === u.vbsId ? <RefreshCw size={14} className="animate-spin" /> : <Trash2 size={14} />}</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {filteredUsers.length === 0 && (
                      <tr>
                        <td colSpan={5} className="py-20 text-center">
                          {fetchError ? (
                            <div className="flex flex-col items-center gap-4 text-rose-500">
                              <ShieldAlert size={40} className="mb-2" />
                              <div className="max-w-md">
                                <p className="font-bold text-sm mb-1">Firestore Access Denied</p>
                                <p className="text-xs text-slate-400 dark:text-slate-500 leading-relaxed">
                                  Admin Dashboard can only read User Data if your access code is correct and session is synced to Firestore.
                                  <br/><br/>
                                  Current Status: <span className="text-brand-purple uppercase">{isSessionSynced ? 'Synced' : 'Syncing...'}</span>
                                </p>
                              </div>
                              <div className="flex gap-4">
                                 <button 
                                   onClick={() => window.location.reload()}
                                   className="px-6 py-2 bg-rose-500 text-white rounded-full text-xs font-bold hover:bg-rose-600 transition-all"
                                 >
                                   Reload App
                                 </button>
                                 {!isSessionSynced && (
                                   <div className="px-6 py-2 bg-slate-100 dark:bg-white/5 text-slate-500 rounded-full text-xs font-bold animate-pulse">
                                     Syncing Session...
                                   </div>
                                 )}
                              </div>
                            </div>
                          ) : (
                            <div className="flex flex-col items-center gap-4 text-slate-500 italic text-sm">
                              <Search size={32} className="opacity-20" />
                              {t('admin.noUsers')}
                            </div>
                          )}
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
          {/* Admin Master Settings - Hidden Section */}
          {vbsUsers.some(u => u.role === 'admin' && u.vbsId === auth.currentUser?.uid) && (
            <div className="premium-glass rounded-[32px] p-6 sm:p-8 shadow-2xl transition-all duration-300 border border-brand-purple/20 bg-brand-purple/5">
              <div className="flex items-center gap-3 mb-8">
                <div className="w-10 h-10 bg-brand-purple text-white rounded-xl flex items-center justify-center shadow-lg shadow-brand-purple/30">
                  <ShieldAlert size={20} />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-slate-900 dark:text-white">{t('admin.adminFeatureControl')}</h3>
                  <p className="text-brand-purple font-bold text-[10px] uppercase tracking-widest opacity-80">Super Admin Access Only</p>
                </div>
              </div>

              <div className="bg-white/50 dark:bg-slate-900/50 border border-brand-purple/10 rounded-2xl p-6 space-y-6">
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <h4 className="text-sm font-bold text-slate-900 dark:text-white">{t('admin.allowVideoRecapAdmin')}</h4>
                    <p className="text-xs text-slate-500 dark:text-slate-400">Control if Admin Key can be used for Video Recap features.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setGlobalSettings({ ...globalSettings, allow_video_recap_admin_key: !globalSettings.allow_video_recap_admin_key })}
                    className={`w-12 h-6 rounded-full transition-all relative ${globalSettings.allow_video_recap_admin_key ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-700'}`}
                  >
                    <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${globalSettings.allow_video_recap_admin_key ? 'left-7' : 'left-1'}`} />
                  </button>
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <h4 className="text-sm font-bold text-slate-900 dark:text-white">{t('admin.allowThumbnailAdmin')}</h4>
                    <p className="text-xs text-slate-500 dark:text-slate-400">Control if Admin Key can be used for Thumbnail Generator.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setGlobalSettings({ ...globalSettings, allow_thumbnail_admin_key: !globalSettings.allow_thumbnail_admin_key })}
                    className={`w-12 h-6 rounded-full transition-all relative ${globalSettings.allow_thumbnail_admin_key ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-700'}`}
                  >
                    <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${globalSettings.allow_thumbnail_admin_key ? 'left-7' : 'left-1'}`} />
                  </button>
                </div>
              </div>
            </div>
          )}

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

      {activeTab === 'announcements' && !configOnly && (
        <div className="max-w-5xl mx-auto w-full space-y-8">
          <div className="premium-glass rounded-[32px] p-6 sm:p-8 shadow-2xl transition-all duration-300 border border-white/5">
            <div className="flex items-center gap-3 mb-8">
              <div className="w-10 h-10 bg-brand-purple/20 text-brand-purple rounded-xl flex items-center justify-center border border-brand-purple/20">
                <Megaphone size={20} />
              </div>
              <div>
                <h3 className="text-xl font-bold text-slate-900 dark:text-white">{t('admin.tabAnnouncements') || 'User Announcements'}</h3>
                <p className="text-slate-500 dark:text-slate-400 text-xs">Push notices and promotions to users</p>
              </div>
            </div>

            <form onSubmit={handleSaveAnnouncement} className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-12">
              <div className="md:col-span-2 space-y-2">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest px-1">Announcement Message</label>
                <textarea
                  value={newAnnouncement.message}
                  onChange={(e) => setNewAnnouncement({ ...newAnnouncement, message: e.target.value })}
                  placeholder="What would you like to tell your users?"
                  className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl px-4 py-3 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-purple/50 transition-all min-h-[100px]"
                  required
                />
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest px-1">Notice Type</label>
                <select
                  value={newAnnouncement.type}
                  onChange={(e) => setNewAnnouncement({ ...newAnnouncement, type: e.target.value as Announcement['type'] })}
                  className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-3 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand-purple/50 transition-all appearance-none"
                >
                  <option value="info">Information (Blue)</option>
                  <option value="warning">Warning (Yellow)</option>
                  <option value="success">Success (Green)</option>
                  <option value="promotion">Promotion (Special Card)</option>
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest px-1">Scroll Speed</label>
                <select
                  value={newAnnouncement.scrollSpeed || 'normal'}
                  onChange={(e) => setNewAnnouncement({ ...newAnnouncement, scrollSpeed: e.target.value as Announcement['scrollSpeed'] })}
                  className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-3 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand-purple/50 transition-all appearance-none"
                >
                  <option value="slow">Slow (25s)</option>
                  <option value="normal">Normal (15s)</option>
                  <option value="fast">Fast (8s)</option>
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest px-1">Dismissible</label>
                <div className="flex items-center gap-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-3 h-[46px]">
                  <span className="text-xs text-slate-500 flex-grow">Can users close this?</span>
                  <button
                    type="button"
                    onClick={() => setNewAnnouncement({ ...newAnnouncement, dismissible: !newAnnouncement.dismissible })}
                    className={`w-10 h-5 rounded-full transition-all relative ${newAnnouncement.dismissible ? 'bg-brand-purple' : 'bg-slate-300 dark:bg-slate-700'}`}
                  >
                    <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${newAnnouncement.dismissible ? 'left-6' : 'left-1'}`} />
                  </button>
                </div>
              </div>

              {newAnnouncement.type === 'promotion' && (
                <>
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest px-1">Promotion Title</label>
                    <input
                      type="text"
                      value={newAnnouncement.title || ''}
                      onChange={(e) => setNewAnnouncement({ ...newAnnouncement, title: e.target.value })}
                      placeholder="e.g. Premium Plan Discount"
                      className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-3 text-sm text-slate-900 dark:text-white"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest px-1">CTA Label</label>
                    <input
                      type="text"
                      value={newAnnouncement.ctaLabel || ''}
                      onChange={(e) => setNewAnnouncement({ ...newAnnouncement, ctaLabel: e.target.value })}
                      placeholder="e.g. Upgrade Now"
                      className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-3 text-sm text-slate-900 dark:text-white"
                    />
                  </div>
                  <div className="md:col-span-2 space-y-2">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest px-1">CTA Link (URL)</label>
                    <input
                      type="text"
                      value={newAnnouncement.ctaLink || ''}
                      onChange={(e) => setNewAnnouncement({ ...newAnnouncement, ctaLink: e.target.value })}
                      placeholder="https://..."
                      className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-3 text-sm text-slate-900 dark:text-white"
                    />
                  </div>
                </>
              )}

              <div className="space-y-2">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest px-1">Start Date (Optional)</label>
                <input
                  type="date"
                  value={newAnnouncement.startDate || ''}
                  onChange={(e) => setNewAnnouncement({ ...newAnnouncement, startDate: e.target.value })}
                  className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-3 text-sm text-slate-900 dark:text-white"
                />
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest px-1">End Date (Optional)</label>
                <input
                  type="date"
                  value={newAnnouncement.endDate || ''}
                  onChange={(e) => setNewAnnouncement({ ...newAnnouncement, endDate: e.target.value })}
                  className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-3 text-sm text-slate-900 dark:text-white"
                />
              </div>

              <div className="md:col-span-2 flex gap-3 pt-4">
                <button
                  type="submit"
                  disabled={isSavingAnnouncement}
                  className="flex-1 py-4 bg-brand-purple text-white rounded-2xl font-bold hover:bg-brand-purple/90 transition-all shadow-lg shadow-brand-purple/20 flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {isSavingAnnouncement ? <RefreshCw size={20} className="animate-spin" /> : (editingAnnouncementId ? <Save size={20} /> : <Plus size={20} />)}
                  {editingAnnouncementId ? 'Update Announcement' : 'Post Announcement'}
                </button>
                {editingAnnouncementId && (
                  <button
                    type="button"
                    onClick={() => {
                      setNewAnnouncement({ message: '', type: 'info', isActive: true, dismissible: true, title: '', ctaLabel: '', ctaLink: '', scrollSpeed: 'normal' });
                      setEditingAnnouncementId(null);
                    }}
                    className="px-6 py-4 bg-slate-100 dark:bg-slate-900/50 text-slate-500 rounded-2xl font-bold hover:bg-slate-200 dark:hover:bg-slate-800 transition-all border border-slate-200 dark:border-slate-800"
                  >
                    Cancel
                  </button>
                )}
              </div>
            </form>

            <div className="space-y-4">
              <div className="flex items-center gap-2 pb-2 border-b border-slate-200 dark:border-white/5">
                <Megaphone size={16} className="text-brand-purple" />
                <h4 className="text-sm font-bold text-slate-900 dark:text-white uppercase tracking-wider">Posted Announcements ({globalSettings.announcements?.length || 0})</h4>
              </div>

              {(!globalSettings.announcements || globalSettings.announcements.length === 0) ? (
                <div className="py-10 text-center text-slate-500 italic text-sm">
                  No announcements yet.
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4">
                  {globalSettings.announcements.map((ann) => (
                    <div key={ann.id} className="flex items-center justify-between p-5 bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800 rounded-[24px] group hover:border-brand-purple/30 transition-all shadow-sm">
                      <div className="flex items-start gap-4 flex-grow min-w-0">
                        <div className={`p-3 rounded-xl ${
                          ann.type === 'promotion' ? 'bg-brand-purple/10 text-brand-purple' :
                          ann.type === 'warning' ? 'bg-amber-500/10 text-amber-500' :
                          ann.type === 'success' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-blue-500/10 text-blue-500'
                        }`}>
                          {ann.type === 'promotion' ? <PartyPopper size={20} /> : <Info size={20} />}
                        </div>
                        <div className="flex-grow min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">{ann.type}</span>
                            {ann.isActive ? (
                               <span className="text-[9px] font-bold text-emerald-500 bg-emerald-500/10 px-2 py-0.5 rounded-full uppercase">Active</span>
                            ) : (
                               <span className="text-[9px] font-bold text-slate-400 bg-slate-400/10 px-2 py-0.5 rounded-full uppercase">Hidden</span>
                            )}
                          </div>
                          {ann.title && <h5 className="font-bold text-slate-900 dark:text-white text-sm mb-0.5">{ann.title}</h5>}
                          <p className="text-sm text-slate-600 dark:text-slate-400 line-clamp-2 leading-relaxed">{ann.message}</p>
                        </div>
                      </div>
                      
                      <div className="flex items-center gap-2 pl-4">
                        <button
                          onClick={() => {
                            const updated = globalSettings.announcements?.map(a => a.id === ann.id ? { ...a, isActive: !a.isActive } : a) || [];
                            const updatedSettings = { ...globalSettings, announcements: updated };
                            setGlobalSettings(updatedSettings);
                            setDoc(doc(db, 'settings', 'global'), { ...updatedSettings, updatedAt: serverTimestamp() }, { merge: true });
                          }}
                          className={`p-2 transition-all rounded-lg ${ann.isActive ? 'text-emerald-500 hover:bg-emerald-500/10' : 'text-slate-400 hover:bg-slate-400/10'}`}
                        >
                          {ann.isActive ? <Eye size={18} /> : <EyeOff size={18} />}
                        </button>
                        <button
                          onClick={() => handleEditAnnouncement(ann)}
                          className="p-2 text-slate-400 hover:text-brand-purple hover:bg-brand-purple/10 rounded-lg transition-all"
                        >
                          <Edit3 size={18} />
                        </button>
                        <button
                          onClick={() => handleDeleteAnnouncement(ann.id)}
                          className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-500/10 rounded-lg transition-all"
                        >
                          <Trash2 size={18} />
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

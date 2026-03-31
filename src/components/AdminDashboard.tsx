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
  Users,
  AlertCircle,
  RefreshCw,
  Lock,
  Shield,
  Settings,
  Database,
  Send,
  Eye,
  EyeOff,
  Save,
  Languages,
  Edit3,
  Zap,
  LogOut,
  LayoutDashboard,
  Activity,
  BarChart3,
  TrendingUp,
  AlertTriangle,
  Wand2,
  Copy
} from 'lucide-react';
import { AppUser, Config, PronunciationRule, ApiKey } from '../types';
import { db, collection, onSnapshot, query, orderBy, setDoc, doc, deleteDoc, updateDoc, handleFirestoreError, OperationType, getDoc, auth, deleteField } from '../firebase';
import { safeStorage, safeClipboard } from '../utils/safeBrowser';
import { Toast, ToastType } from './Toast';
import { sendTelegramNotification } from '../services/telegramService';

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
  const [newPassword, setNewPassword] = useState('');
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

  // Multi-Key State
  const [geminiKeys, setGeminiKeys] = useState<ApiKey[]>([]);
  const [openaiKeys, setOpenaiKeys] = useState<ApiKey[]>([]);

  // Pronunciation Rules State
  const [rules, setRules] = useState<PronunciationRule[]>([]);
  const [newRuleOriginal, setNewRuleOriginal] = useState('');
  const [newRuleReplacement, setNewRuleReplacement] = useState('');
  const [isSavingRule, setIsSavingRule] = useState(false);
  const [isDeletingRule, setIsDeletingRule] = useState<string | null>(null);
  const [isRulesLoading, setIsRulesLoading] = useState(true);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [syncTimeoutReached, setSyncTimeoutReached] = useState(false);
  const [revealedPasswords, setRevealedPasswords] = useState<Record<string, boolean>>({});
  const [isTestingTelegram, setIsTestingTelegram] = useState(false);
  const [isSettingWebhook, setIsSettingWebhook] = useState(false);
  const [userActionModal, setUserActionModal] = useState<{
    isOpen: boolean;
    type: 'password' | 'delete' | 'generate' | 'clear' | 'deleteRule';
    user: AppUser | null;
    rule: PronunciationRule | null;
    inputValue: string;
    isProcessing: boolean;
  }>({
    isOpen: false,
    type: 'password',
    user: null,
    rule: null,
    inputValue: '',
    isProcessing: false
  });

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
    // COMMANDER'S ORDER: Strictly check password on every session.
    // No auto-auth from localStorage or access code.
    setIsAuthenticated(false);
  }, []);

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
      safeStorage.setItem('vbs_isAdmin', 'true');
    } else {
      setAuthError("စကားဝှက် မှားယွင်းနေပါသည်။ (Incorrect Password).");
    }
  };

  useEffect(() => {
    const isMasterAdmin = safeStorage.getItem('vbs_access_code') === 'saw_vlogs_2026';
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
    const isMasterAdmin = safeStorage.getItem('vbs_access_code') === 'saw_vlogs_2026';
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
    try {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {
      // Ignore scroll errors
    }
  };

  const cancelEditRule = () => {
    setNewRuleOriginal('');
    setNewRuleReplacement('');
    setEditingRuleId(null);
  };

  const handleDeleteRule = async (id: string) => {
    const rule = rules.find(r => r.id === id);
    if (!rule) return;
    setUserActionModal({
      isOpen: true,
      type: 'deleteRule',
      user: null,
      rule,
      inputValue: '',
      isProcessing: false
    });
  };

  useEffect(() => {
    if (globalConfig) {
      setLocalConfig(globalConfig);
      setGeminiKeys(globalConfig.gemini_api_keys || []);
      setOpenaiKeys(globalConfig.openai_api_keys || []);
    }
  }, [globalConfig]);

  const handleAddKey = (type: 'gemini' | 'openai') => {
    const newKey: ApiKey = {
      id: `key_${Date.now()}`,
      key: '',
      usageCount: 0,
      status: 'idle',
      label: `Key #${(type === 'gemini' ? geminiKeys : openaiKeys).length + 1}`
    };
    if (type === 'gemini') {
      setGeminiKeys([...geminiKeys, newKey]);
    } else {
      setOpenaiKeys([...openaiKeys, newKey]);
    }
  };

  const handleUpdateKey = (type: 'gemini' | 'openai', id: string, value: string) => {
    if (type === 'gemini') {
      setGeminiKeys(geminiKeys.map(k => k.id === id ? { ...k, key: value } : k));
    } else {
      setOpenaiKeys(openaiKeys.map(k => k.id === id ? { ...k, key: value } : k));
    }
  };

  const handleRemoveKey = (type: 'gemini' | 'openai', id: string) => {
    if (type === 'gemini') {
      setGeminiKeys(geminiKeys.filter(k => k.id !== id));
    } else {
      setOpenaiKeys(openaiKeys.filter(k => k.id !== id));
    }
  };

  const handleToggleSystemLive = async () => {
    const newValue = !localConfig.isSystemLive;
    setLocalConfig({ ...localConfig, isSystemLive: newValue });
    setIsSavingSystem(true);
    try {
      await updateDoc(doc(db, 'settings', 'global_config'), {
        isSystemLive: newValue,
        updatedAt: new Date().toISOString()
      });

      sendTelegramNotification(
        `🚀 <b>System Status Updated</b>\n\n` +
        `<b>New Status:</b> ${newValue ? '🟢 LIVE' : '🔴 OFFLINE'}\n` +
        `<b>Time:</b> ${new Date().toLocaleString()}`,
        localConfig
      ).catch(console.error);

      setToast({ message: `System is now ${newValue ? 'LIVE' : 'OFFLINE'}! 🚀`, type: 'success', isVisible: true });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, 'settings/global_config');
      setToast({ message: 'Failed to update system status.', type: 'error', isVisible: true });
      // Revert local state on error
      setLocalConfig({ ...localConfig, isSystemLive: !newValue });
    } finally {
      setIsSavingSystem(false);
    }
  };

  const handleToggleGlobalKey = async () => {
    const newValue = !localConfig.allow_global_key;
    setLocalConfig({ ...localConfig, allow_global_key: newValue });
    setIsSavingSystem(true);
    try {
      await updateDoc(doc(db, 'settings', 'global_config'), {
        allow_global_key: newValue,
        updatedAt: new Date().toISOString()
      });

      sendTelegramNotification(
        `🔑 <b>Global Key Usage Updated</b>\n\n` +
        `<b>New Status:</b> ${newValue ? '✅ ENABLED' : '❌ DISABLED'}\n` +
        `<b>Time:</b> ${new Date().toLocaleString()}`,
        localConfig
      ).catch(console.error);

      setToast({ message: `Global Key Usage is now ${newValue ? 'ENABLED' : 'DISABLED'}! 🔑`, type: 'success', isVisible: true });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, 'settings/global_config');
      setToast({ message: 'Failed to update global key setting.', type: 'error', isVisible: true });
      // Revert local state on error
      setLocalConfig({ ...localConfig, allow_global_key: !newValue });
    } finally {
      setIsSavingSystem(false);
    }
  };

  const handleTestTelegram = async () => {
    if (!localConfig.telegram_bot_token || !localConfig.telegram_chat_id) {
      setToast({
        message: 'Please provide both Bot Token and Chat ID first.',
        type: 'error',
        isVisible: true
      });
      return;
    }

    setIsTestingTelegram(true);
    try {
      await sendTelegramNotification('🔔 <b>Vlogs By Saw Test Notification</b>\n\nYour Telegram Bot is successfully connected! 🎉', localConfig);
      setToast({
        message: 'Test message sent! Check your Telegram.',
        type: 'success',
        isVisible: true
      });
    } catch (err: any) {
      console.error('Telegram Test Error:', err);
      setToast({
        message: `Failed: ${err.message || 'Unknown error'}`,
        type: 'error',
        isVisible: true
      });
    } finally {
      setIsTestingTelegram(false);
    }
  };

  const handleSetWebhook = async () => {
    if (!localConfig.telegram_bot_token) {
      setToast({ message: 'Please provide Bot Token first.', type: 'error', isVisible: true });
      return;
    }
    setIsSettingWebhook(true);
    try {
      const response = await fetch('/api/telegram/setup-webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: localConfig })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to set webhook');
      setToast({ message: 'Telegram Webhook set successfully! 🚀', type: 'success', isVisible: true });
    } catch (err: any) {
      setToast({ message: err.message || 'Failed to set webhook', type: 'error', isVisible: true });
    } finally {
      setIsSettingWebhook(false);
    }
  };

  const handleSaveSystemConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingSystem(true);
    try {
      const updatedConfig = {
        ...localConfig,
        gemini_api_keys: geminiKeys,
        openai_api_keys: openaiKeys,
        updatedAt: new Date().toISOString()
      };
      
      await setDoc(doc(db, 'settings', 'global_config'), updatedConfig);
      
      sendTelegramNotification(
        `⚙️ <b>System Config Updated</b>\n\n` +
        `<b>Gemini Keys:</b> ${geminiKeys.length}\n` +
        `<b>OpenAI Keys:</b> ${openaiKeys.length}\n` +
        `<b>Time:</b> ${new Date().toLocaleString()}`,
        localConfig
      ).catch(console.error);

      setToast({
        message: 'System configuration saved successfully! ✅',
        type: 'success',
        isVisible: true
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'settings/global_config');
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
    const isMasterAdmin = safeStorage.getItem('vbs_access_code') === 'saw_vlogs_2026';
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

  const hashPassword = async (password: string): Promise<string> => {
    if (!password) return '';
    const msgUint8 = new TextEncoder().encode(password);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    return hashHex;
  };

  const generateRandomString = (length: number = 8) => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  };

  const generatePassword = () => {
    const result = generateRandomString(Math.floor(Math.random() * 3) + 6);
    setNewPassword(result);
    setToast({ message: 'Password generated! 🪄', type: 'success', isVisible: true });
    setTimeout(() => setToast(prev => ({ ...prev, isVisible: false })), 2000);
  };

  const copyToClipboard = async (text: string) => {
    if (!text) return;
    
    const success = await safeClipboard.writeText(text);
    if (success) {
      setToast({ message: 'Password copied to clipboard! 📋', type: 'success', isVisible: true });
    } else {
      setToast({ message: 'Failed to copy. Please copy manually.', type: 'error', isVisible: true });
    }
    
    setTimeout(() => setToast(prev => ({ ...prev, isVisible: false })), 2000);
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newId.trim() || isSubmitting) return;

    const isMasterAdmin = safeStorage.getItem('vbs_access_code') === 'saw_vlogs_2026';
    
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

      const rawPassword = newPassword.trim();
      const hashedPassword = await hashPassword(rawPassword);

      const newUser: AppUser = {
        id,
        name: newName.trim() || id,
        password: hashedPassword,
        access_password: rawPassword,
        failedAttempts: 0,
        isActive: true,
        createdAt: new Date().toISOString(),
        expiryDate: expiryDate.toISOString()
      };

      console.log(`Attempting to create user: ${id} (Master Admin: ${isMasterAdmin})`);
      await setDoc(doc(db, 'users', id), newUser);
      
      sendTelegramNotification(
        `👤 <b>New User Created</b>\n\n` +
        `<b>User ID:</b> <code>${id}</code>\n` +
        `<b>Name:</b> ${newUser.name}\n` +
        `<b>Expiry:</b> ${new Date(newUser.expiryDate).toLocaleDateString()}\n` +
        `<b>Time:</b> ${new Date().toLocaleString()}`,
        localConfig
      ).catch(console.error);

      setNewId('');
      setNewName('');
      setNewPassword('');
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
          const rawPassword = newPassword.trim();
          const hashedPassword = await hashPassword(rawPassword);
          const newUser: AppUser = {
            id,
            name: newName.trim() || id,
            password: hashedPassword,
            access_password: rawPassword,
            failedAttempts: 0,
            isActive: true,
            createdAt: new Date().toISOString(),
            expiryDate: expiryDate.toISOString()
          };
          await setDoc(doc(db, 'users', id), newUser);
          
          sendTelegramNotification(
            `👤 <b>New User Created (Retry)</b>\n\n` +
            `<b>User ID:</b> <code>${id}</code>\n` +
            `<b>Name:</b> ${newUser.name}\n` +
            `<b>Expiry:</b> ${new Date(newUser.expiryDate).toLocaleDateString()}\n` +
            `<b>Time:</b> ${new Date().toLocaleString()}`,
            localConfig
          ).catch(console.error);

          setNewId('');
          setNewName('');
          setNewPassword('');
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

  const handleUserAction = async () => {
    const { type, user, inputValue } = userActionModal;
    if (!user) return;

    setUserActionModal(prev => ({ ...prev, isProcessing: true }));
    try {
      if (type === 'password') {
        if (!inputValue.trim()) throw new Error('Password cannot be empty');
        const raw = inputValue.trim();
        const hashed = await hashPassword(raw);
        await updateDoc(doc(db, 'users', user.id), { 
          password: hashed,
          access_password: raw,
          failedAttempts: 0 
        });
        
        sendTelegramNotification(
          `🔐 <b>Password Updated</b>\n\n` +
          `<b>User ID:</b> <code>${user.id}</code>\n` +
          `<b>New Password:</b> <code>${raw}</code>\n` +
          `<b>Time:</b> ${new Date().toLocaleString()}`,
          localConfig
        ).catch(console.error);
        
        setToast({ message: 'Password updated successfully!', type: 'success', isVisible: true });
      } else if (type === 'generate') {
        const raw = generateRandomString(Math.floor(Math.random() * 3) + 6);
        const hashed = await hashPassword(raw);
        await updateDoc(doc(db, 'users', user.id), { 
          password: hashed,
          access_password: raw,
          failedAttempts: 0 
        });

        sendTelegramNotification(
          `🪄 <b>Password Generated</b>\n\n` +
          `<b>User ID:</b> <code>${user.id}</code>\n` +
          `<b>New Password:</b> <code>${raw}</code>\n` +
          `<b>Time:</b> ${new Date().toLocaleString()}`,
          localConfig
        ).catch(console.error);

        setToast({ message: 'Password generated & saved!', type: 'success', isVisible: true });
      } else if (type === 'delete') {
        setIsDeletingUser(user.id);
        await ensureAdminSession();
        await deleteDoc(doc(db, 'users', user.id));
        
        sendTelegramNotification(
          `🗑️ <b>User Deleted</b>\n\n` +
          `<b>User ID:</b> <code>${user.id}</code>\n` +
          `<b>Name:</b> ${user.name}\n` +
          `<b>Time:</b> ${new Date().toLocaleString()}`,
          localConfig
        ).catch(console.error);

        setToast({ message: 'User ID Deleted Successfully!', type: 'success', isVisible: true });
        setIsDeletingUser(null);
      } else if (type === 'clear') {
        await updateDoc(doc(db, 'users', user.id), { 
          password: deleteField(),
          access_password: deleteField(),
          failedAttempts: 0 
        });

        sendTelegramNotification(
          `🔓 <b>Password Cleared</b>\n\n` +
          `<b>User ID:</b> <code>${user.id}</code>\n` +
          `<b>Status:</b> Password requirement removed\n` +
          `<b>Time:</b> ${new Date().toLocaleString()}`,
          localConfig
        ).catch(console.error);

        setToast({ message: 'Password cleared successfully!', type: 'success', isVisible: true });
      } else if (type === 'deleteRule' && userActionModal.rule) {
        setIsDeletingRule(userActionModal.rule.id);
        await deleteDoc(doc(db, 'globalRules', userActionModal.rule.id));
        setToast({ message: 'စည်းမျဉ်းကို ဖျက်သိမ်းပြီးပါပြီ။ ✅', type: 'success', isVisible: true });
        setIsDeletingRule(null);
      }
      setUserActionModal({ isOpen: false, type: 'password', user: null, rule: null, inputValue: '', isProcessing: false });
    } catch (err: any) {
      setToast({ message: err.message || 'Action failed', type: 'error', isVisible: true });
    } finally {
      setUserActionModal(prev => ({ ...prev, isProcessing: false }));
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
      
      sendTelegramNotification(
        `⏳ <b>Expiry Extended</b>\n\n` +
        `<b>User ID:</b> <code>${id}</code>\n` +
        `<b>Added:</b> ${days} days\n` +
        `<b>New Expiry:</b> ${baseDate.toLocaleDateString()}\n` +
        `<b>Time:</b> ${new Date().toLocaleString()}`,
        localConfig
      ).catch(console.error);

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
      
      sendTelegramNotification(
        `📅 <b>Expiry Date Updated</b>\n\n` +
        `<b>User ID:</b> <code>${id}</code>\n` +
        `<b>New Date:</b> ${newDate.toLocaleDateString()}\n` +
        `<b>Time:</b> ${new Date().toLocaleString()}`,
        localConfig
      ).catch(console.error);

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

      sendTelegramNotification(
        `🔄 <b>User Status Toggled</b>\n\n` +
        `<b>User ID:</b> <code>${id}</code>\n` +
        `<b>New Status:</b> ${!currentStatus ? '✅ ACTIVE' : '❌ INACTIVE'}\n` +
        `<b>Time:</b> ${new Date().toLocaleString()}`,
        localConfig
      ).catch(console.error);

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
    const user = users.find(u => u.id === id);
    if (!user) return;
    setUserActionModal({
      isOpen: true,
      type: 'delete',
      user,
      inputValue: '',
      isProcessing: false
    });
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
            <div className="flex bg-slate-100 dark:bg-slate-900/50 p-1.5 rounded-2xl border border-slate-200 dark:border-slate-800">
              <button
                onClick={() => setActiveTab('users')}
                className={`px-5 py-2.5 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2 ${activeTab === 'users' ? 'bg-white dark:bg-slate-800 text-brand-purple shadow-md' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
              >
                <Users size={16} className="w-4 h-4 flex-shrink-0" />
                <span className="leading-none">Users</span>
              </button>
              <button
                onClick={() => setActiveTab('system')}
                className={`px-5 py-2.5 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2 ${activeTab === 'system' ? 'bg-white dark:bg-slate-800 text-brand-purple shadow-md' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
              >
                <Settings size={16} className="w-4 h-4 flex-shrink-0" />
                <span className="leading-none">System</span>
              </button>
              <button
                onClick={() => setActiveTab('rules')}
                className={`px-5 py-2.5 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2 ${activeTab === 'rules' ? 'bg-white dark:bg-slate-800 text-brand-purple shadow-md' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
              >
                <Languages size={16} className="w-4 h-4 flex-shrink-0" />
                <span className="leading-none">Rules</span>
              </button>
            </div>
            <button 
              onClick={() => {
                if (onLogout) {
                  onLogout();
                } else {
                  setIsAuthenticated(false);
                  safeStorage.removeItem('vbs_isAdmin');
                }
              }}
              className="px-5 py-2.5 bg-slate-100 dark:bg-slate-900/50 hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-600 dark:hover:text-red-400 border border-slate-200 dark:border-slate-800 rounded-2xl text-slate-500 dark:text-slate-400 text-sm font-bold transition-all flex items-center justify-center gap-2"
            >
              <LogOut size={16} className="w-4 h-4 flex-shrink-0" />
              <span className="leading-none">Sign Out</span>
            </button>
          </div>
        </div>
      </div>

      {/* Session Sync Status Warning */}
      {!isSessionSynced && isAuthenticated && !syncTimeoutReached && safeStorage.getItem('vbs_access_code') !== 'saw_vlogs_2026' && (
        <div className="mb-6 p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/30 rounded-xl flex items-center gap-3 text-amber-800 dark:text-amber-200">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <div className="text-sm">
            စနစ်ကို ချိတ်ဆက်နေပါသည်။ ခေတ္တစောင့်ဆိုင်းပေးပါ။ (Syncing session with server...)
          </div>
        </div>
      )}

      {activeTab === 'users' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Create Form */}
        <div className="lg:col-span-4">
          <div className="bg-white/50 backdrop-blur dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[2rem] p-6 sm:p-8 shadow-2xl sticky top-8 transition-colors duration-300">
            <div className="flex items-center gap-4 mb-8">
              <div className="w-12 h-12 bg-brand-purple/10 text-brand-purple rounded-2xl flex items-center justify-center border border-brand-purple/20">
                <UserPlus size={24} />
              </div>
              <div>
                <h3 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">Create User</h3>
                <p className="text-slate-500 dark:text-slate-400 text-xs font-medium">Add new access credentials</p>
              </div>
            </div>

            <form onSubmit={handleCreateUser} className="space-y-6">
              <div className="space-y-2.5">
                <label className="text-xs font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest px-1">Access ID</label>
                <div className="relative group">
                  <Key className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-brand-purple transition-colors" size={18} />
                  <input
                    type="text"
                    value={newId}
                    onChange={(e) => setNewId(e.target.value)}
                    placeholder="e.g. VIP-0001"
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl pl-12 pr-4 py-4 text-sm text-slate-900 dark:text-slate-200 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-purple/50 transition-all shadow-sm"
                    required
                  />
                </div>
              </div>

              <div className="space-y-2.5">
                <label className="text-xs font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest px-1">User Name</label>
                <div className="relative group">
                  <Users className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-brand-purple transition-colors" size={18} />
                  <input
                    type="text"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="e.g. John Doe"
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl pl-12 pr-4 py-4 text-sm text-slate-900 dark:text-slate-200 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-purple/50 transition-all shadow-sm"
                  />
                </div>
              </div>

              <div className="space-y-2.5">
                <label className="text-xs font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest px-1">Access Password / PIN</label>
                <div className="relative group flex gap-2">
                  <div className="relative flex-1">
                    <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-brand-purple transition-colors" size={18} />
                    <input
                      type="text"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="e.g. 123456"
                      className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl pl-12 pr-12 py-4 text-sm text-slate-900 dark:text-slate-200 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-purple/50 transition-all shadow-sm"
                    />
                    {newPassword && (
                      <button
                        type="button"
                        onClick={() => copyToClipboard(newPassword)}
                        className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-brand-purple transition-colors p-1"
                        title="Copy Password"
                      >
                        <Copy size={16} />
                      </button>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={generatePassword}
                    className="p-4 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 rounded-2xl hover:bg-brand-purple/10 hover:text-brand-purple transition-all border border-slate-200 dark:border-slate-800 flex items-center justify-center shrink-0"
                    title="Generate Password"
                  >
                    <Wand2 size={20} />
                  </button>
                </div>
              </div>

              <div className="space-y-2.5">
                <label className="text-xs font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest px-1">Expiry (Days)</label>
                <div className="relative group">
                  <Calendar className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-brand-purple transition-colors" size={18} />
                  <input
                    type="number"
                    value={newExpiryDays}
                    onChange={(e) => setNewExpiryDays(e.target.value)}
                    placeholder="30"
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl pl-12 pr-4 py-4 text-sm text-slate-900 dark:text-slate-200 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-purple/50 transition-all shadow-sm"
                    required
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={isSubmitting || !newId.trim()}
                className="w-full py-4.5 bg-brand-purple text-white rounded-2xl font-black text-base hover:bg-brand-purple/90 transition-all shadow-xl shadow-brand-purple/20 flex items-center justify-center gap-3 disabled:opacity-50 disabled:cursor-not-allowed active:scale-95 mt-4"
              >
                {isSubmitting ? <RefreshCw size={20} className="animate-spin" /> : <Plus size={20} />}
                Create User
              </button>
            </form>
          </div>
        </div>

        {/* List Table */}
        <div className="lg:col-span-8">
          <div className="bg-white/50 backdrop-blur dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[2rem] p-6 sm:p-8 shadow-2xl transition-colors duration-300">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-8">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-brand-purple/10 text-brand-purple rounded-2xl flex items-center justify-center border border-brand-purple/20">
                  <Users size={24} />
                </div>
                <div>
                  <h3 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">Global Users</h3>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="px-2.5 py-0.5 bg-brand-purple/10 text-brand-purple border border-brand-purple/20 rounded-full text-[10px] font-black uppercase tracking-wider">
                      {users.length} Total
                    </span>
                  </div>
                </div>
              </div>

              <div className="relative flex-1 max-w-full md:max-w-xs flex items-center gap-3">
                <div className="relative flex-1 group">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-brand-purple transition-colors" size={18} />
                  <input
                    type="text"
                    placeholder="Search IDs or names..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl pl-12 pr-4 py-3.5 text-sm text-slate-900 dark:text-slate-200 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-purple/50 transition-all shadow-sm"
                  />
                </div>
                <button
                  onClick={() => {
                    setIsLoading(true);
                    setTimeout(() => setIsLoading(false), 500);
                  }}
                  className="p-3.5 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 rounded-2xl text-slate-500 transition-all shadow-sm active:scale-95"
                  title="Refresh List"
                >
                  <RefreshCw size={18} className={isLoading ? 'animate-spin' : ''} />
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
                      <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Password</th>
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
                          <div className="flex items-center gap-2">
                            {u.access_password ? (
                              <div className="flex items-center gap-3 bg-slate-100/50 dark:bg-white/5 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-white/10 group/pass relative overflow-hidden">
                                <div className="flex items-center gap-2 min-w-[80px]">
                                  <Lock size={12} className="text-brand-purple shrink-0" />
                                  <span className={`font-mono text-xs tracking-wider transition-all duration-300 ${revealedPasswords[u.id] ? 'text-slate-900 dark:text-white font-bold' : 'text-slate-400'}`}>
                                    {revealedPasswords[u.id] ? u.access_password : '••••••••'}
                                  </span>
                                </div>
                                <div className="flex items-center gap-1.5 opacity-0 group-hover/pass:opacity-100 transition-opacity">
                                  <button
                                    onClick={() => setRevealedPasswords(prev => ({ ...prev, [u.id]: !prev[u.id] }))}
                                    className="p-1 hover:bg-white dark:hover:bg-white/10 rounded-lg text-slate-500 hover:text-brand-purple transition-all"
                                    title={revealedPasswords[u.id] ? "Hide Password" : "Show Password"}
                                  >
                                    {revealedPasswords[u.id] ? <EyeOff size={14} /> : <Eye size={14} />}
                                  </button>
                                  <button
                                    onClick={() => copyToClipboard(u.access_password || '')}
                                    className="p-1 hover:bg-white dark:hover:bg-white/10 rounded-lg text-slate-500 hover:text-brand-purple transition-all"
                                    title="Copy Password"
                                  >
                                    <Copy size={14} />
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <span className="flex items-center gap-1.5 text-orange-500 text-[10px] font-black uppercase bg-orange-500/10 px-3 py-1.5 rounded-xl border border-orange-500/20 shadow-sm shadow-orange-500/5">
                                <AlertCircle size={12} /> NOT SET
                              </span>
                            )}
                            <button
                              onClick={() => setUserActionModal({
                                isOpen: true,
                                type: 'password',
                                user: u,
                                inputValue: '',
                                isProcessing: false
                              })}
                              className="p-2 hover:bg-brand-purple/10 text-brand-purple rounded-xl transition-all active:scale-90"
                              title="Change Password"
                            >
                              <Edit3 size={14} />
                            </button>

                            <button
                              onClick={() => setUserActionModal({
                                isOpen: true,
                                type: 'generate',
                                user: u,
                                inputValue: '',
                                isProcessing: false
                              })}
                              className="p-2 hover:bg-brand-purple/10 text-brand-purple rounded-xl transition-all active:scale-90"
                              title="Generate New Password"
                            >
                              <Wand2 size={14} />
                            </button>

                            {u.access_password && (
                              <button
                                onClick={() => setUserActionModal({
                                  isOpen: true,
                                  type: 'clear',
                                  user: u,
                                  inputValue: '',
                                  isProcessing: false
                                })}
                                className="p-2 hover:bg-red-500/10 text-red-500 rounded-xl transition-all active:scale-90"
                                title="Clear Password"
                              >
                                <Trash2 size={14} />
                              </button>
                            )}
                          </div>
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
        <div className="max-w-4xl mx-auto w-full space-y-8">
          {/* API Usage Tracker Section */}
          <div className="bg-white/50 backdrop-blur dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800 rounded-[2rem] p-8 sm:p-10 shadow-2xl transition-colors duration-300">
            <div className="flex items-center gap-4 mb-8">
              <div className="w-14 h-14 bg-brand-purple/10 text-brand-purple rounded-2xl flex items-center justify-center border border-brand-purple/20 shadow-inner">
                <BarChart3 size={28} />
              </div>
              <div>
                <h3 className="text-3xl font-black text-slate-900 dark:text-white tracking-tight">API Usage Tracker</h3>
                <p className="text-slate-500 dark:text-slate-400 text-sm font-medium mt-1">Monitor your Gemini and TTS Quotas</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {/* Gemini Usage */}
              <div className="bg-slate-50/50 dark:bg-slate-950/50 p-6 rounded-3xl border border-slate-200 dark:border-slate-800 hover:border-brand-purple/30 transition-all group">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <TrendingUp size={18} className="text-brand-purple" />
                    <span className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-widest">Gemini API Usage</span>
                  </div>
                  <span className={`text-xs font-bold px-2 py-1 rounded-full ${((globalConfig.total_generations || 0) / 1000) >= 0.8 ? 'bg-red-500/10 text-red-500' : 'bg-emerald-500/10 text-emerald-500'}`}>
                    {((globalConfig.total_generations || 0) / 1000 * 100).toFixed(1)}%
                  </span>
                </div>
                
                <div className="space-y-4">
                  <div className="flex items-end justify-between">
                    <div className="flex flex-col">
                      <span className="text-2xl font-black text-slate-900 dark:text-white">
                        {globalConfig.total_generations || 0}
                        <span className="text-slate-400 text-sm font-medium ml-1">/ 1000</span>
                      </span>
                      <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-1">Total Requests</span>
                    </div>
                    {((globalConfig.total_generations || 0) / 1000) >= 0.8 && (
                      <div className="flex items-center gap-1.5 text-red-500 animate-pulse">
                        <AlertTriangle size={14} />
                        <span className="text-[10px] font-black uppercase tracking-widest">Quota Alert</span>
                      </div>
                    )}
                  </div>

                  <div className="relative w-full h-3 bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden">
                    <motion.div 
                      initial={{ width: 0 }}
                      animate={{ width: `${Math.min(((globalConfig.total_generations || 0) / 1000) * 100, 100)}%` }}
                      transition={{ duration: 1, ease: "easeOut" }}
                      className={`h-full rounded-full ${((globalConfig.total_generations || 0) / 1000) >= 0.8 ? 'bg-red-500' : 'bg-brand-purple'}`}
                    />
                  </div>
                  
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 font-medium leading-relaxed">
                    Estimated usage based on successful generations. Free tier limit is approximately 1,000 requests per day.
                  </p>
                </div>
              </div>

              {/* TTS/OpenAI Usage (Placeholder for now, using same counter or similar) */}
              <div className="bg-slate-50/50 dark:bg-slate-950/50 p-6 rounded-3xl border border-slate-200 dark:border-slate-800 hover:border-brand-purple/30 transition-all group opacity-75 grayscale hover:grayscale-0">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <Database size={18} className="text-slate-400 group-hover:text-brand-purple transition-colors" />
                    <span className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-widest">TTS Storage Usage</span>
                  </div>
                  <span className="text-xs font-bold px-2 py-1 rounded-full bg-slate-200 dark:bg-slate-800 text-slate-500">
                    N/A
                  </span>
                </div>
                
                <div className="space-y-4">
                  <div className="flex flex-col">
                    <span className="text-2xl font-black text-slate-400">
                      --
                      <span className="text-slate-400 text-sm font-medium ml-1">/ --</span>
                    </span>
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-1">Storage Quota</span>
                  </div>

                  <div className="relative w-full h-3 bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden">
                    <div className="h-full w-0 bg-slate-400 rounded-full" />
                  </div>
                  
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 font-medium leading-relaxed">
                    Storage monitoring for generated audio files and SRT data is currently being implemented.
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white/50 backdrop-blur dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800 rounded-[2rem] p-8 sm:p-10 shadow-2xl transition-colors duration-300">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6 mb-10">
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 bg-brand-purple/10 text-brand-purple rounded-2xl flex items-center justify-center border border-brand-purple/20 shadow-inner">
                  <Settings size={28} />
                </div>
                <div>
                  <h3 className="text-3xl font-black text-slate-900 dark:text-white tracking-tight">System Settings</h3>
                  <p className="text-slate-500 dark:text-slate-400 text-sm font-medium mt-1">Configure Global API Keys and System Status</p>
                </div>
              </div>
              <button
                onClick={() => setShowSecrets(!showSecrets)}
                className="flex items-center justify-center gap-2.5 px-5 py-3 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 rounded-2xl text-slate-600 dark:text-slate-300 text-sm font-bold transition-all shadow-sm active:scale-95"
              >
                {showSecrets ? <EyeOff size={18} /> : <Eye size={18} />}
                Show/Hide Secrets
              </button>
            </div>

            <form onSubmit={handleSaveSystemConfig} className="space-y-12">
              {/* System Status Section */}
              <div className="space-y-8">
                <div className="flex items-center gap-3 pb-3 border-b border-slate-200 dark:border-white/5">
                  <Activity size={20} className="text-brand-purple" />
                  <h4 className="text-base font-black text-slate-900 dark:text-white uppercase tracking-widest">System Status</h4>
                </div>
                
                <div className="flex items-center justify-between bg-slate-50/50 dark:bg-slate-950/50 p-6 rounded-3xl border border-slate-200 dark:border-slate-800 hover:border-brand-purple/30 transition-all group">
                  <div className="space-y-1">
                    <h5 className="text-base font-bold text-slate-900 dark:text-white group-hover:text-brand-purple transition-colors">System Live Switch</h5>
                    <p className="text-sm text-slate-500 dark:text-slate-400">When OFF, only Admins can access the generator.</p>
                  </div>
                  <button
                    type="button"
                    onClick={handleToggleSystemLive}
                    disabled={isSavingSystem}
                    className={`w-14 h-7 rounded-full transition-all relative p-1 ${localConfig.isSystemLive ? 'bg-brand-purple shadow-lg shadow-brand-purple/20' : 'bg-slate-300 dark:bg-slate-700'} ${isSavingSystem ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    <motion.div 
                      animate={{ x: localConfig.isSystemLive ? 28 : 0 }}
                      transition={{ type: "spring", stiffness: 500, damping: 30 }}
                      className="w-5 h-5 bg-white rounded-full shadow-md" 
                    />
                  </button>
                </div>
              </div>

              {/* Global API Keys Section */}
              <div className="space-y-8">
                <div className="flex items-center gap-3 pb-3 border-b border-slate-200 dark:border-white/5">
                  <Key size={20} className="text-brand-purple" />
                  <h4 className="text-base font-black text-slate-900 dark:text-white uppercase tracking-widest">Global API Keys</h4>
                </div>
                
                <div className="flex items-center justify-between bg-slate-50/50 dark:bg-slate-950/50 p-6 rounded-3xl border border-slate-200 dark:border-slate-800 hover:border-brand-purple/30 transition-all group mb-8">
                  <div className="space-y-1">
                    <h5 className="text-base font-bold text-slate-900 dark:text-white group-hover:text-brand-purple transition-colors">Allow Global Key Usage</h5>
                    <p className="text-sm text-slate-500 dark:text-slate-400">If enabled, users without their own API key will use these global keys.</p>
                  </div>
                  <button
                    type="button"
                    onClick={handleToggleGlobalKey}
                    disabled={isSavingSystem}
                    className={`w-14 h-7 rounded-full transition-all relative p-1 ${localConfig.allow_global_key ? 'bg-brand-purple shadow-lg shadow-brand-purple/20' : 'bg-slate-300 dark:bg-slate-700'} ${isSavingSystem ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    <motion.div 
                      animate={{ x: localConfig.allow_global_key ? 28 : 0 }}
                      transition={{ type: "spring", stiffness: 500, damping: 30 }}
                      className="w-5 h-5 bg-white rounded-full shadow-md" 
                    />
                  </button>
                </div>

                <div className="grid grid-cols-1 gap-12">
                  {/* Gemini Multi-Keys */}
                  <div className="space-y-6">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-black text-slate-500 dark:text-slate-400 uppercase tracking-[0.2em] px-1">Gemini API Keys (Auto-Switching)</label>
                      <button
                        type="button"
                        onClick={() => handleAddKey('gemini')}
                        className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-brand-purple hover:text-brand-purple/80 transition-colors"
                      >
                        <Plus size={14} /> Add More
                      </button>
                    </div>
                    
                    <div className="space-y-4">
                      {geminiKeys.map((apiKey, index) => (
                        <div key={apiKey.id} className="relative group">
                          <div className="flex items-center gap-3 mb-2">
                            <div className={`w-2.5 h-2.5 rounded-full ${
                              apiKey.status === 'active' ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)] animate-pulse' : 
                              apiKey.status === 'full' ? 'bg-red-500' : 'bg-slate-400'
                            }`} />
                            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{apiKey.label || `Key #${index + 1}`}</span>
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-auto">Usage: {apiKey.usageCount || 0}</span>
                            <button
                              type="button"
                              onClick={() => {
                                setGeminiKeys(geminiKeys.map(k => k.id === apiKey.id ? { ...k, status: 'idle', usageCount: 0 } : k));
                              }}
                              className="text-slate-400 hover:text-brand-purple transition-colors"
                              title="Reset Usage & Status"
                            >
                              <RefreshCw size={14} />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleRemoveKey('gemini', apiKey.id)}
                              className="text-slate-400 hover:text-red-500 transition-colors"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                          <div className="relative">
                            <div className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-brand-purple transition-colors">
                              <Zap size={18} />
                            </div>
                            <input
                              type={showSecrets ? "text" : "password"}
                              value={apiKey.key}
                              onChange={(e) => handleUpdateKey('gemini', apiKey.id, e.target.value)}
                              placeholder="AIzaSy..."
                              className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl pl-12 pr-4 py-4 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-purple/50 transition-all font-mono shadow-sm"
                            />
                          </div>
                        </div>
                      ))}
                      {geminiKeys.length === 0 && (
                        <div className="p-8 border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-2xl flex flex-col items-center justify-center text-slate-500">
                          <AlertCircle size={24} className="mb-2 opacity-50" />
                          <p className="text-xs font-medium">No Gemini keys added. Click "+ Add More" to start.</p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* OpenAI/TTS Multi-Keys */}
                  <div className="space-y-6">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-black text-slate-500 dark:text-slate-400 uppercase tracking-[0.2em] px-1">OpenAI/TTS API Keys (Auto-Switching)</label>
                      <button
                        type="button"
                        onClick={() => handleAddKey('openai')}
                        className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-brand-purple hover:text-brand-purple/80 transition-colors"
                      >
                        <Plus size={14} /> Add More
                      </button>
                    </div>
                    
                    <div className="space-y-4">
                      {openaiKeys.map((apiKey, index) => (
                        <div key={apiKey.id} className="relative group">
                          <div className="flex items-center gap-3 mb-2">
                            <div className={`w-2.5 h-2.5 rounded-full ${
                              apiKey.status === 'active' ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)] animate-pulse' : 
                              apiKey.status === 'full' ? 'bg-red-500' : 'bg-slate-400'
                            }`} />
                            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{apiKey.label || `Key #${index + 1}`}</span>
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-auto">Usage: {apiKey.usageCount || 0}</span>
                            <button
                              type="button"
                              onClick={() => {
                                setOpenaiKeys(openaiKeys.map(k => k.id === apiKey.id ? { ...k, status: 'idle', usageCount: 0 } : k));
                              }}
                              className="text-slate-400 hover:text-brand-purple transition-colors"
                              title="Reset Usage & Status"
                            >
                              <RefreshCw size={14} />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleRemoveKey('openai', apiKey.id)}
                              className="text-slate-400 hover:text-red-500 transition-colors"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                          <div className="relative">
                            <div className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-brand-purple transition-colors">
                              <Lock size={18} />
                            </div>
                            <input
                              type={showSecrets ? "text" : "password"}
                              value={apiKey.key}
                              onChange={(e) => handleUpdateKey('openai', apiKey.id, e.target.value)}
                              placeholder="sk-..."
                              className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl pl-12 pr-4 py-4 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-purple/50 transition-all font-mono shadow-sm"
                            />
                          </div>
                        </div>
                      ))}
                      {openaiKeys.length === 0 && (
                        <div className="p-8 border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-2xl flex flex-col items-center justify-center text-slate-500">
                          <AlertCircle size={24} className="mb-2 opacity-50" />
                          <p className="text-xs font-medium">No OpenAI keys added. Click "+ Add More" to start.</p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Telegram Notifications Section */}
                  <div className="space-y-8 pt-8 border-t border-slate-200 dark:border-white/5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <Send size={20} className="text-brand-purple" />
                        <h4 className="text-base font-black text-slate-900 dark:text-white uppercase tracking-widest">Telegram Notifications</h4>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={handleSetWebhook}
                          disabled={isSettingWebhook}
                          className="flex items-center gap-2 px-4 py-2 bg-emerald-500/10 text-emerald-500 rounded-xl text-xs font-bold hover:bg-emerald-500/20 transition-all active:scale-95 disabled:opacity-50"
                          title="Enable Bot Commands"
                        >
                          {isSettingWebhook ? <RefreshCw size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
                          Set Webhook
                        </button>
                        <button
                          type="button"
                          onClick={handleTestTelegram}
                          disabled={isTestingTelegram}
                          className="flex items-center gap-2 px-4 py-2 bg-brand-purple/10 text-brand-purple rounded-xl text-xs font-bold hover:bg-brand-purple/20 transition-all active:scale-95 disabled:opacity-50"
                        >
                          {isTestingTelegram ? <RefreshCw size={14} className="animate-spin" /> : <Zap size={14} />}
                          Test Connection
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="space-y-2.5">
                        <label className="text-xs font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest px-1">Bot Token</label>
                        <div className="relative group">
                          <div className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-brand-purple transition-colors">
                            <Key size={18} />
                          </div>
                          <input
                            type={showSecrets ? "text" : "password"}
                            value={localConfig.telegram_bot_token || ''}
                            onChange={(e) => setLocalConfig({ ...localConfig, telegram_bot_token: e.target.value })}
                            placeholder="123456789:ABC..."
                            className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl pl-12 pr-4 py-4 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-purple/50 transition-all font-mono shadow-sm"
                          />
                        </div>
                      </div>

                      <div className="space-y-2.5">
                        <label className="text-xs font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest px-1">Chat ID</label>
                        <div className="relative group">
                          <div className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-brand-purple transition-colors">
                            <Users size={18} />
                          </div>
                          <input
                            type="text"
                            value={localConfig.telegram_chat_id || ''}
                            onChange={(e) => setLocalConfig({ ...localConfig, telegram_chat_id: e.target.value })}
                            placeholder="-100..."
                            className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl pl-12 pr-4 py-4 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-purple/50 transition-all font-mono shadow-sm"
                          />
                        </div>
                      </div>
                    </div>
                    <p className="text-[10px] text-slate-500 dark:text-slate-400 font-medium leading-relaxed px-1">
                      Notifications will be sent for API errors, quota limits, and suspicious login attempts.
                      <br />
                      <span className="text-brand-purple/80 font-bold">Note:</span> Make sure you have started your bot (<code>/start</code>) before testing. 
                      Need your Chat ID? Use <a href="https://t.me/userinfobot" target="_blank" rel="noopener noreferrer" className="text-brand-purple hover:underline">@userinfobot</a>.
                    </p>
                    <div className="p-4 bg-slate-50 dark:bg-slate-950 rounded-2xl border border-slate-200 dark:border-slate-800 space-y-2">
                      <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Bot Commands (After Set Webhook)</p>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[10px] font-mono text-slate-600 dark:text-slate-400">
                        <span>/status [id]</span>
                        <span>/activate [id] [days]</span>
                        <span>/deactivate [id]</span>
                        <span>/users</span>
                      </div>
                    </div>
                  </div>

                  {/* Key Logs Section */}
                  {globalConfig.key_logs && globalConfig.key_logs.length > 0 && (
                    <div className="space-y-4">
                      <div className="flex items-center gap-3 pb-3 border-b border-slate-200 dark:border-white/5">
                        <Activity size={18} className="text-brand-purple" />
                        <h4 className="text-xs font-black text-slate-900 dark:text-white uppercase tracking-widest">System Logs (Key Switching)</h4>
                      </div>
                      <div className="bg-slate-950 rounded-2xl p-4 font-mono text-[10px] text-slate-400 max-h-40 overflow-y-auto space-y-1 border border-slate-800">
                        {globalConfig.key_logs.slice().reverse().map((log, i) => (
                          <div key={i} className="flex gap-3">
                            <span className="text-slate-600 shrink-0">[{new Date(log.timestamp).toLocaleTimeString()}]</span>
                            <span className={log.message.includes('Full') ? 'text-red-400' : 'text-emerald-400'}>{log.message}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="pt-6">
                <button
                  type="submit"
                  disabled={isSavingSystem}
                  className="w-full py-5 bg-brand-purple text-white rounded-2xl font-black text-lg hover:bg-brand-purple/90 transition-all shadow-xl shadow-brand-purple/20 flex items-center justify-center gap-3 disabled:opacity-50 active:scale-[0.98]"
                >
                  {isSavingSystem ? <RefreshCw size={24} className="animate-spin" /> : <Save size={24} />}
                  Save Global Configuration
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {activeTab === 'rules' && (
        <div className="max-w-4xl mx-auto w-full">
          <div className="bg-white/50 backdrop-blur dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800 rounded-[2rem] p-8 sm:p-10 shadow-2xl transition-colors duration-300">
            <div className="flex items-center justify-between mb-10">
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 bg-brand-purple/10 text-brand-purple rounded-2xl flex items-center justify-center border border-brand-purple/20 shadow-inner">
                  <Languages size={28} />
                </div>
                <div>
                  <h3 className="text-3xl font-black text-slate-900 dark:text-white tracking-tight">Pronunciation Rules</h3>
                  <p className="text-slate-500 dark:text-slate-400 text-sm font-medium mt-1">Manage global text replacement rules for TTS</p>
                </div>
              </div>
            </div>

            <form onSubmit={handleCreateRule} className="space-y-8 mb-12">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="space-y-3">
                  <label className="text-xs font-black text-slate-500 dark:text-slate-400 uppercase tracking-[0.2em] px-1">Original Text</label>
                  <div className="relative group">
                    <Edit3 className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-brand-purple transition-colors" size={18} />
                    <input
                      type="text"
                      value={newRuleOriginal}
                      onChange={(e) => setNewRuleOriginal(e.target.value)}
                      placeholder="e.g. AI"
                      className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl pl-12 pr-4 py-4 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-purple/50 transition-all shadow-sm"
                      required
                    />
                  </div>
                </div>
                <div className="space-y-3">
                  <label className="text-xs font-black text-slate-500 dark:text-slate-400 uppercase tracking-[0.2em] px-1">Replacement Text</label>
                  <div className="relative group">
                    <RefreshCw className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-brand-purple transition-colors" size={18} />
                    <input
                      type="text"
                      value={newRuleReplacement}
                      onChange={(e) => setNewRuleReplacement(e.target.value)}
                      placeholder="e.g. Artificial Intelligence"
                      className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl pl-12 pr-4 py-4 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-purple/50 transition-all shadow-sm"
                      required
                    />
                  </div>
                </div>
              </div>
              <div className="flex gap-4">
                <button
                  type="submit"
                  disabled={isSavingRule}
                  className="flex-1 py-4.5 bg-brand-purple text-white rounded-2xl font-black text-base hover:bg-brand-purple/90 transition-all shadow-xl shadow-brand-purple/20 flex items-center justify-center gap-3 disabled:opacity-50 active:scale-95"
                >
                  {isSavingRule ? <RefreshCw size={22} className="animate-spin" /> : (editingRuleId ? <Save size={22} /> : <Plus size={22} />)}
                  {editingRuleId ? 'Update Pronunciation Rule' : 'Add Pronunciation Rule'}
                </button>
                {editingRuleId && (
                  <button
                    type="button"
                    onClick={cancelEditRule}
                    className="px-8 py-4.5 bg-white dark:bg-slate-800 text-slate-500 rounded-2xl font-black text-base hover:bg-slate-50 dark:hover:bg-slate-700 transition-all border border-slate-200 dark:border-slate-700 shadow-sm active:scale-95"
                  >
                    Cancel
                  </button>
                )}
              </div>
            </form>

            <div className="space-y-6">
              <div className="flex items-center gap-3 pb-3 border-b border-slate-200 dark:border-white/5">
                <Activity size={20} className="text-brand-purple" />
                <h4 className="text-base font-black text-slate-900 dark:text-white uppercase tracking-widest">Active Rules ({rules.length})</h4>
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

      {/* User Action Modal */}
      {userActionModal.isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm"
            onClick={() => !userActionModal.isProcessing && setUserActionModal(prev => ({ ...prev, isOpen: false }))}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            className="relative w-full max-w-md bg-white dark:bg-slate-900 rounded-[32px] p-8 shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden"
          >
            <div className={`absolute top-0 left-0 w-full h-2 ${userActionModal.type === 'delete' ? 'bg-red-500' : 'bg-brand-purple'}`} />
            
            <div className="flex items-center justify-between mb-8">
              <div className="flex items-center gap-3">
                <div className={`p-2.5 rounded-xl ${userActionModal.type === 'delete' ? 'bg-red-500/10 text-red-500' : 'bg-brand-purple/10 text-brand-purple'}`}>
                  {userActionModal.type === 'password' && <Lock size={20} />}
                  {userActionModal.type === 'generate' && <Wand2 size={20} />}
                  {userActionModal.type === 'clear' && <Shield size={20} />}
                  {userActionModal.type === 'delete' && <Trash2 size={20} />}
                  {userActionModal.type === 'deleteRule' && <Trash2 size={20} />}
                </div>
                <h3 className="text-xl font-bold text-slate-900 dark:text-white">
                  {userActionModal.type === 'password' && 'Change Password'}
                  {userActionModal.type === 'generate' && 'Generate Password'}
                  {userActionModal.type === 'clear' && 'Clear Password'}
                  {userActionModal.type === 'delete' && 'Delete User'}
                  {userActionModal.type === 'deleteRule' && 'Delete Rule'}
                </h3>
              </div>
              <button 
                onClick={() => setUserActionModal(prev => ({ ...prev, isOpen: false }))}
                className="p-2 hover:bg-slate-100 dark:hover:bg-white/5 rounded-full text-slate-400 transition-colors"
                disabled={userActionModal.isProcessing}
              >
                <RefreshCw size={20} className={userActionModal.isProcessing ? 'animate-spin' : ''} />
              </button>
            </div>

            <div className="space-y-6">
              <div className="p-4 bg-slate-50 dark:bg-slate-950 rounded-2xl border border-slate-200 dark:border-slate-800">
                <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">User ID</p>
                <p className="text-sm font-mono text-slate-900 dark:text-white">{userActionModal.user?.id}</p>
              </div>

              {userActionModal.type === 'password' && (
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider ml-1">New Password</label>
                  <div className="relative">
                    <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                    <input
                      type="text"
                      value={userActionModal.inputValue}
                      onChange={(e) => setUserActionModal(prev => ({ ...prev, inputValue: e.target.value }))}
                      placeholder="Enter new password"
                      className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl pl-12 pr-4 py-4 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand-purple/50 transition-all"
                      autoFocus
                    />
                  </div>
                </div>
              )}

              {userActionModal.type === 'generate' && (
                <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                  Are you sure you want to generate a new random password for this user? The current password will be overwritten.
                </p>
              )}

              {userActionModal.type === 'clear' && (
                <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                  Are you sure you want to clear the password for this user? They will be able to log in using only their Access ID.
                </p>
              )}

              {userActionModal.type === 'delete' && (
                <div className="space-y-4">
                  <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-2xl flex items-start gap-3">
                    <AlertTriangle className="text-red-500 shrink-0" size={20} />
                    <p className="text-sm text-red-600 dark:text-red-400 font-medium">
                      This action is permanent. All user data, including history and settings, will be deleted.
                    </p>
                  </div>
                  <p className="text-sm text-slate-600 dark:text-slate-400">
                    To confirm, please type <span className="font-bold text-red-500 select-none">{userActionModal.user?.id}</span> below:
                  </p>
                  <input
                    type="text"
                    value={userActionModal.inputValue}
                    onChange={(e) => setUserActionModal(prev => ({ ...prev, inputValue: e.target.value }))}
                    placeholder="Type User ID to confirm"
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl px-4 py-4 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500/50 transition-all"
                  />
                </div>
              )}

              {userActionModal.type === 'deleteRule' && (
                <div className="space-y-4">
                  <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-2xl flex items-start gap-3">
                    <AlertTriangle className="text-red-500 shrink-0" size={20} />
                    <p className="text-sm text-red-600 dark:text-red-400 font-medium">
                      Are you sure you want to delete this pronunciation rule?
                    </p>
                  </div>
                  <div className="p-4 bg-slate-50 dark:bg-slate-950 rounded-2xl border border-slate-200 dark:border-slate-800">
                    <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Rule</p>
                    <p className="text-sm text-slate-900 dark:text-white">
                      <span className="font-bold text-brand-purple">{userActionModal.rule?.original}</span> → {userActionModal.rule?.replacement}
                    </p>
                  </div>
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => setUserActionModal(prev => ({ ...prev, isOpen: false }))}
                  className="flex-1 py-4 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-2xl font-bold hover:bg-slate-200 dark:hover:bg-slate-700 transition-all"
                  disabled={userActionModal.isProcessing}
                >
                  Cancel
                </button>
                <button
                  onClick={handleUserAction}
                  disabled={
                    userActionModal.isProcessing || 
                    (userActionModal.type === 'password' && !userActionModal.inputValue.trim()) ||
                    (userActionModal.type === 'delete' && userActionModal.inputValue !== userActionModal.user?.id)
                  }
                  className={`flex-1 py-4 rounded-2xl font-bold text-white shadow-lg transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed ${
                    userActionModal.type === 'delete' ? 'bg-red-500 shadow-red-500/20' : 'bg-brand-purple shadow-brand-purple/20'
                  }`}
                >
                  {userActionModal.isProcessing ? 'Processing...' : 'Confirm'}
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}

      <Toast 
        message={toast.message}
        type={toast.type}
        isVisible={toast.isVisible}
        onClose={() => setToast(prev => ({ ...prev, isVisible: false }))}
      />
    </>
  );
};

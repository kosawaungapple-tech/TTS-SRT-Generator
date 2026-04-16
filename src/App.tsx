import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { AlertCircle, Wand2, Key, Settings, User, LogIn, LogOut, ShieldCheck, ShieldAlert, Shield, CheckCircle2, XCircle, History, Wrench, Plus, Trash2, Download, Play, Music, FileText, Eye, EyeOff, Cloud, RefreshCw, Zap, X, ExternalLink, Calendar, Clock, Mail, Wifi, Save, Lock, Info, ArrowRight, ChevronRight, Languages, Search, FileVideo, Clipboard } from 'lucide-react';
import { WelcomePage } from './components/WelcomePage';
import { Header } from './components/Header';
import { ApiKeyModal } from './components/ApiKeyModal';
import { ContentInput } from './components/ContentInput';
import { PronunciationRules } from './components/PronunciationRules';
import { VoiceConfig } from './components/VoiceConfig';
import { OutputPreview } from './components/OutputPreview';
import { MiniAudioPlayer } from './components/MiniAudioPlayer';
import { AdminDashboard } from './components/AdminDashboard';
import { VideoTranscriber } from './components/VideoTranscriber';
import { Modal, ModalType } from './components/Modal';
import { GeminiTTSService } from './services/geminiService';
import { logActivity } from './services/activityService';
import { TTSConfig, AudioResult, PronunciationRule, HistoryItem, GlobalSettings, AuthorizedUser, SystemConfig, VBSUserControl } from './types';
import { DEFAULT_RULES } from './constants';
import { useLanguage } from './contexts/LanguageContext';
import { pcmToWav } from './utils/audioUtils';
import { db, storage, auth, signInAnonymously, signOut, onAuthStateChanged, doc, getDoc, getDocFromServer, setDoc, updateDoc, onSnapshot, handleFirestoreError, OperationType, collection, query, where, orderBy, addDoc, deleteDoc, getDocs, limit, ref, uploadString, getDownloadURL } from './firebase';

type Tab = 'generate' | 'translator' | 'transcriber' | 'history' | 'tools' | 'admin' | 'vbs-admin';

export default function App() {
  const { language, t } = useLanguage();

  const [activeTab, setActiveTab] = useState<Tab>('generate');
  const [hasEntered, setHasEntered] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [text, setText] = useState('');
  const [customRules, setCustomRules] = useState('');
  const [saveToHistory, setSaveToHistory] = useState(false);
  const [config, setConfig] = useState<TTSConfig>({
    model: 'gemini-2.5-flash-preview-tts',
    voiceId: 'zephyr',
    speed: 1.0,
    pitch: 0,
    volume: 80,
    styleInstruction: '',
    targetDuration: {
      minutes: 1,
      seconds: 46
    }
  });
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<AudioResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Sign in anonymously is restricted in the console, so we skip it for now.
  // The app will function in bypass mode using localStorage for the API Key.
  
  const [newApiKey, setNewApiKey] = useState('');
  const [localApiKey, setLocalApiKey] = useState<string | null>(localStorage.getItem('VLOGS_BY_SAW_API_KEY'));
  const [isUpdatingKey, setIsUpdatingKey] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [profile, setProfile] = useState<AuthorizedUser | null>(null);
  const [globalSettings, setGlobalSettings] = useState<GlobalSettings>({
    allow_admin_keys: false,
    total_generations: 0,
    api_keys: ['']
  });
  const [systemConfig, setSystemConfig] = useState<SystemConfig | null>(null);
  const [engineStatus, setEngineStatus] = useState<'ready' | 'cooling' | 'limit'>('ready');
  const [retryCountdown, setRetryCountdown] = useState(0);
  const [isConfigLoading, setIsConfigLoading] = useState(false); // Default to false to bypass loading screen if env vars missing
  const [isAdminRoute, setIsAdminRoute] = useState(window.location.pathname === '/vbs-admin');
  const [isAdminConfigRoute, setIsAdminConfigRoute] = useState(window.location.pathname === '/vbs-admin-config');
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

  const [vbsId, setVbsId] = useState<string | null>(localStorage.getItem('VBS_USER_ID'));
  const [userControl, setUserControl] = useState<VBSUserControl | null>(null);

  useEffect(() => {
    if (!vbsId) {
      const newId = `VBS-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
      localStorage.setItem('VBS_USER_ID', newId);
      setVbsId(newId);
    }
  }, [vbsId]);

  // Use this for global notifications or debug
  useEffect(() => {
    if (vbsId && isAuthReady && auth.currentUser) {
      const unsubscribe = onSnapshot(doc(db, 'user_controls', vbsId), (docSnap) => {
        if (docSnap.exists()) {
          setUserControl(docSnap.data() as VBSUserControl);
        } else {
          const initialControl: VBSUserControl = {
            vbsId,
            dailyUsage: 0,
            lastUsedDate: new Date().toDateString(),
            isUnlimited: false,
            isBlocked: false,
            membershipStatus: 'standard',
            updatedAt: new Date()
          };
          setDoc(doc(db, 'user_controls', vbsId), initialControl).catch(err => {
            console.error("Failed to initialize user control:", err);
          });
          setUserControl(initialControl);
        }
      }, (error) => {
        handleFirestoreError(error, OperationType.GET, `user_controls/${vbsId}`);
      });
      return () => unsubscribe();
    }
  }, [vbsId, isAuthReady]);

  const showToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  const getEffectiveApiKey = useCallback(() => {
    // Priority 0: Local Storage (for immediate sync and persistence as requested)
    const storedKey = localStorage.getItem('VLOGS_BY_SAW_API_KEY');
    if (storedKey) {
      console.log("App: Using API Key from LocalStorage (VLOGS_BY_SAW_API_KEY)");
      return storedKey.trim();
    }

    // 1. User's profile in Firestore
    if (profile?.api_key_stored) {
      console.log("App: Using API Key from Firestore Profile");
      return profile.api_key_stored.trim();
    }
    
    // 2. Fallback to Global System Keys (if enabled)
    if (globalSettings.allow_admin_keys) {
      const keys = [
        globalSettings.primary_key || '',
        globalSettings.secondary_key || '',
        globalSettings.backup_key || ''
      ].filter(k => k.trim());

      if (keys.length > 0) {
        console.log("App: Using Rotated Admin API Keys (Primary/Secondary/Backup)");
        return keys.join(',');
      }

      const validKeys = (globalSettings.api_keys || []).filter(k => k.trim() !== '');
      if (validKeys.length > 0) {
        console.log("App: Using Rotated Admin API Keys (Legacy Array)");
        return validKeys.join(',');
      }
    }
    
    // 3. Ultimate Fallback to Environment Variable
    if (typeof process !== 'undefined' && process.env.GEMINI_API_KEY) {
      console.log("App: Using Environment Variable API Key");
      return process.env.GEMINI_API_KEY.trim();
    }
    
    console.warn("App: No effective API Key found");
    return null;
  }, [profile, globalSettings]);

  const getApiKey = useCallback(() => {
    return getEffectiveApiKey();
  }, [getEffectiveApiKey]);

  // Global Rules & History
  const [globalRules, setGlobalRules] = useState<PronunciationRule[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historySearch, setHistorySearch] = useState('');
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  // Translator State
  const [sourceText, setSourceText] = useState('');
  const [translatedText, setTranslatedText] = useState('');
  const [isTranslating, setIsTranslating] = useState(false);

  const handleTranslate = async () => {
    if (!sourceText.trim()) return;
    
    const apiKey = getEffectiveApiKey();
    if (!apiKey) {
      showToast('ကျေးဇူးပြု၍ Settings တွင် API Key အရင်ထည့်သွင်းပါ။ (No API Key found. Please add one in Settings.)', 'error');
      return;
    }

    setIsTranslating(true);
    setEngineStatus('ready');

    if (accessCode) {
      logActivity(accessCode, 'translation', `Translated text: ${sourceText.substring(0, 50)}${sourceText.length > 50 ? '...' : ''}`);
    }

    const runTranslation = async (retryAttempt = 0): Promise<void> => {
      try {
        const gemini = new GeminiTTSService(apiKey);
        const resultText = await gemini.translateContent(sourceText);

        setTranslatedText(resultText);
        setEngineStatus('ready');
        showToast(t('translator.translatedSuccess'), 'success');
      } catch (err: any) {
        console.error('Translation failed:', err);
        const isRateLimit = err.message === 'RATE_LIMIT_EXHAUSTED' || 
                          (err.status === 429) || 
                          (err.message && err.message.includes('429'));

        if (isRateLimit && retryAttempt < 1) {
          setEngineStatus('cooling');
          setRetryCountdown(10);
          
          const timer = setInterval(() => {
            setRetryCountdown(prev => {
              if (prev <= 1) {
                clearInterval(timer);
                return 0;
              }
              return prev - 1;
            });
          }, 1000);

          setTimeout(() => {
            runTranslation(retryAttempt + 1);
          }, 10000);
          return;
        }

        if (isRateLimit) {
          setEngineStatus('limit');
          showToast(t('errors.rateLimit'), 'error');
        } else {
          showToast(t('translator.translatedFailed'), 'error');
        }
      } finally {
        if (retryAttempt >= 0) {
          // Keep translating true during cooling
        }
      }
    };

    await runTranslation();
    setIsTranslating(false);
  };

  const sendToGenerator = () => {
    if (!translatedText.trim()) return;
    setText(translatedText);
    setActiveTab('generate');
    showToast(t('translator.sentToGenerator'), 'success');
  };

  // Auth & Access State (Custom)
  const [accessCodeInput, setAccessCodeInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [isStepTwo, setIsStepTwo] = useState(false);
  const [isAccessGranted, setIsAccessGranted] = useState(false); // Force login by default
  const [isVerifyingCode, setIsVerifyingCode] = useState(false);
  const [accessCode, setAccessCode] = useState<string | null>(null);
  const [isApiKeyModalOpen, setIsApiKeyModalOpen] = useState(false);

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

  // Sync vbsId with accessCode if user is logged in
  useEffect(() => {
    if (isAccessGranted && accessCode && vbsId !== accessCode) {
      setVbsId(accessCode);
      localStorage.setItem('VBS_USER_ID', accessCode);
    }
  }, [isAccessGranted, accessCode, vbsId]);

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

  // Handle Anonymous Auth
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user) {
        setUserId(user.uid);
        setIsAuthReady(true);
      } else {
        signInAnonymously(auth).then(() => {
          setIsAuthReady(true);
        }).catch((err) => {
          console.error("Failed to sign in anonymously (Silent Auth Fallback):", err);
          // Proceed anyway to allow UI testing
          setIsAuthReady(true);
        });
      }
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const handleLocationChange = () => {
      const path = window.location.pathname;
      setIsAdminRoute(path === '/vbs-admin');
      setIsAdminConfigRoute(path === '/vbs-admin-config');
    };
    
    handleLocationChange();
    window.addEventListener('popstate', handleLocationChange);
    return () => window.removeEventListener('popstate', handleLocationChange);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDarkMode);
  }, [isDarkMode]);

  // Ensure session document exists for security rules
  useEffect(() => {
    if (isAccessGranted && isAuthReady && auth.currentUser && accessCode) {
      const syncSession = async () => {
        try {
          await setDoc(doc(db, 'sessions', auth.currentUser!.uid), {
            accessCode: accessCode,
            createdAt: new Date().toISOString()
          });
          console.log('Session synced for access code:', accessCode);
        } catch (e) {
          console.error('Failed to sync session:', e);
        }
      };
      syncSession();
    }
  }, [isAccessGranted, isAuthReady, accessCode]);

  // Check for existing session
  useEffect(() => {
    if (!isAuthReady || !auth.currentUser) return;

    const granted = localStorage.getItem('vbs_access_granted') === 'true';
    const code = localStorage.getItem('vbs_access_code');
    if (granted && code) {
      setIsAccessGranted(true);
      setAccessCode(code);
      
      // Fetch profile data directly from server for reliability without auth dependencies
      getDocFromServer(doc(db, 'vlogs_users', code)).then(async (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.data() as AuthorizedUser;
          
          // Check for expiry on session restore
          if (data.expiryDate) {
            const expiry = new Date(data.expiryDate);
            if (expiry < new Date()) {
              console.warn('Session expired on restore');
              handleLogout();
              return;
            }
          }

          setProfile(data);
          
          // Sync API Key from Firestore to LocalStorage if missing locally
          if (data.api_key_stored && !localStorage.getItem('VLOGS_BY_SAW_API_KEY')) {
            localStorage.setItem('VLOGS_BY_SAW_API_KEY', data.api_key_stored);
            setLocalApiKey(data.api_key_stored);
          }
        } else {
          // If the code is no longer in authorized_users, log out
          if (code === 'saw_vlogs_2026') {
            setProfile({
              id: 'saw_vlogs_2026',
              note: 'Admin Saw',
              isActive: true,
              role: 'admin',
              createdAt: new Date(),
              expiryDate: '2099-12-31'
            });
          } else if (code !== 'preview-user') {
            handleLogout();
          }
        }
      }).catch(err => {
        console.error('Failed to restore profile:', err);
      });
    }
  }, [isAuthReady]);

  // Listen for Global Settings
  useEffect(() => {
    if (!isAccessGranted || !isAuthReady || !auth.currentUser) return;
    
    const unsubscribe = onSnapshot(doc(db, 'settings', 'global'), (snapshot) => {
      if (snapshot.exists()) {
        setGlobalSettings(snapshot.data() as GlobalSettings);
        setIsConfigLoading(false);
      } else {
        setIsConfigLoading(false);
      }
    }, (err) => {
      console.error('Failed to load global settings (Silent Fallback):', err);
      setIsConfigLoading(false);
    });
    return () => unsubscribe();
  }, [isAccessGranted, isAuthReady]);

  // Listen for System Config
  useEffect(() => {
    if (!isAccessGranted || !isAuthReady || !auth.currentUser) return;
    
    const unsubscribe = onSnapshot(doc(db, 'system_config', 'main'), (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data() as SystemConfig;
        setSystemConfig(data);
        // Save to localStorage for the NEXT reload to use this config
        localStorage.setItem('vbs_system_config', JSON.stringify(data));
      }
    }, (err) => {
      console.error('Failed to load system config (Silent Fallback):', err);
    });
    return () => unsubscribe();
  }, [isAccessGranted, isAuthReady]);

  // Listen for Global Rules
  useEffect(() => {
    if (!isAccessGranted || !isAuthReady) {
      setGlobalRules([]);
      return;
    }
    
    const unsubscribe = onSnapshot(collection(db, 'globalRules'), (snapshot) => {
      const rules = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as PronunciationRule));
      setGlobalRules(rules);
    }, (err) => {
      console.error('Failed to load global rules (Silent Fallback):', err);
    });
    return () => unsubscribe();
  }, [isAccessGranted, isAuthReady]);

  // Fetch History
  useEffect(() => {
    if (isAccessGranted && isAuthReady && auth.currentUser && accessCode && activeTab === 'history') {
      setIsHistoryLoading(true);
      const q = query(collection(db, 'history'), where('userId', '==', accessCode), orderBy('createdAt', 'desc'));
      const unsubscribe = onSnapshot(q, (snapshot) => {
        const items = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as HistoryItem));
        setHistory(items);
        setIsHistoryLoading(false);
      }, (err) => {
        console.error('Failed to load history (Silent Fallback):', err);
        setIsHistoryLoading(false);
      });
      return () => unsubscribe();
    }
  }, [isAccessGranted, isAuthReady, accessCode, activeTab]);

  // Seed default admin if collection is empty
  useEffect(() => {
    if (!isAuthReady || !auth.currentUser) return;
    const seedDefaultAdmin = async () => {
      try {
        // Seed SAW-ADMIN-2026
        const adminDoc = await getDocFromServer(doc(db, 'vlogs_users', 'SAW-ADMIN-2026'));
        if (!adminDoc.exists()) {
          console.log('Seeding default admin Access Code...');
          const defaultAdmin: AuthorizedUser = {
            id: 'SAW-ADMIN-2026',
            userId: 'SAW-ADMIN-2026',
            label: 'Default Admin',
            isActive: true,
            role: 'admin',
            createdAt: new Date().toISOString(),
            createdBy: 'system'
          };
          await setDoc(doc(db, 'vlogs_users', defaultAdmin.id), defaultAdmin);
        }

        // Seed saw_vlogs_2026 as master admin
        const masterAdminDoc = await getDocFromServer(doc(db, 'vlogs_users', 'saw_vlogs_2026'));
        if (!masterAdminDoc.exists()) {
          console.log('Seeding master admin Access Code...');
          const masterAdmin: AuthorizedUser = {
            id: 'saw_vlogs_2026',
            userId: 'saw_vlogs_2026',
            label: 'Master Admin',
            isActive: true,
            role: 'admin',
            createdAt: new Date().toISOString(),
            createdBy: 'system'
          };
          await setDoc(doc(db, 'vlogs_users', masterAdmin.id), masterAdmin);
        }
        console.log('Admin seeding check completed.');
      } catch (err) {
        console.error('Failed to seed admins:', err);
      }
    };
    
    // Only seed if we are on the login screen or admin screen
    if (!isAccessGranted) {
      seedDefaultAdmin();
    }
  }, [isAccessGranted]);

  const handleLogin = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (isVerifyingCode) return;
    
    const code = accessCodeInput.trim();
    if (!code) {
      setError('Please enter your Access Code (User ID).');
      return;
    }

    // Step 1: Admin bypass or reveal password
    if (!isStepTwo) {
      if (code === 'saw_vlogs_2026') {
        setIsVerifyingCode(true);
        setError(null);
        try {
          setIsAccessGranted(true);
          setAccessCode(code);
          // Sync vbsId with accessCode for admin
          setVbsId(code);
          localStorage.setItem('VBS_USER_ID', code);
          setProfile({
            id: 'saw_vlogs_2026',
            note: 'Admin Saw',
            isActive: true,
            role: 'admin',
            createdAt: new Date(),
            expiryDate: '2099-12-31'
          });
          localStorage.setItem('vbs_access_granted', 'true');
          localStorage.setItem('vbs_access_code', code);
          localStorage.setItem('vbs_admin_auth', 'saw_vlogs_2026');
          setToast({ message: 'Welcome Admin Saw!', type: 'success' });
          setTimeout(() => {
            setToast(null);
            window.history.pushState({}, '', '/vbs-admin');
            window.dispatchEvent(new Event('popstate'));
          }, 1500);
        } catch (err) {
          console.error('Admin login error:', err);
          setError('An error occurred during login.');
        } finally {
          setIsVerifyingCode(false);
        }
        return;
      } else {
        // Regular user - show password field
        setIsStepTwo(true);
        setError(null);
        return;
      }
    }

    // Step 2: Regular user login with password
    setIsVerifyingCode(true);
    setError(null);

    try {
      console.log('Attempting public fetch for Access Code:', code);
      // Requirement 2: Direct Document Match using getDocFromServer for maximum reliability
      const codeDoc = await getDocFromServer(doc(db, 'vlogs_users', code));
      
      if (!codeDoc.exists()) {
        console.warn('Access Code not found in vlogs_users collection');
        setError('Invalid Access Code. Please contact Admin for authorization.');
        return;
      }

      const codeData = codeDoc.data() as AuthorizedUser;
      
      // Check password if it exists in DB
      if (codeData.password && codeData.password.trim() !== '' && codeData.password !== passwordInput.trim()) {
        console.warn('Invalid password for access code');
        setError(t('auth.invalidPassword'));
        return;
      }

      // Check Expiry
      if (codeData.expiryDate) {
        const expiry = new Date(codeData.expiryDate);
        if (expiry < new Date()) {
          console.warn('Access Code has expired');
          setError(t('auth.expired'));
          return;
        }
      }

      // Requirement 3: If document exists AND isActive is true, grant access immediately
      if (!codeData.isActive) {
        console.warn('Access Code is inactive');
        setError(t('auth.deactivated'));
        return;
      }

      // Success
      setIsAccessGranted(true);
      setAccessCode(code);
      // Sync vbsId with accessCode for regular user
      setVbsId(code);
      localStorage.setItem('VBS_USER_ID', code);
      setProfile(codeData);
      
      // Sync API Key from Firestore to LocalStorage if present
      if (codeData.api_key_stored) {
        localStorage.setItem('VLOGS_BY_SAW_API_KEY', codeData.api_key_stored);
        setLocalApiKey(codeData.api_key_stored);
      }
      
      // Log successful login
      logActivity(code, 'login', 'User logged into the platform');
      
      // Requirement 3: Save user session to localStorage
      localStorage.setItem('vbs_access_granted', 'true');
      localStorage.setItem('vbs_access_code', code);
      
      setToast({ message: 'Welcome back!', type: 'success' });
      setTimeout(() => setToast(null), 3000);
    } catch (err: any) {
      console.error('Access Code Verification Error:', err);
      let msg = err.message || 'Unknown error';
      if (msg.includes('client is offline')) {
        msg = 'Connection failed. Please check your Firebase configuration or wait a moment for the database to initialize.';
      }
      setError(`Verification failed: ${msg}`);
    } finally {
      setIsVerifyingCode(false);
    }
  };

  const handleLogout = async () => {
    await signOut(auth);
    setIsAccessGranted(false);
    setAccessCode(null);
    setProfile(null);
    setIsStepTwo(false);
    localStorage.removeItem('vbs_access_granted');
    localStorage.removeItem('vbs_access_code');
    // We do NOT remove the API Key on logout as per safety requirements
    setLocalApiKey(null);
    setActiveTab('generate');
  };

  const filteredHistory = useMemo(() => {
    if (!historySearch.trim()) return history;
    const search = historySearch.toLowerCase();
    return history.filter(item => 
      item.text.toLowerCase().includes(search) || 
      item.config.voiceId.toLowerCase().includes(search)
    );
  }, [history, historySearch]);

  const handleClearApiKey = () => {
    localStorage.removeItem('VLOGS_BY_SAW_API_KEY');
    setLocalApiKey(null);
    setToast({ message: 'ဆက်တင်များကို သိမ်းဆည်းပြီးပါပြီ။ Website ကို ပြန်ဖွင့်ပါမည်။ (Settings saved. Reloading page...)', type: 'success' });
    setTimeout(() => {
      window.location.reload();
    }, 1500);
  };

  const maskApiKey = (key: string | undefined) => {
    if (!key) return 'Not Set';
    if (showApiKey) return key;
    return `${key.substring(0, 8)}...${key.substring(key.length - 4)}`;
  };

  const handleUpdateGlobalSettings = async (updates: Partial<GlobalSettings>) => {
    try {
      await updateDoc(doc(db, 'settings', 'global'), updates);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, 'settings/global');
    }
  };

  const handleSaveApiKeyFromModal = async (key: string) => {
    const trimmedKey = key.trim();
    setIsUpdatingKey(true);
    try {
      // 1. Save to Local Storage ONLY as per safety requirements
      localStorage.setItem('VLOGS_BY_SAW_API_KEY', trimmedKey);
      setLocalApiKey(trimmedKey);
      
      setToast({ message: 'ဆက်တင်များကို သိမ်းဆည်းပြီးပါပြီ။ Website ကို ပြန်ဖွင့်ပါမည်။ (Settings saved. Reloading page...)', type: 'success' });
      setTimeout(() => {
        window.location.reload();
      }, 1500);
    } catch (err: any) {
      console.error('Save API Key Error:', err);
      setToast({ message: 'Failed to save API Key', type: 'error' });
      setTimeout(() => setToast(null), 3000);
    } finally {
      setIsUpdatingKey(false);
    }
  };

  const handleAddGlobalRule = () => {
    openModal({
      title: 'Add Global Rule',
      message: 'Enter the original text and its replacement:',
      type: 'prompt',
      placeholder: 'Original text...',
      confirmText: 'Next',
      onConfirm: (original) => {
        if (!original) return;
        openModal({
          title: 'Add Global Rule',
          message: `Enter the replacement for "${original}":`,
          type: 'prompt',
          placeholder: 'Replacement text...',
          confirmText: 'Add Rule',
          onConfirm: async (replacement) => {
            if (!replacement) return;
            try {
              await addDoc(collection(db, 'globalRules'), {
                original: original.trim(),
                replacement: replacement.trim(),
                createdAt: new Date().toISOString()
              });
              setToast({ message: 'Global rule added successfully!', type: 'success' });
              setTimeout(() => setToast(null), 3000);
            } catch (err) {
              handleFirestoreError(err, OperationType.CREATE, 'globalRules');
            }
          }
        });
      }
    });
  };

  const handleDeleteGlobalRule = async (id: string) => {
    openModal({
      title: 'Delete Global Rule',
      message: 'Are you sure you want to delete this global pronunciation rule?',
      type: 'confirm',
      confirmText: 'Delete',
      onConfirm: async () => {
        try {
          await deleteDoc(doc(db, 'globalRules', id));
          setToast({ message: 'Global rule deleted successfully!', type: 'success' });
          setTimeout(() => setToast(null), 3000);
        } catch (err) {
          handleFirestoreError(err, OperationType.DELETE, `globalRules/${id}`);
        }
      }
    });
  };

  const handleUpdateGlobalRule = async (id: string, updates: Partial<PronunciationRule>) => {
    try {
      await updateDoc(doc(db, 'globalRules', id), updates);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `globalRules/${id}`);
    }
  };

  const handleGenerate = async () => {
    console.log("App: Generate Voice Button Clicked");
    
    if (!text.trim()) {
      setError('Please enter some text to generate voiceover.');
      return;
    }

    // Check Expiry
    if (profile?.expiryDate) {
      const expiry = new Date(profile.expiryDate);
      if (expiry < new Date()) {
        console.warn('Access Code has expired during session');
        setError('Your account has expired. Please contact Admin Saw for renewal.');
        setIsAccessGranted(false);
        localStorage.removeItem('vbs_access_granted');
        localStorage.removeItem('vbs_access_code');
        return;
      }
    }

    // Direct Fetching from LocalStorage as requested - Strict Validation
    const effectiveKey = getEffectiveApiKey();
    
    const totalTargetSeconds = (config.targetDuration?.minutes || 0) * 60 + (config.targetDuration?.seconds || 0);
    if (totalTargetSeconds <= 0) {
      setError('Please set a target duration of at least 1 second.');
      return;
    }
    
    if (!effectiveKey) {
      console.warn("App: Generation blocked - No API Key found. Opening settings modal.");
      openModal({
        title: 'API Key Required',
        message: 'ကျေးဇူးပြု၍ Settings တွင် API Key အရင်ထည့်သွင်းပါ။ (No API Key found. Please add one in Settings.)',
        type: 'error',
        confirmText: 'Open Settings',
        onConfirm: () => setIsApiKeyModalOpen(true)
      });
      setError('ကျေးဇူးပြု၍ Settings တွင် API Key အရင်ထည့်သွင်းပါ။ (No API Key found. Please add one in Settings.)');
      return;
    }
    
    setIsLoading(true);
    setError(null);
    setResult(null);
    setEngineStatus('ready');

    console.log("App: Starting voiceover generation process with key...");

    const runGeneration = async (retryAttempt = 0): Promise<void> => {
      try {
        const isMock = systemConfig?.mock_mode || false;
        const ttsService = new GeminiTTSService(effectiveKey);
        
        console.log("App: Applying pronunciation rules...");
        // Apply pronunciation rules sequentially: Default -> Global Admin -> User Custom
        let processedText = text;
        
        // 1. Default Rules
        DEFAULT_RULES.forEach(rule => {
          const regex = new RegExp(rule.original, 'gi');
          processedText = processedText.replace(regex, rule.replacement);
        });

        // 2. Global Admin Rules
        globalRules.forEach(rule => {
          const regex = new RegExp(rule.original, 'gi');
          processedText = processedText.replace(regex, rule.replacement);
        });
        
        // 3. User Custom Rules
        customRules.split('\n').forEach((line) => {
          const parts = line.split('->').map(p => p.trim());
          if (parts.length === 2) {
            const regex = new RegExp(parts[0], 'gi');
            processedText = processedText.replace(regex, parts[1]);
          }
        });

        console.log("App: Text processed, calling TTS service...");
        const audioResult = await ttsService.generateTTS(processedText, config, isMock);
        
        if (audioResult.isSimulation) {
          console.warn("App: Received simulation result (fallback triggered)");
          setError("Note: Real API call failed or timed out. Showing simulation result for testing.");
        } else {
          console.log("App: TTS generation successful, updating state...");
        }
        
        setResult(audioResult);
        setEngineStatus('ready');

        // Log successful TTS process
        if (accessCode && !audioResult.isSimulation) {
          logActivity(accessCode, 'tts', `Generated prompt: ${text.substring(0, 50)}${text.length > 50 ? '...' : ''}`);
        }

        // Save to History (Asynchronous if enabled)
        if (saveToHistory && accessCode && !audioResult.isSimulation) {
          console.log("App: Saving to history (Asynchronous)...");
          // We don't await this to ensure immediate result display
          const saveHistory = async () => {
            try {
              // 1. Upload Audio to Storage
              const audioFileName = `audio/${accessCode}/${Date.now()}.wav`;
              const audioRef = ref(storage, audioFileName);
              await uploadString(audioRef, audioResult.audioData, 'base64');
              const audioStorageUrl = await getDownloadURL(audioRef);

              // 2. Upload SRT to Storage
              const srtFileName = `srt/${accessCode}/${Date.now()}.srt`;
              const srtRef = ref(storage, srtFileName);
              await uploadString(srtRef, audioResult.srtContent);
              const srtStorageUrl = await getDownloadURL(srtRef);

              // 3. Save to Firestore
              await addDoc(collection(db, 'history'), {
                userId: accessCode,
                text: text.length > 1000 ? text.substring(0, 1000) + '...' : text,
                audioStorageUrl: audioStorageUrl,
                srtStorageUrl: srtStorageUrl,
                createdAt: new Date().toISOString(),
                config: config
              });
              
              // Update total generations
              await updateDoc(doc(db, 'settings', 'global'), {
                total_generations: (globalSettings.total_generations || 0) + 1
              });
              console.log("App: History saved successfully in background");
            } catch (storageErr) {
              console.error('Error saving to history in background:', storageErr);
            }
          };
          
          saveHistory();
        }
      } catch (err: any) {
        console.error("App: Generation failed with error:", err);
        const isRateLimit = err.message === 'RATE_LIMIT_EXHAUSTED' || 
                          (err.status === 429) || 
                          (err.message && err.message.includes('429'));

        if (isRateLimit && retryAttempt < 1) {
          setEngineStatus('cooling');
          setRetryCountdown(10);
          
          // Start countdown
          const timer = setInterval(() => {
            setRetryCountdown(prev => {
              if (prev <= 1) {
                clearInterval(timer);
                return 0;
              }
              return prev - 1;
            });
          }, 1000);

          // Auto-retry after 10 seconds
          setTimeout(() => {
            runGeneration(retryAttempt + 1);
          }, 10000);
          return;
        }

        if (isRateLimit) {
          setEngineStatus('limit');
          setError("Your API Key has reached its temporary limit. The system will resume shortly.");
        } else {
          setError(err.message || 'An unexpected error occurred.');
          showToast('Generation failed. Please check your API key and connection.', 'error');
        }
      } finally {
        if (retryAttempt >= 0) { // Only set loading false if we're not waiting for retry
          // Actually, we want to keep loading true during cooling
        }
      }
    };

    await runGeneration();
    setIsLoading(false);
  };

  const handleDeleteHistory = async (id: string) => {
    openModal({
      title: 'Delete History',
      message: 'Are you sure you want to delete this history record?',
      type: 'confirm',
      confirmText: 'Delete',
      onConfirm: async () => {
        try {
          await deleteDoc(doc(db, 'history', id));
          setToast({ message: 'History deleted successfully!', type: 'success' });
          setTimeout(() => setToast(null), 3000);
        } catch (err) {
          handleFirestoreError(err, OperationType.DELETE, `history/${id}`);
        }
      }
    });
  };

  const handleDownloadAudio = async (dataOrUrl: string, filename: string) => {
    let base64Data = dataOrUrl;
    if (dataOrUrl.startsWith('http')) {
      const response = await fetch(dataOrUrl);
      const blob = await response.blob();
      base64Data = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const base64 = (reader.result as string).split(',')[1];
          resolve(base64);
        };
        reader.readAsDataURL(blob);
      });
    }

    const binaryString = window.atob(base64Data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    
    // If it's MP3 data, we don't need pcmToWav
    const audioBlob = new Blob([bytes], { type: 'audio/mp3' });
    const url = URL.createObjectURL(audioBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadSRT = async (contentOrUrl: string, filename: string) => {
    let content = contentOrUrl;
    if (contentOrUrl.startsWith('http')) {
      const response = await fetch(contentOrUrl);
      content = await response.text();
    }
    
    // Add UTF-8 BOM for mobile compatibility
    const BOM = '\uFEFF';
    const blob = new Blob([BOM + content], { type: 'text/srt;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename.toLowerCase(); // Ensure lowercase .srt
    a.click();
    URL.revokeObjectURL(url);
  };

  const playFromHistory = async (item: HistoryItem) => {
    try {
      let audioData = '';
      let srtContent = item.srtContent || '';

      // If we have storage URLs, fetch the data
      if (item.audioStorageUrl) {
        const response = await fetch(item.audioStorageUrl);
        const blob = await response.blob();
        // Convert blob to base64 for AudioResult
        audioData = await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => {
            const base64 = (reader.result as string).split(',')[1];
            resolve(base64);
          };
          reader.readAsDataURL(blob);
        });
      }

      if (item.srtStorageUrl && !srtContent) {
        const response = await fetch(item.srtStorageUrl);
        srtContent = await response.text();
      }

      if (!audioData) return;

      const binaryString = window.atob(audioData);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      const wavBlob = pcmToWav(bytes, 24000);
      const url = URL.createObjectURL(wavBlob);
      
      setResult({
        audioUrl: url,
        audioData: audioData,
        srtContent: srtContent,
        subtitles: GeminiTTSService.parseSRT(srtContent)
      });
      setActiveTab('generate');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      console.error('Error playing from history:', err);
      setError('Failed to load audio from history.');
    }
  };

  const isVbsAdmin = profile?.role === 'admin' || accessCode === 'saw_vlogs_2026';

  const isExpired = useMemo(() => {
    if (!userControl?.expiryDate || isVbsAdmin) return false;
    try {
      const expiry = new Date(userControl.expiryDate);
      if (isNaN(expiry.getTime())) return false;
      expiry.setHours(23, 59, 59, 999);
      return expiry.getTime() < Date.now();
    } catch (e) {
      console.error("Date calculation error:", e);
      return false;
    }
  }, [userControl?.expiryDate, isVbsAdmin]);

  const daysUntilExpiry = useMemo(() => {
    if (!userControl?.expiryDate || isVbsAdmin) return null;
    try {
      const expiry = new Date(userControl.expiryDate);
      if (isNaN(expiry.getTime())) return null;
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      expiry.setHours(0, 0, 0, 0);
      const diffTime = expiry.getTime() - today.getTime();
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      return diffDays;
    } catch (e) {
      console.error("Days until expiry calculation error:", e);
      return null;
    }
  }, [userControl?.expiryDate, isVbsAdmin]);

  const isPremium = isVbsAdmin || (userControl?.membershipStatus === 'premium' && !isExpired);

  useEffect(() => {
    if (isExpired && userControl?.isUnlimited) {
      // Automatically show toast if they just expired
      showToast("သင့်အကောင့် သက်တမ်းကုန်ဆုံးသွားပါပြီ။ Admin ထံ ဆက်သွယ်ပါ။", "error");
    }
  }, [isExpired, userControl?.isUnlimited]);

  // Auto-scroll to Output Preview when generation is complete
  useEffect(() => {
    if (!isLoading && result && activeTab === 'generate') {
      const timer = setTimeout(() => {
        const element = document.getElementById('output-preview-container');
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [isLoading, result, activeTab]);

  const NavTab = ({ id, icon, label, tooltip, onClick, active, locked = false }: {
    id: Tab;
    icon: React.ReactNode;
    label: string;
    tooltip: string;
    onClick: () => void;
    active: boolean;
    locked?: boolean;
  }) => {
    const [isHovered, setIsHovered] = useState(false);
    
    return (
      <div className="relative">
        <button
          onClick={onClick}
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
          className={`px-3 sm:px-6 py-2.5 sm:py-3 rounded-[16px] sm:rounded-[18px] text-xs sm:text-sm font-bold transition-all flex items-center gap-2 relative group ${
            active 
              ? 'bg-brand-purple text-white shadow-[0_0_20px_rgba(139,92,246,0.6)] scale-[1.02] sm:scale-[1.05] z-10' 
              : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-white/5 dark:hover:bg-white/5'
          }`}
        >
          <div className={`${active ? 'scale-110 drop-shadow-[0_0_8px_rgba(255,255,255,0.8)]' : 'group-hover:scale-110 transition-transform'}`}>
            {locked && !active ? <Lock size={16} className="text-rose-400" /> : icon}
          </div>
          <span className={`${active ? 'inline' : 'hidden sm:inline'} text-[10px] sm:text-xs tracking-tight whitespace-nowrap`}>
            {label}
          </span>
          
          {active && (
            <div className="absolute inset-0 bg-brand-purple/20 blur-xl rounded-full -z-10" />
          )}
        </button>

        <AnimatePresence>
          {isHovered && (
            <motion.div
              initial={{ opacity: 0, y: 10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.95 }}
              className="absolute bottom-full mb-3 left-1/2 -translate-x-1/2 px-4 py-2 rounded-xl border border-white/20 bg-white/10 backdrop-blur-md dark:bg-black/20 text-[10px] font-bold text-slate-800 dark:text-white whitespace-nowrap shadow-2xl z-50 pointer-events-none"
            >
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-brand-purple animate-pulse" />
                {tooltip}
              </div>
              <div className="absolute top-full left-1/2 -translate-x-1/2 border-8 border-transparent border-t-white/10" />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  };

  if (!hasEntered) {
    return <WelcomePage onEnter={() => setHasEntered(true)} />;
  }

  return (
    <div className={`min-h-screen flex flex-col transition-colors duration-500 relative overflow-hidden ${isDarkMode ? 'dark bg-[#020617] text-white' : 'bg-slate-50 text-slate-900'}`}>
      {/* Premium Background Glows */}
      <div className="fixed top-[-10%] left-[-10%] w-[40%] h-[40%] bg-brand-purple/10 blur-[120px] rounded-full -z-10 animate-pulse-soft" />
      <div className="fixed bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-neon-magenta/10 blur-[120px] rounded-full -z-10 animate-pulse-soft" />
      
      <Header 
        isDarkMode={isDarkMode} 
        toggleTheme={() => setIsDarkMode(!isDarkMode)} 
        onOpenTools={() => setIsApiKeyModalOpen(true)}
        isAccessGranted={isAccessGranted}
        isAdmin={accessCode === 'saw_vlogs_2026'}
        onLogout={handleLogout}
      />

      <main className="flex-1 container mx-auto px-4 sm:px-6 py-6 sm:py-8 overflow-x-hidden">
        {isConfigLoading ? (
          <div className="flex flex-col items-center justify-center py-40">
            <div className="flex items-center justify-center gap-1.5 h-12 mb-6">
              {[...Array(8)].map((_, i) => (
                <motion.div
                  key={i}
                  className="w-1.5 bg-brand-purple rounded-full"
                  animate={{
                    height: [16, 40, 16],
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
            <p className="text-slate-500 font-bold uppercase tracking-widest text-xs animate-pulse">Initializing Narration Engine...</p>
          </div>
        ) : (isAdminRoute || isAdminConfigRoute) ? (
          <AdminDashboard 
            isAuthReady={isAuthReady} 
            onAdminLogin={(code) => {
              setIsAccessGranted(true);
              setAccessCode(code);
            }}
            configOnly={isAdminConfigRoute}
          />
        ) : !isAccessGranted ? (
          <div className="flex flex-col items-center justify-center py-20 text-center px-4">
            <div className="w-20 h-20 glass-card bg-brand-purple/10 text-brand-purple rounded-[24px] flex items-center justify-center mb-8 shadow-2xl shadow-brand-purple/20">
              <Lock size={40} />
            </div>
            
            <div className="w-full max-w-md space-y-8 premium-glass p-10 rounded-[40px] shadow-2xl neon-glow-indigo relative overflow-hidden">
              <div className="absolute top-0 right-0 w-32 h-32 bg-brand-purple/10 blur-[60px] -z-10" />
          <div>
            <h2 className="text-3xl sm:text-4xl font-bold mb-4 text-slate-900 dark:text-white tracking-tight">{t('auth.title')}</h2>
            <p className="text-slate-600 dark:text-slate-400 text-sm sm:text-base leading-relaxed font-medium">
              {t('auth.subtitle')}
            </p>
          </div>
          
          <form onSubmit={handleLogin} className="space-y-5">
            <div className="relative">
              <Key className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={20} />
              <input
                type="text"
                value={accessCodeInput}
                onChange={(e) => {
                  setAccessCodeInput(e.target.value);
                  if (isStepTwo) setIsStepTwo(false);
                }}
                placeholder={t('auth.placeholder')}
                className="w-full bg-slate-50/50 dark:bg-slate-950/50 border border-slate-200 dark:border-white/10 rounded-[20px] pl-12 pr-4 py-4 text-lg font-mono text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-purple/30 transition-all shadow-inner"
              />
            </div>

            <AnimatePresence>
              {isStepTwo && (
                <motion.div 
                  initial={{ opacity: 0, height: 0, marginTop: 0 }}
                  animate={{ opacity: 1, height: 'auto', marginTop: 16 }}
                  exit={{ opacity: 0, height: 0, marginTop: 0 }}
                  className="relative overflow-hidden"
                >
                  <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={20} />
                  <input
                    type="password"
                    value={passwordInput}
                    onChange={(e) => setPasswordInput(e.target.value)}
                    placeholder={t('auth.passwordPlaceholder')}
                    className="w-full bg-slate-50/50 dark:bg-slate-950/50 border border-slate-200 dark:border-white/10 rounded-[20px] pl-12 pr-4 py-4 text-lg font-mono text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-purple/30 transition-all shadow-inner"
                    required
                    autoFocus
                  />
                </motion.div>
              )}
            </AnimatePresence>
            
            {error && (
              <div className="text-red-500 text-sm font-medium flex items-center justify-center gap-2">
                <AlertCircle size={16} /> {error}
              </div>
            )}
            
            <motion.button
              whileHover={{ scale: 1.02, boxShadow: '0 0 20px rgba(139, 92, 246, 0.4)' }}
              whileTap={{ scale: 0.98 }}
              type="submit"
              disabled={isVerifyingCode || !accessCodeInput.trim() || !isAuthReady}
              className="w-full py-4 bg-brand-purple text-white rounded-[20px] font-bold text-lg hover:bg-brand-purple/90 transition-all flex items-center justify-center gap-2 disabled:opacity-50 shadow-lg shadow-brand-purple/30 metallic-btn"
            >
              {isVerifyingCode || !isAuthReady ? (
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                  {!isAuthReady && <span className="text-sm">{t('auth.connecting')}</span>}
                </div>
              ) : (
                <>
                  {isStepTwo ? t('auth.verify') : t('auth.continue')} 
                  <ArrowRight size={20} />
                </>
              )}
            </motion.button>
              </form>
            </div>
          </div>
        ) : (
          <div className="space-y-8">
            {/* Tab Navigation */}
            <div className="flex items-center gap-1 sm:gap-2 glass-card p-1.5 rounded-[22px] w-fit mx-auto shadow-2xl relative z-40">
              <NavTab
                id="generate"
                active={activeTab === 'generate'}
                onClick={() => setActiveTab('generate')}
                icon={<Wand2 size={18} />}
                label={t('nav.generate')}
                tooltip={t('tooltips.generate')}
              />
              <NavTab
                id="translator"
                active={activeTab === 'translator'}
                onClick={() => setActiveTab('translator')}
                icon={<Languages size={18} />}
                label={t('nav.translator')}
                tooltip={t('tooltips.translator')}
              />
              <NavTab
                id="transcriber"
                active={activeTab === 'transcriber'}
                onClick={() => {
                  if (!isPremium) {
                    showToast(t('video.premiumRequired'), "error");
                    return;
                  }
                  setActiveTab('transcriber');
                }}
                icon={<FileVideo size={18} />}
                label={t('nav.transcriber')}
                tooltip={isPremium ? t('tooltips.premiumActive') : t('tooltips.transcriber')}
                locked={!isPremium}
              />
              <NavTab
                id="history"
                active={activeTab === 'history'}
                onClick={() => setActiveTab('history')}
                icon={<History size={18} />}
                label={t('nav.history')}
                tooltip={t('tooltips.history')}
              />
              <NavTab
                id="tools"
                active={activeTab === 'tools'}
                onClick={() => setActiveTab('tools')}
                icon={<Settings size={18} />}
                label={t('nav.settings')}
                tooltip={t('tooltips.settings')}
              />
            </div>

            <AnimatePresence mode="wait">
              {activeTab === 'generate' && (
                <motion.div
                  key="generate"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  className="grid grid-cols-1 lg:grid-cols-12 gap-8"
                >
                    {/* Left Column - Main Flow */}
                  <div className="lg:col-span-7 space-y-8">
                    <ContentInput 
                      text={text} 
                      setText={setText} 
                      isDarkMode={isDarkMode} 
                      getApiKey={getEffectiveApiKey}
                      showToast={showToast}
                      engineStatus={engineStatus}
                      retryCountdown={retryCountdown}
                    />
                    
                    {/* Default Pronunciation Rules Table */}
                    <PronunciationRules
                      rules={DEFAULT_RULES}
                      globalRules={globalRules}
                      customRules={customRules}
                      setCustomRules={setCustomRules}
                      isAdmin={profile?.role === 'admin'}
                      onOpenTools={() => setIsApiKeyModalOpen(true)}
                      showCustomRules={false}
                    />

                    {error && (
                      <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 flex items-start gap-3 text-red-500">
                        <AlertCircle size={20} className="shrink-0 mt-0.5" />
                        <p className="text-sm font-medium">{error}</p>
                      </div>
                    )}
                  </div>

                  {/* Right Column - Config */}
                  <div className="lg:col-span-5 space-y-8">
                    <VoiceConfig config={config} setConfig={setConfig} isDarkMode={isDarkMode} />

                    <div className="space-y-4">
                      <div className="flex items-center justify-between bg-white/50 backdrop-blur dark:bg-slate-900/50 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm transition-colors duration-300">
                        <div className="flex items-center gap-3">
                          <div className="p-2 bg-brand-purple/10 rounded-lg text-brand-purple">
                            <History size={18} />
                          </div>
                          <div>
                            <p className="text-sm font-bold text-slate-900 dark:text-white">မှတ်တမ်းသိမ်းဆည်းမည်</p>
                            <p className="text-[10px] text-slate-500 dark:text-slate-400">Keep a record of this generation for later access</p>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => setSaveToHistory(!saveToHistory)}
                          className={`w-12 h-6 rounded-full transition-all relative ${saveToHistory ? 'bg-brand-purple' : 'bg-slate-300 dark:bg-slate-700'}`}
                        >
                          <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${saveToHistory ? 'left-7' : 'left-1'}`} />
                        </button>
                      </div>

                      {/* Target Duration Input */}
                      <div className="premium-glass rounded-[24px] p-6 border border-white/5 space-y-4 shadow-xl">
                        <div className="flex items-center justify-between">
                          <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest flex items-center gap-2">
                            <Clock size={14} className="text-brand-purple" /> ဗီဒီယိုကြာချိန် သတ်မှတ်ရန်
                          </label>
                          {(text.length > ((config.targetDuration?.minutes || 0) * 60 + (config.targetDuration?.seconds || 0)) * 15) && (
                            <motion.span 
                              initial={{ opacity: 0, scale: 0.9 }}
                              animate={{ opacity: 1, scale: 1 }}
                              className="text-[10px] font-bold text-amber-500 bg-amber-500/10 px-2 py-0.5 rounded-full border border-amber-500/20"
                            >
                              AI will condense long text
                            </motion.span>
                          )}
                        </div>
                        <div className="flex items-center gap-4">
                          <div className="flex-1 bg-slate-50/50 dark:bg-slate-950/50 border border-slate-200 dark:border-white/10 rounded-xl p-3 flex flex-col items-center gap-1 shadow-inner group transition-all focus-within:ring-2 focus-within:ring-brand-purple/30">
                            <input 
                              type="number" 
                              min="0"
                              max="59"
                              value={config.targetDuration?.minutes || 0}
                              onChange={(e) => setConfig({
                                ...config, 
                                targetDuration: { ...config.targetDuration!, minutes: parseInt(e.target.value) || 0 }
                              })}
                              className="bg-transparent text-2xl font-mono font-bold text-center w-full focus:outline-none text-slate-900 dark:text-white"
                            />
                            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-tighter">မိနစ်</span>
                          </div>
                          <div className="text-2xl font-bold text-slate-300 dark:text-slate-700">:</div>
                          <div className="flex-1 bg-slate-50/50 dark:bg-slate-950/50 border border-slate-200 dark:border-white/10 rounded-xl p-3 flex flex-col items-center gap-1 shadow-inner group transition-all focus-within:ring-2 focus-within:ring-brand-purple/30">
                            <input 
                              type="number" 
                              min="0"
                              max="59"
                              value={config.targetDuration?.seconds || 0}
                              onChange={(e) => setConfig({
                                ...config, 
                                targetDuration: { ...config.targetDuration!, seconds: parseInt(e.target.value) || 0 }
                              })}
                              className="bg-transparent text-2xl font-mono font-bold text-center w-full focus:outline-none text-slate-900 dark:text-white"
                            />
                            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-tighter">စက္ကန့်</span>
                          </div>
                        </div>
                      </div>

                      <button
                        onClick={handleGenerate}
                        disabled={isLoading}
                        className={`w-full py-6 rounded-[24px] font-bold text-xl shadow-2xl flex items-center justify-center gap-4 transition-all active:scale-[0.98] bg-brand-purple hover:bg-brand-purple/90 text-white shadow-brand-purple/40`}
                      >
                        {isLoading ? (
                          <div className="flex items-center gap-1 h-6">
                            {[...Array(4)].map((_, i) => (
                              <motion.div
                                key={i}
                                className="w-1.5 bg-white rounded-full"
                                animate={{
                                  height: [10, 24, 10],
                                }}
                                transition={{
                                  duration: 0.6,
                                  repeat: Infinity,
                                  delay: i * 0.1,
                                }}
                              />
                            ))}
                          </div>
                        ) : (
                          <Zap size={28} fill="currentColor" />
                        )}
                        <div className="flex flex-col items-center">
                          <span className="flex items-baseline gap-3">
                            အသံနှင့် စာတန်းထိုး ထုတ်ယူမည်
                            <span className="text-sm font-medium opacity-60">
                              ({Math.ceil(text.length / 3000) || 1} {Math.ceil(text.length / 3000) > 1 ? 'chunks' : 'chunk'})
                            </span>
                          </span>
                        </div>
                      </button>
                    </div>

                    {/* AI Result Area - Hidden until generated */}
                    <AnimatePresence>
                      {(isLoading || (result && activeTab === 'generate')) && (
                        <motion.div
                          initial={{ opacity: 0, y: 40, scale: 0.98 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          exit={{ opacity: 0, y: 20 }}
                          transition={{ 
                            type: "spring", 
                            stiffness: 100, 
                            damping: 20,
                            duration: 0.6 
                          }}
                          id="output-preview-container"
                          className="mt-8"
                        >
                          <OutputPreview 
                            result={result} 
                            isLoading={isLoading} 
                            globalVolume={config.volume}
                            engineStatus={engineStatus}
                            retryCountdown={retryCountdown}
                            targetDuration={config.targetDuration}
                            showToast={showToast}
                          />
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </motion.div>
              )}

              {activeTab === 'transcriber' && (
                <motion.div
                  key="transcriber"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  className="max-w-4xl mx-auto"
                >
                  {!isPremium ? (
                    <div className="glass-card rounded-[32px] p-12 text-center space-y-6 max-w-2xl mx-auto border border-white/5">
                      <div className="w-20 h-20 bg-rose-500/10 text-rose-500 rounded-3xl flex items-center justify-center mx-auto mb-4 border border-rose-500/20">
                        <Lock size={40} />
                      </div>
                      <h3 className="text-2xl font-bold text-slate-900 dark:text-white">
                        {isExpired ? "သင့်အကောင့် သက်တမ်းကုန်ဆုံးသွားပါပြီ" : "ဤသည်မှာ Premium Feature ဖြစ်ပါသည်။"}
                      </h3>
                      <p className="text-slate-500 dark:text-slate-400 leading-relaxed">
                        {isExpired 
                          ? "သင့်အကောင့် သက်တမ်းကုန်ဆုံးသွားပါပြီ။ အသုံးပြုလိုပါက Admin ထံ ဆက်သွယ်၍ သက်တမ်းတိုးပါ။" 
                          : `အသုံးပြုလိုပါက သင်၏ User ID [${vbsId}] ကို Admin ထံပေးပို့၍ ခွင့်ပြုချက်တောင်းခံပါ။`}
                      </p>
                      <div className="pt-4">
                        <button 
                          onClick={() => setActiveTab('tools')}
                          className="px-8 py-3 bg-brand-purple text-white rounded-xl font-bold hover:bg-brand-purple/90 transition-all shadow-lg shadow-brand-purple/20"
                        >
                          Admin ကို ဆက်သွယ်ရန်
                        </button>
                      </div>
                    </div>
                  ) : (
                    <VideoTranscriber 
                      onTranscriptionComplete={(transcribedText, duration) => {
                        setText(transcribedText);
                        if (duration) {
                          const mins = Math.floor(duration / 60);
                          const secs = Math.floor(duration % 60);
                          setConfig(prev => ({
                            ...prev,
                            targetDuration: {
                              minutes: mins,
                              seconds: secs
                            }
                          }));
                        }
                        setActiveTab('generate');
                        setTimeout(() => {
                          window.scrollTo({ top: 0, behavior: 'smooth' });
                        }, 100);
                      }}
                      getApiKey={getEffectiveApiKey}
                      showToast={showToast}
                      isAdmin={isVbsAdmin}
                      userControl={userControl}
                    />
                  )}
                </motion.div>
              )}

              {activeTab === 'translator' && (
                <motion.div
                  key="translator"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  className="max-w-6xl mx-auto space-y-8"
                >
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 sm:gap-10">
                    {/* Source Text */}
                    <div className="glass-card rounded-[32px] p-8 sm:p-10 shadow-2xl transition-all duration-300">
                      <div className="flex items-center gap-4 mb-8">
                        <div className="p-2.5 bg-brand-purple/10 rounded-xl text-brand-purple">
                          <FileText size={24} />
                        </div>
                        <h3 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight">Source Text</h3>
                      </div>
                      <div className="relative group/textarea">
                        <textarea
                          value={sourceText}
                          onChange={(e) => setSourceText(e.target.value)}
                          placeholder="Enter text to translate (English, Thai, etc.)..."
                          className="w-full h-80 bg-slate-50/50 dark:bg-slate-950/50 border border-slate-200 dark:border-slate-800 rounded-[24px] px-6 py-5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand-purple/50 transition-all resize-none font-medium placeholder:text-slate-400 leading-relaxed"
                        />
                        <div className="absolute top-4 right-4 flex gap-2">
                          <button
                            onClick={() => {
                              navigator.clipboard.writeText(sourceText);
                              showToast('စာသားကို ကူးယူပြီးပါပြီ ✨', 'success');
                            }}
                            disabled={!sourceText}
                            className="p-2.5 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border border-slate-200 dark:border-white/10 rounded-xl text-slate-500 hover:text-brand-purple hover:border-brand-purple/50 transition-all shadow-sm disabled:opacity-30"
                            title="Copy"
                          >
                            <Clipboard size={18} />
                          </button>
                          <button
                            onClick={async () => {
                              try {
                                const clipboardText = await navigator.clipboard.readText();
                                setSourceText(sourceText + clipboardText);
                                showToast('စာသားကို ထည့်သွင်းပြီးပါပြီ 📋', 'success');
                              } catch (err) {
                                console.error('Failed to read clipboard');
                              }
                            }}
                            className="p-2.5 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border border-slate-200 dark:border-white/10 rounded-xl text-slate-500 hover:text-brand-purple hover:border-brand-purple/50 transition-all shadow-sm"
                            title="Paste"
                          >
                            <Clipboard size={18} className="rotate-180" />
                          </button>
                        </div>
                      </div>
                      <button
                        onClick={handleTranslate}
                        disabled={isTranslating || !sourceText.trim()}
                        className={`w-full mt-8 py-5 rounded-[20px] font-bold text-lg shadow-xl flex items-center justify-center gap-3 transition-all active:scale-[0.98] ${
                          isTranslating || !sourceText.trim()
                            ? 'bg-slate-200 dark:bg-slate-800 text-slate-400 cursor-not-allowed'
                            : 'bg-brand-purple hover:bg-brand-purple/90 text-white shadow-lg shadow-brand-purple/30'
                        }`}
                      >
                        {isTranslating ? (
                          <div className="flex items-center gap-0.5 h-5">
                            {[...Array(3)].map((_, i) => (
                              <motion.div
                                key={i}
                                className="w-1 bg-white rounded-full"
                                animate={{
                                  height: [6, 14, 6],
                                }}
                                transition={{
                                  duration: 0.6,
                                  repeat: Infinity,
                                  delay: i * 0.1,
                                }}
                              />
                            ))}
                          </div>
                        ) : (
                          <Languages size={22} />
                        )}
                        {isTranslating ? 'Translating...' : 'Translate to Burmese'}
                      </button>
                    </div>
 
                    {/* Burmese Result */}
                    <div className="glass-card rounded-[32px] p-8 sm:p-10 shadow-2xl transition-all duration-300">
                      <div className="flex items-center gap-4 mb-8">
                        <div className="p-2.5 bg-brand-purple/10 rounded-xl text-brand-purple">
                          <Languages size={24} />
                        </div>
                        <h3 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight">Burmese Result</h3>
                      </div>
                      <div className="relative group/textarea">
                        <textarea
                          value={translatedText}
                          readOnly
                          placeholder="Burmese translation will appear here..."
                          className="w-full h-80 bg-slate-100/50 dark:bg-slate-800/20 border border-slate-200 dark:border-slate-800 rounded-[24px] px-6 py-5 text-slate-900 dark:text-white focus:outline-none transition-all resize-none font-medium placeholder:text-slate-400 leading-relaxed"
                        />
                        <div className="absolute top-4 right-4">
                          <button
                            onClick={() => {
                              navigator.clipboard.writeText(translatedText);
                              showToast('စာသားကို ကူးယူပြီးပါပြီ ✨', 'success');
                            }}
                            disabled={!translatedText}
                            className="p-2.5 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border border-slate-200 dark:border-white/10 rounded-xl text-slate-500 hover:text-brand-purple hover:border-brand-purple/50 transition-all shadow-sm disabled:opacity-30"
                            title="Copy"
                          >
                            <Clipboard size={18} />
                          </button>
                        </div>
                      </div>
                      <button
                        onClick={sendToGenerator}
                        disabled={!translatedText.trim()}
                        className={`w-full mt-8 py-5 rounded-[20px] font-bold text-lg shadow-xl flex items-center justify-center gap-3 transition-all active:scale-[0.98] ${
                          !translatedText.trim()
                            ? 'bg-slate-200 dark:bg-slate-800 text-slate-400 cursor-not-allowed'
                            : 'bg-slate-900 dark:bg-white text-white dark:text-slate-900 hover:opacity-90 shadow-lg'
                        }`}
                      >
                        <ArrowRight size={22} /> Send to Generator
                      </button>
                    </div>
                  </div>
                </motion.div>
              )}

              {activeTab === 'history' && (
                <motion.div
                  key="history"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  className="max-w-6xl mx-auto space-y-8"
                >
                  <div className="glass-card rounded-[32px] p-8 sm:p-10 shadow-2xl transition-all duration-300">
                    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-8 mb-10">
                      <div>
                        <h2 className="text-3xl font-bold flex items-center gap-4 text-slate-900 dark:text-white tracking-tight">
                          <div className="p-2.5 bg-brand-purple/10 rounded-xl text-brand-purple">
                            <History size={28} />
                          </div>
                          {t('history.title')}
                        </h2>
                        <p className="text-slate-500 dark:text-slate-400 text-sm mt-2 font-medium">{t('history.subtitle')}</p>
                      </div>
                      
                      <div className="relative flex-1 max-w-lg">
                        <input
                          type="text"
                          placeholder={t('history.search')}
                          value={historySearch}
                          onChange={(e) => setHistorySearch(e.target.value)}
                          className="w-full bg-slate-50/50 dark:bg-slate-950/50 border border-slate-200 dark:border-slate-800 rounded-[20px] px-6 py-4 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand-purple/50 transition-all pr-14 placeholder:text-slate-400 font-medium shadow-sm"
                        />
                        <div className="absolute right-4 top-1/2 -translate-y-1/2 p-2 bg-brand-purple/10 rounded-xl text-brand-purple">
                          <Search size={18} />
                        </div>
                      </div>
                    </div>

                    {isHistoryLoading ? (
                      <div className="flex flex-col items-center justify-center py-24 gap-6">
                        <div className="relative">
                          <div className="w-14 h-14 border-4 border-brand-purple/20 border-t-brand-purple rounded-full animate-spin" />
                          <History size={20} className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-brand-purple animate-pulse" />
                        </div>
                        <p className="text-slate-500 dark:text-slate-400 font-bold uppercase tracking-widest text-xs">{t('history.loading')}</p>
                      </div>
                    ) : filteredHistory.length === 0 ? (
                      <div className="text-center py-32 bg-slate-50/50 dark:bg-slate-950/50 rounded-[32px] border border-dashed border-slate-200 dark:border-slate-800">
                        <div className="w-20 h-20 bg-white dark:bg-white/5 rounded-full flex items-center justify-center mx-auto mb-6 text-slate-400 dark:text-slate-600 shadow-inner">
                          <History size={40} />
                        </div>
                        <h3 className="text-xl font-bold text-slate-900 dark:text-slate-300">{t('history.noResults')}</h3>
                        <p className="text-slate-500 dark:text-slate-500 text-sm mt-2 max-w-xs mx-auto leading-relaxed">{t('history.adjustSearch')}</p>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 gap-6">
                        {filteredHistory.map((item) => (
                          <div key={item.id} className="group bg-white/40 dark:bg-slate-900/40 border border-slate-200/50 dark:border-slate-800/50 rounded-[24px] p-6 sm:p-8 transition-all hover:bg-white/60 dark:hover:bg-slate-900/60 hover:border-brand-purple/40 hover:shadow-xl hover:-translate-y-1">
                            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-8">
                              <div className="flex-1 min-w-0 space-y-4">
                                <div className="flex items-center gap-4">
                                  <span className="px-3 py-1 bg-brand-purple/10 text-brand-purple rounded-full text-[10px] font-bold uppercase tracking-[0.15em] border border-brand-purple/20">
                                    {item.config.voiceId}
                                  </span>
                                  <div className="flex items-center gap-2 text-[10px] text-slate-500 dark:text-slate-400 font-bold uppercase tracking-widest">
                                    <Clock size={12} />
                                    {new Date(item.createdAt).toLocaleString()}
                                  </div>
                                </div>
                                <p className="text-base font-medium text-slate-900 dark:text-slate-200 line-clamp-2 leading-relaxed">
                                  {item.text}
                                </p>
                              </div>
                              
                              <div className="flex items-center gap-3 shrink-0">
                                <button 
                                  onClick={() => {
                                    navigator.clipboard.writeText(item.text);
                                    showToast(t('generate.copySuccess'), 'success');
                                  }}
                                  className="p-3 bg-slate-100 dark:bg-white/5 text-slate-500 rounded-[14px] hover:bg-brand-purple hover:text-white transition-all border border-slate-200 dark:border-white/10 shadow-sm"
                                  title={t('history.copyText')}
                                >
                                  <Clipboard size={18} />
                                </button>
                                <button 
                                  onClick={() => playFromHistory(item)}
                                  className="flex items-center gap-3 px-6 py-3 bg-brand-purple text-white rounded-[16px] text-sm font-bold hover:bg-brand-purple/90 transition-all shadow-lg shadow-brand-purple/30 active:scale-95"
                                >
                                  <Play size={16} fill="currentColor" /> {t('history.play')}
                                </button>
                                <div className="h-10 w-[1px] bg-slate-200 dark:bg-slate-800 mx-1" />
                                <button 
                                  onClick={() => handleDownloadAudio(item.audioStorageUrl || '', `narration-${item.id}.mp3`)}
                                  className="p-3 bg-blue-500/10 text-blue-500 rounded-[14px] hover:bg-blue-500 hover:text-white transition-all border border-blue-500/20 shadow-sm"
                                  title={t('output.downloadMp3')}
                                >
                                  <Music size={18} />
                                </button>
                                <button 
                                  onClick={() => handleDownloadSRT(item.srtStorageUrl || item.srtContent || '', `subtitles-${item.id}.srt`)}
                                  className="p-3 bg-amber-500/10 text-amber-500 rounded-[14px] hover:bg-amber-500 hover:text-white transition-all border border-amber-500/20 shadow-sm"
                                  title={t('output.downloadSrt')}
                                >
                                  <FileText size={18} />
                                </button>
                                <button 
                                  onClick={() => handleDeleteHistory(item.id)}
                                  className="p-3 bg-rose-500/10 text-rose-500 rounded-[14px] hover:bg-rose-500 hover:text-white transition-all border border-rose-500/20 shadow-sm"
                                  title={t('common.delete')}
                                >
                                  <Trash2 size={18} />
                                </button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </motion.div>
              )}

              {activeTab === 'tools' && (
                <motion.div
                  key="tools"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  className="max-w-5xl mx-auto space-y-8"
                >
                  {/* Profile Card */}
                  <div className="glass-card rounded-[32px] p-8 sm:p-12 shadow-2xl transition-all duration-300">
                    <div className="flex flex-col lg:flex-row items-center lg:items-start gap-8 lg:gap-10 text-center lg:text-left">
                      <div className="w-24 h-24 sm:w-32 sm:h-32 bg-gradient-to-br from-brand-purple to-purple-700 text-white rounded-[32px] flex items-center justify-center text-4xl sm:text-5xl font-bold shadow-2xl shadow-brand-purple/30 border border-white/10 shrink-0">
                        {accessCode?.charAt(0).toUpperCase() || 'V'}
                      </div>
                      <div className="flex-1 w-full space-y-4">
                        <div className="flex flex-col lg:flex-row items-center gap-4">
                          <h3 className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white tracking-tight">User ID: {accessCode}</h3>
                          <span className="flex items-center gap-2 px-4 py-1.5 rounded-full text-[10px] sm:text-[11px] font-bold uppercase tracking-[0.15em] border bg-emerald-500/10 text-emerald-500 border-emerald-500/20 shadow-sm">
                            <CheckCircle2 size={14} /> Authorized Access
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center justify-center lg:justify-start gap-6 text-slate-500 dark:text-slate-400">
                          <div className="flex items-center gap-2 text-sm font-medium">
                            <Clock size={16} className="text-brand-purple" />
                            Session active
                          </div>
                          <div className="flex items-center gap-2 text-sm font-medium">
                            <ShieldCheck size={16} className="text-brand-purple" />
                            {isPremium ? 'အဆင့်မြင့် (Premium) အသုံးပြုသူ' : 'သာမန် (Standard) အသုံးပြုသူ'}
                          </div>
                          <div className="flex items-center gap-2 text-sm font-medium">
                            <Calendar size={16} className="text-brand-purple" />
                            {isVbsAdmin ? (
                              "သက်တမ်း: Lifetime Premium"
                            ) : (userControl?.membershipStatus === 'premium' || userControl?.isUnlimited) ? (
                              <div className="flex items-center gap-2">
                                <span>အကောင့်သက်တမ်းကုန်ဆုံးရက်: {userControl.expiryDate ? (
                                  (() => {
                                    try {
                                      const d = new Date(userControl.expiryDate);
                                      return isNaN(d.getTime()) ? 'မာစတာအကောင့် (Master)' : d.toLocaleDateString('en-GB');
                                    } catch(e) { return 'မာစတာအကောင့် (Master)'; }
                                  })()
                                ) : 'မာစတာအကောင့် (Master)'}</span>
                                {daysUntilExpiry !== null && daysUntilExpiry <= 3 && daysUntilExpiry >= 0 && (
                                  <span className="px-2 py-0.5 bg-amber-500/10 text-amber-500 rounded-md text-[10px] font-bold animate-pulse border border-amber-500/20">
                                    {daysUntilExpiry === 0 ? "ယနေ့ ကုန်ဆုံးပါမည်" : `${daysUntilExpiry} ရက်သာ လိုပါတော့သည်`}
                                  </span>
                                )}
                              </div>
                            ) : (
                              "သက်တမ်း: Standard User"
                            )}
                          </div>
                        </div>
                        
                        <div className="pt-6 flex flex-col sm:flex-row gap-4">
                          <button
                            onClick={handleLogout}
                            className="px-8 py-4 bg-rose-500/10 text-rose-500 border border-rose-500/20 rounded-[16px] font-bold text-sm hover:bg-rose-500 hover:text-white transition-all flex items-center justify-center gap-3 shadow-sm"
                          >
                            <LogOut size={18} /> Sign Out
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Gemini API Key Section */}
                  <div 
                    onClick={() => setIsApiKeyModalOpen(true)}
                    className="glass-card rounded-[24px] p-6 sm:p-8 shadow-2xl transition-all duration-300 cursor-pointer hover:border-brand-purple/30 group"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-brand-purple/10 rounded-xl flex items-center justify-center text-brand-purple group-hover:scale-110 transition-transform">
                          <Key size={20} />
                        </div>
                        <div>
                          <h3 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white">Gemini API Key</h3>
                          <p className="text-xs text-slate-500 dark:text-slate-400">Configure your personal Google AI Studio key</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className={`flex items-center gap-2 text-[10px] sm:text-[11px] font-bold uppercase tracking-widest ${localApiKey ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                          <div className={`w-2.5 h-2.5 rounded-full ${localApiKey ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`} />
                          {localApiKey ? 'CONNECTED' : 'No API Key found'}
                        </div>
                        <ChevronRight size={18} className="text-slate-400 group-hover:translate-x-1 transition-transform" />
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
      </main>

      {/* Settings Integrated into Tools Tab */}
      {/* Toast Notification */}
      <ApiKeyModal 
        isOpen={isApiKeyModalOpen}
        onClose={() => setIsApiKeyModalOpen(false)}
        onSave={handleSaveApiKeyFromModal}
        onClear={handleClearApiKey}
        initialKey={localApiKey || ''}
        vbsId={vbsId}
      />
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 50 }}
            className={`fixed bottom-8 left-1/2 -translate-x-1/2 px-6 py-3 rounded-2xl shadow-2xl flex items-center gap-3 z-50 border backdrop-blur-xl ${
              toast.type === 'success' 
                ? 'bg-emerald-500/20 border-emerald-500/30 text-emerald-400' 
                : 'bg-red-500/20 border-red-500/30 text-red-400'
            }`}
          >
            {toast.type === 'success' ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
            <span className="text-sm font-bold">{toast.message}</span>
          </motion.div>
        )}
      </AnimatePresence>
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
      <footer className="py-12 flex justify-center px-6">
        <p className="text-slate-500 font-mono text-[10px] md:text-xs tracking-[0.2em] uppercase text-center max-w-xs md:max-w-none leading-relaxed opacity-60">
          © 2026 Vlogs By Saw <span className="mx-2 hidden md:inline">•</span> <br className="md:hidden" /> Premium AI Narration
        </p>
      </footer>
    </div>
  );
}

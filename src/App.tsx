import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { AlertCircle, Wand2, Key, Settings, LogOut, ShieldCheck, CheckCircle2, History, Trash2, Music, FileText, RefreshCw, ExternalLink, Clock, Lock, ArrowRight, ChevronRight, Search, FileVideo, Clipboard, Mic2, Play, Info, Sparkles, Image as ImageIcon } from 'lucide-react';
import { WelcomePage } from './components/WelcomePage';
import { Header } from './components/Header';
import { ApiKeyModal } from './components/ApiKeyModal';
import { ContentInput } from './components/ContentInput';
import { PronunciationRules } from './components/PronunciationRules';
import { VoiceConfig } from './components/VoiceConfig';
import { OutputPreview } from './components/OutputPreview';
import { AdminDashboard } from './components/AdminDashboard';
import { VideoTranscriber } from './components/VideoTranscriber';
import { ThumbnailCreator } from './components/ThumbnailCreator';
import { AnnouncementPanel } from './components/AnnouncementPanel';
import { Modal, ModalType } from './components/Modal';
import { GeminiTTSService } from './services/geminiService';
import { logActivity } from './services/activityService';
import { TTSConfig, AudioResult, PronunciationRule, HistoryItem, GlobalSettings, SystemConfig, VBSUserControl, Announcement } from './types';
import { DEFAULT_RULES } from './constants';
import { useLanguage } from './contexts/LanguageContext';
import { translateError } from './utils/errorUtils';
import { pcmToWav, formatMyanmarDuration, pcmBase64ToWav, renderSpeedAdjustedAudio } from './utils/audioUtils';
import { generateOptimizedSubtitles } from './utils/subtitleUtils';
import { db, storage, auth, signInAnonymously, signOut, onAuthStateChanged, doc, getDocFromServer, setDoc, updateDoc, onSnapshot, handleFirestoreError, OperationType, collection, query, where, orderBy, addDoc, deleteDoc, ref, uploadString, getDownloadURL, serverTimestamp } from './firebase';

type Tab = 'generate' | 'translator' | 'transcriber' | 'thumbnail' | 'history' | 'tools' | 'admin' | 'vbs-admin';

export default function App() {
  const { language, t } = useLanguage();

  const [activeTab, setActiveTab] = useState<Tab>('generate');
  const [hasEntered, setHasEntered] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [text, setText] = useState('');
  const [customRules, setCustomRules] = useState('');
  const [saveToHistory, setSaveToHistory] = useState(false);
  const [config, setConfig] = useState<TTSConfig>({
    voiceId: 'kore',
    speed: 1.0,
    pitch: 0,
    volume: 80,
    styleInstruction: '',
  });
  const [isLoading, setIsLoading] = useState(false);
  const [isProcessingSpeed, setIsProcessingSpeed] = useState(false);
  const [result, setResult] = useState<AudioResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Sign in anonymously is restricted in the console, so we skip it for now.
  // The app will function in bypass mode using localStorage for the API Key.
  
  const [localApiKey, setLocalApiKey] = useState<string | null>(localStorage.getItem('VLOGS_BY_SAW_API_KEY'));
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [profile, setProfile] = useState<VBSUserControl | null>(null);
  const [globalSettings, setGlobalSettings] = useState<GlobalSettings>({
    allow_admin_keys: false,
    total_generations: 0,
    api_keys: ['']
  });
  const [engineStatus, setEngineStatus] = useState<'ready' | 'cooling' | 'limit'>('ready');
  const [retryCountdown, setRetryCountdown] = useState(0);
  const [isConfigLoading, setIsConfigLoading] = useState(false); // Default to false to bypass loading screen if env vars missing
  const [isAdminRoute, setIsAdminRoute] = useState(window.location.pathname === '/vbs-admin');
  const [isAdminConfigRoute, setIsAdminConfigRoute] = useState(window.location.pathname === '/vbs-admin-config');
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [isSessionSynced, setIsSessionSynced] = useState(false);

  useEffect(() => {
    // Safety timeout for auth readiness in case Firebase Auth is blocked by browser tracking protection
    const timer = setTimeout(() => {
      if (!isAuthReady) {
        console.warn("Auth readiness safety timeout reached. Proceeding...");
        setIsAuthReady(true);
      }
    }, 6000);
    return () => clearTimeout(timer);
  }, [isAuthReady]);

  const [vbsId, setVbsId] = useState<string | null>(localStorage.getItem('VBS_USER_ID'));
  const [userControl, setUserControl] = useState<VBSUserControl | null>(null);
  const [abortController, setAbortController] = useState<AbortController | null>(null);

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
            updatedAt: serverTimestamp()
          } as unknown as VBSUserControl;
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

  const isUsingAdminKey = useMemo(() => {
    // Personal checks
    if (localStorage.getItem('VLOGS_BY_SAW_API_KEY')) return false;
    if (profile?.api_key_stored) return false;
    
    // Admin checks
    if (globalSettings.allow_admin_keys) {
      if ((globalSettings.primary_key || globalSettings.secondary_key || globalSettings.backup_key)) return true;
      if ((globalSettings.api_keys || []).some(k => k.trim())) return true;
    }
    
    // Environment check (treated as admin key technically)
    if (typeof process !== 'undefined' && process.env.GEMINI_API_KEY) return true;
    
    return false;
  }, [profile, globalSettings]);

  const getEffectiveApiKey = useCallback(() => {
    // Priority -1: Immediate LocalStorage fetch (Strict persistence for Admin)
    const immediateLocalKey = localStorage.getItem('VLOGS_BY_SAW_API_KEY');
    if (immediateLocalKey && immediateLocalKey.trim()) {
      return immediateLocalKey.trim();
    }

    // [ADMIN PREMIUM KEY PRIORITY - COMMANDER ORDER]
    // If the toggle is ON, we bypass everything and use admin keys directly.
    if (isUsingAdminKey && globalSettings.allow_admin_keys) {
      const adminKeys = [
        globalSettings.primary_key || '',
        globalSettings.secondary_key || '',
        globalSettings.backup_key || ''
      ].filter(k => k.trim());

      if (adminKeys.length > 0) {
        console.log("App: Bypassing local storage - Using Admin Premium Keys (Toggle is ON)");
        return adminKeys.join(',');
      }
    }
    
    // Priority 2: Firestore User Profile
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
  }, [profile, globalSettings, localApiKey, isUsingAdminKey]);

  // Global Rules & History
  const [globalRules, setGlobalRules] = useState<PronunciationRule[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historySearch, setHistorySearch] = useState('');
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  // Auth & Access State (Custom)
  const [accessCodeInput, setAccessCodeInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [isStepTwo, setIsStepTwo] = useState(false);
  const [isAccessGranted, setIsAccessGranted] = useState(() => {
    return localStorage.getItem('vbs_access_granted') === 'true' || 
           localStorage.getItem('vbs_access_code') === 'saw_vlogs_2026';
  }); 
  const [isVerifyingCode, setIsVerifyingCode] = useState(false);
  const [accessCode, setAccessCode] = useState<string | null>(() => localStorage.getItem('vbs_access_code'));
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
        setIsAuthReady(true);
      } else {
        signInAnonymously(auth).then((result) => {
          if (result.user) {
            setIsAuthReady(true);
          }
        }).catch((err) => {
          console.error("Failed to sign in anonymously (Silent Auth Fallback):", err);
          // Don't set isAuthReady to true if it failed, stay in loading state
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
            createdAt: serverTimestamp()
          });
          
          console.log('Session synced for access code:', accessCode);
          setIsSessionSynced(true);
        } catch (e) {
          console.error('Failed to sync session:', e);
          setIsSessionSynced(false);
        }
      };
      syncSession();
    } else {
      setIsSessionSynced(false);
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
      
      // Fetch profile data directly from server for reliability
      getDocFromServer(doc(db, 'user_controls', code)).then(async (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.data() as VBSUserControl;
          setProfile(data);
          
          // Sync API Key from Firestore to LocalStorage if missing locally
          if (data.api_key_stored && !localStorage.getItem('VLOGS_BY_SAW_API_KEY')) {
            const trimmedKey = data.api_key_stored.trim();
            localStorage.setItem('VLOGS_BY_SAW_API_KEY', trimmedKey);
            setLocalApiKey(trimmedKey);
          }
        } else if (code === 'saw_vlogs_2026') {
          // Master Admin Fallback
          setProfile({ 
            vbsId: code, 
            role: 'admin', 
            isActive: true, 
            note: 'The Commander',
            membershipStatus: 'premium'
          } as unknown as VBSUserControl);
        } else {
          // If the code is no longer in authorized_users, log out
          if (code !== 'preview-user') {
            handleLogout();
          }
        }
      }).catch((err) => {
        console.error("Profile fetch error (possibly waiting for session sync):", err);
        // If it's a permission error, we don't logout yet, we wait for isSessionSynced
        // The rule might be denying 'get' if the session isn't there yet, even though we changed it to isSignedIn()
        // Sometimes Firestore rules have slight propagation delay
      });
    }
  }, [isAuthReady]);

  // Listen for Global Settings
  useEffect(() => {
    if (!isAccessGranted || !isAuthReady || !auth.currentUser) return;
    
    const unsubscribe = onSnapshot(doc(db, 'settings', 'global'), (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data() as GlobalSettings;
        
        // Merge offline announcements if they exist (only for the current admin who saved them)
        const offlineAnnouncements = localStorage.getItem('vbs_offline_announcements');
        if (offlineAnnouncements) {
          try {
            const parsed = JSON.parse(offlineAnnouncements);
            // Deduplicate by ID, preferring server version but keeping local ones not yet on server
            const serverAnnouncements = data.announcements || [];
            const merged = [...serverAnnouncements];
            parsed.forEach((offAnn: Announcement) => {
              if (offAnn && offAnn.id && !merged.find(a => a.id === offAnn.id)) {
                merged.push(offAnn);
              }
            });
            data.announcements = merged;
          } catch {
            console.error("Failed to merge offline announcements");
          }
        }

        setGlobalSettings(data);
        setIsConfigLoading(false);
      } else {
        // Fallback for settings if doc doesn't exist yet
        const offlineAnnouncements = localStorage.getItem('vbs_offline_announcements');
        if (offlineAnnouncements) {
           try {
             const parsed = JSON.parse(offlineAnnouncements);
             setGlobalSettings(prev => ({ ...prev, announcements: parsed }));
           } catch {
             // Silence is golden
           }
        }
        setIsConfigLoading(false);
      }
    }, (err) => {
      console.error('Failed to load global settings (Silent Fallback):', err);
      // Try to load from localStorage as absolute fallback
      const offlineAnnouncements = localStorage.getItem('vbs_offline_announcements');
      if (offlineAnnouncements) {
        try {
          const parsed = JSON.parse(offlineAnnouncements);
          setGlobalSettings(prev => ({ ...prev, announcements: parsed }));
        } catch {
          // Silence is golden
        }
      }
      setIsConfigLoading(false);
    });
    return () => unsubscribe();
  }, [isAccessGranted, isAuthReady]);

  // Listen for System Config
  useEffect(() => {
    if (!isAccessGranted || !isAuthReady || !auth.currentUser || profile?.role !== 'admin' || !isSessionSynced) return;
    
    const unsubscribe = onSnapshot(doc(db, 'system_config', 'main'), (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data() as SystemConfig;
        // Save to localStorage for the NEXT reload to use this config
        localStorage.setItem('vbs_system_config', JSON.stringify(data));
      }
    }, (err) => {
      console.error('Failed to load system config (Silent Fallback):', err);
    });
    return () => unsubscribe();
  }, [isAccessGranted, isAuthReady, profile]);

  // Listen for Global Rules
  useEffect(() => {
    if (!isAccessGranted || !isAuthReady || !auth.currentUser) {
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
        const adminDoc = await getDocFromServer(doc(db, 'user_controls', 'SAW-ADMIN-2026'));
        if (!adminDoc.exists()) {
          console.log('Seeding default admin Access Code...');
          const defaultAdmin: VBSUserControl = {
            vbsId: 'SAW-ADMIN-2026',
            isActive: true,
            role: 'admin',
            isUnlimited: true,
            membershipStatus: 'premium',
            dailyUsage: 0,
            lastUsedDate: new Date().toDateString(),
            isBlocked: false,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
          };
          await setDoc(doc(db, 'user_controls', defaultAdmin.vbsId), defaultAdmin);
        }

        // Seed saw_vlogs_2026 as master admin
        const masterAdminDoc = await getDocFromServer(doc(db, 'user_controls', 'saw_vlogs_2026'));
        if (!masterAdminDoc.exists()) {
          console.log('Seeding master admin Access Code...');
          const masterAdmin: VBSUserControl = {
            vbsId: 'saw_vlogs_2026',
            isActive: true,
            role: 'admin',
            isUnlimited: true,
            membershipStatus: 'premium',
            dailyUsage: 0,
            lastUsedDate: new Date().toDateString(),
            isBlocked: false,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
          };
          await setDoc(doc(db, 'user_controls', masterAdmin.vbsId), masterAdmin);
        }
        console.log('Admin seeding check completed.');
      } catch (err) {
        console.error('Failed to seed admin:', err);
      }
    };
    
    // Only seed if we are not authenticated
    if (!isAccessGranted) {
      seedDefaultAdmin();
    }
  }, [isAccessGranted]);

  const handleLogin = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    
    const code = accessCodeInput.trim();
    if (!code) {
      setError('Please enter your Access Code (User ID).');
      return;
    }

    // [COMMANDER BYPASS - URGENT]
    if (code === 'saw_vlogs_2026') {
      setIsAccessGranted(true);
      setAccessCode(code);
      setVbsId(code);
      localStorage.setItem('VBS_USER_ID', code);
      localStorage.setItem('vbs_access_granted', 'true');
      localStorage.setItem('vbs_access_code', code);
      setProfile({ 
        vbsId: code, 
        role: 'admin', 
        isActive: true, 
        note: 'The Commander',
        membershipStatus: 'premium'
      } as unknown as VBSUserControl);
      setToast({ message: 'Welcome back, Commander!', type: 'success' });
      setTimeout(() => setToast(null), 3000);
      return;
    }

    // Step 1: Check code presence
    if (!isStepTwo) {
      // Regular login flow
      setIsStepTwo(true);
      setError(null);
      return;
    }

    // Step 2: Regular user login with password
    setIsVerifyingCode(true);
    setError(null);

    try {
      console.log('Attempting public fetch for Access Code:', code);
      // Requirement 2: Direct Document Match using getDocFromServer for maximum reliability
      const codeDoc = await getDocFromServer(doc(db, 'user_controls', code));
      
      if (!codeDoc.exists()) {
        console.warn('Access Code not found in user_controls collection');
        setError('Invalid Access Code. Please contact Admin for authorization.');
        return;
      }

      const codeData = codeDoc.data() as VBSUserControl;
      
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
      localStorage.setItem('vbs_access_granted', 'true');
      localStorage.setItem('vbs_access_code', code);
      setProfile(codeData);
      
      // Sync API Key from Firestore to LocalStorage if present
      if (codeData.api_key_stored) {
        const trimmedKey = codeData.api_key_stored.trim();
        localStorage.setItem('VLOGS_BY_SAW_API_KEY', trimmedKey);
        setLocalApiKey(trimmedKey);
      }
      
      // Log successful login
      logActivity(code, 'login', 'User logged into the platform');
      
      // Requirement 3: Save user session to localStorage
      localStorage.setItem('vbs_access_granted', 'true');
      localStorage.setItem('vbs_access_code', code);
      
      setToast({ message: 'Welcome back!', type: 'success' });
      setTimeout(() => setToast(null), 3000);
    } catch (err: unknown) {
      console.error('Access Code Verification Error:', err);
      const errorObj = err as { message?: string };
      let msg = errorObj.message || 'Unknown error';
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
    setToast({ message: 'API Key အောင်မြင်စွာ ဖျက်လိုက်ပါပြီ။ (API Key cleared successfully!)', type: 'success' });
    setTimeout(() => setToast(null), 3000);
  };

  const handleSaveApiKeyFromModal = async (key: string) => {
    const trimmedKey = key.trim();
    try {
      // 1. Save to Local Storage ONLY as per safety requirements
      localStorage.setItem('VLOGS_BY_SAW_API_KEY', trimmedKey);
      setLocalApiKey(trimmedKey);
      
      setToast({ message: 'ဆက်တင်များကို သိမ်းဆည်းပြီးပါပြီ။ (Settings saved successfully!)', type: 'success' });
      setTimeout(() => setToast(null), 3000);
    } catch (err: unknown) {
      console.error('Save API Key Error:', err);
      setToast({ message: 'Failed to save API Key', type: 'error' });
      setTimeout(() => setToast(null), 3000);
    } finally {
      // Done setting key
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

    // [SINGLE-PASS ESTIMATION - COMMANDER ORDER]
    // Gemini 1.5 Flash uses single-pass with no recursive sync loops
    const effectiveKey = getEffectiveApiKey();
    
    if (!effectiveKey || !effectiveKey.trim()) {
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
    
    if (!text || text.trim().length === 0) {
      showToast("ကျေးဇူးပြု၍ ပြောင်းလဲလိုသော စာသားကို အရင်ရိုက်ထည့်ပါ။ (Please enter text to convert.)", 'error');
      return;
    }
    
    setIsLoading(true);
    setError(null);
    setResult(null);
    setEngineStatus('ready');

    console.log("App: Starting voiceover generation process with key...");

    const runGeneration = async (retryAttempt = 0): Promise<void> => {
      try {
        const ttsService = new GeminiTTSService(effectiveKey);
        
        const currentController = new AbortController();
        setAbortController(currentController);

        console.log("App: Applying pronunciation rules...");
        let processedText = text;
        
        DEFAULT_RULES.forEach(rule => {
          const regex = new RegExp(rule.original, 'gi');
          processedText = processedText.replace(regex, rule.replacement);
        });

        globalRules.forEach(rule => {
          const regex = new RegExp(rule.original, 'gi');
          processedText = processedText.replace(regex, rule.replacement);
        });
        
        customRules.split('\n').forEach((line) => {
          const parts = line.split('->').map(p => p.trim());
          if (parts.length === 2) {
            const regex = new RegExp(parts[0], 'gi');
            processedText = processedText.replace(regex, parts[1]);
          }
        });

        // [SINGLE-PASS ESTIMATION - COMMANDER ORDER]
        // Gemini 1.5 Flash uses single-pass with no recursive sync loops
        const generationPromise = ttsService.generateTTS(
          processedText, 
          { ...config }
        );

        console.log(`App: Calling TTS service with Single-Pass logic...`);
        
        const audioResult = await generationPromise;
        
        // [SPEED ADJUSTMENT - CRITICAL FIX]
        let finalAudioResult = { ...audioResult };
        if (config.speed && config.speed !== 1.0) {
          setIsProcessingSpeed(true);
          try {
            console.log(`App: Processing audio speed adjustment to ${config.speed}x...`);
            const wavBlob = pcmBase64ToWav(audioResult.audioData);
            const { blob: speedAdjustedBlob, duration: finalDuration } = await renderSpeedAdjustedAudio(wavBlob, config.speed);
            const finalUrl = URL.createObjectURL(speedAdjustedBlob);
            
            // Re-generate subtitles for final duration
            const finalSubtitles = generateOptimizedSubtitles(processedText, finalDuration);
            const finalSrt = finalSubtitles.map(s => `${s.index}\n${s.startTime} --> ${s.endTime}\n${s.text}\n`).join('\n');
            
            // Convert blob to base64 for history/storage
            const speedAdjustedBuffer = await speedAdjustedBlob.arrayBuffer();
            const reader = new FileReader();
            const base64Promise = new Promise<string>((resolve) => {
              reader.onloadend = () => {
                const base64data = reader.result as string;
                resolve(base64data.split(',')[1]);
              };
            });
            reader.readAsDataURL(speedAdjustedBlob);
            const finalBase64 = await base64Promise;

            finalAudioResult = {
              ...audioResult,
              audioUrl: finalUrl,
              audioData: finalBase64,
              rawAudio: speedAdjustedBuffer, // CRITICAL: Update rawAudio to new buffer
              duration: finalDuration,
              baseDuration: finalDuration, // Update so OutputPreview sees the final duration
              subtitles: finalSubtitles,
              srtContent: finalSrt,
              speed: config.speed
            };
          } catch (err) {
            console.error("Speed adjustment failed:", err);
            // Fallback to 1x if processing fails
          } finally {
            setIsProcessingSpeed(false);
          }
        }

        // [AUTO-PLAY REMOVED - USER REQUEST]
        // Playback is now triggered manually by the user in the OutputPreview component

        // IMMEDIATE RELEASE: Show result before any DB writes
        setResult(finalAudioResult);
        setError(null);
        setEngineStatus('ready');
        setIsLoading(false); 
        setAbortController(null);
        
        // BACKGROUND TASKS: Non-blocking
        if (accessCode) {
          logActivity(accessCode, 'tts', `Generated: ${text.substring(0, 50)}`).catch(() => {});
        }

        if (saveToHistory && accessCode) {
          const saveHistory = async () => {
            try {
              const audioFileName = `audio/${accessCode}/${Date.now()}.wav`;
              const audioRef = ref(storage, audioFileName);
              await uploadString(audioRef, finalAudioResult.audioData, 'base64');
              const audioStorageUrl = await getDownloadURL(audioRef);

              const srtFileName = `srt/${accessCode}/${Date.now()}.srt`;
              const srtRef = ref(storage, srtFileName);
              await uploadString(srtRef, finalAudioResult.srtContent);
              const srtStorageUrl = await getDownloadURL(srtRef);

              await addDoc(collection(db, 'history'), {
                userId: accessCode,
                text: text.length > 5000 ? text.substring(0, 5000) + '...' : text,
                audioStorageUrl: audioStorageUrl,
                srtStorageUrl: srtStorageUrl,
                duration: finalAudioResult.duration,
                config: { ...config },
                createdAt: serverTimestamp(),
              });

              await updateDoc(doc(db, 'settings', 'global'), {
                total_generations: (globalSettings.total_generations || 0) + 1
              });

              console.log("App: Generation saved to history successfully.");
            } catch (err) {
              console.error("App: Failed to save to history:", err);
            }
          };
          saveHistory();
        }
      } catch (err: unknown) {
        setIsLoading(false);
        setAbortController(null);
        
        const error = err as { message?: string; name?: string; status?: number };

        if (error.message === 'AbortError' || error.name === 'AbortError') {
          console.log("App: Generation cancelled by user");
          setEngineStatus('ready');
          return;
        }
        if (error.message?.startsWith('TEXT_TOO_LONG')) {
          const parts = error.message.split('|');
          setError(`${t('generate.textTooLong')} (${parts[1]}/${parts[2]})`);
          return;
        }
        
        const isRateLimit = error.message === 'RATE_LIMIT_EXHAUSTED' || error.status === 429;
        if (isRateLimit && retryAttempt < 1) {
          setEngineStatus('cooling');
          setRetryCountdown(10);
          const timer = setInterval(() => {
            setRetryCountdown(prev => {
              if (prev <= 1) { clearInterval(timer); return 0; }
              return prev - 1;
            });
          }, 1000);
          setTimeout(() => runGeneration(retryAttempt + 1), 10000);
          return;
        }

        if (isRateLimit) {
          setEngineStatus('limit');
          setError(translateError(err, language));
        } else {
          setError(translateError(err, language));
          showToast(translateError(err, language), 'error');
        }
      } 
    };

    try {
      await runGeneration();
    } catch (criticalErr) {
      console.error("Critical Generation Error:", criticalErr);
      setError("A critical error occurred. Please try again.");
    } finally {
      setIsLoading(false);
    }
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
      
      // Check if it's MP3 or PCM (OLD)
      let audioBlob: Blob;
      if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) { // ID3 (MP3)
        audioBlob = new Blob([bytes], { type: 'audio/mp3' });
      } else if (bytes[0] === 0xFF && (bytes[1] & 0xE0) === 0xE0) { // Sync Frame (MP3)
        audioBlob = new Blob([bytes], { type: 'audio/mp3' });
      } else {
        // Assume old PCM format
        audioBlob = pcmToWav(bytes, 24000);
      }
      
      const url = URL.createObjectURL(audioBlob);
      const audioArrayBuffer = await audioBlob.arrayBuffer();
      
      setResult({
        audioUrl: url,
        audioData: audioData,
        rawAudio: audioArrayBuffer,
        srtContent: srtContent,
        subtitles: GeminiTTSService.parseSRT(srtContent),
        baseDuration: item.baseDuration || 0,
        oneXDuration: item.oneXDuration || item.baseDuration || 0,
        speed: item.config.speed || 1.0,
        duration: item.duration || item.baseDuration || 0
      });
      setActiveTab('generate');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      console.error('Error playing from history:', err);
      setError('Failed to load audio from history.');
    }
  };

  const isVbsAdmin = useMemo(() => {
    const ADMIN_CODE = import.meta.env.VITE_ADMIN_ACCESS_CODE || 'saw_vlogs_2026';
    return accessCode === ADMIN_CODE;
  }, [accessCode]);

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

  const isPremium = isVbsAdmin || (userControl?.membershipStatus === 'premium' && !isExpired);
  const canUseThumbnail = isVbsAdmin || (isPremium && !!globalSettings.allow_thumbnail_admin_key);

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

  const NavTab = ({ icon, label, tooltip, onClick, active, locked = false }: {
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
        isAdmin={isVbsAdmin}
        onLogout={handleLogout}
        profile={profile}
        userControl={userControl}
      />

      {isAccessGranted && !isVbsAdmin && (
        <AnnouncementPanel announcements={globalSettings.announcements} />
      )}

      <main className="flex-1 container mx-auto px-4 sm:px-6 py-6 sm:py-8 overflow-x-hidden">
        <div className="mb-8 text-center sm:text-left">
          <h1 className="text-3xl sm:text-5xl font-black text-slate-900 dark:text-white mb-2 flex items-center justify-center sm:justify-start gap-3">
            Vlogs By Saw
            <span className="text-xs bg-brand-purple/10 text-brand-purple px-3 py-1 rounded-full uppercase tracking-tighter shadow-sm border border-brand-purple/20">
              Premium AI Narration
            </span>
          </h1>
          <p className="text-slate-500 dark:text-slate-400 font-medium max-w-2xl">
            Professional Burmese Storytelling & Cinematic AI Voiceover Studio. Engineered for high-end recap content.
          </p>
        </div>

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
            
            <div className="mt-12 flex flex-col items-center gap-3">
              <a 
                href={window.location.href} 
                target="_blank" 
                rel="noopener noreferrer"
                className="flex items-center gap-2 px-4 py-2 bg-brand-purple/10 text-brand-purple rounded-full hover:bg-brand-purple/20 transition-all text-sm font-medium group"
              >
                <ExternalLink size={14} className="group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
                Open in New Tab (Fixes Safari/iOS)
              </a>
              <p className="text-[10px] text-slate-400 max-w-[250px] text-center leading-relaxed">
                If the app fails to load, your browser might be blocking session cookies. Opening in a new tab or disabling "Prevent Cross-Site Tracking" in Safari usually fixes this.
              </p>
            </div>
          </div>
        ) : (isAdminRoute || isAdminConfigRoute) ? (
          <AdminDashboard 
            isAuthReady={isAuthReady} 
            onAdminLogin={(code) => {
              setIsAccessGranted(true);
              setAccessCode(code);
            }}
            configOnly={isAdminConfigRoute}
            isSessionSynced={isSessionSynced}
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
                icon={<Mic2 size={18} />}
                label={t('nav.studio')}
                tooltip={t('tooltips.generate')}
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
                id="thumbnail"
                active={activeTab === 'thumbnail'}
                onClick={() => {
                  if (!canUseThumbnail) {
                    showToast(isPremium ? t('thumbnailFeature.temporarilyDisabled') : t('thumbnailFeature.premiumRequired'), "error");
                    return;
                  }
                  setActiveTab('thumbnail');
                }}
                icon={<ImageIcon size={18} />}
                label={t('nav.thumbnail') || 'သမ်းနေးလ်'}
                tooltip={canUseThumbnail ? t('tooltips.thumbnail') : t('thumbnailFeature.locked')}
                locked={!canUseThumbnail}
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
                      speed={config.speed}
                      hasResult={!!result}
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
                    <VoiceConfig 
                      config={config} 
                      setConfig={setConfig} 
                      isDarkMode={isDarkMode} 
                      isAdmin={profile?.role === 'admin'}
                      baseDuration={result?.oneXDuration}
                    />

                    <div className="space-y-4">
                      <div className="flex items-center justify-between bg-white/50 backdrop-blur dark:bg-slate-900/50 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm transition-colors duration-300">
                        <div className="flex items-center gap-3">
                          <div className="p-2 bg-brand-purple/10 rounded-lg text-brand-purple">
                            <History size={18} />
                          </div>
                          <div>
                            <p className="text-sm font-bold text-slate-900 dark:text-white">{t('generate.saveToHistory')}</p>
                            <p className="text-[10px] text-slate-500 dark:text-slate-400">{t('generate.saveToHistoryDesc')}</p>
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

                      {config.speed > 1.5 && (
                          <motion.div 
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="mb-6 p-4 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 shadow-xl shadow-amber-500/5"
                          >
                            <div className="flex gap-3">
                              <Info size={18} className="shrink-0 mt-0.5 text-amber-500" />
                              <div className="text-[11px] leading-relaxed space-y-1">
                                <p className="font-bold">အမြန်နှုန်း အရမ်းမြန်ရင် အသံအရည်အသွေး အနည်းငယ် ပြောင်းလဲနိုင်ပါတယ်။</p>
                                <p className="opacity-80">အကောင်းဆုံး အသံထွက်အတွက် 1.2x မှ 1.5x အတွင်းသာ ထားရှိရန် အကြံပြုပါတယ်။</p>
                                <button 
                                  onClick={() => setConfig(prev => ({ ...prev, speed: 1.2 }))}
                                  className="mt-2 flex items-center gap-1.5 px-3 py-1 bg-amber-500 text-white rounded-full font-bold uppercase text-[9px] tracking-wider hover:bg-amber-600 transition-all shadow-lg shadow-amber-500/30"
                                >
                                  <Sparkles size={10} />
                                  Optimize to 1.2x
                                </button>
                              </div>
                            </div>
                          </motion.div>
                        )}

                      <button
                        onClick={isLoading || isProcessingSpeed ? () => abortController?.abort() : handleGenerate}
                        disabled={isLoading || isProcessingSpeed}
                        className={`w-full py-6 rounded-[24px] font-bold text-xl shadow-2xl flex items-center justify-center gap-4 transition-all active:scale-[0.98] ${
                          (isLoading || isProcessingSpeed) 
                            ? 'bg-rose-500/10 text-rose-500 border border-rose-500/20 shadow-none cursor-not-allowed' 
                            : 'bg-brand-purple hover:bg-brand-purple/90 text-white shadow-brand-purple/40'
                        }`}
                      >
                        {(isLoading || isProcessingSpeed) ? (
                          <div className="flex flex-col items-center gap-1">
                            {isProcessingSpeed ? (
                              <div className="flex flex-col items-center gap-2">
                                <RefreshCw size={24} className="animate-spin text-rose-500" />
                                <span className="text-sm font-bold text-rose-500">
                                  ⚙️ Speed {config.speed}x အသံပြင်ဆင်နေသည်...
                                </span>
                              </div>
                            ) : (
                              <>
                                <div className="flex items-center gap-1 h-5">
                                  {[...Array(5)].map((_, i) => (
                                    <motion.div
                                      key={i}
                                      className="w-1 bg-rose-500 rounded-full"
                                      animate={{
                                        height: [8, 20, 8],
                                      }}
                                      transition={{
                                        duration: 0.6,
                                        repeat: Infinity,
                                        delay: i * 0.1,
                                      }}
                                    />
                                  ))}
                                </div>
                                <span className="animate-pulse text-xs opacity-90">{t('generate.generating')}</span>
                                <span className="text-[10px] font-bold opacity-60 uppercase tracking-widest mt-0.5">ခေတ္တစောင့်ဆိုင်းပေးပါ... (Might take 1-2 mins)</span>
                              </>
                            )}
                          </div>
                        ) : error ? (
                          <>
                            <RefreshCw size={24} className="animate-spin-slow" /> Retry Generation
                          </>
                        ) : (
                          <>
                            <Wand2 size={24} /> {t('generate.generateBtn')}
                          </>
                        )}
                      </button>
                      <div className="flex flex-col items-center">
                          <span className="flex items-baseline gap-3">
                            {"အသံနှင့် စာတန်းထိုး ထုတ်ယူမည်"}
                            <span className="text-sm font-medium opacity-60">
                              ({Math.ceil(text.length / 3000) || 1} {Math.ceil(text.length / 3000) > 1 ? 'chunks' : 'chunk'})
                            </span>
                          </span>
                        </div>
                    </div>

                        <AnimatePresence>
                          {(isLoading || error || (result && activeTab === 'generate')) && (
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
                                playbackSpeed={config.speed}
                                result={result} 
                                isLoading={isLoading} 
                                error={error}
                                onRetry={() => handleGenerate()}
                                globalVolume={config.volume}
                                engineStatus={engineStatus}
                                retryCountdown={retryCountdown}
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
                            : "အသုံးပြုလိုပါက Admin ထံသို့ ခွင့်ပြုချက်တောင်းခံပါ။"
                          }
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
                      onTranscriptionComplete={(transcribedText) => {
                        setText(transcribedText);
                        setActiveTab('generate');
                        setTimeout(() => {
                          window.scrollTo({ top: 0, behavior: 'smooth' });
                        }, 100);
                      }}
                      getApiKey={getEffectiveApiKey}
                      showToast={showToast}
                      isAdmin={isVbsAdmin}
                      userControl={userControl}
                      isUsingAdminKey={isUsingAdminKey}
                      allowVideoRecapAdminKey={globalSettings.allow_video_recap_admin_key}
                    />
                  )}
                </motion.div>
              )}

              {activeTab === 'thumbnail' && (
                <motion.div
                  key="thumbnail"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                >
                   <ThumbnailCreator 
                     isDarkMode={isDarkMode} 
                     showToast={showToast}
                     getApiKey={getEffectiveApiKey}
                     isAdmin={isVbsAdmin}
                     isPremium={isPremium}
                     allowThumbnailAdminKey={globalSettings.allow_thumbnail_admin_key}
                   />
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
                                  {(item.duration || item.baseDuration) > 0 && (
                                    <div className="flex items-center gap-2 text-[10px] text-brand-purple font-bold uppercase tracking-widest bg-brand-purple/5 px-2 py-0.5 rounded-full border border-brand-purple/10">
                                      <Play size={10} fill="currentColor" />
                                      {formatMyanmarDuration(item.duration || item.baseDuration || 0)}
                                    </div>
                                  )}
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
                                  title={t('history.delete')}
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
                  <div className="glass-card rounded-[32px] p-8 sm:p-12 shadow-2xl transition-all duration-300 relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-32 h-32 bg-brand-purple/5 blur-[50px] -z-10" />
                    <div className="flex flex-col lg:flex-row items-center lg:items-start gap-8 lg:gap-10 text-center lg:text-left">
                      <div className="w-24 h-24 sm:w-32 sm:h-32 bg-gradient-to-br from-brand-purple to-purple-700 text-white rounded-[32px] flex items-center justify-center text-4xl sm:text-5xl font-bold shadow-2xl shadow-brand-purple/30 border border-white/10 shrink-0">
                        {accessCode?.charAt(0).toUpperCase() || 'V'}
                      </div>
                      <div className="flex-1 w-full space-y-4">
                        <div className="flex flex-col lg:flex-row items-center gap-4">
                          <h3 className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white tracking-tight">
                            {t('settings.title')}
                          </h3>
                          <span className="flex items-center gap-2 px-4 py-1.5 rounded-full text-[10px] sm:text-[11px] font-bold uppercase tracking-[0.15em] border bg-emerald-500/10 text-emerald-500 border-emerald-500/20 shadow-sm">
                            <CheckCircle2 size={14} /> AUTHORIZED
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center justify-center lg:justify-start gap-6 text-slate-500 dark:text-slate-400">
                          <div className="flex items-center gap-2 text-sm font-medium">
                            <Clock size={16} className="text-brand-purple" />
                            Session active
                          </div>
                          <div className="flex items-center gap-2 text-sm font-medium">
                            <ShieldCheck size={16} className="text-brand-purple" />
                            {isPremium ? (language === 'mm' ? 'အဆင့်မြင့် (Premium) အသုံးပြုသူ' : 'Premium Access Active') : (language === 'mm' ? 'သာမန် (Standard) အသုံးပြုသူ' : 'Standard User')}
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

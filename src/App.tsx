import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { AlertCircle, Wand2, Key, Settings, User, LogIn, LogOut, ShieldCheck, ShieldAlert, Shield, CheckCircle2, XCircle, History, Wrench, Plus, Trash2, Download, Play, Music, FileText, Eye, EyeOff, Cloud, RefreshCw, Zap, X, ExternalLink, Calendar, Clock, Mail, Wifi, Save, Lock, Info, ArrowRight, ChevronRight, ChevronDown } from 'lucide-react';
import { Header } from './components/Header';
import { Footer } from './components/Footer';
import { ApiKeyModal } from './components/ApiKeyModal';
import { ContentInput } from './components/ContentInput';
import { PronunciationRules } from './components/PronunciationRules';
import { VoiceConfig } from './components/VoiceConfig';
import { OutputPreview } from './components/OutputPreview';
import { WelcomePage } from './components/WelcomePage';
import { MiniAudioPlayer } from './components/MiniAudioPlayer';
import { AdminDashboard } from './components/AdminDashboard';
import { GeminiTTSService } from './services/geminiService';
import { sendTelegramNotification } from './services/telegramService';
import { TTSConfig, AudioResult, PronunciationRule, HistoryItem, Config, AppUser } from './types';
import { DEFAULT_RULES, VOICE_OPTIONS } from './constants';
import { pcmToWav } from './utils/audioUtils';
import { db, storage, auth, signInAnonymously, signOut, onAuthStateChanged, doc, getDoc, getDocFromServer, setDoc, updateDoc, onSnapshot, handleFirestoreError, OperationType, collection, query, where, orderBy, addDoc, deleteDoc, getDocs, limit, ref, uploadString, uploadBytes, getDownloadURL, deleteField } from './firebase';
import { safeStorage, safeSessionStorage, safeHistory, safeLocation } from './utils/safeBrowser';

type Tab = 'generate' | 'history' | 'tools' | 'admin' | 'vbs-admin';

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('generate');
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [text, setText] = useState('');
  const [customRules, setCustomRules] = useState('');
  const [saveToHistory, setSaveToHistory] = useState(false);
  const [config, setConfig] = useState<TTSConfig>({
    voiceId: 'zephyr',
    speed: 1.0,
    pitch: 0,
    volume: 80,
  });
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<AudioResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  // Auto-dismiss Toast
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => {
        setToast(null);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  const [profile, setProfile] = useState<AppUser | null>(null);
  const [systemConfig, setSystemConfig] = useState<Config>({
    isSystemLive: true,
    allow_global_key: false
  });

  // Global Rules & History
  const [globalRules, setGlobalRules] = useState<PronunciationRule[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historySearch, setHistorySearch] = useState('');
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const [isConfigLoading, setIsConfigLoading] = useState(true);
  const [isAdminRoute, setIsAdminRoute] = useState(false);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [isSessionSynced, setIsSessionSynced] = useState(false);
  const [showWelcome, setShowWelcome] = useState(false);

  // Auth & Access State (Custom)
  const [accessCodeInput, setAccessCodeInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [showPasswordInput, setShowPasswordInput] = useState(false);
  const [isAccessGranted, setIsAccessGranted] = useState(false);
  const [isVerifyingCode, setIsVerifyingCode] = useState(false);
  const [accessCode, setAccessCode] = useState<string | null>(null);
  const [isApiKeyModalOpen, setIsApiKeyModalOpen] = useState(false);
  const [isChangePasswordModalOpen, setIsChangePasswordModalOpen] = useState(false);
  const [newPass, setNewPass] = useState('');
  const [confirmPass, setConfirmPass] = useState('');
  const [isUpdatingPassword, setIsUpdatingPassword] = useState(false);
  const [apiKeyMode, setApiKeyMode] = useState<'admin' | 'personal'>('admin');
  const [localApiKey, setLocalApiKey] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [isUpdatingKey, setIsUpdatingKey] = useState(false);

  // Password Hashing Utility (SHA-256)
  const hashPassword = async (password: string): Promise<string> => {
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  };
  const [lastGenerationTime, setLastGenerationTime] = useState<number>(() => {
    const saved = safeStorage.getItem('vbs_last_gen_time');
    return saved ? parseInt(saved, 10) : 0;
  });
  const [remainingCooldown, setRemainingCooldown] = useState(0);

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accessCode || !newPass || newPass !== confirmPass || isUpdatingPassword) return;

    setIsUpdatingPassword(true);
    try {
      const hashed = await hashPassword(newPass);
      await updateDoc(doc(db, 'users', accessCode), {
        password: hashed,
        access_password: newPass,
        failedAttempts: 0
      });

      setToast({ message: 'Password updated successfully! 🔐', type: 'success' });
      setIsChangePasswordModalOpen(false);
      setNewPass('');
      setConfirmPass('');
    } catch (err) {
      console.error('Failed to update password:', err);
      setToast({ message: 'Failed to update password. Please try again.', type: 'error' });
    } finally {
      setIsUpdatingPassword(false);
    }
  };

  // Welcome Page Logic
  useEffect(() => {
    // Test Firestore connection
    const testConnection = async () => {
      try {
        await getDocFromServer(doc(db, '_internal', 'connection_test'));
      } catch (error) {
        if (error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Firestore Error: The client is offline. Please check your Firebase configuration.");
          setToast({ message: "Firebase connection failed. Please check configuration.", type: 'error' });
        }
      }
    };
    testConnection();

    if (isAccessGranted) {
      const hasSeenWelcome = safeSessionStorage.getItem('vbs_welcome_seen');
      if (!hasSeenWelcome) {
        setShowWelcome(true);
      }
    }
  }, [isAccessGranted]);

  const handleGetStarted = () => {
    setShowWelcome(false);
    safeSessionStorage.setItem('vbs_welcome_seen', 'true');
    setActiveTab('generate');
    
    // Smooth scroll to top if needed
    try {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {
      // Ignore scroll errors
    }
  };

  // Cooldown Timer Effect
  useEffect(() => {
    const COOLDOWN_SECONDS = 60;
    const isAdmin = accessCode === 'saw_vlogs_2026';
    
    if (isAdmin) {
      setRemainingCooldown(0);
      return;
    }

    const updateTimer = () => {
      const now = Date.now();
      const timeSinceLastGen = (now - lastGenerationTime) / 1000;
      const remaining = Math.max(0, Math.ceil(COOLDOWN_SECONDS - timeSinceLastGen));
      setRemainingCooldown(remaining);
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [lastGenerationTime, accessCode]);

  // Route Guard & Location Sync
  useEffect(() => {
    const handleLocationChange = () => {
      const path = window.location.pathname;
      const isAdm = path === '/vbs-admin' || path === '/admin';
      setIsAdminRoute(isAdm);
      
      // Redirect unauthorized users back to login page (home)
      if (isAdm && accessCode !== 'saw_vlogs_2026') {
        safeHistory.pushState({}, '', '/');
        try {
          window.dispatchEvent(new PopStateEvent('popstate'));
        } catch (e) {
          // Ignore dispatch errors
        }
        setIsAdminRoute(false);
      }
    };

    window.addEventListener('popstate', handleLocationChange);
    // Initial check
    handleLocationChange();
    
    return () => window.removeEventListener('popstate', handleLocationChange);
  }, [accessCode]);

  // Load API Key and Mode from LocalStorage on Mount
  useEffect(() => {
    const savedKeyEncoded = safeStorage.getItem('VLOGS_BY_SAW_API_KEY');
    const savedMode = safeStorage.getItem('VBS_API_KEY_MODE') as 'admin' | 'personal';
    
    if (savedKeyEncoded) {
      try {
        // Try to decode Base64
        setLocalApiKey(atob(savedKeyEncoded));
      } catch (e) {
        // Fallback for old plain text keys
        setLocalApiKey(savedKeyEncoded);
      }
    }
    
    if (savedMode) setApiKeyMode(savedMode);
  }, []);

  const handleSaveApiKeyMode = (mode: 'admin' | 'personal') => {
    setApiKeyMode(mode);
    safeStorage.setItem('VBS_API_KEY_MODE', mode);
  };

  // Handle Anonymous Auth
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user) {
        setUserId(user.uid);
        setIsAuthReady(true);
        // Clear auth-related errors if we successfully connected
        setError(prev => prev?.includes('authentication is restricted') ? null : prev);
      } else {
        // Only try to sign in anonymously if we're not already in the process of signing in with Google
        // or if we're not already signed in.
        signInAnonymously(auth).then(() => {
          setIsAuthReady(true);
          setError(prev => (prev?.includes('authentication is restricted') || prev?.includes('Anonymous Auth is disabled')) ? null : prev);
        }).catch((err) => {
          // If anonymous auth is disabled, it's a configuration issue in Firebase Console
          if (err.code === 'auth/admin-restricted-operation') {
            console.warn("Anonymous Auth is disabled in Firebase Console. Non-admin access will be limited.");
            // We'll show a helpful error if they aren't already logged in
            if (!auth.currentUser) {
              setError("Anonymous Auth is disabled in Firebase Console. Please enable it in Authentication > Sign-in method to use the app.");
            }
          } else {
            console.error("Silent Auth Fallback Error:", err);
          }
          setIsAuthReady(true);
        });
      }
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const handleLocationChange = () => {
      const isRoute = window.location.pathname === '/vbs-admin';
      setIsAdminRoute(isRoute);
    };
    
    handleLocationChange();
    window.addEventListener('popstate', handleLocationChange);
    return () => window.removeEventListener('popstate', handleLocationChange);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDarkMode);
  }, [isDarkMode]);

  // Sync Session for Security Rules
  useEffect(() => {
    // Aggressive Sync: If we have the master code, we try to sync as soon as auth is ready
    if (isAccessGranted && isAuthReady && auth.currentUser && accessCode) {
      const syncSession = async () => {
        try {
          // If it's master admin, we can optimistically set synced to true to speed up UI
          // but we still need to do the actual write for Firestore rules to pass
          const isMaster = accessCode === 'saw_vlogs_2026';
          if (isMaster) setIsSessionSynced(true);

          if (!auth.currentUser) {
            // Try one last time to sign in anonymously if we're not authenticated
            try {
              await signInAnonymously(auth);
            } catch (authErr) {
              console.error("Final login auth attempt failed:", authErr);
              throw new Error("Authentication failed. Please ensure Anonymous Auth is enabled in Firebase Console.");
            }
          }

          if (!auth.currentUser) {
            throw new Error("Authentication failed. No user found.");
          }

          await setDoc(doc(db, 'sessions', auth.currentUser.uid), {
            accessCode: accessCode,
            createdAt: new Date().toISOString()
          });
          console.log('Session synced successfully for UID:', auth.currentUser.uid);
          setIsSessionSynced(true);
        } catch (e) {
          console.error('Failed to sync session:', e);
          setIsSessionSynced(false);
        }
      };
      syncSession();
    } else {
      // Don't reset if we are in the middle of a sync or if it's master admin
      if (!accessCode || accessCode !== 'saw_vlogs_2026') {
        setIsSessionSynced(false);
      }
    }
  }, [isAccessGranted, isAuthReady, accessCode, userId]);

  // Restore Session from LocalStorage (ID only) and Sync with Firestore
  useEffect(() => {
    const code = safeStorage.getItem('vbs_access_code');
    if (code) {
      setAccessCode(code);
      // Speed up: If it's the master code, grant access immediately
      if (code === 'saw_vlogs_2026') {
        setIsAccessGranted(true);
      }
    } else {
      setIsConfigLoading(false);
    }
  }, []);

  // Real-time User Profile Sync
  useEffect(() => {
    if (!accessCode) return;
    
    // For normal users, we wait for auth to be ready to ensure session sync can happen
    // but for master admin, we can start immediately
    if (accessCode !== 'saw_vlogs_2026' && !isAuthReady) return;
    
    const unsubscribe = onSnapshot(doc(db, 'users', accessCode), (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data() as AppUser;
        
        // Check expiry
        const now = new Date();
        const expiry = new Date(data.expiryDate);
        
        if (data.isActive && expiry > now) {
          setProfile(data);
          setIsAccessGranted(true);
        } else {
          setIsAccessGranted(false);
          if (expiry <= now) {
            setError('Your access has expired. Please contact Admin.');
          } else {
            setError('Your account is inactive.');
          }
        }
      } else {
        // If code is 'saw_vlogs_2026', it's a master code override
        if (accessCode === 'saw_vlogs_2026') {
          setProfile({
            id: 'saw_vlogs_2026',
            name: 'Master Admin',
            isActive: true,
            createdAt: new Date().toISOString(),
            expiryDate: '2099-12-31T23:59:59Z'
          });
          setIsAccessGranted(true);
        } else {
          setIsAccessGranted(false);
          safeStorage.removeItem('vbs_access_code');
        }
      }
      setIsConfigLoading(false);
    }, (err) => {
      // For master admin, we might not have a document yet, so we ignore permission errors here
      // and rely on the static profile set in the snapshot handler if it doesn't exist.
      if (accessCode === 'saw_vlogs_2026') {
        setProfile({
          id: 'saw_vlogs_2026',
          name: 'Master Admin',
          isActive: true,
          createdAt: new Date().toISOString(),
          expiryDate: '2099-12-31T23:59:59Z'
        });
        setIsAccessGranted(true);
        setIsConfigLoading(false);
      } else {
        console.error('User Sync Error:', err);
        setIsConfigLoading(false);
      }
    });
    
    return () => unsubscribe();
  }, [accessCode, isAuthReady]);

  // Listen for System Config (Real-time) - DIRECT FETCHING (No Auth Required)
  useEffect(() => {
    // We remove the auth guard here to allow fetching the key immediately as requested
    const unsubscribe = onSnapshot(doc(db, 'settings', 'global_config'), (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data() as Config;
        console.log("App: Global Config Updated from Firestore", { 
          hasGeminiKey: !!data.gemini_api_key,
          isSystemLive: data.isSystemLive 
        });
        setSystemConfig({
          ...data,
          isSystemLive: data.isSystemLive ?? true,
          allow_global_key: data.allow_global_key ?? false
        });
      }
      setIsConfigLoading(false);
    }, (err) => {
      // Only log if it's not a permission error due to missing auth (though rules allow public read)
      if (err.code !== 'permission-denied') {
        console.error('Config Sync Error:', err);
      }
      setIsConfigLoading(false);
    });
    return () => unsubscribe();
  }, []); // Run immediately on mount

  // Auto-set System to LIVE if requested (One-time check for Master Admin)
  useEffect(() => {
    if (accessCode === 'saw_vlogs_2026' && systemConfig.isSystemLive === false) {
      console.log("App: Auto-toggling System to LIVE as requested by Admin...");
      updateDoc(doc(db, 'settings', 'global_config'), {
        isSystemLive: true,
        updatedAt: new Date().toISOString()
      }).catch(err => console.error("App: Failed to auto-toggle system status:", err));
    }
  }, [accessCode, systemConfig.isSystemLive]);

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
    if (isAccessGranted && isAuthReady && accessCode && activeTab === 'history') {
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

  const handleLogin = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (isVerifyingCode) return;
    setError(null);
    
    const code = accessCodeInput.trim();
    if (!code) {
      setError('Please enter your Access ID.');
      return;
    }

    // Master code override - IMMEDIATE BYPASS (No Auth Required)
    if (code === 'saw_vlogs_2026') {
      setIsVerifyingCode(true);
      
      // Ensure we have a Firebase session even for Master Admin to call proxy
      if (!auth.currentUser) {
        try {
          await signInAnonymously(auth);
        } catch (err: any) {
          console.warn("Master Admin: Anonymous Auth failed, but proceeding with local bypass.", err);
        }
      }

      setAccessCode(code);
      safeStorage.setItem('vbs_access_code', code);
      // DO NOT set vbs_isAdmin here anymore, force password check in Dashboard
      
      // Only show toast if not already shown in this session
      if (!safeSessionStorage.getItem('vbs_admin_toast_shown')) {
        setToast({ message: 'Master Admin Access Granted', type: 'success' });
        safeSessionStorage.setItem('vbs_admin_toast_shown', 'true');
      }
      
      // Redirect to Admin Dashboard immediately
      safeHistory.pushState({}, '', '/vbs-admin');
      try {
        window.dispatchEvent(new PopStateEvent('popstate'));
      } catch (e) {
        // Ignore dispatch errors
      }
      setIsVerifyingCode(false);
      return;
    }

    if (!isAuthReady) {
      setError('System is still connecting. Please wait a moment.');
      return;
    }

    if (!auth.currentUser) {
      try {
        await signInAnonymously(auth);
      } catch (err: any) {
        if (err.code === 'auth/admin-restricted-operation') {
          setError('System authentication is restricted. Please enable Anonymous Auth in Firebase Console.');
        } else {
          setError(`Authentication failed: ${err.message}`);
        }
        return;
      }
    }

    setIsVerifyingCode(true);
    setError(null);

    try {
      const userDoc = await getDocFromServer(doc(db, 'users', code));
      
      if (!userDoc.exists()) {
        setError('Invalid Access ID. Please contact Admin.');
        setIsVerifyingCode(false);
        return;
      }

      const userData = userDoc.data() as AppUser;
      const now = new Date();
      const expiry = new Date(userData.expiryDate);

      if (!userData.isActive) {
        setError('This account is inactive.');
        setIsVerifyingCode(false);
        return;
      }

      if (expiry <= now) {
        setError('This account has expired.');
        setIsVerifyingCode(false);
        return;
      }

      // Brute-force protection check
      if (userData.failedAttempts && userData.failedAttempts >= 5 && userData.lastFailedAttempt) {
        const lastAttempt = new Date(userData.lastFailedAttempt);
        const blockUntil = new Date(lastAttempt.getTime() + 30 * 60 * 1000); // 30 minutes block
        
        if (now < blockUntil) {
          const remainingMinutes = Math.ceil((blockUntil.getTime() - now.getTime()) / (60 * 1000));
          setError(`Too many failed attempts. Account blocked for ${remainingMinutes} more minutes.`);
          setIsVerifyingCode(false);
          return;
        }
      }

      // If user has a password, verify it
      if (userData.password) {
        if (!showPasswordInput) {
          setShowPasswordInput(true);
          setIsVerifyingCode(false);
          return;
        }

        if (!passwordInput.trim()) {
          setError('Please enter your password.');
          setIsVerifyingCode(false);
          return;
        }

        const hashedInput = await hashPassword(passwordInput.trim());
        if (hashedInput !== userData.password) {
          // Increment failed attempts
          const newFailedAttempts = (userData.failedAttempts || 0) + 1;
          await updateDoc(doc(db, 'users', code), {
            failedAttempts: newFailedAttempts,
            lastFailedAttempt: now.toISOString()
          });

          if (newFailedAttempts >= 5) {
            setError('Too many failed attempts. Account blocked for 30 minutes.');
            // Notify Admin via Telegram
            if (systemConfig) {
              sendTelegramNotification(
                `⚠️ <b>Suspicious Login Attempt</b>\n\n` +
                `<b>User ID:</b> <code>${code}</code>\n` +
                `<b>Status:</b> Account Blocked (5 failed attempts)\n` +
                `<b>Time:</b> ${new Date().toLocaleString()}`,
                systemConfig
              ).catch(console.error);
            }
          } else {
            setError(`Invalid password. ${5 - newFailedAttempts} attempts remaining.`);
          }
          setIsVerifyingCode(false);
          return;
        }
      }

      // Success - Reset failed attempts if any
      if (userData.failedAttempts && userData.failedAttempts > 0) {
        await updateDoc(doc(db, 'users', code), {
          failedAttempts: 0,
          lastFailedAttempt: null
        });
      }

      setAccessCode(code);
      safeStorage.setItem('vbs_access_code', code);
      setToast({ message: 'Welcome back!', type: 'success' });
    } catch (err: any) {
      console.error('Login Error:', err);
      setError(`Login failed: ${err.message}`);
    } finally {
      setIsVerifyingCode(false);
    }
  };

  const handleLogout = async () => {
    await signOut(auth);
    setIsAccessGranted(false);
    setAccessCode(null);
    setProfile(null);
    
    // Clear ALL storage as per Commander's Order
    safeStorage.clear();
    safeSessionStorage.clear();
    
    setActiveTab('generate');
    // Redirect to home
    safeHistory.pushState({}, '', '/');
    try {
      window.dispatchEvent(new PopStateEvent('popstate'));
    } catch (e) {
      // Ignore dispatch errors
    }
    setIsAdminRoute(false);
  };

  const filteredHistory = useMemo(() => {
    if (!historySearch.trim()) return history;
    const search = historySearch.toLowerCase();
    return history.filter(item => 
      item.text.toLowerCase().includes(search) || 
      item.config.voiceId.toLowerCase().includes(search)
    );
  }, [history, historySearch]);

  const handleClearApiKey = async () => {
    safeStorage.removeItem('VLOGS_BY_SAW_API_KEY');
    setLocalApiKey('');
    
    // Also clear from Firestore if profile exists
    if (accessCode) {
      try {
        const userRef = doc(db, 'users', accessCode);
        await updateDoc(userRef, {
          api_key_stored: deleteField()
        });
      } catch (err) {
        console.error('Failed to clear API Key from Firestore:', err);
      }
    }
    
    setToast({ message: 'Gemini API Key ကို ဖျက်သိမ်းပြီးပါပြီ။ ✅', type: 'success' });
    setTimeout(() => {
      safeLocation.reload();
    }, 1500);
  };

  const maskApiKey = (key: string | undefined) => {
    if (!key) return 'Not Set';
    if (showApiKey) return key;
    return `${key.substring(0, 8)}...${key.substring(key.length - 4)}`;
  };

  const getEffectiveApiKey = useCallback(() => {
    let key: string | null = null;
    let source = "none";

    // 1. Try Personal Key First (User Profile or LocalStorage)
    if (profile?.api_key_stored) {
      key = profile.api_key_stored.trim();
      source = "Firestore (User Profile)";
    } else if (localApiKey) {
      key = localApiKey.trim();
      source = "LocalStorage (Personal)";
    }

    // 2. Fallback to Global Key if personal is missing AND global usage is allowed
    if (!key && systemConfig.allow_global_key && systemConfig.gemini_api_key) {
      key = systemConfig.gemini_api_key.trim();
      source = "Firestore (System Config - Global Fallback)";
    }

    // 3. Ultimate Fallback for Admin (Master Admin always has access to env key)
    if (!key && accessCode === 'saw_vlogs_2026' && (typeof process !== 'undefined' && process.env.GEMINI_API_KEY)) {
      key = process.env.GEMINI_API_KEY.trim();
      source = "Environment Variable (Admin Only)";
    }

    if (key) {
      console.log(`App: getEffectiveApiKey - Source: ${source}, Key: ${key.substring(0, 4)}...${key.substring(key.length - 4)}`);
    } else {
      console.warn(`App: getEffectiveApiKey - No key found from any source.`);
    }
    return key;
  }, [profile, localApiKey, systemConfig, accessCode]);

  const getApiKeySource = useCallback(() => {
    if (profile?.api_key_stored || localApiKey) return 'personal';
    if (systemConfig.allow_global_key && systemConfig.gemini_api_key) return 'admin';
    if (accessCode === 'saw_vlogs_2026' && (typeof process !== 'undefined' && process.env.GEMINI_API_KEY)) return 'admin';
    return 'none';
  }, [profile, localApiKey, systemConfig, accessCode]);

  const handleUpdateSystemConfig = async (updates: Partial<Config>) => {
    try {
      await updateDoc(doc(db, 'settings', 'global_config'), updates);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, 'settings/global_config');
    }
  };

  const handleSaveApiKeyFromModal = async (key: string) => {
    const trimmedKey = key.trim();
    setIsUpdatingKey(true);
    try {
      // 1. Save to Local Storage (Encrypted with Base64)
      const encodedKey = btoa(trimmedKey);
      safeStorage.setItem('VLOGS_BY_SAW_API_KEY', encodedKey);
      setLocalApiKey(trimmedKey);
      
      // 2. Also save to Firestore if user is logged in
      if (accessCode) {
        const userRef = doc(db, 'users', accessCode);
        await setDoc(userRef, {
          api_key_stored: trimmedKey // Firestore is already secure via rules
        }, { merge: true });
      }
      
      setToast({ message: 'Gemini API Key ကို သိမ်းဆည်းပြီးပါပြီ။ ✅', type: 'success' });
      setTimeout(() => {
        safeLocation.reload();
      }, 1500);
    } catch (err: any) {
      console.error('Save API Key Error:', err);
      setToast({ message: 'Failed to save API Key', type: 'error' });
      setTimeout(() => setToast(null), 3000);
    } finally {
      setIsUpdatingKey(false);
    }
  };

  const handleAddGlobalRule = async (original: string, replacement: string) => {
    if (accessCode !== 'saw_vlogs_2026') return;
    
    try {
      await addDoc(collection(db, 'globalRules'), {
        original,
        replacement,
        createdAt: new Date().toISOString()
      });
      setToast({ message: 'Rule added successfully', type: 'success' });
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'globalRules');
    }
  };

  const handleDeleteGlobalRule = async (id: string) => {
    if (accessCode !== 'saw_vlogs_2026') return;
    
    if (confirm('Are you sure you want to delete this rule?')) {
      try {
        await deleteDoc(doc(db, 'globalRules', id));
        setToast({ message: 'Rule deleted successfully', type: 'success' });
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, `globalRules/${id}`);
      }
    }
  };

  const handleUpdateGlobalRule = async (id: string, original: string, replacement: string) => {
    if (accessCode !== 'saw_vlogs_2026') return;
    
    try {
      await updateDoc(doc(db, 'globalRules', id), {
        original,
        replacement,
        updatedAt: new Date().toISOString()
      });
      setToast({ message: 'Rule updated successfully', type: 'success' });
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

    // Rate Limiting (Cooldown) - Commander's Order
    // Admin (saw_vlogs_2026) has no limits. Regular users have a 60s cooldown.
    const COOLDOWN_SECONDS = 60;
    const isAdmin = accessCode === 'saw_vlogs_2026';

    if (!isAdmin) {
      const now = Date.now();
      const timeSinceLastGen = (now - lastGenerationTime) / 1000;
      
      if (timeSinceLastGen < COOLDOWN_SECONDS) {
        const remaining = Math.ceil(COOLDOWN_SECONDS - timeSinceLastGen);
        setError(`ခေတ္တစောင့်ဆိုင်းပေးပါ။ နောက်ထပ် ${remaining} စက္ကန့်အကြာမှ ထပ်မံထုတ်ယူနိုင်ပါမည်။ (Please wait ${remaining}s before next generation.)`);
        setToast({ message: `Cooldown Active: ${remaining}s remaining`, type: 'error' });
        return;
      }
    }

    // Direct Fetching from LocalStorage as requested - Strict Validation
    const effectiveKey = getEffectiveApiKey();
    
    if (!effectiveKey) {
      console.warn("App: Generation blocked - No API Key found. Opening settings modal.");
      setToast({ 
        message: 'ကျေးဇူးပြု၍ Settings တွင် API Key အရင်ထည့်သွင်းပါ။ (No API Key found. Please add one in Settings.)', 
        type: 'error' 
      });
      setIsApiKeyModalOpen(true);
      setError('ကျေးဇူးပြု၍ Settings တွင် API Key အရင်ထည့်သွင်းပါ။ (No API Key found. Please add one in Settings.)');
      return;
    }
    
    setIsLoading(true);
    setError(null);
    setResult(null);

    console.log("App: Starting voiceover generation process with key...");

    try {
      const isMock = systemConfig?.mock_mode || false;
      const ttsService = new GeminiTTSService(effectiveKey || '');
      
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
        if (audioResult.audioData === "MOCK_DATA") {
          setError("Note: Real API call failed (likely due to missing ID Token or API Key). Please ensure Anonymous Auth is enabled in Firebase Console.");
        } else {
          setError("Note: Real API call failed or timed out. Showing simulation result for testing.");
        }
      } else {
        console.log("App: TTS generation successful, updating state...");
        // If Gemini generated a script from a prompt, update the text area
        if (audioResult.generatedText) {
          setText(audioResult.generatedText);
          setToast({ message: 'Gemini generated a script and audio! ✨', type: 'success' });
        }
      }
      
      setResult(audioResult);
      if (!audioResult.generatedText) {
        setToast({ message: 'SRT နှင့် အသံဖိုင် ထုတ်ယူပြီးပါပြီ။ ✅', type: 'success' });
      }

      // Update last generation time for rate limiting
      const now = Date.now();
      setLastGenerationTime(now);
      safeStorage.setItem('vbs_last_gen_time', now.toString());

      // Save to History (Asynchronous if enabled)
      if (saveToHistory && accessCode && !audioResult.isSimulation) {
        console.log("App: Saving to history (Asynchronous)...");
        // We don't await this to ensure immediate result display
        const saveHistory = async () => {
          try {
            // 1. Upload Audio to Storage
            const audioFileName = `audio/${accessCode}/${Date.now()}.wav`;
            const audioRef = ref(storage, audioFileName);
            if (audioResult.wavBlob) {
              await uploadBytes(audioRef, audioResult.wavBlob);
            } else {
              await uploadString(audioRef, audioResult.audioData, 'base64');
            }
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
            await updateDoc(doc(db, 'settings', 'global_config'), {
              total_generations: (systemConfig.total_generations || 0) + 1
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
      const errorMsg = err.message || 'An unexpected error occurred.';
      setError(errorMsg);

      // Notify Admin via Telegram for API errors
      if (systemConfig) {
        const isQuotaError = errorMsg.toLowerCase().includes('quota exceeded') || errorMsg.includes('429');
        const emoji = isQuotaError ? '⏳' : '❌';
        const title = isQuotaError ? 'API Quota Limit Reached' : 'API Error Occurred';
        
        sendTelegramNotification(
          `${emoji} <b>${title}</b>\n\n` +
          `<b>User ID:</b> <code>${accessCode}</code>\n` +
          `<b>Error:</b> <i>${errorMsg}</i>\n` +
          `<b>Time:</b> ${new Date().toLocaleString()}`,
          systemConfig
        ).catch(console.error);
      }
    } finally {
      console.log("App: Generation process finished (Cleaning up loading state)");
      setIsLoading(false);
    }
  };

  const handleDeleteHistory = async (id: string) => {
    if (confirm('Delete this history record?')) {
      try {
        await deleteDoc(doc(db, 'history', id));
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, `history/${id}`);
      }
    }
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
    
    // Use correct MIME type based on filename
    const mimeType = filename.endsWith('.mp3') ? 'audio/mp3' : 'audio/wav';
    const audioBlob = new Blob([bytes], { type: mimeType });
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
    
    // Ensure filename ends strictly in .srt
    const srtFilename = filename.toLowerCase().endsWith('.srt') ? filename : `${filename}.srt`;
    
    // Use application/x-subrip and add UTF-8 BOM (\ufeff) for mobile compatibility
    const blob = new Blob(["\ufeff" + content], { type: 'application/x-subrip' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = srtFilename;
    document.body.appendChild(a); // Append to body for better cross-browser support
    a.click();
    document.body.removeChild(a);
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
      try {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } catch (e) {
        // Ignore scroll errors
      }
    } catch (err) {
      console.error('Error playing from history:', err);
      setError('Failed to load audio from history.');
    }
  };

  return (
    <div className={`min-h-screen flex flex-col transition-colors duration-300 ${isDarkMode ? 'dark bg-[#020617] text-white' : 'bg-white text-slate-900'}`}>
      <Header 
        isDarkMode={isDarkMode} 
        toggleTheme={() => setIsDarkMode(!isDarkMode)} 
        onOpenTools={() => setIsApiKeyModalOpen(true)}
        isAccessGranted={isAccessGranted}
        onLogout={handleLogout}
        isAdminRoute={isAdminRoute}
        isAdmin={accessCode === 'saw_vlogs_2026'}
      />

      <main className="flex-1 container mx-auto px-4 sm:px-6 py-6 sm:py-8 overflow-x-hidden">
        <AnimatePresence>
          {showWelcome && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[100]"
            >
              <WelcomePage onGetStarted={handleGetStarted} />
            </motion.div>
          )}
        </AnimatePresence>

        {isConfigLoading ? (
          <div className="flex flex-col items-center justify-center py-40">
            <RefreshCw size={48} className="text-brand-purple animate-spin mb-4" />
            <p className="text-slate-500 font-medium">Initializing Narration Engine...</p>
          </div>
        ) : (!systemConfig.isSystemLive && accessCode !== 'saw_vlogs_2026' && !isAdminRoute) ? (
          <div className="flex flex-col items-center justify-center py-40 text-center">
            <div className="w-20 h-20 bg-amber-500/10 text-amber-500 rounded-3xl flex items-center justify-center mb-6">
              <RefreshCw size={40} className="animate-spin" />
            </div>
            <h2 className="text-2xl font-bold mb-2 text-slate-900 dark:text-white">System Maintenance</h2>
            <p className="text-slate-600 dark:text-slate-400 mb-8 max-w-md mx-auto">
              The narration engine is currently undergoing maintenance or is temporarily disabled by the administrator. Please check back later.
            </p>
            {accessCode && (
              <button 
                onClick={handleLogout}
                className="px-6 py-3 bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-200 rounded-xl font-bold hover:bg-slate-300 dark:hover:bg-slate-700 transition-all"
              >
                Sign Out
              </button>
            )}
          </div>
        ) : (isAdminRoute && accessCode === 'saw_vlogs_2026') ? (
          <AdminDashboard 
            isAuthReady={isAuthReady} 
            isSessionSynced={isSessionSynced}
            setIsSessionSynced={setIsSessionSynced}
            systemConfig={systemConfig}
            onUpdateSystemConfig={handleUpdateSystemConfig}
            onLogout={handleLogout}
          />
        ) : isAdminRoute ? (
          <div className="flex flex-col items-center justify-center py-40 text-center">
            <div className="w-20 h-20 bg-red-500/10 text-red-500 rounded-3xl flex items-center justify-center mb-6">
              <Lock size={40} />
            </div>
            <h2 className="text-2xl font-bold mb-2 text-slate-900 dark:text-white">Access Denied</h2>
            <p className="text-slate-600 dark:text-slate-400 mb-8">You do not have permission to access the Admin Dashboard.</p>
            <button 
              onClick={() => {
                safeHistory.pushState({}, '', '/');
                try {
                  window.dispatchEvent(new PopStateEvent('popstate'));
                } catch (e) {
                  // Ignore dispatch errors
                }
              }}
              className="px-6 py-3 bg-brand-purple text-white rounded-xl font-bold hover:bg-brand-purple/90 transition-all"
            >
              Return to App
            </button>
          </div>
        ) : !isAccessGranted ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-20 h-20 bg-brand-purple/10 text-brand-purple rounded-3xl flex items-center justify-center mb-6">
              <Lock size={40} />
            </div>
            
            <div className="w-full max-w-md space-y-6">
              <h2 className="text-xl sm:text-2xl font-bold mb-2 text-slate-900 dark:text-white">Vlogs By Saw - Narration Engine</h2>
              <p className="text-slate-600 dark:text-slate-300 mb-6 sm:mb-8 text-sm sm:text-base">
                Please enter your unique User ID (Access Code) to start generating professional Myanmar voiceovers.
              </p>
              
              <form onSubmit={handleLogin} className="space-y-4">
                <div className="relative">
                  <Key className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={20} />
                  <input
                    type="text"
                    value={accessCodeInput}
                    onChange={(e) => {
                      setAccessCodeInput(e.target.value);
                      setShowPasswordInput(false);
                      setPasswordInput('');
                      setError(null);
                    }}
                    placeholder="Enter Access ID..."
                    disabled={showPasswordInput}
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl pl-12 pr-4 py-4 text-lg font-mono text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-purple/50 transition-all disabled:opacity-50"
                  />
                </div>

                {showPasswordInput && (
                  <motion.div 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="relative"
                  >
                    <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={20} />
                    <input
                      type="password"
                      value={passwordInput}
                      onChange={(e) => setPasswordInput(e.target.value)}
                      placeholder="Enter Password / PIN..."
                      autoFocus
                      className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl pl-12 pr-4 py-4 text-lg font-mono text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-purple/50 transition-all"
                    />
                  </motion.div>
                )}
                
                {error && (
                  <div className="text-red-500 text-sm font-medium flex items-center justify-center gap-2 bg-red-500/10 py-3 px-4 rounded-xl border border-red-500/20">
                    <AlertCircle size={16} /> {error}
                  </div>
                )}
                
                <div className="flex gap-2">
                  {showPasswordInput && (
                    <button
                      type="button"
                      onClick={() => {
                        setShowPasswordInput(false);
                        setPasswordInput('');
                        setError(null);
                      }}
                      className="px-6 py-4 bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-slate-400 rounded-2xl font-bold hover:bg-slate-200 dark:hover:bg-white/10 transition-all"
                    >
                      Back
                    </button>
                  )}
                  <button
                    type="submit"
                    disabled={isVerifyingCode || !accessCodeInput.trim() || (showPasswordInput && !passwordInput.trim()) || (!isAuthReady && accessCodeInput.trim() !== 'saw_vlogs_2026')}
                    className="flex-1 py-4 bg-brand-purple text-white rounded-2xl font-bold text-lg hover:bg-brand-purple/90 transition-all flex items-center justify-center gap-2 disabled:opacity-50 shadow-lg shadow-brand-purple/20"
                  >
                    {isVerifyingCode || (!isAuthReady && accessCodeInput.trim() !== 'saw_vlogs_2026') ? (
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                        {!isAuthReady && accessCodeInput.trim() !== 'saw_vlogs_2026' && <span className="text-sm">Connecting...</span>}
                      </div>
                    ) : (
                      <>
                        {showPasswordInput ? 'Login' : 'Verify Access'} 
                        <ArrowRight size={20} />
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        ) : (
          <div className="space-y-8">
            {/* Tab Navigation */}
            <div className="flex items-center gap-2 sm:gap-4 bg-white/50 backdrop-blur dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-1 rounded-2xl w-fit mx-auto shadow-sm">
              <button
                onClick={() => setActiveTab('generate')}
                className={`px-4 sm:px-6 py-2.5 rounded-xl text-xs sm:text-sm font-bold transition-all flex items-center justify-center gap-2 ${activeTab === 'generate' ? 'bg-brand-purple text-white shadow-lg' : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'}`}
              >
                <Wand2 size={18} className="w-4 h-4 sm:w-4.5 sm:h-4.5 flex-shrink-0" /> Generate
              </button>
              <button
                onClick={() => setActiveTab('history')}
                className={`px-4 sm:px-6 py-2.5 rounded-xl text-xs sm:text-sm font-bold transition-all flex items-center justify-center gap-2 ${activeTab === 'history' ? 'bg-brand-purple text-white shadow-lg' : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'}`}
              >
                <History size={18} className="w-4 h-4 sm:w-4.5 sm:h-4.5 flex-shrink-0" /> History
              </button>
              <button
                onClick={() => setActiveTab('tools')}
                className={`px-4 sm:px-6 py-2.5 rounded-xl text-xs sm:text-sm font-bold transition-all flex items-center justify-center gap-2 relative ${activeTab === 'tools' ? 'bg-brand-purple text-white shadow-lg' : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'}`}
              >
                <Wrench size={18} className="w-4 h-4 sm:w-4.5 sm:h-4.5 flex-shrink-0" /> Tools
              </button>
            </div>

            <AnimatePresence mode="wait">
              {activeTab === 'generate' && (
                <motion.div
                  key="generate"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  className="max-w-5xl mx-auto space-y-12"
                >
                  {/* Section 1: Input Fields (Text & Settings) */}
                  <div className="space-y-8">
                    <ContentInput 
                      text={text} 
                      setText={setText} 
                      isDarkMode={isDarkMode} 
                      onToast={(message, type) => setToast({ message, type })}
                    />
                    
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                      <VoiceConfig config={config} setConfig={setConfig} isDarkMode={isDarkMode} />
                      
                      <div className="space-y-8">
                        {/* Voice Selection Dropdown */}
                        <div className="bg-white/50 backdrop-blur dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[32px] p-8 shadow-2xl transition-colors duration-300 h-full">
                          <div className="flex items-center gap-3 mb-6">
                            <div className="w-10 h-10 bg-brand-purple/10 rounded-xl flex items-center justify-center text-brand-purple">
                              <Music size={20} />
                            </div>
                            <div>
                              <h3 className="text-xl font-bold text-slate-900 dark:text-white">အသံရွေးချယ်ရန်</h3>
                              <p className="text-xs text-slate-500 dark:text-slate-400 font-medium uppercase tracking-wider">Voice Selection</p>
                            </div>
                          </div>
                          
                          <div className="relative">
                            <select
                              value={config.voiceId}
                              onChange={(e) => setConfig({ ...config, voiceId: e.target.value })}
                              className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl px-6 py-4 text-lg font-bold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand-purple/50 transition-all appearance-none cursor-pointer"
                            >
                              {VOICE_OPTIONS.map((voice) => (
                                <option key={voice.id} value={voice.id}>
                                  {voice.name}
                                </option>
                              ))}
                            </select>
                            <div className="absolute right-6 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
                              <ChevronDown size={24} />
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Pronunciation Rules Table */}
                    <PronunciationRules
                      rules={DEFAULT_RULES}
                      globalRules={globalRules}
                      customRules={customRules}
                      setCustomRules={setCustomRules}
                      isAdmin={accessCode === 'saw_vlogs_2026'}
                      onOpenTools={() => setActiveTab('tools')}
                      onAddGlobalRule={handleAddGlobalRule}
                      onUpdateGlobalRule={handleUpdateGlobalRule}
                      onDeleteGlobalRule={handleDeleteGlobalRule}
                      showCustomRules={false}
                    />
                  </div>

                  {/* Section 2: Output & Subtitle Previews */}
                  <div className="space-y-8">
                    <OutputPreview 
                      result={result} 
                      isLoading={isLoading} 
                      globalVolume={config.volume}
                      isAdmin={isAccessGranted}
                      onToast={(message, type) => setToast({ message, type })}
                    />

                    {error && (
                      <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 flex items-start gap-3 text-red-500">
                        <AlertCircle size={20} className="shrink-0 mt-0.5" />
                        <p className="text-sm font-medium">{error}</p>
                      </div>
                    )}
                  </div>

                  {/* Section 3: Generate Action */}
                  <div className="bg-white/50 backdrop-blur dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[40px] p-8 sm:p-12 shadow-2xl transition-colors duration-300">
                    <div className="flex flex-col md:flex-row items-center justify-between gap-8 mb-10">
                      <div className="flex items-center gap-4">
                        <div className="p-3 bg-brand-purple/10 rounded-2xl text-brand-purple">
                          <History size={24} />
                        </div>
                        <div>
                          <p className="text-lg font-bold text-slate-900 dark:text-white">မှတ်တမ်းသိမ်းဆည်းမည်</p>
                          <p className="text-sm text-slate-500 dark:text-slate-400 font-medium">Keep a record of this generation for later access</p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setSaveToHistory(!saveToHistory)}
                        className={`w-16 h-8 rounded-full transition-all relative ${saveToHistory ? 'bg-brand-purple' : 'bg-slate-300 dark:bg-slate-700'}`}
                      >
                        <div className={`absolute top-1 w-6 h-6 bg-white rounded-full shadow-lg transition-all ${saveToHistory ? 'left-9' : 'left-1'}`} />
                      </button>
                    </div>

                    <div className="flex flex-col items-center gap-6">
                      <button
                        onClick={handleGenerate}
                        disabled={isLoading || remainingCooldown > 0}
                        className={`w-full py-8 rounded-[32px] font-bold text-2xl shadow-2xl flex items-center justify-center gap-6 transition-all active:scale-[0.98] ${remainingCooldown > 0 ? 'bg-slate-400 cursor-not-allowed' : 'bg-brand-purple hover:bg-brand-purple/90'} text-white shadow-brand-purple/40 group`}
                      >
                        {isLoading ? (
                          <div className="w-10 h-10 border-4 border-white/20 border-t-white rounded-full animate-spin" />
                        ) : remainingCooldown > 0 ? (
                          <Clock size={36} className="animate-pulse" />
                        ) : (
                          <Zap size={36} fill="currentColor" className="group-hover:scale-110 transition-transform" />
                        )}
                        <div className="flex flex-col items-center">
                          <span className="flex items-baseline gap-4">
                            {remainingCooldown > 0 
                              ? `စောင့်ဆိုင်းရန် (${remainingCooldown}s)` 
                              : 'အသံနှင့် စာတန်းထိုး ထုတ်ယူမည်'}
                            <span className="text-base font-medium opacity-60">
                              ({Math.ceil(text.length / 3000) || 1} {Math.ceil(text.length / 3000) > 1 ? 'chunks' : 'chunk'})
                            </span>
                          </span>
                        </div>
                      </button>
                      
                      <div className="flex items-center gap-3 text-xs font-bold uppercase tracking-[0.2em]">
                        {getApiKeySource() === 'personal' ? (
                          <span className="flex items-center gap-2 px-4 py-2 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded-xl border border-emerald-500/20">
                            <Key size={16} /> Using Personal Key
                          </span>
                        ) : getApiKeySource() === 'admin' ? (
                          <span className="flex items-center gap-2 px-4 py-2 bg-amber-500/10 text-amber-600 dark:text-amber-400 rounded-xl border border-amber-500/20">
                            <ShieldCheck size={16} /> Using Admin Key
                          </span>
                        ) : (
                          <span className="flex items-center gap-2 px-4 py-2 bg-red-500/10 text-red-600 dark:text-red-400 rounded-xl border border-red-500/20">
                            <AlertCircle size={16} /> No API Key Configured
                          </span>
                        )}
                      </div>
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
                  className="max-w-5xl mx-auto space-y-6"
                >
                  <div className="bg-white/50 backdrop-blur dark:bg-slate-900 rounded-2xl p-8 shadow-2xl border border-slate-200 dark:border-slate-800 transition-colors duration-300">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-8">
                      <div>
                        <h2 className="text-2xl font-bold flex items-center gap-3 text-slate-900 dark:text-white">
                          <History className="text-brand-purple" /> Generation History
                        </h2>
                        <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">Manage and re-download your previous generations</p>
                      </div>
                      
                      <div className="relative flex-1 max-w-md">
                        <input
                          type="text"
                          placeholder="Search history by text..."
                          value={historySearch}
                          onChange={(e) => setHistorySearch(e.target.value)}
                          className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl px-6 py-3 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand-purple/50 transition-all pr-12 placeholder:text-slate-400"
                        />
                        <Wand2 size={18} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-600" />
                      </div>
                    </div>

                    {isHistoryLoading ? (
                      <div className="flex flex-col items-center justify-center py-20 gap-4">
                        <div className="w-10 h-10 border-4 border-brand-purple/20 border-t-brand-purple rounded-full animate-spin" />
                        <p className="text-slate-500 dark:text-slate-400 font-medium">Loading history...</p>
                      </div>
                    ) : filteredHistory.length === 0 ? (
                      <div className="text-center py-24 bg-slate-50 dark:bg-slate-950 rounded-3xl border border-dashed border-slate-200 dark:border-slate-800">
                        <div className="w-16 h-16 bg-white dark:bg-white/5 rounded-full flex items-center justify-center mx-auto mb-4 text-slate-400 dark:text-slate-600">
                          <History size={32} />
                        </div>
                        <h3 className="text-lg font-bold text-slate-900 dark:text-slate-400">No results found</h3>
                        <p className="text-slate-500 dark:text-slate-600 text-sm mt-1">Try adjusting your search or generate something new!</p>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 gap-4">
                        {filteredHistory.map((item) => (
                          <div key={item.id} className="group bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 transition-all hover:bg-slate-100 dark:hover:bg-slate-900 hover:border-brand-purple/30">
                            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                              <div className="flex-1 min-w-0 space-y-3">
                                <div className="flex items-center gap-3">
                                  <span className="px-2 py-0.5 bg-brand-purple/20 text-brand-purple rounded text-[10px] font-bold uppercase tracking-wider">
                                    {item.config.voiceId}
                                  </span>
                                  <span className="text-[10px] text-slate-500 dark:text-slate-400 font-mono">
                                    {new Date(item.createdAt).toLocaleString()}
                                  </span>
                                </div>
                                <p className="text-sm font-medium text-slate-900 dark:text-slate-200 line-clamp-2 leading-relaxed">
                                  {item.text}
                                </p>
                              </div>
                              
                              <div className="flex items-center gap-2 shrink-0">
                                <button 
                                  onClick={() => playFromHistory(item)}
                                  className="flex items-center gap-2 px-4 py-2 bg-brand-purple text-white rounded-xl text-xs font-bold hover:bg-brand-purple/90 transition-all shadow-lg shadow-brand-purple/20"
                                >
                                  <Play size={14} fill="currentColor" /> Play
                                </button>
                                <div className="h-8 w-[1px] bg-white/10 mx-1" />
                                <button 
                                  onClick={() => handleDownloadAudio(item.audioStorageUrl || '', `narration-${item.id}.wav`)}
                                  className="p-2.5 bg-blue-500/10 text-blue-500 rounded-xl hover:bg-blue-500 hover:text-white transition-all border border-blue-500/20"
                                  title="Download MP3"
                                >
                                  <Music size={16} />
                                </button>
                                <button 
                                  onClick={() => handleDownloadSRT(item.srtStorageUrl || item.srtContent || '', `subtitles-${item.id}.srt`)}
                                  className="p-2.5 bg-amber-500/10 text-amber-500 rounded-xl hover:bg-amber-500 hover:text-white transition-all border border-amber-500/20"
                                  title="Download SRT"
                                >
                                  <FileText size={16} />
                                </button>
                                <button 
                                  onClick={() => handleDeleteHistory(item.id)}
                                  className="p-2.5 bg-red-500/10 text-red-500 rounded-xl hover:bg-red-500 hover:text-white transition-all border border-red-500/20"
                                  title="Delete"
                                >
                                  <Trash2 size={16} />
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
                  className="max-w-4xl mx-auto space-y-8"
                >
                  {/* Profile Card */}
                  <div className="bg-white/50 backdrop-blur dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-8 shadow-2xl transition-colors duration-300">
                    <div className="flex flex-col sm:flex-row items-center sm:items-start gap-4 sm:gap-6 mb-6 sm:mb-8 text-center sm:text-left">
                      <div className="w-16 h-16 sm:w-20 sm:h-20 bg-brand-purple/20 text-brand-purple rounded-2xl flex items-center justify-center text-2xl sm:text-3xl font-bold shadow-inner border border-brand-purple/20 shrink-0">
                        {accessCode?.charAt(0).toUpperCase() || 'V'}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 mb-2">
                          <h2 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white truncate">
                            {accessCode === 'saw_vlogs_2026' ? 'Commander Saw' : `User ID: ${accessCode}`}
                          </h2>
                          <span className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider w-fit mx-auto sm:mx-0 ${accessCode === 'saw_vlogs_2026' ? 'bg-amber-500/20 text-amber-600' : 'bg-brand-purple/20 text-brand-purple'}`}>
                            {accessCode === 'saw_vlogs_2026' ? 'Master Admin' : 'VIP Member'}
                          </span>
                        </div>
                        <p className="text-slate-500 dark:text-slate-400 text-xs sm:text-sm flex items-center justify-center sm:justify-start gap-2">
                          <Clock size={12} className="sm:w-3.5 sm:h-3.5" /> Session active via Access Code
                        </p>
                      </div>
                      <div className="flex flex-col sm:flex-row items-center gap-2 w-full sm:w-auto">
                        <button
                          onClick={() => setIsChangePasswordModalOpen(true)}
                          className="w-full sm:w-auto px-4 py-2.5 bg-brand-purple/10 text-brand-purple border border-brand-purple/20 rounded-xl font-bold text-xs hover:bg-brand-purple hover:text-white transition-all flex items-center justify-center gap-2"
                        >
                          <Lock size={14} /> Change Password
                        </button>
                        <button
                          onClick={handleLogout}
                          className="w-full sm:w-auto px-4 py-2.5 bg-slate-100 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 rounded-xl font-bold text-xs hover:bg-red-500/10 hover:text-red-500 hover:border-red-500/20 transition-all flex items-center justify-center gap-2"
                        >
                          <LogOut size={14} /> Sign Out
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Change Password Modal */}
                  <AnimatePresence>
                    {isChangePasswordModalOpen && (
                      <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
                        <motion.div
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          onClick={() => setIsChangePasswordModalOpen(false)}
                          className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm"
                        />
                        <motion.div
                          initial={{ opacity: 0, scale: 0.9, y: 20 }}
                          animate={{ opacity: 1, scale: 1, y: 0 }}
                          exit={{ opacity: 0, scale: 0.9, y: 20 }}
                          className="relative w-full max-w-md bg-white dark:bg-slate-900 rounded-[32px] p-8 shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden"
                        >
                          <div className="absolute top-0 left-0 w-full h-2 bg-brand-purple" />
                          
                          <div className="flex items-center justify-between mb-8">
                            <div className="flex items-center gap-3">
                              <div className="p-2.5 bg-brand-purple/10 rounded-xl text-brand-purple">
                                <Lock size={20} />
                              </div>
                              <h3 className="text-xl font-bold text-slate-900 dark:text-white">Change Password</h3>
                            </div>
                            <button 
                              onClick={() => setIsChangePasswordModalOpen(false)}
                              className="p-2 hover:bg-slate-100 dark:hover:bg-white/5 rounded-full text-slate-400 transition-colors"
                            >
                              <X size={20} />
                            </button>
                          </div>

                          <form onSubmit={handleChangePassword} className="space-y-6">
                            <div className="space-y-4">
                              <div className="space-y-2">
                                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider ml-1">New Password</label>
                                <div className="relative">
                                  <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                                  <input
                                    type="password"
                                    value={newPass}
                                    onChange={(e) => setNewPass(e.target.value)}
                                    placeholder="Enter new password"
                                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl pl-12 pr-4 py-4 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand-purple/50 transition-all"
                                    required
                                    minLength={6}
                                  />
                                </div>
                              </div>

                              <div className="space-y-2">
                                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider ml-1">Confirm Password</label>
                                <div className="relative">
                                  <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                                  <input
                                    type="password"
                                    value={confirmPass}
                                    onChange={(e) => setConfirmPass(e.target.value)}
                                    placeholder="Confirm new password"
                                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl pl-12 pr-4 py-4 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand-purple/50 transition-all"
                                    required
                                    minLength={6}
                                  />
                                </div>
                                {newPass && confirmPass && newPass !== confirmPass && (
                                  <p className="text-red-500 text-[10px] font-bold mt-1 ml-1 flex items-center gap-1">
                                    <AlertCircle size={10} /> Passwords do not match
                                  </p>
                                )}
                              </div>
                            </div>

                            <button
                              type="submit"
                              disabled={!newPass || newPass !== confirmPass || isUpdatingPassword}
                              className="w-full py-4 bg-brand-purple hover:bg-brand-purple/90 text-white rounded-2xl font-bold shadow-lg shadow-brand-purple/20 transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                            >
                              {isUpdatingPassword ? (
                                <RefreshCw size={18} className="animate-spin" />
                              ) : (
                                <Save size={18} />
                              )}
                              {isUpdatingPassword ? 'Updating...' : 'Save New Password'}
                            </button>
                          </form>
                        </motion.div>
                      </div>
                    )}
                  </AnimatePresence>

                  {/* Gemini API Key Section */}
                  <div 
                    onClick={() => setIsApiKeyModalOpen(true)}
                    className="bg-white/50 backdrop-blur dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-8 shadow-2xl transition-colors duration-300 cursor-pointer hover:border-brand-purple/30 group"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-brand-purple/10 rounded-xl flex items-center justify-center text-brand-purple group-hover:scale-110 transition-transform">
                          <Key size={20} />
                        </div>
                        <div>
                          <h3 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white">Gemini API Key</h3>
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            {getEffectiveApiKey() ? `Active Key: ${maskApiKey(getEffectiveApiKey() || '')}` : 'Configure your personal Google AI Studio key'}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className={`flex items-center gap-2 text-[10px] sm:text-[11px] font-bold uppercase tracking-widest ${getApiKeySource() === 'personal' ? 'text-emerald-600 dark:text-emerald-400' : getApiKeySource() === 'admin' ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400'}`}>
                          <div className={`w-2.5 h-2.5 rounded-full ${getApiKeySource() !== 'none' ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`} />
                          {getApiKeySource() === 'personal' ? 'PERSONAL KEY CONNECTED' : getApiKeySource() === 'admin' ? 'ADMIN KEY ACTIVE' : 'No API Key found'}
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
        initialKey={getEffectiveApiKey() || ''}
        initialMode={apiKeyMode}
        onSaveMode={handleSaveApiKeyMode}
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
            <button 
              onClick={() => setToast(null)}
              className="ml-2 hover:opacity-70 transition-opacity"
            >
              <X size={16} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
      <Footer />
    </div>
  );
}

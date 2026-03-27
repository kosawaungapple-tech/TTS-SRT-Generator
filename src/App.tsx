import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { AlertCircle, Wand2, Key, Settings, User, LogIn, LogOut, ShieldCheck, ShieldAlert, Shield, CheckCircle2, XCircle, History, Wrench, Plus, Trash2, Download, Play, Music, FileText, Eye, EyeOff, Cloud, RefreshCw, Zap, X, ExternalLink, Calendar, Clock, Mail, Wifi, Save, Lock, Info, ArrowRight, ChevronRight, Youtube, Search, Upload, Video, Volume2, ChevronDown } from 'lucide-react';
import { GoogleGenAI } from "@google/genai";
import { Header } from './components/Header';
import { ApiKeyModal } from './components/ApiKeyModal';
import { ContentInput } from './components/ContentInput';
import { PronunciationRules } from './components/PronunciationRules';
import { VoiceConfig } from './components/VoiceConfig';
import { OutputPreview } from './components/OutputPreview';
import { MiniAudioPlayer } from './components/MiniAudioPlayer';
import { AdminDashboard } from './components/AdminDashboard';
import { GeminiTTSService } from './services/geminiService';
import { TTSConfig, AudioResult, PronunciationRule, HistoryItem, GlobalSettings, AuthorizedUser, SystemConfig } from './types';
import { DEFAULT_RULES, VOICE_OPTIONS } from './constants';
import { pcmToWav } from './utils/audioUtils';
import { db, storage, auth, signInAnonymously, signOut, onAuthStateChanged, doc, getDoc, getDocFromServer, setDoc, updateDoc, onSnapshot, handleFirestoreError, OperationType, collection, query, where, orderBy, addDoc, deleteDoc, getDocs, limit, ref, uploadString, getDownloadURL } from './firebase';

type Tab = 'generate' | 'history' | 'tools' | 'admin' | 'vbs-admin' | 'youtube-recap' | 'youtube-transcript';

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>(() => {
    const role = localStorage.getItem('vbs_role');
    return role === 'ADMIN' ? 'generate' : 'youtube-transcript';
  });
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [text, setText] = useState('');
  const [customRules, setCustomRules] = useState('');
  const [saveToHistory, setSaveToHistory] = useState(false);
  const [config, setConfig] = useState<TTSConfig>({
    voiceId: 'zephyr',
    speed: 1.0,
    pitch: 0,
    volume: 80,
    effects: {
      echo: { enabled: false, delay: 0.3, feedback: 0.4 },
      reverb: { enabled: false, decay: 1.5, mix: 0.3 },
      pitchShift: { enabled: false, semitones: 0 },
      chorus: { enabled: false, rate: 1.5, depth: 0.5 }
    }
  });
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<AudioResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Sign in anonymously is restricted in the console, so we skip it for now.
  // The app will function in bypass mode using localStorage for the API Key.
  
  const [newApiKey, setNewApiKey] = useState('');
  const [localApiKey, setLocalApiKey] = useState<string | null>(localStorage.getItem('VLOGS_BY_SAW_API_KEY'));
  const [apiSwitch, setApiSwitch] = useState<'admin' | 'personal'>(localStorage.getItem('VBS_API_SWITCH') as 'admin' | 'personal' || 'admin');
  const [isUpdatingKey, setIsUpdatingKey] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [profile, setProfile] = useState<AuthorizedUser | null>(null);
  const [globalSettings, setGlobalSettings] = useState<GlobalSettings>({
    allow_global_key: false,
    total_generations: 0
  });
  const [systemLive, setSystemLive] = useState<boolean>(() => {
    const saved = localStorage.getItem('system_live');
    return saved === null ? true : saved === 'true';
  });
  const [systemConfig, setSystemConfig] = useState<SystemConfig | null>(() => {
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
        openai_api_key: ''
      };
      
      const rKey = localStorage.getItem('rapidapi_key');
      const gKey = localStorage.getItem('gemini_api_key');
      const oKey = localStorage.getItem('openai_api_key');
      
      if (rKey) config.rapidapi_key = rKey;
      if (gKey) config.gemini_api_key = gKey;
      if (oKey) config.openai_api_key = oKey;
      
      return config;
    } catch (e) {
      console.error('Failed to initialize system config from localStorage:', e);
      return null;
    }
  });

  // Global Rules & History
  const [globalRules, setGlobalRules] = useState<PronunciationRule[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historySearch, setHistorySearch] = useState('');
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const [isConfigLoading, setIsConfigLoading] = useState(false); // Default to false to bypass loading screen if env vars missing
  const [isAdminRoute, setIsAdminRoute] = useState(window.location.pathname === '/vbs-admin');
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<'ADMIN' | 'USER' | null>(localStorage.getItem('vbs_role') as any || null);

  // Auth & Access State (Custom)
  const [accessCodeInput, setAccessCodeInput] = useState('');
  const [isAccessGranted, setIsAccessGranted] = useState(localStorage.getItem('vbs_access_granted') === 'true');
  const [isVerifyingCode, setIsVerifyingCode] = useState(false);
  const [accessCode, setAccessCode] = useState<string | null>(localStorage.getItem('vbs_access_code'));
  const [isApiKeyModalOpen, setIsApiKeyModalOpen] = useState(false);
  const [isAdmin, setIsAdmin] = useState(localStorage.getItem('vbs_role') === 'ADMIN');
  const [isSessionSynced, setIsSessionSynced] = useState(false);
  const [isAdminModalOpen, setIsAdminModalOpen] = useState(false);
  const [adminPasswordInput, setAdminPasswordInput] = useState('');
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [isProcessingYoutube, setIsProcessingYoutube] = useState(false);
  const [youtubeTranscriptUrl, setYoutubeTranscriptUrl] = useState('');
  const [rawTranscript, setRawTranscript] = useState('');
  const [isFetchingTranscript, setIsFetchingTranscript] = useState(false);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [isVideoProcessing, setIsVideoProcessing] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [showManualInput, setShowManualInput] = useState(true); // Default to true now
  const [manualTranscript, setManualTranscript] = useState('');
  const [showTranscriptGuide, setShowTranscriptGuide] = useState(false);
  const [recapManualText, setRecapManualText] = useState('');
  const [missionLogs, setMissionLogs] = useState<{ time: string; msg: string }[]>([]);

  const addMissionLog = useCallback((msg: string) => {
    const now = new Date();
    const time = `T+${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;
    setMissionLogs(prev => [...prev, { time, msg }].slice(-6));
  }, []);

  const StarChartAnimation = () => (
    <div className="fixed inset-0 z-[100] bg-brand-black/90 backdrop-blur-xl flex flex-col items-center justify-center overflow-hidden">
      <div className="absolute inset-0 pointer-events-none">
        {[...Array(50)].map((_, i) => (
          <div 
            key={i}
            className="absolute bg-white rounded-full animate-star-float"
            style={{
              width: Math.random() * 3 + 'px',
              height: Math.random() * 3 + 'px',
              left: Math.random() * 100 + '%',
              top: Math.random() * 100 + '%',
              animationDelay: Math.random() * 10 + 's',
              opacity: Math.random()
            }}
          />
        ))}
      </div>
      <div className="relative z-10 flex flex-col items-center">
        <div className="w-32 h-32 border-4 border-brand-purple/20 border-t-brand-purple rounded-full animate-spin mb-8 shadow-[0_0_30px_rgba(139,92,246,0.5)]" />
        <h2 className="text-2xl font-bold text-white font-mono tracking-[0.2em] animate-pulse text-center px-4">ဗီဒီယိုကို စစ်ဆေးနေပါသည်...</h2>
        <p className="mt-4 text-brand-purple font-mono text-sm tracking-widest uppercase">Processing Data Star-Chart</p>
        <div className="mt-8 flex gap-2">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="w-2 h-2 bg-brand-purple rounded-full animate-bounce" style={{ animationDelay: i * 0.2 + 's' }} />
          ))}
        </div>
      </div>
    </div>
  );

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
      const isRoute = window.location.pathname === '/vbs-admin' || window.location.pathname === '/admin';
      
      // RBAC Redirect: If user is not ADMIN and tries to access admin route, redirect to home
      if (isRoute && userRole !== 'ADMIN') {
        window.location.href = '/';
        return;
      }
      
      setIsAdminRoute(isRoute);
    };
    
    handleLocationChange();
    window.addEventListener('popstate', handleLocationChange);
    return () => window.removeEventListener('popstate', handleLocationChange);
  }, [userRole]);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDarkMode);
  }, [isDarkMode]);

  // Ensure session document exists for security rules
  useEffect(() => {
    if (isAccessGranted && isAuthReady && auth.currentUser && accessCode) {
      const syncSession = async () => {
        try {
          // If admin, ensure SAW-ADMIN-2026 exists first (bootstrap)
          if (isAdmin && accessCode === 'SAW-ADMIN-2026') {
            const adminDocRef = doc(db, 'authorized_users', 'SAW-ADMIN-2026');
            const adminDoc = await getDoc(adminDocRef);
            if (!adminDoc.exists()) {
              await setDoc(adminDocRef, {
                id: 'SAW-ADMIN-2026',
                label: 'Default Admin',
                isActive: true,
                role: 'admin',
                createdAt: new Date().toISOString()
              });
              console.log('Admin bootstrapped successfully');
            }
          }

          await setDoc(doc(db, 'sessions', auth.currentUser!.uid), {
            accessCode: accessCode,
            createdAt: new Date().toISOString()
          });
          setIsSessionSynced(true);
          console.log('Session synced for access code:', accessCode);
        } catch (e) {
          console.error('Failed to sync session:', e);
          setIsSessionSynced(false);
        }
      };
      syncSession();
    } else {
      setIsSessionSynced(false);
    }
  }, [isAccessGranted, isAuthReady, accessCode, isAdmin]);

  // Check for existing session
  useEffect(() => {
    const granted = localStorage.getItem('vbs_access_granted') === 'true';
    const code = localStorage.getItem('vbs_access_code');
    if (granted && code) {
      setIsAccessGranted(true);
      setAccessCode(code);
      
      // Fetch profile data directly from server for reliability without auth dependencies
      getDocFromServer(doc(db, 'authorized_users', code)).then(async (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.data() as AuthorizedUser;
          setProfile(data);
          
          // Sync API Key from Firestore to LocalStorage if missing locally
          if (data.api_key_stored && !localStorage.getItem('VLOGS_BY_SAW_API_KEY')) {
            localStorage.setItem('VLOGS_BY_SAW_API_KEY', data.api_key_stored);
            setLocalApiKey(data.api_key_stored);
          }
        } else {
          // If the code is no longer in authorized_users, log out
          if (code !== 'preview-user') {
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
    // Load from localStorage first
    const savedSettings = localStorage.getItem('vbs_global_settings');
    if (savedSettings) {
      try {
        setGlobalSettings(JSON.parse(savedSettings));
        setIsConfigLoading(false);
      } catch (e) {
        console.error('Error parsing local global settings:', e);
      }
    }

    if (!isAccessGranted || !isAuthReady) return;
    
    const unsubscribe = onSnapshot(doc(db, 'settings', 'global'), (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data() as GlobalSettings;
        setGlobalSettings(data);
        localStorage.setItem('vbs_global_settings', JSON.stringify(data));
        setIsConfigLoading(false);
      } else {
        setIsConfigLoading(false);
      }
    }, (err) => {
      handleFirestoreError(err, OperationType.GET, 'settings/global');
      setIsConfigLoading(false);
    });
    return () => unsubscribe();
  }, [isAccessGranted, isAuthReady]);

  // Listen for System Config (Now from LocalStorage)
  useEffect(() => {
    const loadSystemConfig = () => {
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
          openai_api_key: ''
        };
        
        // Individual overrides if they exist
        const rKey = localStorage.getItem('rapidapi_key');
        const gKey = localStorage.getItem('gemini_api_key');
        const oKey = localStorage.getItem('openai_api_key');
        
        if (rKey) config.rapidapi_key = rKey;
        if (gKey) config.gemini_api_key = gKey;
        if (oKey) config.openai_api_key = oKey;
        
        setSystemConfig(config);
      } catch (e) {
        console.error('Failed to load system config from localStorage:', e);
      }
    };
    
    loadSystemConfig();
    
    // Add event listener for storage changes (in case changed in another tab)
    const handleStorageChange = (e: StorageEvent) => {
      if ((e.key === 'vbs_system_config' || e.key === 'rapidapi_key' || e.key === 'gemini_api_key' || e.key === 'openai_api_key')) {
        loadSystemConfig();
      }
    };
    
    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  // Listen for Global Rules
  useEffect(() => {
    // Load from localStorage first
    const savedRules = localStorage.getItem('vbs_global_rules');
    if (savedRules) {
      try {
        setGlobalRules(JSON.parse(savedRules));
      } catch (e) {
        console.error('Error parsing local global rules:', e);
      }
    }

    if (!isAccessGranted || !isAuthReady) {
      return;
    }
    
    const unsubscribe = onSnapshot(collection(db, 'globalRules'), (snapshot) => {
      const rules = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as PronunciationRule));
      setGlobalRules(rules);
      localStorage.setItem('vbs_global_rules', JSON.stringify(rules));
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, 'globalRules');
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

  // Seed default admin if collection is empty
  useEffect(() => {
    if (!isAuthReady) return;
    const seedDefaultAdmin = async () => {
      try {
        const adminDoc = await getDocFromServer(doc(db, 'authorized_users', 'SAW-ADMIN-2026'));
        if (!adminDoc.exists()) {
          console.log('Seeding default admin Access Code...');
          const defaultAdmin: AuthorizedUser = {
            id: 'SAW-ADMIN-2026',
            label: 'Default Admin',
            isActive: true,
            role: 'admin',
            createdAt: new Date().toISOString(),
            createdBy: 'system'
          };
          await setDoc(doc(db, 'authorized_users', defaultAdmin.id), defaultAdmin);
          console.log('Default admin seeded successfully.');
        }
      } catch (err) {
        console.error('Failed to seed default admin:', err);
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
      setError('ဝင်ရောက်ရန် ကုဒ်ရိုက်ထည့်ပါ');
      return;
    }

    setIsVerifyingCode(true);
    setError(null);

    try {
      // Hardcoded RBAC Logic (Master Admin)
      const ADMIN_CODE = 'saw_vlogs_2026';
      const USER_CODE = 'saw_user_2026';

      let role: 'ADMIN' | 'USER' | null = null;

      if (code === ADMIN_CODE) {
        role = 'ADMIN';
      } else if (code === USER_CODE) {
        role = 'USER';
      } else {
        // Check localStorage users
        const savedUsers = localStorage.getItem('vbs_authorized_users');
        if (savedUsers) {
          try {
            const users: AuthorizedUser[] = JSON.parse(savedUsers);
            const foundUser = users.find(u => u.id === code);
            
            if (foundUser) {
              // Check Expiry
              if (foundUser.expiryDate) {
                const expiry = new Date(foundUser.expiryDate);
                const now = new Date();
                if (now > expiry) {
                  setError('ဤ ID မှာ သက်တမ်းကုန်ဆုံးသွားပါပြီ။ ကျေးဇူးပြု၍ Admin ကို ဆက်သွယ်ပါ။');
                  return;
                }
              }
              role = foundUser.role.toUpperCase() as 'ADMIN' | 'USER';
            }
          } catch (e) {
            console.error('Error parsing local users:', e);
          }
        }
      }

      if (role) {
        setUserRole(role);
        setIsAdmin(role === 'ADMIN');
        setIsAccessGranted(true);
        setAccessCode(code);
        localStorage.setItem('vbs_role', role);
        localStorage.setItem('vbs_access_granted', 'true');
        localStorage.setItem('vbs_access_code', code);
        
        if (role === 'ADMIN') {
          setToast({ message: 'အက်ဒမင်အဖြစ် ဝင်ရောက်ပြီးပါပြီ', type: 'success' });
        } else {
          setActiveTab('youtube-transcript');
          setToast({ message: 'အသုံးပြုသူအဖြစ် ဝင်ရောက်ပြီးပါပြီ', type: 'success' });
        }
      } else {
        setError('မှားယွင်းသော ကုဒ်ဖြစ်ပါသည်။');
        return;
      }

      setTimeout(() => setToast(null), 3000);
    } catch (err: any) {
      console.error('Access Code Verification Error:', err);
      setError(`ဝင်ရောက်မှု မအောင်မြင်ပါ: ${err.message || 'အမည်မသိ အမှားအယွင်း'}`);
    } finally {
      setIsVerifyingCode(false);
    }
  };

  const handleLogout = async () => {
    await signOut(auth);
    setIsAccessGranted(false);
    setAccessCode(null);
    setIsAdmin(false);
    setUserRole(null);
    localStorage.removeItem('vbs_access_granted');
    localStorage.removeItem('vbs_access_code');
    localStorage.removeItem('vbs_role');
    localStorage.removeItem('is_admin_auth');
    // We do NOT remove the API Key on logout as per safety requirements
    setLocalApiKey(null);
    setActiveTab('generate');
  };

  const handleAdminLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (adminPasswordInput === 'saw_vlogs_2026') {
      setIsAdmin(true);
      setAccessCode('SAW-ADMIN-2026');
      localStorage.setItem('is_admin_auth', 'true');
      localStorage.setItem('vbs_access_code', 'SAW-ADMIN-2026');
      localStorage.setItem('vbs_access_granted', 'true');
      setIsAdminModalOpen(false);
      setAdminPasswordInput('');
      alert("Welcome, Saw!");
    } else {
      alert("စကားဝှက် မှားယွင်းနေပါသည်။");
    }
  };

  const handleFetchTranscript = async () => {
    const url = youtubeTranscriptUrl.trim();
    if (!url) return;
    
    addMissionLog(`YOUTUBE URL လက်ခံရရှိပါသည်: ${url.substring(0, 30)}...`);
    
    // Check for Admin API Keys if in Admin mode
    if (apiSwitch === 'admin' && !systemConfig?.rapidapi_key) {
      setToast({ message: "စနစ်စီမံခန့်ခွဲသူမှ RapidAPI Key ထည့်သွင်းထားခြင်း မရှိပါ။", type: 'error' });
      addMissionLog("အမှား: RAPIDAPI KEY မရှိပါ။");
      return;
    }
    
    setIsFetchingTranscript(true);
    setIsVideoProcessing(true); // Trigger Star-Chart animation
    setError(null);
    setRawTranscript('');
    
    const extractVideoId = (url: string) => {
      const regex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/|youtube\.com\/shorts\/)([^"&?\/\s]{11})/i;
      const match = url.match(regex);
      return match ? match[1] : null;
    };

    const videoId = extractVideoId(url);
    if (!videoId) {
      setToast({ message: "YouTube URL မှားယွင်းနေပါသည်။", type: 'error' });
      addMissionLog("အမှား: မှားယွင်းသော YOUTUBE URL ဖြစ်နေပါသည်။");
      setIsFetchingTranscript(false);
      return;
    }

    const fetchViaRapidAPI = async () => {
      const rapidKey = localStorage.getItem('rapidapi_key') || systemConfig?.rapidapi_key;
      if (!rapidKey) throw new Error("RapidAPI Key missing");
      
      addMissionLog("စာသားများ ထုတ်ယူနေပါသည် (RapidAPI)...");
      const response = await fetch(`https://youtube-video-subtitles-list.p.rapidapi.com/get_subtitles?video_id=${videoId}&locale=en`, {
        method: 'GET',
        headers: {
          'x-rapidapi-key': rapidKey,
          'x-rapidapi-host': 'youtube-video-subtitles-list.p.rapidapi.com'
        }
      });
      
      const data = await response.json();
      
      if (data && typeof data === 'object' && data.message === "Transcript not available") {
        throw new Error("ဤ Video တွင် Transcript ပိတ်ထားပါသဖြင့် Video File Upload စနစ်ကို အသုံးပြုပေးပါ။");
      }

      if (!response.ok) throw new Error(`RapidAPI Error: ${response.statusText}`);
      
      // Assuming the API returns an array of subtitle objects with 'text' property
      if (data && Array.isArray(data)) {
        addMissionLog("စာသားများ ထုတ်ယူမှု အောင်မြင်ပါသည်။");
        return data.map((t: any) => t.text).join(' ');
      }
      throw new Error("Invalid response from RapidAPI");
    };

    const fetchViaServer = async () => {
      const response = await fetch(`/api/youtube-transcript?url=${encodeURIComponent(url)}`);
      const data = await response.json();
      if (!response.ok || !data.transcript) throw new Error(data.error || "Server fetch failed");
      return data.transcript.map((t: any) => t.text).join(' ');
    };

    const fetchViaClientProxy = async () => {
      const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
      const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(watchUrl)}`;
      const response = await fetch(proxyUrl);
      if (!response.ok) throw new Error("Proxy fetch failed");
      
      const data = await response.json();
      const html = data.contents;
      
      const regex = /ytInitialPlayerResponse\s*=\s*({.+?});/s;
      const match = html.match(regex);
      if (!match) throw new Error("Could not find player response in HTML");
      
      const playerResponse = JSON.parse(match[1]);
      const tracks = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
      
      if (!tracks || tracks.length === 0) throw new Error("No caption tracks found");
      
      const track = tracks.find((t: any) => t.languageCode === 'en') || 
                    tracks.find((t: any) => t.languageCode === 'en-US') ||
                    tracks.find((t: any) => t.languageCode.startsWith('en')) ||
                    tracks[0];
      
      const transcriptRes = await fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(track.baseUrl)}`);
      if (!transcriptRes.ok) throw new Error("Failed to fetch transcript XML via proxy");
      
      const transcriptData = await transcriptRes.json();
      const xml = transcriptData.contents;
      
      const textRegex = /<text start="([\d.]+)" dur="([\d.]+)".*?>(.*?)<\/text>/g;
      let fullText = "";
      let m;
      while ((m = textRegex.exec(xml)) !== null) {
        fullText += m[3]
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")
          .replace(/&nbsp;/g, ' ') + " ";
      }
      if (!fullText) throw new Error("Transcript is empty");
      return fullText.trim();
    };

    const rapidKey = localStorage.getItem('rapidapi_key') || systemConfig?.rapidapi_key;
    if (apiSwitch === 'admin' && rapidKey) {
      addMissionLog("RAPIDAPI ဖြင့် ထုတ်ယူရန် ကြိုးစားနေပါသည်...");
      try {
        const text = await fetchViaRapidAPI();
        setRawTranscript(text);
        setRetryCount(0);
        setShowManualInput(false);
        setIsFetchingTranscript(false);
        setIsVideoProcessing(false);
        addMissionLog("RAPIDAPI ဖြင့် ထုတ်ယူမှု အောင်မြင်ပါသည်။");
        return;
      } catch (rapidErr) {
        console.warn("RapidAPI fetch failed, trying fallbacks...", rapidErr);
        addMissionLog("RAPIDAPI ဖြင့် ထုတ်ယူ၍မရပါ၊ အခြားနည်းလမ်းဖြင့် ကြိုးစားနေပါသည်...");
      }
    }

    try {
      // Try server next
      try {
        const text = await fetchViaServer();
        setRawTranscript(text);
        setRetryCount(0);
        setShowManualInput(false);
      } catch (serverErr) {
        console.warn("Server fetch failed, trying client proxy...", serverErr);
        const text = await fetchViaClientProxy();
        setRawTranscript(text);
        setRetryCount(0);
        setShowManualInput(false);
      }
    } catch (err: any) {
      console.error("YouTube Transcript Error:", err);
      const newRetryCount = retryCount + 1;
      setRetryCount(newRetryCount);
      
      if (err.message.includes("Transcript ပိတ်ထားပါသဖြင့်")) {
        setError(err.message);
        setShowManualInput(true);
      } else if (newRetryCount >= 3) {
        setShowManualInput(true);
        setError("အလိုအလျောက် ဖတ်၍မရပါ။ ကျေးဇူးပြု၍ youtube-transcript.io ကဲ့သို့ site များမှ စာသားကို Copy ကူးပြီး ဤနေရာတွင် Paste လုပ်ပေးပါ။");
      } else {
        setError(`YouTube က Transcript ထုတ်ပေးဖို့ ငြင်းဆိုထားပါသည် (Retry ${newRetryCount}/3).`);
      }
    } finally {
      setIsFetchingTranscript(false);
      setIsVideoProcessing(false);
    }
  };

  const handleVideoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const allowedTypes = ['video/mp4', 'video/x-matroska', 'video/quicktime'];
      if (!allowedTypes.includes(file.type) && !file.name.endsWith('.mkv')) {
        setToast({ message: "Unsupported file format. Please upload .mp4, .mkv, or .mov", type: 'error' });
        return;
      }
      setVideoFile(file);
      addMissionLog(`ဗီဒီယိုဖိုင် လက်ခံရရှိပါသည်: ${file.name} (${(file.size / (1024 * 1024)).toFixed(2)} MB)`);
    }
  };

  const processVideoFile = async () => {
    if (!videoFile) return;
    
    // Check for Gemini API Key
    const apiKey = systemConfig?.gemini_api_key;
    if (!apiKey) {
      setToast({ message: "စနစ်စီမံခန့်ခွဲသူမှ Gemini API Key ထည့်သွင်းထားခြင်း မရှိပါ။", type: 'error' });
      addMissionLog("အမှား: GEMINI API KEY မရှိပါ။");
      return;
    }

    setIsVideoProcessing(true);
    setError(null);
    setRawTranscript('');
    addMissionLog("ဗီဒီယိုကို စစ်ဆေးနေပါသည် (GEMINI 1.5 PRO)...");

    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          resolve(result.split(',')[1]);
        };
        reader.onerror = reject;
        reader.readAsDataURL(videoFile);
      });

      const ai = new GoogleGenAI({ apiKey });
      const response = await ai.models.generateContent({
        model: "gemini-3.1-pro-preview",
        contents: [
          {
            parts: [
              {
                inlineData: {
                  mimeType: videoFile.type || 'video/mp4',
                  data: base64,
                },
              },
              {
                text: "Please provide a detailed transcript or a very thorough summary of what is being said and happening in this video. If there is speech, transcribe it accurately. If there is no speech, describe the visual events in detail. Output the result in English. Focus on capturing all spoken dialogue for script generation.",
              },
            ],
          },
        ],
      });

      const resultText = response.text;
      if (resultText) {
        setRawTranscript(resultText);
        addMissionLog("ဗီဒီယို စစ်ဆေးမှု ပြီးဆုံးပါပြီ။ စာသားများ ထုတ်ယူပြီးပါပြီ။");
        setToast({ message: "ဗီဒီယို စစ်ဆေးမှု အောင်မြင်ပါသည်။", type: 'success' });
      } else {
        throw new Error("Gemini returned an empty response.");
      }
    } catch (err: any) {
      console.error("Video Processing Error:", err);
      setError(`ဗီဒီယို စစ်ဆေးရန် မအောင်မြင်ပါ - ${err.message}`);
      addMissionLog(`အမှား: ဗီဒီယို စစ်ဆေးမှု မအောင်မြင်ပါ - ${err.message}`);
      setToast({ message: "စစ်ဆေးမှု မအောင်မြင်ပါ။ မှတ်တမ်းတွင် ကြည့်ရှုပါ။", type: 'error' });
    } finally {
      setIsVideoProcessing(false);
    }
  };

  const handleYoutubeRecap = async (providedText?: string) => {
    // Priority: 1. providedText (from transcript tab), 2. recapManualText (from recap tab)
    const textToSummarize = typeof providedText === 'string' ? providedText : recapManualText.trim();
    
    if (!textToSummarize) return;

    addMissionLog("ဇာတ်လမ်းအကျဉ်းချုပ် ဖန်တီးမှုကို စတင်နေပါသည်...");

    // Check for Admin API Keys if in Admin mode
    if (apiSwitch === 'admin' && (!systemConfig?.rapidapi_key || !systemConfig?.gemini_api_key || !systemConfig?.openai_api_key)) {
      setError("စနစ်စီမံခန့်ခွဲသူမှ API Keys များ ထည့်သွင်းထားခြင်း မရှိပါ။");
      addMissionLog("အမှား: စနစ် API KEYS များ ထည့်သွင်းထားခြင်း မရှိပါ။");
      return;
    }
    
    setIsProcessingYoutube(true);
    setError(null);
    setText('');
    setResult(null);
    
    try {
      const fullText = textToSummarize;
      
      addMissionLog("GEMINI 3.1 PRO ဖြင့် လုပ်ဆောင်နေပါသည်...");
      const ai = new GoogleGenAI({ apiKey: getEffectiveApiKey() || '' });
      const geminiResponse = await ai.models.generateContent({
        model: "gemini-3.1-pro-preview",
        contents: fullText,
        config: {
          systemInstruction: "Translate and summarize the following English YouTube transcript into a natural, engaging Burmese narrative recap. Use a storytelling style.",
        }
      });
      
      const summary = geminiResponse.text;
      if (summary) {
        addMissionLog("ဇာတ်လမ်းအကျဉ်းချုပ် ဖန်တီးမှု အောင်မြင်ပါသည်။");
        setText(summary);
        setActiveTab('generate');
        // Small delay to ensure state update before generation
        setTimeout(() => {
          handleGenerate();
        }, 300);
      }
    } catch (err: any) {
      console.error("YouTube Recap Error:", err);
      addMissionLog("အမှား: GEMINI RECAP မအောင်မြင်ပါ။");
      setError("Gemini မှ Recap ပြုလုပ်ပေးရန် ငြင်းဆိုထားပါသည် (Check API Key or Content).");
    } finally {
      setIsProcessingYoutube(false);
    }
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
    localStorage.removeItem('VBS_API_SWITCH');
    setLocalApiKey(null);
    setApiSwitch('admin');
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

  const getEffectiveApiKey = useCallback(() => {
    // If Admin Key is selected, use the Global System Key
    if (apiSwitch === 'admin') {
      // Priority 1: systemConfig from Admin Dashboard
      if (systemConfig?.gemini_api_key) {
        console.log("App: Using Gemini API Key from System Config (Admin Mode)");
        return systemConfig.gemini_api_key.trim();
      }
      // Priority 2: globalSettings (Legacy fallback)
      if (globalSettings.allow_global_key && globalSettings.global_system_key) {
        console.log("App: Using Global System API Key (Legacy Admin Mode)");
        return globalSettings.global_system_key.trim();
      }
      console.warn("App: Admin Mode selected but no Admin API Key configured");
      return null;
    }

    // If Personal Key is selected, use the key from Local Storage
    const storedKey = localStorage.getItem('VLOGS_BY_SAW_API_KEY');
    if (storedKey) {
      console.log("App: Using API Key from LocalStorage (Personal Mode)");
      return storedKey.trim();
    }

    if (profile?.api_key_stored) {
      console.log("App: Using API Key from Firestore Profile (Personal Mode Fallback)");
      return profile.api_key_stored.trim();
    }
    
    // Ultimate Fallback to Environment Variable
    if (typeof process !== 'undefined' && process.env.GEMINI_API_KEY) {
      console.log("App: Using Environment Variable API Key");
      return process.env.GEMINI_API_KEY.trim();
    }
    
    console.warn("App: No effective API Key found");
    return null;
  }, [profile, globalSettings, apiSwitch]);

  const handleUpdateGlobalSettings = async (updates: Partial<GlobalSettings>) => {
    try {
      await updateDoc(doc(db, 'settings', 'global'), updates);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, 'settings/global');
    }
  };

  const handleSaveApiKeyFromModal = async (key: string, selectedSwitch: 'admin' | 'personal') => {
    const trimmedKey = key.trim();
    setIsUpdatingKey(true);
    try {
      // 1. Save switch preference
      localStorage.setItem('VBS_API_SWITCH', selectedSwitch);
      setApiSwitch(selectedSwitch);

      // 2. Save personal key if provided
      if (selectedSwitch === 'personal' && trimmedKey) {
        localStorage.setItem('VLOGS_BY_SAW_API_KEY', trimmedKey);
        setLocalApiKey(trimmedKey);
      }
      
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

  const handleAddGlobalRule = async () => {
    const original = prompt('Enter original text:');
    const replacement = prompt('Enter replacement text:');
    if (original && replacement) {
      try {
        await addDoc(collection(db, 'globalRules'), {
          original,
          replacement,
          createdAt: new Date().toISOString()
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, 'globalRules');
      }
    }
  };

  const handleDeleteGlobalRule = async (id: string) => {
    if (confirm('Delete this rule?')) {
      try {
        await deleteDoc(doc(db, 'globalRules', id));
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, `globalRules/${id}`);
      }
    }
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

    // Use the effective API key based on the switch setting
    const effectiveKey = getEffectiveApiKey();
    
    if (apiSwitch === 'admin' && (!systemConfig?.rapidapi_key || !systemConfig?.gemini_api_key || !systemConfig?.openai_api_key)) {
      setError("System maintenance: API Keys not configured by Admin.");
      return;
    }
    
    if (!effectiveKey) {
      console.warn("App: Generation blocked - No effective API Key found. Opening settings modal.");
      if (apiSwitch === 'personal') {
        window.alert('ကျေးဇူးပြု၍ Settings တွင် API Key အရင်ထည့်သွင်းပါ။ (No API Key found. Please add one in Settings.)');
      } else {
        window.alert('Admin Key မရှိသေးပါ။ ကျေးဇူးပြု၍ ခဏစောင့်ပါ သို့မဟုတ် ကိုယ်ပိုင် Key သုံးပါ။ (Admin Key not available. Please wait or use personal key.)');
      }
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
        setError("Note: Real API call failed or timed out. Showing simulation result for testing.");
      } else {
        console.log("App: TTS generation successful, updating state...");
      }
      
      setResult(audioResult);

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
      setError(err.message || 'An unexpected error occurred.');
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
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
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

  return (
    <div className={`min-h-screen flex flex-col transition-colors duration-300 ${isDarkMode ? 'dark bg-[#020617] text-white' : 'bg-white text-slate-900'}`}>
      <div className="fixed inset-0 pointer-events-none scanline opacity-30" />
      <div className="fixed inset-0 pointer-events-none grid-bg opacity-20" />
      <Header 
        isDarkMode={isDarkMode} 
        toggleTheme={() => setIsDarkMode(!isDarkMode)} 
        onOpenTools={() => setIsApiKeyModalOpen(true)}
        isAccessGranted={isAccessGranted}
        isAdmin={isAdmin}
        onLogout={handleLogout}
      />

      <main className="flex-1 container mx-auto px-4 sm:px-6 py-6 sm:py-8 overflow-x-hidden">
        {isConfigLoading ? (
          <div className="flex flex-col items-center justify-center py-40">
            <RefreshCw size={48} className="text-brand-purple animate-spin mb-4" />
            <p className="text-slate-500 font-medium font-mono uppercase tracking-widest">စနစ်ကို စတင်နေပါသည်...</p>
          </div>
        ) : isAdminRoute ? (
          <AdminDashboard 
            isAuthReady={isAuthReady} 
            isAdmin={isAdmin}
            isSessionSynced={isSessionSynced}
            onLogout={handleLogout}
            onConfigUpdate={setSystemConfig}
          />
        ) : !isAccessGranted ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-20 h-20 bg-brand-purple/10 text-brand-purple rounded-3xl flex items-center justify-center mb-6 border border-brand-purple/20 shadow-[0_0_20px_rgba(168,85,247,0.2)]">
              <Lock size={40} />
            </div>
            
            <div className="w-full max-w-md space-y-6">
              <h2 className="text-xl sm:text-2xl font-bold mb-2 text-slate-900 dark:text-white font-mono uppercase tracking-tighter">Vlogs By Saw - Narration Engine</h2>
              <p className="text-slate-600 dark:text-slate-300 mb-6 sm:mb-8 text-sm sm:text-base font-sans font-bold">
                ဝင်ရောက်ရန် ကုဒ်ရိုက်ထည့်ပါ
              </p>
              
              <form onSubmit={handleLogin} className="space-y-4">
                <div className="relative">
                  <Key className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={20} />
                  <input
                    type="text"
                    value={accessCodeInput}
                    onChange={(e) => setAccessCodeInput(e.target.value)}
                    placeholder="Access Code ကို ဤနေရာတွင် ရိုက်ထည့်ပါ..."
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl pl-12 pr-4 py-4 text-lg font-mono text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-purple/50 transition-all"
                  />
                </div>
                
                {error && (
                  <div className="text-red-500 text-sm font-medium flex items-center justify-center gap-2 font-sans">
                    <AlertCircle size={16} /> {error}
                  </div>
                )}
                
                <button
                  type="submit"
                  disabled={isVerifyingCode || !accessCodeInput.trim() || !isAuthReady}
                  className="w-full py-4 bg-brand-purple text-white rounded-2xl font-bold text-lg hover:bg-brand-purple/90 transition-all flex items-center justify-center gap-2 disabled:opacity-50 shadow-lg shadow-brand-purple/20 font-mono uppercase tracking-widest btn-pulse"
                >
                  {isVerifyingCode || !isAuthReady ? (
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                      {!isAuthReady && <span className="text-sm">ချိတ်ဆက်နေပါသည်...</span>}
                    </div>
                  ) : (
                    <>အတည်ပြုမည် <ArrowRight size={20} /></>
                  )}
                </button>
              </form>
            </div>
          </div>
        ) : (
          <div className="space-y-8">
            {/* Tab Navigation */}
            {!(!systemLive && !isAdmin) && (
              <div className="flex flex-wrap items-center gap-2 sm:gap-4 bg-white/50 backdrop-blur dark:bg-slate-900/40 p-1.5 rounded-2xl w-fit mx-auto shadow-sm transition-all duration-300 border border-slate-200/50 dark:border-slate-800/50">
                <button
                  onClick={() => setActiveTab('youtube-transcript')}
                  className={`px-6 sm:px-8 py-3 rounded-xl text-xs sm:text-sm font-bold transition-all flex items-center gap-2 relative font-sans ${activeTab === 'youtube-transcript' ? 'bg-brand-purple text-white shadow-lg shadow-brand-purple/30' : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'}`}
                >
                  <FileText size={18} strokeWidth={1.5} /> ဗီဒီယိုအရင်းအမြစ်
                </button>
                <button
                  onClick={() => setActiveTab('youtube-recap')}
                  className={`px-6 sm:px-8 py-3 rounded-xl text-xs sm:text-sm font-bold transition-all flex items-center gap-2 relative font-sans ${activeTab === 'youtube-recap' ? 'bg-brand-purple text-white shadow-lg shadow-brand-purple/30' : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'}`}
                >
                  <Youtube size={18} strokeWidth={1.5} /> ဇာတ်လမ်းအကျဉ်း
                </button>
                <button
                  onClick={() => setActiveTab('generate')}
                  className={`px-6 sm:px-8 py-3 rounded-xl text-xs sm:text-sm font-bold transition-all flex items-center gap-2 font-sans ${activeTab === 'generate' ? 'bg-brand-purple text-white shadow-lg shadow-brand-purple/30' : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'}`}
                >
                  <Wand2 size={18} strokeWidth={1.5} /> အသံထည့်သွင်းခြင်း
                </button>
                <button
                  onClick={() => setActiveTab('history')}
                  className={`px-6 sm:px-8 py-3 rounded-xl text-xs sm:text-sm font-bold transition-all flex items-center gap-2 font-sans ${activeTab === 'history' ? 'bg-brand-purple text-white shadow-lg shadow-brand-purple/30' : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'}`}
                >
                  <History size={18} strokeWidth={1.5} /> မှတ်တမ်းဟောင်း
                </button>
                {isAdmin && (
                  <>
                    <button
                      onClick={() => setActiveTab('tools')}
                      className={`px-6 sm:px-8 py-3 rounded-xl text-xs sm:text-sm font-bold transition-all flex items-center gap-2 relative font-sans ${activeTab === 'tools' ? 'bg-brand-purple text-white shadow-lg shadow-brand-purple/30' : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'}`}
                    >
                      <Wrench size={18} strokeWidth={1.5} /> ကိရိယာများ
                    </button>
                    <button
                      onClick={() => setActiveTab('admin')}
                      className={`px-6 sm:px-8 py-3 rounded-xl text-xs sm:text-sm font-bold transition-all flex items-center gap-2 relative font-sans ${activeTab === 'admin' ? 'bg-brand-purple text-white shadow-lg shadow-brand-purple/30' : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'}`}
                    >
                      <Shield size={18} strokeWidth={1.5} /> အက်ဒမင်
                    </button>
                  </>
                )}
              </div>
            )}

            {isAdmin && !systemLive && (
              <div className="flex justify-center">
                <div className="px-4 py-2 bg-red-500/10 border border-red-500/20 rounded-full flex items-center gap-2 text-red-500 text-xs font-bold font-mono animate-pulse">
                  <AlertCircle size={14} />
                  SYSTEM IS CURRENTLY OFFLINE FOR USERS
                </div>
              </div>
            )}

            <AnimatePresence mode="wait">
              {!systemLive && !isAdmin ? (
                <motion.div
                  key="offline"
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  className="max-w-2xl mx-auto py-20 text-center space-y-8"
                >
                  <div className="relative inline-block">
                    <div className="absolute inset-0 bg-red-500/20 blur-3xl rounded-full animate-pulse" />
                    <div className="relative w-24 h-24 bg-slate-900 border-2 border-red-500/50 rounded-3xl flex items-center justify-center text-red-500 shadow-[0_0_30px_rgba(239,68,68,0.3)]">
                      <Wifi size={48} className="animate-bounce" />
                    </div>
                  </div>
                  <div className="space-y-4">
                    <h2 className="text-3xl font-bold text-slate-900 dark:text-white font-sans tracking-tight">
                      စနစ်ကို ခေတ္တပိတ်ထားပါသည်။
                    </h2>
                    <p className="text-lg text-slate-500 dark:text-slate-400 font-medium">
                      ခဏအကြာမှ ပြန်လည်ကြိုးစားပေးပါ။
                    </p>
                    <p className="text-[10px] text-slate-400 font-mono uppercase tracking-[0.3em]">System is temporarily offline</p>
                  </div>
                  
                  {/* Admin Login Shortcut for testing */}
                  <div className="pt-8">
                    <button
                      onClick={() => setIsAdminModalOpen(true)}
                      className="text-xs font-bold text-slate-400 hover:text-brand-purple transition-colors flex items-center gap-2 mx-auto uppercase tracking-widest font-mono"
                    >
                      <Lock size={12} /> Admin Override
                    </button>
                  </div>
                </motion.div>
              ) : (
                <>
                  {activeTab === 'generate' && (
                <motion.div
                  key="generate"
                  initial={{ opacity: 0, y: 20, filter: 'blur(10px)' }}
                  animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                  exit={{ opacity: 0, y: -20, filter: 'blur(10px)' }}
                  transition={{ type: "spring", stiffness: 100, damping: 20 }}
                  className="space-y-8"
                >
                  <div className="flex flex-col items-center text-center mb-8">
                    <div className="w-16 h-16 bg-brand-purple/10 text-brand-purple rounded-2xl flex items-center justify-center mb-4 border border-brand-purple/20 shadow-[0_0_15px_rgba(168,85,247,0.3)]">
                      <Volume2 size={32} strokeWidth={1.5} />
                    </div>
                    <h2 className="text-2xl font-bold text-slate-900 dark:text-white font-sans tracking-tight">အသံထည့်သွင်းခြင်း</h2>
                    <p className="text-slate-500 dark:text-slate-400 text-sm mt-2 font-mono uppercase tracking-widest">Voiceover Generation Console</p>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
                    {/* Column 1: Configuration */}
                    <div className="lg:col-span-1 space-y-8">
                      <div className="bg-white/50 backdrop-blur dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl transition-colors duration-300 hover:neon-border-purple">
                        <VoiceConfig config={config} setConfig={setConfig} isDarkMode={isDarkMode} />
                        <div className="mt-8">
                          <PronunciationRules
                            rules={DEFAULT_RULES}
                            globalRules={globalRules}
                            customRules={customRules}
                            setCustomRules={setCustomRules}
                            isAdmin={isAdmin}
                            onOpenTools={() => setIsApiKeyModalOpen(true)}
                            showCustomRules={false}
                          />
                        </div>
                      </div>
                    </div>

                    {/* Column 2: Input & Process */}
                    <div className="lg:col-span-1 space-y-8">
                      <div className="bg-white/50 backdrop-blur dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl transition-colors duration-300 hover:neon-border-blue">
                        <ContentInput text={text} setText={setText} isDarkMode={isDarkMode} />
                        
                        <div className="space-y-4 mt-8">
                          <div className="flex items-center justify-between bg-white/50 backdrop-blur dark:bg-slate-900/50 p-4 rounded-2xl border border-slate-200/50 dark:border-slate-800/50 shadow-sm transition-colors duration-300">
                            <div className="flex items-center gap-3">
                              <div className="p-2 bg-brand-purple/10 rounded-lg text-brand-purple">
                                <History size={18} strokeWidth={1.5} />
                              </div>
                              <div>
                                <p className="text-sm font-bold text-slate-900 dark:text-white font-sans">မှတ်တမ်းသိမ်းဆည်းမည်</p>
                                <p className="text-[10px] text-slate-500 dark:text-slate-400 font-mono uppercase">Sync to Mission Logs</p>
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

                          <button
                            onClick={handleGenerate}
                            disabled={isLoading || !text.trim()}
                            className={`w-full py-6 rounded-[24px] font-bold text-xl shadow-2xl flex items-center justify-center gap-4 transition-all active:scale-[0.98] bg-brand-purple hover:bg-brand-purple/90 text-white shadow-brand-purple/40 hover:ring-2 hover:ring-brand-purple/50 hover:shadow-[0_0_25px_rgba(168,85,247,0.5)] font-mono uppercase tracking-widest btn-pulse`}
                          >
                            {isLoading ? (
                              <RefreshCw size={28} className="animate-spin" />
                            ) : (
                              <Zap size={28} strokeWidth={1.5} />
                            )}
                            <div className="flex flex-col items-center">
                              <span className="flex items-baseline gap-3 font-sans">
                                {isLoading ? 'ဖန်တီးနေပါသည်...' : 'အသံထုတ်ယူမည်'}
                                <span className="text-sm font-medium opacity-60 font-mono">
                                  ({Math.ceil(text.length / 3000) || 1} UNIT)
                                </span>
                              </span>
                            </div>
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Column 3: Output */}
                    <div className="lg:col-span-1 space-y-8">
                      <div className="bg-white/50 backdrop-blur dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl transition-colors duration-300 hover:neon-border-emerald">
                        <OutputPreview 
                          result={result} 
                          isLoading={isLoading} 
                          globalVolume={config.volume}
                        />
                        {error && (
                          <div className="mt-6 bg-red-500/10 border border-red-500/20 rounded-xl p-4 flex items-start gap-3 text-red-500 font-mono">
                            <AlertCircle size={20} className="shrink-0 mt-0.5" />
                            <p className="text-sm font-medium">{error}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}

              {activeTab === 'history' && (
                <motion.div
                  key="history"
                  initial={{ opacity: 0, x: 100, filter: 'blur(10px)' }}
                  animate={{ opacity: 1, x: 0, filter: 'blur(0px)' }}
                  exit={{ opacity: 0, x: -100, filter: 'blur(10px)' }}
                  transition={{ type: "spring", stiffness: 100, damping: 20 }}
                  className="max-w-5xl mx-auto space-y-6"
                >
                  <div className="flex flex-col items-center text-center mb-8">
                    <div className="w-16 h-16 bg-brand-purple/10 text-brand-purple rounded-2xl flex items-center justify-center mb-4 border border-brand-purple/20 shadow-[0_0_15px_rgba(168,85,247,0.3)]">
                      <History size={32} strokeWidth={1.5} />
                    </div>
                    <h2 className="text-2xl font-bold text-slate-900 dark:text-white font-sans tracking-tight">မှတ်တမ်းဟောင်း</h2>
                    <p className="text-slate-500 dark:text-slate-400 text-sm mt-2 font-mono uppercase tracking-widest">Generation History Archive</p>
                  </div>

                  <div className="bg-white/50 backdrop-blur dark:bg-slate-900 rounded-2xl p-8 shadow-2xl border border-slate-200 dark:border-slate-800 transition-colors duration-300">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-8">
                      <div>
                        <h2 className="text-2xl font-bold flex items-center gap-3 text-slate-900 dark:text-white">
                          <History className="text-brand-purple" /> မှတ်တမ်းဟောင်း
                        </h2>
                        <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">ယခင်က ဖန်တီးထားသော အသံများကို စီမံခန့်ခွဲရန်</p>
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
                                  onClick={() => handleDownloadAudio(item.audioStorageUrl || '', `narration-${item.id}.mp3`)}
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
                  initial={{ opacity: 0, x: 100, filter: 'blur(10px)' }}
                  animate={{ opacity: 1, x: 0, filter: 'blur(0px)' }}
                  exit={{ opacity: 0, x: -100, filter: 'blur(10px)' }}
                  transition={{ type: "spring", stiffness: 100, damping: 20 }}
                  className="max-w-4xl mx-auto space-y-8"
                >
                  {/* Profile Card */}
                  <div className="bg-white/50 backdrop-blur dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-8 shadow-2xl transition-colors duration-300">
                    <div className="flex flex-col sm:flex-row items-center sm:items-start gap-4 sm:gap-6 mb-6 sm:mb-8 text-center sm:text-left">
                      <div className="w-16 h-16 sm:w-20 sm:h-20 bg-brand-purple/20 text-brand-purple rounded-2xl flex items-center justify-center text-2xl sm:text-3xl font-bold shadow-inner border border-brand-purple/20 shrink-0">
                        {accessCode?.charAt(0).toUpperCase() || 'V'}
                      </div>
                      <div className="flex-1 w-full">
                        <div className="flex flex-col sm:flex-row items-center gap-2 sm:gap-3 mb-2">
                          <h3 className="text-lg sm:text-2xl font-bold text-slate-900 dark:text-white truncate max-w-full">User ID: {accessCode}</h3>
                          <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[9px] sm:text-[10px] font-bold uppercase tracking-wider border bg-emerald-500/20 text-emerald-500 border-emerald-500/30">
                            <CheckCircle2 size={10} className="sm:w-3 sm:h-3" /> Authorized Access
                          </span>
                        </div>
                        <p className="text-slate-500 dark:text-slate-400 text-xs sm:text-sm flex items-center justify-center sm:justify-start gap-2">
                          <Clock size={12} className="sm:w-3.5 sm:h-3.5" /> Session active via Access Code
                        </p>
                      </div>
                      <button
                        onClick={handleLogout}
                        className="w-full sm:w-auto px-4 py-2.5 bg-slate-100 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 rounded-xl font-bold text-xs hover:bg-red-500/10 hover:text-red-500 hover:border-red-500/20 transition-all flex items-center justify-center gap-2"
                      >
                        <LogOut size={14} /> Sign Out
                      </button>
                    </div>
                  </div>

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

                  {/* Admin Login Section */}
                  {!isAdmin && (
                    <div 
                      onClick={() => setIsAdminModalOpen(true)}
                      className="bg-white/50 backdrop-blur dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-8 shadow-2xl transition-colors duration-300 cursor-pointer hover:border-brand-purple/30 group"
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 bg-brand-purple/10 rounded-xl flex items-center justify-center text-brand-purple group-hover:scale-110 transition-transform">
                            <Shield size={20} />
                          </div>
                          <div>
                            <h3 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white">Admin Login</h3>
                            <p className="text-xs text-slate-500 dark:text-slate-400">Access administrative dashboard and settings</p>
                          </div>
                        </div>
                        <ChevronRight size={18} className="text-slate-400 group-hover:translate-x-1 transition-transform" />
                      </div>
                    </div>
                  )}
                </motion.div>
              )}

              {activeTab === 'admin' && isAdmin && (
                <motion.div
                  key="admin"
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                >
                  <AdminDashboard 
                    isAuthReady={isAuthReady} 
                    isAdmin={isAdmin}
                    isSessionSynced={isSessionSynced}
                    onLogout={handleLogout} 
                    onConfigUpdate={(config) => {
                      setSystemConfig(config);
                      setSystemLive(config.system_live ?? true);
                    }}
                  />
                </motion.div>
              )}

              {activeTab === 'youtube-transcript' && (
                <motion.div
                  key="youtube-transcript"
                  initial={{ opacity: 0, x: 100, filter: 'blur(10px)' }}
                  animate={{ opacity: 1, x: 0, filter: 'blur(0px)' }}
                  exit={{ opacity: 0, x: -100, filter: 'blur(10px)' }}
                  transition={{ type: "spring", stiffness: 100, damping: 20 }}
                  className="max-w-4xl mx-auto space-y-8"
                >
                  <div className="flex flex-col items-center text-center mb-8">
                    <div className="w-16 h-16 bg-blue-500/10 text-blue-500 rounded-2xl flex items-center justify-center mb-4 border border-blue-500/20 shadow-[0_0_15px_rgba(59,130,246,0.3)]">
                      <FileText size={32} strokeWidth={1.5} />
                    </div>
                    <h2 className="text-2xl font-bold text-slate-900 dark:text-white font-sans tracking-tight">ဗီဒီယိုအရင်းအမြစ်</h2>
                    <p className="text-slate-500 dark:text-slate-400 text-sm mt-2 font-mono uppercase tracking-widest">Original Script Extraction Unit</p>
                  </div>

                  <div className="bg-white/50 backdrop-blur dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 sm:p-10 shadow-2xl transition-colors duration-300 hover:neon-border-blue">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                      {/* YouTube Section */}
                      <div className="space-y-6 p-6 bg-slate-50/50 dark:bg-slate-950/50 rounded-2xl border border-slate-200/50 dark:border-slate-800/50 hover:neon-border-purple transition-all duration-300">
                        <div className="flex items-center gap-3 mb-2">
                          <Youtube size={20} className="text-red-500" strokeWidth={1.5} />
                          <h3 className="text-sm font-bold uppercase tracking-widest font-mono">YouTube လင့်ခ်</h3>
                        </div>
                        <div className="space-y-4">
                          <div className="space-y-2">
                            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest px-1 font-mono">URL</label>
                            <input
                              type="text"
                              value={youtubeTranscriptUrl}
                              onChange={(e) => setYoutubeTranscriptUrl(e.target.value)}
                              placeholder="https://www.youtube.com/watch?v=..."
                              className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200/50 dark:border-slate-800/50 rounded-2xl px-4 py-4 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand-purple/50 transition-all placeholder:text-slate-400 font-mono"
                            />
                          </div>
                          
                          <button
                            onClick={handleFetchTranscript}
                            disabled={isFetchingTranscript || !youtubeTranscriptUrl.trim()}
                            className="w-full py-4 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl font-bold flex items-center justify-center gap-2 transition-all disabled:opacity-50 shadow-lg shadow-blue-600/20 font-sans uppercase tracking-widest btn-pulse"
                          >
                            {isFetchingTranscript ? (
                              <RefreshCw size={20} className="animate-spin" />
                            ) : (
                              <Search size={20} strokeWidth={1.5} />
                            )}
                            <span>{isFetchingTranscript ? "ရှာဖွေနေပါသည်..." : "စာသားထုတ်ယူမည်"}</span>
                          </button>
                        </div>
                      </div>

                      {/* Video Upload Section */}
                      <div className="space-y-6 p-6 bg-slate-50/50 dark:bg-slate-950/50 rounded-2xl border border-slate-200/50 dark:border-slate-800/50 hover:neon-border-blue transition-all duration-300">
                        <div className="flex items-center gap-3 mb-2">
                          <Upload size={20} className="text-emerald-500" strokeWidth={1.5} />
                          <h3 className="text-sm font-bold uppercase tracking-widest font-mono">ဗီဒီယိုဖိုင်တင်ရန်</h3>
                        </div>
                        <div className="space-y-4">
                          <div className="space-y-2">
                            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest px-1 font-mono">ဗီဒီယိုဖိုင် (.mp4, .mkv, .mov)</label>
                            <div className="relative group">
                              <input
                                type="file"
                                accept="video/mp4,video/x-matroska,video/quicktime"
                                onChange={handleVideoUpload}
                                className="hidden"
                                id="video-upload"
                              />
                              <label
                                htmlFor="video-upload"
                                className="w-full h-14 bg-slate-50 dark:bg-slate-950 border-2 border-dashed border-slate-200/50 dark:border-slate-800/50 rounded-2xl flex items-center justify-center cursor-pointer hover:border-emerald-500/50 hover:bg-emerald-500/5 transition-all group"
                              >
                                {videoFile ? (
                                  <span className="text-xs font-mono text-emerald-500 truncate px-4">{videoFile.name}</span>
                                ) : (
                                  <div className="flex items-center gap-2 text-slate-400 group-hover:text-emerald-500">
                                    <Plus size={18} strokeWidth={1.5} />
                                    <span className="text-xs font-mono">ဗီဒီယိုဖိုင်ရွေးရန်</span>
                                  </div>
                                )}
                              </label>
                            </div>
                          </div>
                          
                          <button
                            onClick={processVideoFile}
                            disabled={isVideoProcessing || !videoFile}
                            className="w-full py-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl font-bold flex items-center justify-center gap-2 transition-all disabled:opacity-50 shadow-lg shadow-emerald-600/20 font-sans uppercase tracking-widest btn-pulse"
                          >
                            {isVideoProcessing ? (
                              <RefreshCw size={20} className="animate-spin" />
                            ) : (
                              <Zap size={20} strokeWidth={1.5} />
                            )}
                            <span>ဗီဒီယိုကို စစ်ဆေးမည်</span>
                          </button>
                        </div>
                      </div>

                      {/* Voice Character Selection Section */}
                      <div className="space-y-6 p-6 bg-slate-50/50 dark:bg-slate-950/50 rounded-2xl border border-slate-200/50 dark:border-slate-800/50 hover:neon-border-purple transition-all duration-300">
                        <div className="flex items-center gap-3 mb-2">
                          <Volume2 size={20} className="text-brand-purple" strokeWidth={1.5} />
                          <h3 className="text-sm font-bold uppercase tracking-widest font-mono">အသံရွေးချယ်ရန်</h3>
                        </div>
                        <div className="space-y-4">
                          <div className="space-y-2">
                            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest px-1 font-mono">အသံရွေးချယ်ရန်</label>
                            <div className="relative">
                              <select
                                value={config.voiceId}
                                onChange={(e) => setConfig({ ...config, voiceId: e.target.value })}
                                className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200/50 dark:border-slate-800/50 rounded-2xl px-4 py-4 text-sm text-slate-900 dark:text-white appearance-none focus:outline-none focus:ring-2 focus:ring-brand-purple/50 transition-all cursor-pointer font-sans"
                              >
                                {VOICE_OPTIONS.map((voice) => (
                                  <option key={voice.id} value={voice.id} className="bg-white dark:bg-slate-950 text-slate-900 dark:text-white">
                                    {voice.name}
                                  </option>
                                ))}
                              </select>
                              <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-slate-500">
                                <ChevronDown size={18} strokeWidth={1.5} />
                              </div>
                            </div>
                          </div>
                          <div className="h-[56px] flex items-center justify-center text-[10px] text-slate-500 font-mono uppercase tracking-widest text-center px-2">
                            အသံဖန်တီးမှုအားလုံးအတွက် အသုံးပြုမည့် အသံအမျိုးအစား
                          </div>
                        </div>
                      </div>
                    </div>

                    {rawTranscript && (
                      <div className="mt-8 space-y-4 animate-in fade-in slide-in-from-top-4 duration-500">
                        <div className="space-y-2">
                          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest px-1 font-mono">ထုတ်ယူထားသော စာသားများ</label>
                          <div className="w-full h-48 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 text-sm text-slate-500 dark:text-slate-400 overflow-y-auto leading-relaxed scrollbar-thin scrollbar-thumb-slate-200 dark:scrollbar-thumb-slate-800 font-mono">
                            {rawTranscript}
                          </div>
                        </div>

                        <button
                          onClick={() => handleYoutubeRecap(rawTranscript)}
                          disabled={isProcessingYoutube}
                          className="w-full py-4 bg-brand-purple text-white rounded-2xl font-bold text-lg hover:bg-brand-purple/90 transition-all flex items-center justify-center gap-3 disabled:opacity-50 shadow-lg shadow-brand-purple/20 hover:ring-2 hover:ring-brand-purple/50 hover:shadow-[0_0_20px_rgba(168,85,247,0.4)] font-mono uppercase tracking-widest"
                        >
                          {isProcessingYoutube ? (
                            <>
                              <RefreshCw size={20} className="animate-spin" />
                              <span>အကျဉ်းချုပ်နေပါသည်...</span>
                            </>
                          ) : (
                            <>
                              <Wand2 size={20} />
                              <span>အကျဉ်းချုပ်ပြီး အသံထုတ်ယူမည်</span>
                            </>
                          )}
                        </button>
                      </div>
                    )}

                    {error && (
                      <div className="mt-6 bg-red-500/10 border border-red-500/20 rounded-xl p-4 flex items-start gap-3 text-red-500 font-mono">
                        <AlertCircle size={20} className="shrink-0 mt-0.5" />
                        <p className="text-sm font-medium">{error}</p>
                      </div>
                    )}
                  </div>
                </motion.div>
              )}
              {activeTab === 'youtube-recap' && (
                <motion.div
                  key="youtube-recap"
                  initial={{ opacity: 0, x: 100, filter: 'blur(10px)' }}
                  animate={{ opacity: 1, x: 0, filter: 'blur(0px)' }}
                  exit={{ opacity: 0, x: -100, filter: 'blur(10px)' }}
                  transition={{ type: "spring", stiffness: 100, damping: 20 }}
                  className="max-w-2xl mx-auto space-y-8"
                >
                  <div className="flex flex-col items-center text-center mb-8">
                    <div className="w-16 h-16 bg-red-500/10 text-red-500 rounded-2xl flex items-center justify-center mb-4 border border-red-500/20 shadow-[0_0_15px_rgba(239,68,68,0.3)]">
                      <Youtube size={32} />
                    </div>
                    <h2 className="text-2xl font-bold text-slate-900 dark:text-white font-mono tracking-tighter uppercase">ဇာတ်လမ်းအကျဉ်း</h2>
                    <p className="text-slate-500 dark:text-slate-400 text-sm mt-2 font-mono">ဗီဒီယိုကို အကျဉ်းချုပ်ပြီး အသံဖလှယ်ပေးမည်</p>
                  </div>

                  <div className="bg-white/50 backdrop-blur dark:bg-slate-900 border border-slate-200/50 dark:border-slate-800/50 rounded-3xl p-6 sm:p-10 shadow-2xl transition-colors duration-300">
                    <div className="space-y-6">
                      <div className="space-y-4">
                        <div className="space-y-2">
                          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest px-1 font-mono">စာသားများ ထည့်သွင်းရန်</label>
                          <textarea
                            value={recapManualText}
                            onChange={(e) => setRecapManualText(e.target.value)}
                            placeholder="အကျဉ်းချုပ်လိုသော စာသားများကို ဤနေရာတွင် ထည့်သွင်းပါ..."
                            className="w-full h-48 bg-slate-50 dark:bg-slate-950 border border-slate-200/50 dark:border-slate-800/50 rounded-xl p-4 text-sm text-slate-900 dark:text-slate-200 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-purple/50 transition-all resize-none font-mono"
                          />
                          <p className="text-[10px] text-slate-500 px-1 font-mono">YouTube ဗီဒီယိုအောက်ရှိ '...More' -&gt; 'Show Transcript' မှ စာသားများကို ကူးယူနိုင်ပါသည်။</p>
                        </div>
                      </div>

                      {error && (
                        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 flex items-start gap-3 text-red-500 font-mono">
                          <AlertCircle size={20} className="shrink-0 mt-0.5" />
                          <p className="text-sm font-medium">{error}</p>
                        </div>
                      )}

                      <button
                        onClick={() => handleYoutubeRecap()}
                        disabled={isProcessingYoutube || !recapManualText.trim()}
                        className="w-full py-4 bg-brand-purple text-white rounded-2xl font-bold text-lg hover:bg-brand-purple/90 transition-all flex items-center justify-center gap-3 disabled:opacity-50 shadow-lg shadow-brand-purple/20 hover:ring-2 hover:ring-brand-purple/50 hover:shadow-[0_0_20px_rgba(168,85,247,0.4)] font-mono uppercase tracking-widest"
                      >
                        {isProcessingYoutube ? (
                          <>
                            <RefreshCw size={20} className="animate-spin" />
                            <span>အကျဉ်းချုပ်နေပါသည်...</span>
                          </>
                        ) : (
                          <>
                            <Wand2 size={20} />
                            <span>အကျဉ်းချုပ်ပြီး အသံထုတ်ယူမည်</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </motion.div>
              )}
            </>
          )}
        </AnimatePresence>

            {/* Mission Log Panel */}
            <div className="max-w-4xl mx-auto mt-8">
              <div className="bg-slate-900/80 backdrop-blur border border-slate-800 rounded-xl p-4 shadow-2xl">
                <div className="flex items-center gap-2 mb-2 border-b border-slate-800 pb-2">
                  <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest font-mono">စနစ်လည်ပတ်မှု မှတ်တမ်း</span>
                </div>
                <div className="space-y-1 h-24 overflow-y-auto custom-scrollbar">
                  {missionLogs.length === 0 ? (
                    <p className="text-[10px] text-slate-600 font-mono italic">စနစ်မှ ညွှန်ကြားချက်များကို စောင့်ဆိုင်းနေပါသည်...</p>
                  ) : (
                    missionLogs.map((log, idx) => (
                      <div key={idx} className="flex gap-3 text-[10px] font-mono">
                        <span className="text-emerald-500/70 shrink-0">{log.time}</span>
                        <span className="text-slate-300">{log.msg}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
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
        initialSwitch={apiSwitch}
      />

      {/* Admin Login Modal */}
      <AnimatePresence>
        {isAdminModalOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsAdminModalOpen(false)}
              className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-md bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden"
            >
              <div className="p-6 sm:p-8">
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-brand-purple/10 text-brand-purple rounded-xl flex items-center justify-center">
                      <Shield size={20} />
                    </div>
                    <h3 className="text-xl font-bold text-slate-900 dark:text-white">အက်ဒမင် ဝင်ရောက်ခွင့်</h3>
                  </div>
                  <button 
                    onClick={() => setIsAdminModalOpen(false)}
                    className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
                  >
                    <X size={20} />
                  </button>
                </div>

                <form onSubmit={handleAdminLogin} className="space-y-6">
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest px-1">အက်ဒမင် စကားဝှက်</label>
                    <div className="relative">
                      <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                      <input
                        type="password"
                        value={adminPasswordInput}
                        onChange={(e) => setAdminPasswordInput(e.target.value)}
                        placeholder="အက်ဒမင် စကားဝှက် ထည့်သွင်းပါ..."
                        className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl pl-12 pr-4 py-3.5 text-sm text-slate-900 dark:text-slate-200 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-purple/50 transition-all"
                        autoFocus
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    className="w-full py-4 bg-brand-purple text-white rounded-2xl font-bold hover:bg-brand-purple/90 transition-all shadow-lg shadow-brand-purple/20 flex items-center justify-center gap-2"
                  >
                    <LogIn size={20} /> အက်ဒမင်အဖြစ် ဝင်ရောက်မည်
                  </button>
                </form>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
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
    </div>
  );
}

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { AlertCircle, Wand2, Key, Settings, User, LogIn, LogOut, ShieldCheck, ShieldAlert, Shield, CheckCircle2, XCircle, History, Wrench, Plus, Trash2, Download, Play, Music, FileText, Eye, EyeOff, Cloud, RefreshCw, Zap, X, ExternalLink, Calendar, Clock, Mail, Wifi, Save, Lock, Info, ArrowRight, ChevronRight, ChevronDown } from 'lucide-react';
import { Header } from './components/Header';
import { ApiKeyModal } from './components/ApiKeyModal';
import { ContentInput } from './components/ContentInput';
import { PronunciationRules } from './components/PronunciationRules';
import { VoiceConfig } from './components/VoiceConfig';
import { OutputPreview } from './components/OutputPreview';
import { MiniAudioPlayer } from './components/MiniAudioPlayer';
import { AdminDashboard } from './components/AdminDashboard';
import { GeminiTTSService } from './services/geminiService';
import { TTSConfig, AudioResult, PronunciationRule, HistoryItem, Config, AppUser } from './types';
import { DEFAULT_RULES, VOICE_OPTIONS } from './constants';
import { pcmToWav } from './utils/audioUtils';
import { db, storage, auth, signInAnonymously, signOut, onAuthStateChanged, doc, getDoc, getDocFromServer, setDoc, updateDoc, onSnapshot, handleFirestoreError, OperationType, collection, query, where, orderBy, addDoc, deleteDoc, getDocs, limit, ref, uploadString, getDownloadURL, deleteField } from './firebase';

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
  const [isAdminRoute, setIsAdminRoute] = useState(window.location.pathname === '/vbs-admin');
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

  // Auth & Access State (Custom)
  const [accessCodeInput, setAccessCodeInput] = useState('');
  const [isAccessGranted, setIsAccessGranted] = useState(false);
  const [isVerifyingCode, setIsVerifyingCode] = useState(false);
  const [accessCode, setAccessCode] = useState<string | null>(null);
  const [isApiKeyModalOpen, setIsApiKeyModalOpen] = useState(false);
  const [apiKeyMode, setApiKeyMode] = useState<'admin' | 'personal'>('admin');
  const [localApiKey, setLocalApiKey] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [isUpdatingKey, setIsUpdatingKey] = useState(false);

  const handleSaveApiKeyMode = (mode: 'admin' | 'personal') => {
    setApiKeyMode(mode);
    localStorage.setItem('VBS_API_KEY_MODE', mode);
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
          console.error("Silent Auth Fallback:", err);
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
    if (isAccessGranted && isAuthReady && auth.currentUser && accessCode) {
      const syncSession = async () => {
        try {
          await setDoc(doc(db, 'sessions', auth.currentUser!.uid), {
            accessCode: accessCode,
            createdAt: new Date().toISOString()
          });
        } catch (e) {
          console.error('Failed to sync session:', e);
        }
      };
      syncSession();
    }
  }, [isAccessGranted, isAuthReady, accessCode]);

  // Restore Session from LocalStorage (ID only) and Sync with Firestore
  useEffect(() => {
    const code = localStorage.getItem('vbs_access_code');
    if (code) {
      setAccessCode(code);
      // We don't set isAccessGranted yet, we wait for the Firestore sync
    } else {
      setIsConfigLoading(false);
    }
  }, []);

  // Real-time User Profile Sync
  useEffect(() => {
    if (!accessCode || !isAuthReady) return;
    
    const unsubscribe = onSnapshot(doc(db, 'users', accessCode), (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data() as AppUser;
        
        // Check expiry
        const now = new Date();
        const expiry = new Date(data.expiryDate);
        
        if (data.isActive && expiry > now) {
          setProfile(data);
          setIsAccessGranted(true);
          
          // Sync API Key Mode if stored in profile
          if (data.api_key_stored) {
            // We can still use localStorage as a cache, but Firestore is the source of truth
          }
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
          localStorage.removeItem('vbs_access_code');
        }
      }
      setIsConfigLoading(false);
    }, (err) => {
      console.error('User Sync Error:', err);
      setIsConfigLoading(false);
    });
    
    return () => unsubscribe();
  }, [accessCode, isAuthReady]);

  // Listen for System Config (Real-time)
  useEffect(() => {
    if (!isAuthReady) return;
    
    const unsubscribe = onSnapshot(doc(db, 'config', 'main'), (snapshot) => {
      if (snapshot.exists()) {
        setSystemConfig(snapshot.data() as Config);
      }
    }, (err) => {
      console.error('Config Sync Error:', err);
    });
    return () => unsubscribe();
  }, [isAuthReady]);

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
    
    const code = accessCodeInput.trim();
    if (!code) {
      setError('Please enter your Access ID.');
      return;
    }

    setIsVerifyingCode(true);
    setError(null);

    try {
      // Master code override
      if (code === 'saw_vlogs_2026') {
        setAccessCode(code);
        localStorage.setItem('vbs_access_code', code);
        setToast({ message: 'Master Admin Access Granted', type: 'success' });
        return;
      }

      const userDoc = await getDocFromServer(doc(db, 'users', code));
      
      if (!userDoc.exists()) {
        setError('Invalid Access ID. Please contact Admin.');
        return;
      }

      const userData = userDoc.data() as AppUser;
      const now = new Date();
      const expiry = new Date(userData.expiryDate);

      if (!userData.isActive) {
        setError('This account is inactive.');
        return;
      }

      if (expiry <= now) {
        setError('This account has expired.');
        return;
      }

      // Success
      setAccessCode(code);
      localStorage.setItem('vbs_access_code', code);
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
    localStorage.removeItem('vbs_access_code');
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

  const handleClearApiKey = async () => {
    localStorage.removeItem('VLOGS_BY_SAW_API_KEY');
    setLocalApiKey(null);
    
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
      window.location.reload();
    }, 1500);
  };

  const maskApiKey = (key: string | undefined) => {
    if (!key) return 'Not Set';
    if (showApiKey) return key;
    return `${key.substring(0, 8)}...${key.substring(key.length - 4)}`;
  };

  const getEffectiveApiKey = useCallback(() => {
    if (apiKeyMode === 'personal') {
      if (profile?.api_key_stored) {
        return profile.api_key_stored.trim();
      }
      return null;
    } else {
      // Admin mode
      if (systemConfig.allow_global_key && systemConfig.gemini_api_key) {
        return systemConfig.gemini_api_key.trim();
      }
      
      // Ultimate Fallback to Environment Variable
      if (typeof process !== 'undefined' && process.env.GEMINI_API_KEY) {
        return process.env.GEMINI_API_KEY.trim();
      }
      
      return null;
    }
  }, [apiKeyMode, profile, systemConfig]);

  const getApiKeySource = useCallback(() => {
    const key = getEffectiveApiKey();
    if (!key) return 'none';
    return apiKeyMode;
  }, [getEffectiveApiKey, apiKeyMode]);

  const handleUpdateSystemConfig = async (updates: Partial<Config>) => {
    try {
      await updateDoc(doc(db, 'config', 'main'), updates);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, 'config/main');
    }
  };

  const handleSaveApiKeyFromModal = async (key: string) => {
    const trimmedKey = key.trim();
    setIsUpdatingKey(true);
    try {
      // 1. Save to Local Storage
      localStorage.setItem('VLOGS_BY_SAW_API_KEY', trimmedKey);
      setLocalApiKey(trimmedKey);
      
      // 2. Also save to Firestore if user is logged in
      if (accessCode) {
        const userRef = doc(db, 'users', accessCode);
        await updateDoc(userRef, {
          api_key_stored: trimmedKey
        });
      }
      
      setToast({ message: 'Gemini API Key ကို သိမ်းဆည်းပြီးပါပြီ။ ✅', type: 'success' });
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
    if (confirm('Are you sure you want to delete this rule?')) {
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

    // Direct Fetching from LocalStorage as requested - Strict Validation
    const effectiveKey = getEffectiveApiKey();
    
    if (!effectiveKey) {
      console.warn("App: Generation blocked - No API Key found. Opening settings modal.");
      window.alert('ကျေးဇူးပြု၍ Settings တွင် API Key အရင်ထည့်သွင်းပါ။ (No API Key found. Please add one in Settings.)');
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
      setToast({ message: 'SRT နှင့် အသံဖိုင် ထုတ်ယူပြီးပါပြီ။ ✅', type: 'success' });

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
            await updateDoc(doc(db, 'config', 'main'), {
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
      window.scrollTo({ top: 0, behavior: 'smooth' });
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
        {isConfigLoading ? (
          <div className="flex flex-col items-center justify-center py-40">
            <RefreshCw size={48} className="text-brand-purple animate-spin mb-4" />
            <p className="text-slate-500 font-medium">Initializing Narration Engine...</p>
          </div>
        ) : (isAdminRoute && accessCode === 'saw_vlogs_2026') ? (
          <AdminDashboard 
            isAuthReady={isAuthReady} 
            systemConfig={systemConfig}
            onUpdateSystemConfig={handleUpdateSystemConfig}
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
                window.history.pushState({}, '', '/');
                window.dispatchEvent(new PopStateEvent('popstate'));
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
                    onChange={(e) => setAccessCodeInput(e.target.value)}
                    placeholder="Enter Access Code..."
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl pl-12 pr-4 py-4 text-lg font-mono text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-purple/50 transition-all"
                  />
                </div>
                
                {error && (
                  <div className="text-red-500 text-sm font-medium flex items-center justify-center gap-2">
                    <AlertCircle size={16} /> {error}
                  </div>
                )}
                
                <button
                  type="submit"
                  disabled={isVerifyingCode || !accessCodeInput.trim() || !isAuthReady}
                  className="w-full py-4 bg-brand-purple text-white rounded-2xl font-bold text-lg hover:bg-brand-purple/90 transition-all flex items-center justify-center gap-2 disabled:opacity-50 shadow-lg shadow-brand-purple/20"
                >
                  {isVerifyingCode || !isAuthReady ? (
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                      {!isAuthReady && <span className="text-sm">Connecting...</span>}
                    </div>
                  ) : (
                    <>Verify Access <ArrowRight size={20} /></>
                  )}
                </button>
              </form>
            </div>
          </div>
        ) : (
          <div className="space-y-8">
            {/* Tab Navigation */}
            <div className="flex items-center gap-2 sm:gap-4 bg-white/50 backdrop-blur dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-1 rounded-2xl w-fit mx-auto shadow-sm">
              <button
                onClick={() => setActiveTab('generate')}
                className={`px-4 sm:px-6 py-2.5 rounded-xl text-xs sm:text-sm font-bold transition-all flex items-center gap-2 ${activeTab === 'generate' ? 'bg-brand-purple text-white shadow-lg' : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'}`}
              >
                <Wand2 size={18} /> Generate
              </button>
              <button
                onClick={() => setActiveTab('history')}
                className={`px-4 sm:px-6 py-2.5 rounded-xl text-xs sm:text-sm font-bold transition-all flex items-center gap-2 ${activeTab === 'history' ? 'bg-brand-purple text-white shadow-lg' : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'}`}
              >
                <History size={18} /> History
              </button>
              <button
                onClick={() => setActiveTab('tools')}
                className={`px-4 sm:px-6 py-2.5 rounded-xl text-xs sm:text-sm font-bold transition-all flex items-center gap-2 relative ${activeTab === 'tools' ? 'bg-brand-purple text-white shadow-lg' : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'}`}
              >
                <Wrench size={18} /> Tools
              </button>
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
                    <ContentInput text={text} setText={setText} isDarkMode={isDarkMode} />
                    
                    {/* Default Pronunciation Rules Table */}
                    <PronunciationRules
                      rules={DEFAULT_RULES}
                      globalRules={globalRules}
                      customRules={customRules}
                      setCustomRules={setCustomRules}
                      isAdmin={accessCode === 'saw_vlogs_2026'}
                      onOpenTools={() => setActiveTab('tools')}
                      onDeleteGlobalRule={handleDeleteGlobalRule}
                      showCustomRules={false}
                    />

                    {/* Voice Selection Dropdown */}
                    <div className="bg-white/50 backdrop-blur dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[32px] p-8 shadow-2xl transition-colors duration-300">
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

                    <OutputPreview 
                      result={result} 
                      isLoading={isLoading} 
                      globalVolume={config.volume}
                      isAdmin={isAccessGranted}
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

                      <div className="flex flex-col items-center gap-3">
                        <button
                          onClick={handleGenerate}
                          disabled={isLoading}
                          className={`w-full py-6 rounded-[24px] font-bold text-xl shadow-2xl flex items-center justify-center gap-4 transition-all active:scale-[0.98] bg-brand-purple hover:bg-brand-purple/90 text-white shadow-brand-purple/40`}
                        >
                          {isLoading ? (
                            <div className="w-8 h-8 border-4 border-white/20 border-t-white rounded-full animate-spin" />
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
                        
                        <div className="flex items-center gap-2 text-[10px] sm:text-xs font-bold uppercase tracking-widest">
                          {getApiKeySource() === 'personal' ? (
                            <span className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded-lg border border-emerald-500/20">
                              <Key size={14} /> Using Personal Key
                            </span>
                          ) : getApiKeySource() === 'admin' ? (
                            <span className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500/10 text-amber-600 dark:text-amber-400 rounded-lg border border-amber-500/20">
                              <ShieldCheck size={14} /> Using Admin Key
                            </span>
                          ) : (
                            <span className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500/10 text-red-600 dark:text-red-400 rounded-lg border border-red-500/20">
                              <AlertCircle size={14} /> No API Key Configured
                            </span>
                          )}
                        </div>
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
                          <h2 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white truncate">User ID: {accessCode}</h2>
                          <span className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider w-fit mx-auto sm:mx-0 ${accessCode === 'saw_vlogs_2026' ? 'bg-amber-500/20 text-amber-600' : 'bg-brand-purple/20 text-brand-purple'}`}>
                            {accessCode === 'saw_vlogs_2026' ? 'Master Admin' : 'VIP Member'}
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
        initialKey={localApiKey || ''}
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
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

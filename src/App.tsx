import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { AlertCircle, Wand2, Key, Settings, User, LogIn, LogOut, ShieldCheck, ShieldAlert, Shield, CheckCircle2, XCircle, History, Wrench, Plus, Trash2, Download, Play, Music, FileText, Eye, EyeOff, Cloud, RefreshCw, Zap, X, ExternalLink, Calendar, Clock, Mail, Wifi, Save, Lock, Info, ArrowRight } from 'lucide-react';
import { Header } from './components/Header';
import { ContentInput } from './components/ContentInput';
import { PronunciationRules } from './components/PronunciationRules';
import { VoiceConfig } from './components/VoiceConfig';
import { OutputPreview } from './components/OutputPreview';
import { MiniAudioPlayer } from './components/MiniAudioPlayer';
import { AdminDashboard } from './components/AdminDashboard';
import { GeminiTTSService } from './services/geminiService';
import { TTSConfig, AudioResult, PronunciationRule, HistoryItem, GlobalSettings, AuthorizedUser, SystemConfig } from './types';
import { DEFAULT_RULES } from './constants';
import { pcmToWav } from './utils/audioUtils';
import { db, storage, auth, signInAnonymously, signOut, onAuthStateChanged, doc, getDoc, getDocFromServer, setDoc, updateDoc, onSnapshot, handleFirestoreError, OperationType, collection, query, where, orderBy, addDoc, deleteDoc, getDocs, limit, ref, uploadString, getDownloadURL } from './firebase';

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

  // Sign in anonymously is restricted in the console, so we skip it for now.
  // The app will function in bypass mode using localStorage for the API Key.
  
  const [newApiKey, setNewApiKey] = useState('');
  const [localApiKey, setLocalApiKey] = useState<string | null>(localStorage.getItem('vbs_gemini_api_key'));
  const [isUpdatingKey, setIsUpdatingKey] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [profile, setProfile] = useState<AuthorizedUser | null>(null);
  const [globalSettings, setGlobalSettings] = useState<GlobalSettings>({
    allow_global_key: false,
    total_generations: 0
  });
  const [systemConfig, setSystemConfig] = useState<SystemConfig | null>(null);

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

  // Auth & Access State (Custom)
  const [accessCodeInput, setAccessCodeInput] = useState('');
  const [isAccessGranted, setIsAccessGranted] = useState(true); // Default to true for preview environment
  const [isVerifyingCode, setIsVerifyingCode] = useState(false);
  const [accessCode, setAccessCode] = useState<string | null>('preview-user');

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
          
          // Recreate session document if auth is ready
          if (auth.currentUser) {
            try {
              await setDoc(doc(db, 'sessions', auth.currentUser.uid), {
                accessCode: code,
                createdAt: new Date().toISOString()
              });
            } catch (e) {
              console.error('Failed to recreate session:', e);
            }
          }
          
          // Sync API Key from Firestore to LocalStorage if missing locally
          if (data.api_key_stored && !localStorage.getItem('vbs_gemini_api_key')) {
            localStorage.setItem('vbs_gemini_api_key', data.api_key_stored);
            setLocalApiKey(data.api_key_stored);
          }
        } else {
          handleLogout();
        }
      }).catch(err => {
        console.error('Failed to restore profile:', err);
      });
    }
  }, [isAuthReady]);

  // Listen for Global Settings
  useEffect(() => {
    if (!isAccessGranted || !isAuthReady) return;
    
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
    if (!isAccessGranted || !isAuthReady) return;
    
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
      setError('Please enter your Access Code (User ID).');
      return;
    }

    setIsVerifyingCode(true);
    setError(null);

    try {
      console.log('Attempting public fetch for Access Code:', code);
      // Requirement 2: Direct Document Match using getDocFromServer for maximum reliability
      const codeDoc = await getDocFromServer(doc(db, 'authorized_users', code));
      
      if (!codeDoc.exists()) {
        console.warn('Access Code not found in authorized_users collection');
        setError('Invalid Access Code. Please contact Admin for authorization.');
        return;
      }

      const codeData = codeDoc.data() as AuthorizedUser;
      // Requirement 3: If document exists AND isActive is true, grant access immediately
      if (!codeData.isActive) {
        console.warn('Access Code is inactive');
        setError('This Access Code has been deactivated.');
        return;
      }

      // Create a session document to link the anonymous UID to the access code for secure Firestore rules
      if (auth.currentUser) {
        try {
          await setDoc(doc(db, 'sessions', auth.currentUser.uid), {
            accessCode: code,
            createdAt: new Date().toISOString()
          });
        } catch (sessionErr) {
          console.error('Failed to create session document:', sessionErr);
          // Continue anyway, but rules might block some reads
        }
      }

      // Success
      setIsAccessGranted(true);
      setAccessCode(code);
      setProfile(codeData);
      
      // Sync API Key from Firestore to LocalStorage if present
      if (codeData.api_key_stored) {
        localStorage.setItem('vbs_gemini_api_key', codeData.api_key_stored);
        setLocalApiKey(codeData.api_key_stored);
      }
      
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
    localStorage.removeItem('vbs_access_granted');
    localStorage.removeItem('vbs_access_code');
    localStorage.removeItem('vbs_gemini_api_key');
    setLocalApiKey(null);
    setActiveTab('generate');
  };

  const handleUpdateApiKey = async () => {
    if (!accessCode || !newApiKey.trim()) return;
    const keyToSave = newApiKey.trim();
    setIsUpdatingKey(true);
    setConnectionStatus('idle');
    try {
      // 1. Save to LocalStorage immediately so the app can function
      localStorage.setItem('vbs_gemini_api_key', keyToSave);
      setLocalApiKey(keyToSave);
      
      // 2. Try to sync with Firestore
      try {
        await setDoc(doc(db, 'authorized_users', accessCode), {
          api_key_stored: keyToSave
        }, { merge: true });
      } catch (firestoreErr) {
        console.warn('Could not sync API key to Firestore (Silent Fallback):', firestoreErr);
        // We don't throw here so the user can still use the app with the local key
      }
      
      setNewApiKey('');
      setToast({ message: 'Key Saved! 🎉', type: 'success' });
      setTimeout(() => setToast(null), 3000);
      
      const ttsService = new GeminiTTSService(keyToSave);
      const isValid = await ttsService.verifyConnection();
      setConnectionStatus(isValid ? 'success' : 'error');
    } catch (err: any) {
      console.error('Save API Key Error:', err);
      setToast({ message: 'Failed to update API Key', type: 'error' });
      setTimeout(() => setToast(null), 3000);
    } finally {
      setIsUpdatingKey(false);
    }
  };

  const handleRemoveApiKey = async () => {
    if (!accessCode) return;
    setIsUpdatingKey(true);
    setConnectionStatus('idle');
    try {
      // 1. Clear local storage immediately
      localStorage.removeItem('vbs_gemini_api_key');
      setLocalApiKey(null);

      // 2. Try to update Firestore
      try {
        await setDoc(doc(db, 'authorized_users', accessCode), {
          api_key_stored: ""
        }, { merge: true });
      } catch (firestoreErr) {
        console.warn('Could not remove API key from Firestore (Silent Fallback):', firestoreErr);
      }
      
      // 3. Clear input field
      setNewApiKey('');
      
      // 4. Show notification
      setToast({ message: 'API Key Removed', type: 'success' });
      setTimeout(() => setToast(null), 3000);
    } catch (err: any) {
      console.error('Remove API Key Error:', err);
      setToast({ message: 'Failed to remove API Key', type: 'error' });
      setTimeout(() => setToast(null), 3000);
    } finally {
      setIsUpdatingKey(false);
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

  const handleVerifyConnection = async () => {
    const effectiveKey = getEffectiveApiKey();
    if (!effectiveKey) return;
    
    setConnectionStatus('testing');
    try {
      const ttsService = new GeminiTTSService(effectiveKey);
      const isValid = await ttsService.verifyConnection();
      setConnectionStatus(isValid ? 'success' : 'error');
    } catch (err) {
      setConnectionStatus('error');
    }
  };

  const maskApiKey = (key: string | undefined) => {
    if (!key) return 'Not Set';
    if (showApiKey) return key;
    return `${key.substring(0, 8)}...${key.substring(key.length - 4)}`;
  };

  const getEffectiveApiKey = useCallback(() => {
    // Priority 0: Local Storage (for immediate sync and persistence as requested)
    if (localApiKey) return localApiKey;

    if (!profile) return null;
    
    // 1. Personal Key Priority
    if (profile.api_key_stored) {
      return profile.api_key_stored;
    }
    
    // 2. Fallback to Global System Key (if enabled)
    if (globalSettings.allow_global_key && globalSettings.global_system_key) {
      return globalSettings.global_system_key;
    }
    
    return null;
  }, [profile, globalSettings, localApiKey]);

  const handleUpdateGlobalSettings = async (updates: Partial<GlobalSettings>) => {
    try {
      await updateDoc(doc(db, 'settings', 'global'), updates);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, 'settings/global');
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

    const effectiveKey = getEffectiveApiKey();
    // We don't block if key is missing anymore, the service will fallback to mock
    
    setIsLoading(true);
    setError(null);
    setResult(null);

    console.log("App: Starting voiceover generation process...");

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
    const wavBlob = pcmToWav(bytes, 24000);
    const url = URL.createObjectURL(wavBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename.replace('.mp3', '.wav');
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
      <Header 
        isDarkMode={isDarkMode} 
        toggleTheme={() => setIsDarkMode(!isDarkMode)} 
        onOpenTools={() => setActiveTab('tools')}
        isAccessGranted={isAccessGranted}
        onLogout={handleLogout}
      />

      <main className="flex-1 container mx-auto px-4 sm:px-6 py-6 sm:py-8 overflow-x-hidden">
        {isConfigLoading ? (
          <div className="flex flex-col items-center justify-center py-40">
            <RefreshCw size={48} className="text-brand-purple animate-spin mb-4" />
            <p className="text-slate-500 font-medium">Initializing Narration Engine...</p>
          </div>
        ) : isAdminRoute ? (
          <AdminDashboard isAuthReady={isAuthReady} />
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
                    className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl pl-12 pr-4 py-4 text-lg font-mono text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-purple/50 transition-all"
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
            <div className="flex items-center gap-2 sm:gap-4 bg-white/50 backdrop-blur dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800 p-1 rounded-2xl w-fit mx-auto shadow-sm">
              <button
                onClick={() => setActiveTab('generate')}
                className={`px-4 sm:px-6 py-2.5 rounded-xl text-xs sm:text-sm font-bold transition-all flex items-center gap-2 ${activeTab === 'generate' ? 'bg-brand-purple text-white shadow-lg' : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-300'}`}
              >
                <Wand2 size={18} /> Generate
              </button>
              <button
                onClick={() => setActiveTab('history')}
                className={`px-4 sm:px-6 py-2.5 rounded-xl text-xs sm:text-sm font-bold transition-all flex items-center gap-2 ${activeTab === 'history' ? 'bg-brand-purple text-white shadow-lg' : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-300'}`}
              >
                <History size={18} /> History
              </button>
              <button
                onClick={() => setActiveTab('tools')}
                className={`px-4 sm:px-6 py-2.5 rounded-xl text-xs sm:text-sm font-bold transition-all flex items-center gap-2 relative ${activeTab === 'tools' ? 'bg-brand-purple text-white shadow-lg' : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-300'}`}
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
                    <ContentInput text={text} setText={setText} />
                    
                    {/* Default Pronunciation Rules Table */}
                    <PronunciationRules
                      rules={DEFAULT_RULES}
                      globalRules={globalRules}
                      customRules={customRules}
                      setCustomRules={setCustomRules}
                      isAdmin={profile?.role === 'admin'}
                      onOpenTools={() => setActiveTab('tools')}
                      showCustomRules={false}
                    />

                    <OutputPreview result={result} isLoading={isLoading} />

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
                  <div className="bg-white/50 backdrop-blur dark:bg-slate-900/50 rounded-2xl p-8 shadow-2xl border border-slate-200 dark:border-slate-800 transition-colors duration-300">
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
                          className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl px-6 py-3 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand-purple/50 transition-all pr-12 placeholder:text-slate-400"
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
                      <div className="text-center py-24 bg-slate-50 dark:bg-black/20 rounded-3xl border border-dashed border-slate-200 dark:border-white/5">
                        <div className="w-16 h-16 bg-white dark:bg-white/5 rounded-full flex items-center justify-center mx-auto mb-4 text-slate-400 dark:text-slate-600">
                          <History size={32} />
                        </div>
                        <h3 className="text-lg font-bold text-slate-900 dark:text-slate-400">No results found</h3>
                        <p className="text-slate-500 dark:text-slate-600 text-sm mt-1">Try adjusting your search or generate something new!</p>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 gap-4">
                        {filteredHistory.map((item) => (
                          <div key={item.id} className="group bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 transition-all hover:bg-slate-100 dark:hover:bg-slate-800 hover:border-brand-purple/30">
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
                  <div className="bg-white/50 backdrop-blur dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-8 shadow-2xl transition-colors duration-300">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                      <div className="flex items-center gap-3">
                        <Key size={20} className="text-brand-purple" />
                        <h3 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white">Gemini API Key</h3>
                      </div>
                      <div className={`flex items-center gap-2 text-[10px] sm:text-[11px] font-bold uppercase tracking-widest ${localApiKey ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                        <div className={`w-2.5 h-2.5 rounded-full ${localApiKey ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`} />
                        {localApiKey ? 'CONNECTED' : 'DISCONNECTED'}
                      </div>
                    </div>

                    <div className="space-y-4">
                      <div className="space-y-2">
                        <label htmlFor="gemini-api-key" className="block text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest px-1">
                          Personal API Key Configuration
                        </label>
                        <div className="relative group">
                          <input
                            id="gemini-api-key"
                            type={showApiKey ? "text" : "password"}
                            value={localApiKey || newApiKey}
                            onChange={(e) => !localApiKey && setNewApiKey(e.target.value)}
                            readOnly={!!localApiKey}
                            placeholder={localApiKey ? "••••••••••••••••" : "Enter your Gemini API Key..."}
                            className={`w-full border rounded-2xl px-4 sm:px-6 py-3.5 sm:py-4 text-base sm:text-lg font-mono transition-all pr-12 sm:pr-14 focus:outline-none focus:ring-2 focus:ring-brand-purple/50 ${
                              localApiKey 
                                ? 'bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 cursor-not-allowed' 
                                : 'bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white placeholder:text-slate-400'
                            }`}
                          />
                          <button
                            type="button"
                            onClick={() => setShowApiKey(!showApiKey)}
                            aria-label={showApiKey ? "Hide API Key" : "Show API Key"}
                            title={showApiKey ? "Hide API Key" : "Show API Key"}
                            className="absolute right-3 sm:right-4 top-1/2 -translate-y-1/2 p-2.5 text-slate-400 hover:text-brand-purple dark:hover:text-brand-purple transition-all focus:outline-none focus:ring-2 focus:ring-brand-purple/50 rounded-xl bg-white/10 backdrop-blur-sm border border-transparent hover:border-brand-purple/20"
                          >
                            {showApiKey ? <EyeOff size={18} /> : <Eye size={18} />}
                          </button>
                        </div>
                      </div>

                      <div className="flex flex-col sm:flex-row gap-3">
                        {!localApiKey ? (
                          <button
                            onClick={handleUpdateApiKey}
                            disabled={isUpdatingKey || !newApiKey.trim()}
                            className="w-full sm:flex-1 py-3.5 sm:py-4 bg-brand-purple text-white rounded-2xl font-bold text-sm hover:bg-brand-purple/90 transition-all shadow-xl shadow-brand-purple/20 flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer active:scale-95"
                          >
                            {isUpdatingKey ? <RefreshCw size={18} className="animate-spin" /> : <Save size={18} />}
                            Save API Key
                          </button>
                        ) : (
                          <div className="hidden sm:flex sm:flex-1" />
                        )}
                        
                        {localApiKey && (
                          <button
                            onClick={() => {
                              if (confirm('Are you sure you want to remove your API key?')) {
                                handleRemoveApiKey();
                              }
                            }}
                            disabled={isUpdatingKey}
                            className="w-full sm:w-auto px-6 py-3.5 sm:py-4 bg-slate-100 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 rounded-2xl flex items-center justify-center hover:bg-red-500/10 hover:text-red-500 hover:border-red-500/20 transition-all disabled:opacity-50"
                          >
                            {isUpdatingKey ? <RefreshCw size={20} className="animate-spin" /> : <Trash2 size={20} />}
                          </button>
                        )}
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

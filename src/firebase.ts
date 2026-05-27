import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged, signInAnonymously, User as FirebaseUser, browserLocalPersistence, setPersistence } from 'firebase/auth';
import { initializeFirestore, doc, getDoc, setDoc, updateDoc, onSnapshot, getDocFromServer, collection, query, where, orderBy, addDoc, deleteDoc, getDocs, limit, serverTimestamp, Timestamp, increment } from 'firebase/firestore';
import { getStorage, ref, uploadBytes, getDownloadURL, uploadString } from 'firebase/storage';

// Import the Firebase configuration
import defaultFirebaseConfig from '../firebase-applet-config.json';

// Dynamic configuration logic
const getFirebaseConfig = () => {
  const savedConfig = localStorage.getItem('vbs_system_config');
  if (savedConfig) {
    try {
      const parsed = JSON.parse(savedConfig);
      // Only use saved config if it doesn't contain placeholder "remixed" values
      const isPlaceholder = (val: string) => !val || val.includes('remixed-') || val.includes('TODO_');
      
      if (!isPlaceholder(parsed.firebase_project_id) && !isPlaceholder(parsed.firebase_api_key)) {
        return {
          apiKey: parsed.firebase_api_key,
          authDomain: parsed.firebase_auth_domain,
          projectId: parsed.firebase_project_id,
          appId: parsed.firebase_app_id,
          firestoreDatabaseId: defaultFirebaseConfig.firestoreDatabaseId
        };
      } else {
        console.warn('Saved Firebase config contains placeholders, falling back to default.');
        localStorage.removeItem('vbs_system_config');
      }
    } catch (e) {
      console.error('Failed to parse saved firebase config', e);
    }
  }
  return defaultFirebaseConfig;
};

const firebaseConfig = getFirebaseConfig();

// Validate Firebase config
interface FirebaseConfig {
  apiKey?: string;
  authDomain?: string;
  projectId?: string;
  appId?: string;
  [key: string]: string | undefined;
}

const validateConfig = (config: FirebaseConfig) => {
  const required = ['apiKey', 'authDomain', 'projectId', 'appId'];
  const missing = required.filter(key => !config[key]);
  if (missing.length > 0) {
    console.error('Missing Firebase config keys:', missing);
    console.log('Current config keys available:', Object.keys(config));
    return false;
  }
  console.log('Firebase projectId:', config.projectId);
  return true;
};

if (!validateConfig(firebaseConfig)) {
  console.error('Firebase config incomplete — check firebase-applet-config.json or system settings');
}

// Initialize Firebase SDK
const app = initializeApp(firebaseConfig);

// Use initializeFirestore with long polling to bypass potential WebSocket blocks in the preview environment
export const db = initializeFirestore(app, {
  experimentalForceLongPolling: true,
}, firebaseConfig.firestoreDatabaseId);

export const auth = getAuth(app);
setPersistence(auth, browserLocalPersistence).catch(err => {
  console.error("Failed to set auth persistence:", err);
});
export const storage = getStorage(app);
export const googleProvider = new GoogleAuthProvider();

export const getIdToken = async () => {
  if (!auth.currentUser) return null;
  return await auth.currentUser.getIdToken();
};

export function getCurrentUserId(): string | null {
  const user = auth.currentUser;
  // Previously we blocked anonymous writes here, but this app uses Access Code login
  // which leaves users technically anonymous. We must allow them to write their own docs.
  if (!user) return null;
  return user.uid;
}

export async function getUserControls(userId: string) {
  const currentUser = auth.currentUser;
  
  // Requirement: Allow fetching for authorized anonymous users
  if (!currentUser) {
    console.warn("[VBS] Skipping getUserControls — not logged in");
    return null;
  }

  try {
    const docRef = doc(db, "user_controls", userId);
    const snap = await getDoc(docRef);
    return snap.exists() ? snap.data() : null;
  } catch (err) {
    console.error("[VBS] getUserControls error:", err);
    return null;
  }
}

export { signInWithPopup, signOut, onAuthStateChanged, signInAnonymously, doc, getDoc, setDoc, updateDoc, onSnapshot, getDocFromServer, collection, query, where, orderBy, addDoc, deleteDoc, getDocs, limit, ref, uploadBytes, getDownloadURL, uploadString, serverTimestamp, Timestamp, increment };
export type { FirebaseUser };

// Test connection to Firestore
async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if(error instanceof Error && error.message.includes('the client is offline')) {
      console.error("Please check your Firebase configuration. ");
    }
  }
}
testConnection();

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid || 'anonymous',
      email: auth.currentUser?.email || null,
      emailVerified: auth.currentUser?.emailVerified || false,
      isAnonymous: auth.currentUser?.isAnonymous || true,
      tenantId: auth.currentUser?.tenantId || null,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

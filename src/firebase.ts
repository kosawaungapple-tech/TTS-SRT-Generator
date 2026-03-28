import { initializeApp } from 'firebase/app';
import { getAuth, signOut, onAuthStateChanged, signInAnonymously, User as FirebaseUser } from 'firebase/auth';
import { initializeFirestore, doc, getDoc, setDoc, updateDoc, onSnapshot, getDocFromServer, collection, query, where, orderBy, addDoc, deleteDoc, getDocs, limit, deleteField } from 'firebase/firestore';
import { getStorage, ref, uploadBytes, getDownloadURL, uploadString } from 'firebase/storage';

// Import the Firebase configuration
import defaultFirebaseConfig from '../firebase-applet-config.json';

/**
 * COMMANDER'S ORDER: PASTE YOUR FIREBASE CREDENTIALS HERE
 * This will override the default configuration.
 */
const manualFirebaseConfig = {
  apiKey: "PASTE_YOUR_API_KEY_HERE",
  authDomain: "PASTE_YOUR_AUTH_DOMAIN_HERE",
  projectId: "PASTE_YOUR_PROJECT_ID_HERE",
  storageBucket: "PASTE_YOUR_STORAGE_BUCKET_HERE",
  messagingSenderId: "PASTE_YOUR_MESSAGING_SENDER_ID_HERE",
  appId: "PASTE_YOUR_APP_ID_HERE",
  measurementId: "PASTE_YOUR_MEASUREMENT_ID_HERE"
};

// Dynamic configuration logic
const getFirebaseConfig = () => {
  // Check if manual config is provided (not using placeholders)
  const isManualProvided = manualFirebaseConfig.apiKey !== "PASTE_YOUR_API_KEY_HERE";
  
  if (isManualProvided) {
    return {
      ...manualFirebaseConfig,
      firestoreDatabaseId: defaultFirebaseConfig.firestoreDatabaseId // Keep the database ID from the environment
    };
  }

  // Fallback to default config
  return defaultFirebaseConfig;
};

const firebaseConfig = getFirebaseConfig();

// Initialize Firebase SDK
const app = initializeApp(firebaseConfig);

// Use initializeFirestore with long polling to bypass potential WebSocket blocks in the preview environment
export const db = initializeFirestore(app, {
  experimentalForceLongPolling: true,
}, firebaseConfig.firestoreDatabaseId);

export const auth = getAuth(app);
export const storage = getStorage(app);

export const getIdToken = async () => {
  if (!auth.currentUser) return null;
  return await auth.currentUser.getIdToken();
};

export { signOut, onAuthStateChanged, signInAnonymously, doc, getDoc, setDoc, updateDoc, onSnapshot, getDocFromServer, collection, query, where, orderBy, addDoc, deleteDoc, getDocs, limit, ref, uploadBytes, getDownloadURL, uploadString, deleteField };
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
  // Silence permission errors for the master admin to avoid console noise
  const isMasterAdmin = localStorage.getItem('vbs_access_code') === 'saw_vlogs_2026' || localStorage.getItem('vbs_isAdmin') === 'true';
  const isPermissionError = error instanceof Error && error.message.includes('Missing or insufficient permissions');
  
  if (isMasterAdmin && isPermissionError) {
    // Silently log for debugging but don't throw or show red errors
    console.debug(`[Firestore Permission Silenced] ${operationType} on ${path}`);
    return;
  }

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

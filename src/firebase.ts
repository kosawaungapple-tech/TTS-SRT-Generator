import { initializeApp } from 'firebase/app';
import { getAuth, signOut, onAuthStateChanged, signInAnonymously, User as FirebaseUser } from 'firebase/auth';
import { initializeFirestore, doc, getDoc, setDoc, updateDoc, onSnapshot, getDocFromServer, collection, query, where, orderBy, addDoc, deleteDoc, getDocs, limit, deleteField, increment } from 'firebase/firestore';
import { getStorage, ref, uploadBytes, getDownloadURL, uploadString } from 'firebase/storage';
import { safeStorage } from './utils/safeBrowser';

// Import the Firebase configuration
import firebaseConfig from '../firebase-applet-config.json';

// Initialize Firebase SDK
const app = initializeApp(firebaseConfig);

// Use initializeFirestore with long polling to bypass potential WebSocket blocks in the preview environment
export const db = initializeFirestore(app, {
  experimentalForceLongPolling: true,
}, firebaseConfig.firestoreDatabaseId);

export const auth = getAuth(app);
export const storage = getStorage(app);

export const getIdToken = async () => {
  // 1. If we already have a user, return the token
  if (auth.currentUser) {
    try {
      return await auth.currentUser.getIdToken(true); // Force refresh to be safe
    } catch (e) {
      console.warn("getIdToken: Failed to get token from current user, trying re-auth", e);
    }
  }

  // 2. Try to sign in anonymously if no user
  try {
    console.log("getIdToken: Attempting anonymous sign-in...");
    const credential = await signInAnonymously(auth);
    if (credential.user) {
      console.log("getIdToken: Anonymous sign-in successful");
      return await credential.user.getIdToken();
    }
  } catch (e: any) {
    if (e.code === 'auth/admin-restricted-operation') {
      console.error("getIdToken: CRITICAL - Anonymous Auth is DISABLED in Firebase Console. Please enable it in Authentication > Sign-in method.");
    } else {
      console.warn("getIdToken: Anonymous sign-in attempt failed:", e);
    }
  }

  // 3. Fallback: Wait for auth to settle with retries
  console.log("getIdToken: Waiting for auth state to settle...");
  for (let i = 0; i < 3; i++) {
    const user = await new Promise<FirebaseUser | null>((resolve) => {
      const unsubscribe = onAuthStateChanged(auth, (user) => {
        if (user) {
          unsubscribe();
          resolve(user);
        }
      });
      setTimeout(() => {
        unsubscribe();
        resolve(null);
      }, 1500); // Wait 1.5s per attempt
    });

    if (user) return await user.getIdToken();
    if (auth.currentUser) return await auth.currentUser.getIdToken();
    
    // If it failed, try signing in again
    try {
      await signInAnonymously(auth);
    } catch (e) {}
  }

  console.error("getIdToken: FAILED - No authenticated user found. API calls will fail.");
  return null;
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
  let isMasterAdmin = false;
  try {
    isMasterAdmin = safeStorage.getItem('vbs_access_code') === 'saw_vlogs_2026' || safeStorage.getItem('vbs_isAdmin') === 'true';
  } catch (e) {
    // Ignore storage errors in restricted environments
  }
  
  const isPermissionError = error instanceof Error && error.message.includes('Missing or insufficient permissions');
  const isReadOperation = operationType === OperationType.GET || operationType === OperationType.LIST;
  
  if (isMasterAdmin && isPermissionError && isReadOperation) {
    // Silently log for debugging but don't throw or show red errors for READS
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

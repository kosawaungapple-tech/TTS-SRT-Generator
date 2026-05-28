import { db, addDoc, collection, doc, updateDoc, getDoc, serverTimestamp, handleFirestoreError, OperationType, getCurrentUserId } from '../firebase';
import { ActivityLog, VBSUserControl } from '../types';

/**
 * Logs a user activity to Firestore and updates user usage summary.
 * Wrapped in robust try/catch to prevent breaking the caller.
 */
export const logActivity = async (vbsId: string, type: ActivityLog['type'], details: string) => {
  // Guard: Never write with anonymous or null user
  const userId = getCurrentUserId();
  if (!userId) {
    console.warn('[VBS] Skipping activity log — user not authenticated or anonymous');
    return;
  }

  try {
    const now = new Date();
    const today = now.toDateString();

    // 1. Add detailed log
    try {
      await addDoc(collection(db, 'activity_logs'), {
        vbsId: vbsId || 'unknown',
        type,
        details: details || '',
        createdAt: serverTimestamp()
      });
    } catch (logErr) {
      // Use standard error handler but don't re-throw to caller for logging
      try {
        handleFirestoreError(logErr, OperationType.CREATE, 'activity_logs');
      } catch {
        // Just consume the thrown error from handleFirestoreError
      }
    }

    // 2. Update summary in user_controls
    try {
      // Owner bypass for usage tracking
      if (vbsId === 'saw_vlogs_2026') return;

      const userRef = doc(db, 'user_controls', vbsId);
      const userDoc = await getDoc(userRef);
      
      if (userDoc.exists()) {
        const data = userDoc.data() as VBSUserControl;
        const isNewDay = data.lastUsedDate !== today;
        
        const updates: Partial<VBSUserControl> = {
          updatedAt: serverTimestamp(),
          lastUsedDate: today
        };

        if (type === 'login') {
          updates.lastLoginAt = serverTimestamp();
        } else {
          // Increment daily usage for TTS, Transcription, etc.
          const currentTasks = isNewDay ? 0 : (data.dailyUsage || 0);
          updates.dailyUsage = currentTasks + 1;
        }

        await updateDoc(userRef, updates);
      }
    } catch (updateErr) {
      try {
        handleFirestoreError(updateErr, OperationType.UPDATE, `user_controls/${vbsId}`);
      } catch {
        // Consume
      }
    }
  } catch (globalErr) {
    console.error('Fatal error in activity logging:', globalErr);
  }
};

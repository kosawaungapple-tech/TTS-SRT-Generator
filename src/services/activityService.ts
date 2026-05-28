import { db, addDoc, collection, doc, updateDoc, getDoc, serverTimestamp } from '../firebase';
import { ActivityLog, VBSUserControl } from '../types';

export const logActivity = async (vbsId: string, type: ActivityLog['type'], details: string) => {
  try {
    const now = new Date();
    const today = now.toDateString();

    // 1. Add detailed log
    await addDoc(collection(db, 'activity_logs'), {
      vbsId,
      type,
      details,
      createdAt: serverTimestamp()
    });

    // 2. Update summary in user_controls
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
  } catch (_err) {
    console.error('Failed to log activity:', _err);
  }
};

import { db, addDoc, collection, doc, updateDoc, getDoc } from '../firebase';
import { ActivityLog, VBSUserControl } from '../types';

export const logActivity = async (vbsId: string, type: ActivityLog['type'], details: string) => {
  try {
    const now = new Date();
    const today = now.toDateString();
    const isoString = now.toISOString();

    // 1. Add detailed log
    await addDoc(collection(db, 'activity_logs'), {
      vbsId,
      type,
      details,
      createdAt: isoString
    });

    // 2. Update summary in user_controls
    const userRef = doc(db, 'user_controls', vbsId);
    const userDoc = await getDoc(userRef);
    
    if (userDoc.exists()) {
      const data = userDoc.data() as VBSUserControl;
      const isNewDay = data.lastUsedDate !== today;
      
      const updates: any = {
        updatedAt: now,
        lastUsedDate: today
      };

      if (type === 'login') {
        updates.lastLoginAt = isoString;
      } else {
        // Increment daily tasks for TTS, Transcription, etc.
        const currentTasks = isNewDay ? 0 : (data.dailyTasks || 0);
        updates.dailyTasks = currentTasks + 1;
      }

      await updateDoc(userRef, updates);
    }
  } catch (err) {
    console.error('Failed to log activity:', err);
  }
};

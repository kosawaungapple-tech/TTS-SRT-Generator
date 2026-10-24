import { db, doc, getDoc, updateDoc, increment, handleFirestoreError, OperationType, getCurrentUserId } from '../firebase';

export type CreditAction = 'video' | 'tts' | 'rewrite';

export const OWNER_VBS_ID = 'saw_vlogs_2026';

export async function getActionCost(action: CreditAction): Promise<number> {
  try {
    const settingsDoc = await getDoc(doc(db, "settings", "credits"));
    if (!settingsDoc.exists()) {
      // Fallback to defaults
      const defaults = { video: 5, tts: 2, rewrite: 2 };
      return defaults[action];
    }
    const data = settingsDoc.data();
    const costMap = {
      video: data?.videoRecapCost ?? 5,
      tts: data?.ttsGenerationCost ?? 2,
      rewrite: data?.aiRewriteCost ?? 2,
    };
    return costMap[action];
  } catch (error) {
    console.error("Error fetching action cost:", error);
    const defaults = { video: 5, tts: 2, rewrite: 2 };
    return defaults[action];
  }
}

export async function checkAndDeductCredits(vbsId: string, action: CreditAction): Promise<{ success: boolean; message?: string; cost?: number }> {
  // Owner always bypasses
  if (vbsId === OWNER_VBS_ID) return { success: true };

  // Guard: Never write with anonymous or null user
  const authUserId = getCurrentUserId();
  if (!authUserId) {
    console.warn('[VBS] Skipping credit deduction — user not authenticated or anonymous');
    return { success: true }; 
  }

  try {
    const cost = await getActionCost(action);
    const userRef = doc(db, "user_controls", vbsId);
    const userSnap = await getDoc(userRef);
    
    if (!userSnap.exists()) {
      return { success: false, message: "User account not found." };
    }

    const currentCredits = userSnap.data()?.credits ?? 0;

    if (currentCredits < cost) {
      return { success: false, message: "Credits မလုံလောက်ပါ။ Credits ထပ်ဖြည့်ပါ။", cost };
    }

    try {
      await updateDoc(userRef, {
        credits: increment(-cost)
      });
    } catch (err) {
       handleFirestoreError(err, OperationType.UPDATE, `user_controls/${vbsId}`);
       throw err; 
    }

    return { success: true, cost };
  } catch (error) {
    console.error("Error checking/deducting credits:", error);
    return { success: false, message: "Credit check failed. Please try again." };
  }
}

export async function giveWelcomeCredits(vbsId: string): Promise<void> {
  // Owner doesn't need credits as they bypass checks
  if (vbsId === OWNER_VBS_ID) return;

  // Guard: Never write with anonymous or null user
  const authUserId = getCurrentUserId();
  if (!authUserId) {
    console.warn('[VBS] Skipping welcome credits — user not authenticated or anonymous');
    return;
  }

  try {
    const settingsDoc = await getDoc(doc(db, "settings", "credits"));
    const welcomeCredits = settingsDoc.data()?.newPremiumWelcomeCredits ?? 20;
    
    const userRef = doc(db, "user_controls", vbsId);
    await updateDoc(userRef, {
      credits: increment(welcomeCredits)
    });
    console.log(`[VBS] Awarded ${welcomeCredits} welcome credits to ${vbsId}`);
  } catch (error) {
    console.error("Error awarding welcome credits:", error);
  }
}

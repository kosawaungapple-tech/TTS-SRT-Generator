rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // Owner/admin has full access
    match /{document=**} {
      allow read, write: if request.auth != null 
        && request.auth.uid == "saw_vlogs_2026";
    }

    // Users can only read/write their own document (legacy users collection)
    match /users/{userId} {
      allow read, write: if request.auth != null 
        && request.auth.uid == userId;
    }

    match /user_controls/{vbsId} {
      // Required for handleLogin to perform verification
      allow get: if request.auth != null;
      
      // Master admin can list all controls
      allow list: if request.auth != null && (
        exists(/databases/$(database)/documents/sessions/$(request.auth.uid)) && 
        get(/databases/$(database)/documents/sessions/$(request.auth.uid)).data.accessCode == "saw_vlogs_2026"
      );

      // Normal read/update if session matches
      allow read, update: if request.auth != null && (
        (exists(/databases/$(database)/documents/sessions/$(request.auth.uid)) && 
         get(/databases/$(database)/documents/sessions/$(request.auth.uid)).data.accessCode == vbsId) ||
        (exists(/databases/$(database)/documents/sessions/$(request.auth.uid)) && 
         get(/databases/$(database)/documents/sessions/$(request.auth.uid)).data.accessCode == "saw_vlogs_2026")
      );
      
      // Allow initial creation by any auth user (e.g. self-registration if allowed)
      allow create: if request.auth != null;
      
      // Delete only by master admin
      allow delete: if request.auth != null && (
         exists(/databases/$(database)/documents/sessions/$(request.auth.uid)) && 
         get(/databases/$(database)/documents/sessions/$(request.auth.uid)).data.accessCode == "saw_vlogs_2026"
      );
    }

    // Admin stats — anyone authenticated can log usage
    match /adminKeyStats/{keyId} {
      allow read: if request.auth != null;
      allow write: if request.auth != null;
    }

    // Settings — only owner can write
    match /settings/{doc} {
      allow read: if request.auth != null;
      allow write: if request.auth != null && (
        exists(/databases/$(database)/documents/sessions/$(request.auth.uid)) && 
        get(/databases/$(database)/documents/sessions/$(request.auth.uid)).data.accessCode == "saw_vlogs_2026"
      );
    }
    
    // Activity logs - Users can write if authenticated
    match /activity_logs/{logId} {
      allow create: if request.auth != null;
      allow read: if request.auth != null && (
        exists(/databases/$(database)/documents/sessions/$(request.auth.uid)) && 
        get(/databases/$(database)/documents/sessions/$(request.auth.uid)).data.accessCode == "saw_vlogs_2026"
      );
    }

    // Global Rules - only owner can write
    match /globalRules/{ruleId} {
      allow read: if request.auth != null;
      allow write: if request.auth != null && (
        exists(/databases/$(database)/documents/sessions/$(request.auth.uid)) && 
        get(/databases/$(database)/documents/sessions/$(request.auth.uid)).data.accessCode == "saw_vlogs_2026"
      );
    }

    // History - Users can read their own
    match /history/{id} {
      allow read: if request.auth != null && (
        (exists(/databases/$(database)/documents/sessions/$(request.auth.uid)) && 
         get(/databases/$(database)/documents/sessions/$(request.auth.uid)).data.accessCode == resource.data.userId) ||
        (exists(/databases/$(database)/documents/sessions/$(request.auth.uid)) && 
         get(/databases/$(database)/documents/sessions/$(request.auth.uid)).data.accessCode == "saw_vlogs_2026")
      );
      allow create: if request.auth != null;
      allow delete: if request.auth != null && (
        (exists(/databases/$(database)/documents/sessions/$(request.auth.uid)) && 
         get(/databases/$(database)/documents/sessions/$(request.auth.uid)).data.accessCode == resource.data.userId) ||
        (exists(/databases/$(database)/documents/sessions/$(request.auth.uid)) && 
         get(/databases/$(database)/documents/sessions/$(request.auth.uid)).data.accessCode == "saw_vlogs_2026")
      );
    }
    
    // Admin Channels - only owner can read/write
    match /admin_channels/{channelId} {
      allow read, write: if request.auth != null && (
        exists(/databases/$(database)/documents/sessions/$(request.auth.uid)) && 
        get(/databases/$(database)/documents/sessions/$(request.auth.uid)).data.accessCode == "saw_vlogs_2026"
      );
    }

    // Sessions - Users can write their own
    match /sessions/{userId} {
      allow read, write: if request.auth != null
        && request.auth.uid == userId;
    }
    
    // System Config - owner only
    match /system_config/{doc} {
      allow read, write: if request.auth != null && (
        exists(/databases/$(database)/documents/sessions/$(request.auth.uid)) && 
        get(/databases/$(database)/documents/sessions/$(request.auth.uid)).data.accessCode == "saw_vlogs_2026"
      );
    }
  }
}

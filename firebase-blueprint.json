{
  "entities": {
    "User": {
      "title": "User Profile",
      "description": "Stores user account information including their role and API key.",
      "type": "object",
      "properties": {
        "uid": { "type": "string", "description": "The unique user ID from Firebase Auth." },
        "email": { "type": "string", "format": "email", "description": "The user's email address." },
        "displayName": { "type": "string", "description": "The user's display name." },
        "photoURL": { "type": "string", "description": "The user's profile picture URL." },
        "role": { "type": "string", "enum": ["admin", "user"], "description": "The user's role in the system." },
        "api_key_stored": { "type": "string", "description": "The user's personal Google AI Studio API Key." },
        "is_verified": { "type": "boolean", "description": "Whether the user has been manually verified by an admin." },
        "pending_verification": { "type": "boolean", "description": "Whether the user has requested activation." },
        "createdAt": { "type": "string", "format": "date-time" },
        "lastSignInAt": { "type": "string", "format": "date-time" }
      },
      "required": ["uid", "email", "role"]
    },
    "ApiChannel": {
      "title": "API Key Channel",
      "description": "An admin-managed API key channel for rotation and sharing.",
      "type": "object",
      "properties": {
        "id": { "type": "string" },
        "key": { "type": "string" },
        "status": { "type": "string", "enum": ["active", "idle", "limit"] },
        "label": { "type": "string" },
        "createdAt": { "type": "string", "format": "date-time" }
      },
      "required": ["id", "key", "status"]
    },
    "PronunciationRule": {
      "title": "Pronunciation Rule",
      "description": "A rule for phonetic mapping.",
      "type": "object",
      "properties": {
        "id": { "type": "string" },
        "original": { "type": "string" },
        "replacement": { "type": "string" },
        "createdBy": { "type": "string" },
        "createdAt": { "type": "string", "format": "date-time" }
      },
      "required": ["original", "replacement"]
    },
    "HistoryItem": {
      "title": "History Item",
      "description": "A record of a generated voiceover with storage links.",
      "type": "object",
      "properties": {
        "id": { "type": "string" },
        "userId": { "type": "string" },
        "userEmail": { "type": "string", "format": "email" },
        "text": { "type": "string", "description": "Truncated text for preview." },
        "audioStorageUrl": { "type": "string", "description": "Firebase Storage URL for the audio file." },
        "srtStorageUrl": { "type": "string", "description": "Firebase Storage URL for the SRT file." },
        "srtContent": { "type": "string", "description": "Optional small SRT content." },
        "createdAt": { "type": "string", "format": "date-time" },
        "config": { "type": "object" }
      },
      "required": ["userId", "audioStorageUrl", "srtStorageUrl", "createdAt"]
    },
    "AuthorizedUser": {
      "title": "Authorized User (Access Code)",
      "description": "A record of an authorized Access Code for the system.",
      "type": "object",
      "properties": {
        "id": { "type": "string", "description": "The Access Code itself." },
        "userId": { "type": "string", "description": "The User ID (same as Access Code)." },
        "password": { "type": "string", "description": "The user's password." },
        "expiryDate": { "type": "string", "format": "date-time", "description": "The subscription expiry date." },
        "role": { "type": "string", "enum": ["admin", "user"], "description": "The user's role." },
        "label": { "type": "string", "description": "Optional name/label for the ID." },
        "isActive": { "type": "boolean", "description": "Whether the ID is active." },
        "createdAt": { "type": "string", "format": "date-time" },
        "createdBy": { "type": "string", "description": "UID of the admin who created it." }
      },
      "required": ["id", "isActive", "createdAt", "role"]
    },
    "VBSUserControl": {
      "title": "VBS User Control",
      "description": "Granular control for individual VBS User IDs.",
      "type": "object",
      "properties": {
        "vbsId": { "type": "string" },
        "dailyUsage": { "type": "number" },
        "lastUsedDate": { "type": "string" },
        "isUnlimited": { "type": "boolean" },
        "isBlocked": { "type": "boolean" },
        "membershipStatus": { "type": "string", "enum": ["standard", "premium"] },
        "credits": { "type": "number", "description": "Remaining credits for transactions." },
        "videosGeneratedToday": { "type": "number", "description": "Number of videos generated today." },
        "dailyVideoLimit": { "type": "number", "description": "Maximum allowed videos per day." },
        "lastVideoDate": { "type": "string", "description": "The date of the last video generation (YYYY-MM-DD)." },
        "admin_override_active": { "type": "boolean", "description": "Whether an admin has overridden the daily limit." },
        "expiryDate": { "type": "string", "format": "date" },
        "updatedAt": { "type": "string", "format": "date-time" },
        "lastLoginAt": { "type": "string", "format": "date-time" }
      },
      "required": ["vbsId", "dailyUsage", "lastUsedDate", "isUnlimited", "isBlocked"]
    },
    "GlobalSettings": {
      "title": "Global Settings",
      "description": "System-wide settings for API keys and monitoring.",
      "type": "object",
      "properties": {
        "allow_admin_keys": { "type": "boolean" },
        "total_generations": { "type": "number" },
        "api_keys": { "type": "array", "items": { "type": "string" } },
        "primary_key": { "type": "string" },
        "secondary_key": { "type": "string" },
        "backup_key": { "type": "string" },
        "welcome_credits": { "type": "number", "description": "Default credits for new premium users." },
        "recap_cost": { "type": "number", "description": "Credits cost for video-to-text recap." },
        "tts_cost": { "type": "number", "description": "Credits cost for text-to-speech generation." }
      }
    },
    "Session": {
      "title": "User Session",
      "description": "Transient session information linking Auth UID to Access Code.",
      "type": "object",
      "properties": {
        "accessCode": { "type": "string" },
        "createdAt": { "type": "string", "format": "date-time" }
      },
      "required": ["accessCode", "createdAt"]
    },
    "ActivityLog": {
      "title": "Activity Log",
      "description": "System activity logs for auditing.",
      "type": "object",
      "properties": {
        "vbsId": { "type": "string" },
        "type": { "type": "string" },
        "details": { "type": "string" },
        "createdAt": { "type": "string", "format": "date-time" }
      },
      "required": ["vbsId", "type", "details", "createdAt"]
    },
    "AdminKeyStats": {
      "title": "Admin API Key Stats",
      "description": "Activity statistics for a specific Admin API Key.",
      "type": "object",
      "properties": {
        "totalRequests": { "type": "number" },
        "rateLimitCount": { "type": "number" },
        "lastUsed": { "type": "string", "format": "date-time" },
        "lastStatus": { "type": "string", "enum": ["success", "rate_limited", "error"] },
        "updatedAt": { "type": "string", "format": "date-time" }
      }
    },
    "CreditSettings": {
      "title": "Credit Costs",
      "description": "System-wide credit costs for AI features.",
      "type": "object",
      "properties": {
        "videoRecapCost": { "type": "integer" },
        "ttsGenerationCost": { "type": "integer" },
        "aiRewriteCost": { "type": "integer" },
        "newPremiumWelcomeCredits": { "type": "integer" },
        "updatedAt": { "type": "string", "format": "date-time" }
      }
    },
    "SystemConfig": {
      "title": "System Configuration",
      "description": "Global system configuration for Firebase and Telegram.",
      "type": "object",
      "properties": {
        "firebase_project_id": { "type": "string" },
        "firebase_api_key": { "type": "string" },
        "firebase_auth_domain": { "type": "string" },
        "firebase_app_id": { "type": "string" },
        "telegram_bot_token": { "type": "string" },
        "telegram_chat_id": { "type": "string" },
        "updatedAt": { "type": "string", "format": "date-time" }
      }
    }
  },
  "firestore": {
    "/users/{userId}": {
      "schema": "User",
      "description": "User profile document."
    },
    "/settings/global": {
      "schema": "GlobalSettings",
      "description": "Global system settings."
    },
    "/settings/credits": {
      "schema": "CreditSettings",
      "description": "System-wide credit costs and welcome gifts."
    },
    "/globalRules/{ruleId}": {
      "schema": "PronunciationRule",
      "description": "Global pronunciation rules set by admins."
    },
    "/history/{historyId}": {
      "schema": "HistoryItem",
      "description": "Generation history for users."
    },
    "/vlogs_users/{accessCode}": {
      "schema": "AuthorizedUser",
      "description": "Authorized Access Codes for the system."
    },
    "/user_controls/{vbsId}": {
      "schema": "VBSUserControl",
      "description": "Granular control for individual VBS User IDs."
    },
    "/system_config/main": {
      "schema": "SystemConfig",
      "description": "Global system configuration for Firebase and Telegram."
    },
    "/sessions/{uid}": {
      "schema": "Session",
      "description": "Auth session mapping."
    },
    "/activity_logs/{logId}": {
      "schema": "ActivityLog",
      "description": "System activity logs."
    },
    "/adminKeyStats/{keyId}": {
      "schema": "AdminKeyStats",
      "description": "Stats for each admin key."
    },
    "/admin_channels/{channelId}": {
      "schema": "ApiChannel",
      "description": "Admin API key channels for the global pool."
    }
  }
}

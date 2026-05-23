
export type Language = 'mm' | 'en';

export const translations = {
  // Navigation Tabs
    nav: {
      generate: { en: "Generate Voice", mm: "အသံထုတ်ယူခြင်း" },
      translator: { en: "AI Translator", mm: "ဘာသာပြန်" },
      transcriber: { en: "Recap Video", mm: "Recap ဗီဒီယို" },
      thumbnail: { en: "Thumbnail", mm: "သမ်းနေးလ်" },
      history: { en: "History", mm: "မှတ်တမ်း" },
      studio: { en: "Studio", mm: "စတူဒီယို" },
      settings: { en: "Settings", mm: "ပြင်ဆင်ချက်" },
      admin: { en: "Admin", mm: "စီမံခန့်ခွဲသူ" }
    },
  
  // Tooltips
  tooltips: {
    generate: { en: "Audio Extraction / AI Narration", mm: "AI အသံထုတ်ယူခြင်း နှင့် ဇာတ်လမ်းပြောပြခြင်း" },
    translator: { en: "AI Translation Tool", mm: "AI ဘာသာပြန်ကိရိယာ" },
    transcriber: { en: "Video-to-Text Recap Transcription", mm: "Recap ဗီဒီယိုမှ စာသားသို့ ပြောင်းလဲခြင်း" },
    thumbnail: { en: "Create Video Thumbnails", mm: "ဗီဒီယို သမ်းနေးလ်များ ပြုလုပ်ရန်" },
    history: { en: "Your Generation History", mm: "ယခင်ပြုလုပ်ထားသော မှတ်တမ်းများ" },
    settings: { en: "Account & App Settings", mm: "အကောင့်နှင့် အက်ပ်ပြင်ဆင်ချက်များ" },
    premiumActive: { en: "Premium Access Active ✨", mm: "Premium အဆင့်မြင့်ရယူနိုင်ပါသည် ✨" }
  },

  // Auth / Welcome
  auth: {
    title: { en: "Narration Engine", mm: "Narration Engine" },
    subtitle: { en: "Please enter your unique User ID (Access Code) to start generating professional Myanmar voiceovers.", mm: "အရည်အသွေးမြင့် မြန်မာဘာသာ အသံနောက်ခံများ ဖန်တီးရန် သင်၏ User ID (Access Code) ကို ရိုက်ထည့်ပါ။" },
    placeholder: { en: "Enter Access Code...", mm: "Access Code ကို ရိုက်ထည့်ပါ..." },
    passwordPlaceholder: { en: "Enter Password...", mm: "လျှို့ဝှက်နံပါတ် ရိုက်ထည့်ပါ..." },
    continue: { en: "Continue", mm: "ရှေ့ဆက်မည်" },
    verify: { en: "Verify Access", mm: "အတည်ပြုမည်" },
    connecting: { en: "Connecting...", mm: "ချိတ်ဆက်နေသည်..." },
    invalidCode: { en: "Invalid Access Code.", mm: "Access Code မမှန်ကန်ပါ။" },
    invalidPassword: { en: "Invalid Password.", mm: "လျှို့ဝှက်နံပါတ် မမှန်ကန်ပါ။" },
    expired: { en: "Your account has expired. Please contact Admin Saw for renewal.", mm: "သင့်အကောင့် သက်တမ်းကုန်ဆုံးသွားပါပြီ။ အဆင့်မြှင့်ရန် Admin ထံ ဆက်သွယ်ပါ။" },
    deactivated: { en: "This Access Code has been deactivated.", mm: "ဤ Access Code ကို ပိတ်ထားပါသည်။" }
  },

  // Content Studio / Generate Tab
  generate: {
    inputTitle: { en: "Narration Script", mm: "ဇာတ်လမ်းစာသား" },
    inputPlaceholder: { en: "Type or paste your story content here...", mm: "ဇာတ်လမ်းစာသားများကို ဤနေရာတွင် ရိုက်ထည့်ပါ သို့မဟုတ် ကူးထည့်ပါ..." },
    generateBtn: { en: "Generate Voiceover", mm: "AI အသံထုတ်ယူမည်" },
    generating: { en: "Generating...", mm: "🔊 အသံဖိုင် ဖန်တီးနေသည်..." },
    saveToHistory: { en: "Save to History", mm: "မှတ်တမ်းသိမ်းဆည်းမည်" },
    saveToHistoryDesc: { en: "Keep a record of this generation for later access", mm: "နောင်ပြန်လည်အသုံးပြုနိုင်ရန် ဤမှတ်တမ်းကို သိမ်းဆည်းထားမည်" },
    contentStudio: { en: "Content Studio", mm: "Content Studio" },
    aiPowered: { en: "AI Powered", mm: "AI နှင့် ပံ့ပိုးထားသော" },
    engineReady: { en: "Engine: Ready", mm: "စနစ် - အသင့်ဖြစ်ပါပြီ" },
    engineCooling: { en: "Engine: Cooling Down", mm: "စနစ် - ခေတ္တအနားယူနေသည်" },
    engineLimit: { en: "Engine: Limit Reached", mm: "စနစ် - အကန့်အသတ်သို့ ရောက်နေသည်" },
    rewriteBtn: { en: "Rewrite with AI", mm: "AI နှင့် ပြန်လည်ရေးသားမည်" },
    rewriting: { en: "Rewriting...", mm: "ပြန်လည်ရေးသားနေသည်..." },
    coolingDown: { en: "Cooling down...", mm: "စောင့်ဆိုင်းနေပါသည်..." },
    copySuccess: { en: "Copied to clipboard ✨", mm: "စာသားကို ကူးယူပြီးပါပြီ ✨" },
    pasteSuccess: { en: "Text pasted from clipboard 📋", mm: "စာသားကို ထည့်သွင်းပြီးပါပြီ 📋" },
    syncingTempo: { en: "Syncing Tempo & Duration...", mm: "အနှေးအမြန်နှင့် ကြာချိန်ကို ချိန်ညှိနေပါသည်..." },
    noApiKey: { en: "No API Key found. Please add one in Settings.", mm: "API Key မရှိသေးပါ။ Settings တွင် API Key ထည့်သွင်းပါ။" },
    rewriteSuccess: { en: "Text rewritten successfully!", mm: "စာသားကို အောင်မြင်စွာ ပြန်လည်ရေးသားပြီးပါပြီ။" },
    characters: { en: "characters", mm: "စာလုံးရေ" },
    stillProcessing: { en: "Still processing, almost done...", mm: "လုပ်ဆောင်နေဆဲဖြစ်သည်၊ မကြာမီပြီးစီးတော့မည်..." },
    textTooLong: { en: "Text is too long for the selected duration.", mm: "ရွေးချယ်ထားသော ကြာချိန်အတွက် စာသားရှည်လွန်းနေပါသည်။" }
  },

  // Voice Config
  voiceConfig: {
    title: { en: "Voice Configuration", mm: "အသံချိန်ညှိချက်များ" },
    model: { en: "AI Model", mm: "AI မော်ဒယ်" },
    voice: { en: "Voice Persona", mm: "အသံရွေးချယ်ရန်" },
    speed: { en: "Speaking Speed", mm: "အသံအနှေးအမြန်" },
    pitch: { en: "Voice Pitch", mm: "အသံအနိမ့်အမြင့်" },
    volume: { en: "Volume", mm: "အသံပမာဏ" },
    style: { en: "Narration Style Instructions", mm: "အသံနေအထား ညွှန်ကြားချက်" },
    stylePlaceholder: { en: "e.g. Angry, Excited, Professional...", mm: "ဥပမာ - Angry, Excited, Professional..." },
    changesApplyNext: { en: "Changes will apply to the next generation.", mm: "ပြုပြင်ပြောင်းလဲမှုများသည် နောက်တစ်ကြိမ် ထုတ်ယူမှသာ သက်ရောက်မည်ဖြစ်သည်။" },
    styles: {
      warm: { en: "Warm", mm: "နွေးထွေးသော" },
      professional: { en: "Professional", mm: "ကျွမ်းကျင်သော" },
      excited: { en: "Excited", mm: "စိတ်လှုပ်ရှားသော" },
      angry: { en: "Angry", mm: "ဒေါသထွက်သော" },
      sad: { en: "Sad", mm: "ဝမ်းနည်းဖွယ်" },
      whisper: { en: "Whisper", mm: "တိုးတိုးလေး" },
      calm: { en: "Calm", mm: "တည်ငြိမ်သော" },
      energetic: { en: "Energetic", mm: "တက်ကြွသော" },
      storytelling: { en: "Storytelling", mm: "ဇာတ်လမ်းပြောပြဟန်" },
      serious: { en: "Serious", mm: "လေးနက်သော" },
      happy: { en: "Happy", mm: "ပျော်ရွှင်သော" },
      horror: { en: "Horror", mm: "ထိတ်လန့်ဖွယ်" },
      panic: { en: "Panic", mm: "ထိတ်လန့်တုန်လှုပ်သော" },
      suspense: { en: "Suspense", mm: "ရင်တထိတ်ထိတ်" }
    },
    vocalStyle: { en: "Vocal Style", mm: "အသံဟန်ပန်" },
    creativity: { en: "Creativity Level", mm: "ဖန်တီးမှုအဆင့်" },
    advanced: { en: "Advanced AI Settings", mm: "အဆင့်မြင့် AI ချိန်ညှိချက်များ" },
    grounding: { en: "Google Search Grounding", mm: "Google Search အခြေပြုမည်" },
    hiFi: { en: "High-Fidelity Audio", mm: "ကြည်လင်ပြတ်သားသော အသံ" },
    fastTrack: { en: "Fast-Track Processing", mm: "အမြန်လုပ်ဆောင်မည်" },
    vocalStyles: {
      neutral: { en: "Neutral", mm: "ပုံမှန်" },
      expressive: { en: "Expressive", mm: "ဖော်ပြချက်ကောင်းသော" },
      energetic: { en: "Energetic", mm: "တက်ကြွသော" },
      calm: { en: "Calm", mm: "တည်ငြိမ်သော" }
    },
    creativityLow: { en: "Precise & Factual", mm: "တိကျပြီး အချက်အလက်ကျသော" },
    creativityHigh: { en: "Dramatic Storytelling", mm: "ဇာတ်လမ်းဆန်သော ပြောဟန်" }
  },

  // Translator
  translator: {
    title: { en: "Video Script Translator", mm: "Video Script ဘာသာပြန်ရန်" },
    subtitle: { en: "Translate scripts into cinematic storyteller Myanmar language.", mm: "ဇာတ်လမ်းပြောဟန် မြန်မာဘာသာသို့ အလိုအလျောက် ပြောင်းလဲပေးမည်။" },
    inputPlaceholder: { en: "Paste original script here (English, Thai, etc.)...", mm: "ဘာသာပြန်လိုသော စာသားများကို ဤနေရာတွင် ထည့်ပါ..." },
    translateBtn: { en: "Translate Now", mm: "ဘာသာပြန်ဆိုမည်" },
    translating: { en: "Translating...", mm: "ဘာသာပြန်နေပါသည်..." },
    sendToGenerator: { en: "Send to Generator", mm: "Generator သို့ ပို့မည်" },
    copy: { en: "Copy Result", mm: "စာသားကူးယူမည်" },
    translatedTitle: { en: "Translated Script (Myanmar)", mm: "ဘာသာပြန်ပြီးစာသား (မြန်မာ)" },
    translatedSuccess: { en: "Translation successful!", mm: "ဘာသာပြန်ဆိုမှု အောင်မြင်ပါသည်။" },
    translatedFailed: { en: "Translation failed. Please check your connection.", mm: "ဘာသာပြန်ဆိုမှု မအောင်မြင်ပါ။" },
    sentToGenerator: { en: "Sent to Generator!", mm: "စာသားကို Generator သို့ ပို့လိုက်ပါပြီ။" }
  },

  // Video Recap
  video: {
    title: { en: "Video-to-Text Recap", mm: "ဗီဒီယိုမှ စာသားထုတ်ယူခြင်း" },
    subtitle: { en: "Upload a video file to automatically extract Myanmar text.", mm: "ဗီဒီယိုဖိုင်ကို တင်သွင်းပြီး အလိုအလျောက် စာသားထုတ်ယူပါ။" },
    premiumRequired: { en: "This is a Premium Feature. Please contact Admin to upgrade.", mm: "ဤသည်မှာ Premium သီးသန့် Feature ဖြစ်ပါသည်။ အဆင့်မြှင့်ရန် Admin ကို ဆက်သွယ်ပါ။" },
    blocked: { en: "Your User ID is blocked. Contact Admin.", mm: "သင်၏ User ID ကို ပိတ်ပင်ထားပါသည်။ Admin ကို ဆက်သွယ်ပါ။" },
    recapLocked: { en: "Premium Feature Locked 🔒", mm: "Premium Feature ကို ပိတ်ထားပါသည် 🔒" },
    videoRecapLimited: { en: "Video Recap is currently limited to Personal API Keys only. Please switch to your own key to use this feature.", mm: "Video Recap ကို မိမိကိုယ်ပိုင် API Key ဖြင့်သာ အသုံးပြုနိုင်ပါသည်။ ကျေးဇူးပြု၍ မိမိ၏ Key သို့ ပြောင်းလဲအသုံးပြုပါ။" },
    contactAdmin: { en: "Please send your User ID to Admin for approval.", mm: "အသုံးပြုလိုပါက သင်၏ User ID ကို Admin ထံပေးပို့၍ ခွင့်ပြုချက်တောင်းခံပါ။" },
    yourUserId: { en: "Your User ID:", mm: "သင်၏ User ID:" },
    dragDrop: { en: "Drag & Drop Video", mm: "ဗီဒီယိုဖိုင်အား ဤနေရာသို့ ဆွဲထည့်ပါ" },
    supportFormats: { en: "Support MP4, MOV, AVI. Max 20MB recommended.", mm: "MP4, MOV, AVI ဖိုင်များ ရရှိနိုင်ပါသည်။ အများဆုံး 20MB အထိ အကြံပြုပါသည်။" },
    dropToUpload: { en: "Drop to Upload", mm: "တင်ရန် လွှတ်ချလိုက်ပါ" },
    transcribeBtn: { en: "Transcribe Video", mm: "စာသားထုတ်ယူမည်" },
    transcribing: { en: "Transcribing...", mm: "စာသားထုတ်ယူနေသည်..." },
    aiListening: { en: "AI is listening to your video...", mm: "AI မှ ဗီဒီယိုကို နားထောင်နေပါသည်..." },
    success: { en: "Transcription & Translation successful! ✨", mm: "ဗီဒီယိုမှ မြန်မာဘာသာသို့ ပြန်ဆိုပြီးပါပြီ ✨" },
    onlyVideos: { en: "Only video files are supported.", mm: "ဗီဒီယိုဖိုင်များသာ လက်ခံပါသည်။" },
    premiumActive: { en: "Premium Access Active ✨", mm: "Premium အသုံးပြုခွင့် ရရှိထားပါသည် ✨" }
  },

  // Output Preview
  output: {
    title: { en: "AI Narrator Studio", mm: "AI Narrator Studio" },
    premiumOutput: { en: "Premium Output", mm: "Premium Output" },
    generating: { en: "AI Narrator is crafting your voice...", mm: "🔊 အသံဖိုင် ဖန်တီးနေသည်..." },
    tuning: { en: "Fine-tuning the cinematic tone and synchronizing every millisecond.", mm: "အသံနေအထားနှင့် အချိန်ကိုက်မှုများကို အကောင်းဆုံးဖြစ်အောင် ချိန်ညှိနေပါသည်။" },
    emptyTitle: { en: "Output Preview", mm: "Output Preview" },
    emptySubtitle: { en: "Generated audio and subtitles will appear here after you click generate.", mm: "အသံနှင့် စာတန်းထိုးများကို ထုတ်ယူပြီးပါက ဤနေရာတွင် မြင်တွေ့ရမည်ဖြစ်သည်။" },
    srtPreview: { en: "Subtitle Preview (SRT)", mm: "စာတန်းထိုး နမူနာ (SRT)" },
    downloadMp3: { en: "Download MP3", mm: "MP3 ရယူမည်" },
    downloadSrt: { en: "Download SRT", mm: "SRT ရယူမည်" }
  },

  history: {
    title: { en: "Generation History", mm: "ယခင်မှတ်တမ်းများ" },
    subtitle: { en: "Manage and re-download your previous professional narrations", mm: "ယခင်ထုတ်ယူထားသော အသံဖိုင်များကို စီမံခန့်ခွဲပြီး ပြန်လည်ရယူပါ" },
    search: { en: "Search history...", mm: "မှတ်တမ်းများကို ရှာဖွေရန်..." },
    delete: { en: "Delete History", mm: "မှတ်တမ်းဖျက်ရန်" },
    noHistory: { en: "No generation history found.", mm: "မှတ်တမ်းများ မရှိသေးပါ။" },
    noResults: { en: "No results found", mm: "ရှာဖွေမှုရလဒ် မတွေ့ပါ" },
    adjustSearch: { en: "Try adjusting your search or start generating professional voiceovers now!", mm: "ရှာဖွေမှုစကားလုံးကို ပြောင်းလဲကြည့်ပါ သို့မဟုတ် အသံဖိုင်အသစ်များ စတင်ထုတ်ယူလိုက်ပါ" },
    loading: { en: "Loading your history...", mm: "မှတ်တမ်းများကို ရယူနေပါသည်..." },
    copyText: { en: "Copy Text", mm: "စာသားကူးယူရန်" },
    play: { en: "Load to Player", mm: "Player သို့ ပို့မည်" },
    clearScript: { en: "Clear Script", mm: "စာသားများဖျက်မည်" }
  },

  // Common / UI
  common: {
    loading: { en: "Loading", mm: "ဆောင်ရွက်နေပါသည်" },
    error: { en: "Error", mm: "အမှားအယွင်း" },
    success: { en: "Success", mm: "အောင်မြင်ပါသည်" }
  },

  // Settings / Admin
  settings: {
    title: { en: "Account Settings", mm: "အကောင့်ပြင်ဆင်ချက်များ" },
    logout: { en: "Logout", mm: "ထွက်မည်" },
    apiKey: { en: "Personal API Key", mm: "မိမိ၏ API Key" },
    theme: { en: "App Theme", mm: "Theme ပြောင်းရန်" },
    dark: { en: "Dark Mode", mm: "Dark Mode" },
    light: { en: "Light Mode", mm: "Light Mode" },
    privacy: { en: "Privacy Policy", mm: "ကိုယ်ရေးအချက်အလက် ထိန်းသိမ်းမှု မူဝါဒ" },
    terms: { en: "Terms of Service", mm: "ဝန်ဆောင်မှုဆိုင်ရာ စည်းကမ်းချက်များ" },
    expiry: { en: "Expiry", mm: "သက်တမ်း" },
    expiryDate: { en: "Expiry Date", mm: "သက်တမ်းကုန်ရက်" },
    accountStatus: { en: "Account Level", mm: "အဖွဲ့ဝင်အဆင့်" },
    unlimited: { en: "Unlimited", mm: "အကန့်အသတ်မရှိ" },
    standardUser: { en: "User", mm: "အသုံးပြုသူ" }
  },

  // Admin Dashboard
  admin: {
    title: { en: "Admin Control Center", mm: "ဗဟိုထိန်းချုပ်ရေးဌာန" },
    subtitle: { en: "Manage Authorized Access Codes (User IDs)", mm: "ခွင့်ပြုထားသော Access Code (User ID) များကို စီမံခန့်ခွဲရန်" },
    authTitle: { en: "Authorized Access Only", mm: "စီမံခန့်ခွဲသူများသာ အသုံးပြုနိုင်ပါသည်" },
    authSubtitle: { en: "Please enter the administrative access code to continue.", mm: "ဆက်လက်ဆောင်ရွက်ရန် စီမံခန့်ခွဲသူ ကုဒ်ကို ရိုက်ထည့်ပါ။" },
    enterCode: { en: "Enter Access Code", mm: "Access Code ရိုက်ထည့်ပါ" },
    unlockBtn: { en: "Unlock Dashboard", mm: "Dashboard ဖွင့်မည်" },
    logout: { en: "Logout", mm: "ထွက်မည်" },
    userManagement: { en: "User Management", mm: "အသုံးပြုသူ စီမံခန့်ခွဲခြင်း" },
    systemSettings: { en: "System Settings", mm: "System ချိန်ညှိချက်များ" },
    idSettings: { en: "ID Management", mm: "User ID စီမံခန့်ခွဲခြင်း" },
    pronunciationRules: { en: "Pronunciation Rules", mm: "အသံထွက် ချိန်ညှိချက်များ" },
    createUser: { en: "Create New User ID", mm: "User ID အသစ်ပြုလုပ်ရန်" },
    idLabel: { en: "Access ID / Code", mm: "Access ID / ကုဒ်" },
    noteLabel: { en: "User Note / Name", mm: "မှတ်ချက် / အမည်" },
    roleLabel: { en: "User Role", mm: "အသုံးပြုသူ အဆင့်" },
    expiryLabel: { en: "Expiry Date (Optional)", mm: "သက်တမ်းကုန်ဆုံးရက် (မထည့်လည်းရ)" },
    passwordLabel: { en: "Password", mm: "လျှို့ဝှက်နံပါတ်" },
    createBtn: { en: "Create ID", mm: "ID ပြုလုပ်မည်" },
    userList: { en: "Authorized User IDs", mm: "ခွင့်ပြုထားသော User ID များ" },
    searchIds: { en: "Search by ID or Note...", mm: "ID သို့မဟုတ် မှတ်ချက်ဖြင့် ရှာရန်..." },
    id: { en: "Account ID", mm: "ID နှင့် အခြေအနေ" },
    details: { en: "User Details", mm: "အသုံးပြုသူ အချက်အလက်" },
    note: { en: "Note", mm: "မှတ်ချက်" },
    usage: { en: "Usage Stats", mm: "အသုံးပြုမှု" },
    membership: { en: "Level & Expiry", mm: "သက်တမ်းနှင့် အဆင့်" },
    actions: { en: "Actions", mm: "ပြင်ဆင်ရန်" },
    active: { en: "Active", mm: "အသုံးပြုနေဆဲ" },
    deactivated: { en: "Deactivated", mm: "ရပ်ဆိုင်းထားသည်" },
    noUsers: { en: "No users found matching your search.", mm: "ရှာဖွေမှုနှင့် ကိုက်ညီသော အသုံးပြုသူ မတွေ့ပါ" },
    registeredUsers: { en: "Registered Users", mm: "မှတ်ပုံတင်ထားသော အသုံးပြုသူများ" },
    user: { en: "User", mm: "အသုံးပြုသူ" },
    verification: { en: "Verification", mm: "အတည်ပြုချက်" },
    joined: { en: "Joined", mm: "စတင်ဝင်ရောက်သည့်နေ့" },
    lastActivity: { en: "Last Activity", mm: "နောက်ဆုံးလှုပ်ရှားမှု" },
    extend30Days: { en: "Extend 30 Days", mm: "ရက် ၃၀ တိုးမည်" },
    setCustomExpiry: { en: "Set Custom Expiry", mm: "သက်တမ်းကုန်ရက် သတ်မှတ်မည်" },
    updatePassword: { en: "Update Password", mm: "စကားဝှက် ပြောင်းမည်" },
    toggleVIP: { en: "Toggle VIP/Unlimited Hub", mm: "VIP/အကန့်အသတ်မဲ့ ပြောင်းမည်" },
    resetUsage: { en: "Reset Daily Usage", mm: "နေ့စဉ်အသုံးပြုမှု ပြန်စမည်" },
    toggleRole: { en: "Toggle Role", mm: "အခန်းကဏ္ဍ ပြောင်းမည်" },
    deactivate: { en: "Deactivate", mm: "ရပ်ဆိုင်းရန်" },
    activate: { en: "Activate", mm: "ပြန်ဖွင့်ရန်" },
    stats: { en: "Statistics", mm: "စာရင်းအင်း" },
    totalGenerations: { en: "Total Generations", mm: "စုစုပေါင်း ထုတ်ယူမှု" },
    unlimited: { en: "Unlimited", mm: "အကန့်အသတ်မရှိ" },
    today: { en: "Today", mm: "ယနေ့" },
    adminRole: { en: "Admin", mm: "Admin" },
    userRole: { en: "User", mm: "User" },
    standard: { en: "Standard", mm: "Standard" },
    premium: { en: "Premium", mm: "Premium" },
    expiryUnlimited: { en: "No Expiry", mm: "သက်တမ်းကုန်ဆုံးရက်မရှိ" },
    expired: { en: "Expired", mm: "သက်တမ်းကုန်ပြီ" },
    tasksToday: { en: "Tasks Today", mm: "ယနေ့လုပ်ဆောင်မှု" },
    loginSuccess: { en: "Logged in as Admin.", mm: "Admin အဖြစ် ဝင်ရောက်ပြီးပါပြီ။" },
    infrastructureMode: { en: "Infrastructure Configuration Mode", mm: "အခြေခံအဆောက်အအုံ ပြင်ဆင်မှုပုံစံ" },
    firebaseTelegram: { en: "Firebase & Telegram Settings", mm: "Firebase နှင့် Telegram ချိန်ညှိချက်များ" },
    infraDesc: { en: "Configure Infrastructure Integrations", mm: "အခြေခံစနစ် ချိတ်ဆက်မှုများကို ချိန်ညှိရန်" },
    showSecrets: { en: "Show Secrets", mm: "လျှို့ဝှက်ချက်များ ပြရန်" },
    hideSecrets: { en: "Hide Secrets", mm: "လျှို့ဝှက်ချက်များ ဖုံးရန်" },
    firebaseConfig: { en: "Firebase Configuration", mm: "Firebase ချိန်ညှိချက်" },
    apiKeyControl: { en: "API Key Control", mm: "API Key ထိန်းချုပ်မှု" },
    systemConfig: { en: "System Configuration", mm: "စနစ် ချိန်ညှိချက်" },
    apiKeyRotation: { en: "API Key Rotation & Switch", mm: "API Key အလှည့်ကျစနစ်" },
    apiKeyRotationDesc: { en: "Manage multiple keys for auto-switching on rate limits", mm: "Rate Limit ဖြစ်ပေါ်ပါက Key များ အလိုအလျောက် ပြောင်းလဲသောအစီအစဉ်" },
    allowAdminKeys: { en: "Allow Users to use Admin API Keys", mm: "Admin Key များကို အသုံးပြုသူများ သုံးခွင့်ပေးရန်" },
    allowAdminKeysDesc: { en: "If ON, the system uses rotated Admin keys. If OFF, users must provide their own.", mm: "ဖွင့်ထားပါက Admin Key များကို သုံးပါမည်။ ပိတ်ထားပါက အသုံးပြုသူများ ကိုယ်ပိုင် Key ထည့်ရပါမည်။" },
    primaryKey: { en: "Primary API Key", mm: "ပင်မ API Key" },
    secondaryKey: { en: "Secondary API Key", mm: "ဒုတိယ API Key" },
    backupKey: { en: "Backup API Key", mm: "အရန် API Key" },
    keyRotationDesc: { en: "The system will automatically rotate through these keys if a Rate Limit (429) occurs.", mm: "Rate Limit (429) ဖြစ်ပေါ်ပါက စနစ်မှ ဤ Key များကို အလိုအလျောက် လှည့်ပတ်အသုံးပြုပါမည်။" },
    adminFeatureControl: { en: "Admin Feature Control", mm: "အဆင့်မြင့် လုပ်ဆောင်ချက် ထိန်းချုပ်မှု" },
    allowVideoRecapAdmin: { en: "Allow Video Recap with Admin Key", mm: "Admin Key ဖြင့် Video Recap ခွင့်ပြုမည်" },
    allowThumbnailAdmin: { en: "Thumbnail Generator Access", mm: "Thumbnail Generator Access" },
    useAdminPremiumKey: { en: "Use Admin Premium Key", mm: "Admin Premium Key ကို အသုံးပြုရန်" },
    saveSettings: { en: "Save Settings", mm: "ချိန်ညှိချက်များ သိမ်းမည်" },
    standby: { en: "Standby", mm: "အရန်သင့်" },
    backup1: { en: "Backup 1", mm: "အရန် ၁" },
    backup2: { en: "Backup 2", mm: "အရန် ၂" },
    tabUsers: { en: "Users", mm: "အသုံးပြုသူများ" },
    tabSystem: { en: "System", mm: "စနစ်" },
    tabRules: { en: "Rules", mm: "စည်းမျဉ်းများ" },
    tabAnnouncements: { en: "Announcements", mm: "ကြေညာချက်များ" },
  },

  // Thumbnail Access
  thumbnailFeature: {
    locked: { en: "Premium Feature Locked 🔒", mm: "Premium Feature — Admin ဖွင့်ပေးမှသာ အသုံးပြုနိုင်သည်" },
    premiumRequired: { en: "Premium Access Required", mm: "Premium Access လိုအပ်သည်" },
    temporarilyDisabled: { en: "Temporarily Disabled — Please wait", mm: "ယာယီပိတ်ထားသည် — ခဏစောင့်ပါ" }
  },

  // Welcome Page
  welcome: {
    title: { en: "Vlogs By Saw AI Audio Generation System", mm: "Vlogs By Saw AI အသံဖန်တီးမှု စနစ်" },
    subtitle: { en: "The best AI technology for Burmese Storytelling, TTS and Video Recap.", mm: "Burmese Storytelling, TTS နှင့် Video Recap များအတွက် အကောင်းဆုံး AI နည်းပညာ။" },
    description: { en: "Experience high-quality narration with cutting-edge AI technology. Specially designed for Burmese narration.", mm: "Experience high-quality narration with cutting-edge AI technology. မြန်မာစကားပြော အသံဖန်တီးမှုများအတွက် အထူးပြုလုပ်ထားပါသည်။" },
    feature1Title: { en: "Natural Voices", mm: "သဘာဝကျသော အသံများ" },
    feature2Title: { en: "Expert Translation", mm: "ကျွမ်းကျင်စွာ ဘာသာပြန်ဆိုမှု" },
    feature3Title: { en: "4x Faster Processing", mm: "၄ ဆ ပိုမိုမြန်ဆန်သော လုပ်ဆောင်ချက်" },
    startBtn: { en: "Get Started", mm: "စတင်အသုံးပြုမည်" }
  },

  // Pronunciation Rules
  rules: {
    title: { en: "Pronunciation Rules", mm: "အသံထွက် ချိန်ညှိချက်များ" },
    subtitle: { en: "Built-in Engine Rules", mm: "စနစ်တွင် ပါဝင်ပြီးသား စည်းမျဉ်းများ" },
    manage: { en: "Manage Rules", mm: "စည်းမျဉ်းများ ပြင်ဆင်ရန်" },
    view: { en: "View Settings", mm: "ချိန်ညှိချက်များ ကြည့်ရန်" },
    original: { en: "Original Text", mm: "မူလစာသား" },
    replacement: { en: "Replacement (Myanmar)", mm: "အစားထိုးရန် (မြန်မာ)" },
    global: { en: "Global", mm: "အားလုံးအတွက်" },
    custom: { en: "Custom User Rules", mm: "ကိုယ်ပိုင် စည်းမျဉ်းများ" },
    regexSupported: { en: "Regex supported. Format: \"Original -> Replacement\"", mm: "Regex ကို အသုံးပြုနိုင်သည်။ ပုံစံ - \"မူလ -> အစားထိုး\"" },
    placeholder: { en: "Example: 'Vlogs By Saw' -> 'ဗလော့ ဘိုင် စော'", mm: "ဥပမာ - 'Vlogs By Saw' -> 'ဗလော့ ဘိုင် စော'" }
  },

  // API Key Modal
  keyModal: {
    title: { en: "Settings", mm: "ဆက်တင်များ" },
    config: { en: "API Configuration", mm: "API ချိန်ညှိချက်များ" },
    label: { en: "Enter your API Key (Google AI Studio)", mm: "သင်၏ API Key ကို ဤနေရာတွင် ထည့်ပါ (Google AI Studio)" },
    placeholder: { en: "Paste your API Key here...", mm: "API Key ကို ဤနေရာတွင် ကူးထည့်ပါ..." },
    getApiKey: { en: "How to get a free API Key?", mm: "အခမဲ့ API Key မည်သို့ရယူမည်နည်း။" },
    clear: { en: "Clear Key", mm: "ဖျက်မည်" },
    save: { en: "Save & Test", mm: "သိမ်းဆည်းမည်" },
    verifying: { en: "Key Verified (Status: Active) - Settings saved!", mm: "Key စစ်ဆေးပြီးပါပြီ (အခြေအနေ - အသုံးပြုနိုင်သည်) - ဆက်တင်များကို သိမ်းဆည်းပြီးပါပြီ။" },
    invalid: { en: "Invalid API Key. Please check again.", mm: "API Key မှားယွင်းနေပါသည်။ ပြန်စစ်ပေးပါ။" },
    unexpected: { en: "An unexpected error occurred during verification.", mm: "စစ်ဆေးနေစဉ်အတွင်း အမှားတစ်ခု ဖြစ်ပေါ်ခဲ့ပါသည်။" },
    userIdLabel: { en: "Your User ID:", mm: "သင်၏ User ID:" },
    localStoreNotice: { en: "Your API Key is stored locally and never sent to our servers.", mm: "သင်၏ API Key ကို စက်ထဲတွင်သာ သိမ်းဆည်းထားပြီး မည်သည့်နေရာသို့မှ ပေးပို့မည်မဟုတ်ပါ။" }
  },

  // Error Messages
  errors: {
    rateLimit: { en: "API rate limit reached. Please wait a moment.", mm: "API limit ပြည့်နေသည် — ခဏစောင့်ပြီး ထပ်ကြိုးစားပါ" },
    connection: { en: "Connection failed. Please try again.", mm: "Gemini server error — နောက်မှ ထပ်ကြိုးစားပါ" },
    generic: { en: "Something went wrong.", mm: "တစ်ခုခု မှားယွင်းနေပါသည်" },
    audioLoadFailed: { en: "Failed to load audio from history.", mm: "မှတ်တမ်းမှ အသံဖိုင်ကို ပြန်လည်ယူရန် မအောင်မြင်ပါ။" },
    modelNotFound: { en: "AI Model not found.", mm: "အသုံးပြုမည့် AI Model ကို ရှာမတွေ့ပါ။" },
    invalidArgument: { en: "The provided information is incorrect.", mm: "ပေးထားသောအချက်အလက်များ မမှန်ကန်ပါ။ (Invalid Request)" },
    timeout: { en: "Internet connection is slow.", mm: "အင်တာနက် အဆက်အသွယ် နှေးကွေးနေပါသည်" },
    emptyScript: { en: "The narration script is empty.", mm: "စာသားအရင်ထည့်ပါ" },
    apiKey: { en: "Invalid API Key.", mm: "API Key မှားနေသည် သို့မဟုတ် ဤ feature အတွက် ခွင့်မပြုရသေး" },
    default: { en: "Something went wrong. Please wait.", mm: "တစ်ခုခု မှားယွင်းနေပါသည်" }
  },

  // Common UI
  ui: {
    confirm: { en: "Confirm", mm: "အတည်ပြုပါ" },
    cancel: { en: "Cancel", mm: "ပယ်ဖျက်ပါ" },
    save: { en: "Save Changes", mm: "သိမ်းဆည်းပါ" },
    delete: { en: "Delete", mm: "ဖျက်မည်" },
    close: { en: "Close", mm: "ပိတ်မည်" },
    speed: { en: "Speed", mm: "အမြန်နှုန်း" },
    search: { en: "Search...", mm: "ရှာဖွေရန်..." },
    dismiss: { en: "Dismiss", mm: "ပိတ်မည်" }
  }
};

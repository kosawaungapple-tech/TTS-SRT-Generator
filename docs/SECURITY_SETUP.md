# လုံခြုံရေး တင်းကြပ်ခြင်း — သင်လုပ်ရမယ့်အဆင့်များ

Code ဘက်က အဆင်သင့်ပါ။ အောက်က အဆင့်တွေကို **အစီအစဉ်အတိုင်း** လုပ်ပါ။ အဆင့် ၄ (Rules တင်ခြင်း) ကို မလုပ်မခြင်း
ဘာမှ မပြောင်းသေးပါဘူး၊ အရင်အတိုင်း ဆက်သုံးလို့ရပါတယ်။

## 1. Firebase Service Account ရယူခြင်း
1. Firebase Console → သင့် project (`directed-reporter-wkx2q`) → ⚙ Project settings → **Service accounts**
2. **Generate new private key** ကို နှိပ်ပြီး JSON ဖိုင်ကို ဒေါင်းပါ။ (ဒီဖိုင်ကို ဘယ်သူ့ကိုမှ မပေးပါနဲ့၊ GitHub မှာလည်း မတင်ပါနဲ့)
3. Vercel → Project → Settings → Environment Variables မှာ `FIREBASE_SERVICE_ACCOUNT` ဆိုတဲ့နာမည်နဲ့ အဲဒီ JSON တစ်ခုလုံးကို ကူးထည့်ပါ။

## 2. Admin password သတ်မှတ်ခြင်း
Vercel Environment Variables မှာ `ADMIN_PASSWORD` ကို ကိုယ်တိုင်ရွေးပြီး ထည့်ပါ (အနည်းဆုံး ၁၂ လုံး၊ စာလုံး/ဂဏန်း/သင်္ကေတ ရောပါ)။
ပြီးရင် Vercel မှာ **Redeploy** လုပ်ပါ။

## 3. စမ်းကြည့်ခြင်း (Rules မတင်ခင်)
- Website ကို ဖွင့်ပါ၊ `saw_vlogs_2026` ကို ရိုက်ပြီး Continue နှိပ်ရင် Password တောင်းလာရမယ်။
- အဆင့် ၂ မှာ ထည့်ထားတဲ့ ADMIN_PASSWORD နဲ့ ဝင်လို့ရရမယ်။ Admin စာမျက်နှာ (`/vbs-admin`) မှာလည်း Password ကွက်ပေါ်ပြီး ဝင်လို့ရရမယ်။
- User တစ်ယောက်ကို စမ်းဝင်ကြည့်ပါ။ အကောင့်အသစ်ဖွင့်ကြည့်ပြီး Admin မှာ Activate လုပ်ကာ ဝင်ကြည့်ပါ။
- ဒါတွေ အားလုံးအဆင်ပြေမှ အဆင့် ၄ ကို သွားပါ။

## 4. Firestore / Storage Rules တင်ခြင်း
1. Firebase Console → **Firestore Database** → **Rules** tab → repo ထဲက `firestore.rules` ရဲ့ စာသားအားလုံးကို ကူးထည့်ပြီး **Publish**။
   (Database က default မဟုတ်ဘဲ `ai-studio-…` ဆိုတဲ့ နာမည်ပါတဲ့ database ဖြစ်လို့ အဲဒီ database ကို ရွေးပြီးမှ Rules tab ကို ဖွင့်ပါ။)
2. **Storage** → **Rules** → `storage.rules` ကို ကူးထည့်ပြီး **Publish**။
3. တင်ပြီးတာနဲ့ Admin နဲ့ User နှစ်မျိုးလုံး ပြန်ဝင်ကြည့်ပါ။ တစ်ခုခု မှားရင် အရင် rules (`docs/firestore.rules.legacy`) ကို ပြန်တင်လို့ရပါတယ်။

## 5. ပြီးတဲ့နောက် မဖြစ်မနေ လုပ်ရမယ့်အရာများ
- **Admin Gemini API key တွေအားလုံးကို အသစ်လဲပါ။** အရင် rules ကြောင့် key တွေကို လူတိုင်း ဖတ်နိုင်ခဲ့လို့ ပေါက်ကြားနိုင်ပါတယ်။
  (Google AI Studio မှာ key အသစ်ဖန်တီး၊ Admin → API Channels မှာ အဟောင်းကိုဖျက်ပြီး အသစ်ထည့်)
- Firestore ထဲမှာ `user_controls/SAW-ADMIN-2026` ဆိုတဲ့ document ရှိရင် **ဖျက်ပါ။** (အရင် code က password မပါဘဲ တည်ဆောက်ထားတဲ့ admin အကောင့်ပါ။)
- User တွေရဲ့ password တွေက အရင်က စာသားအတိုင်း သိမ်းထားတာပါ။ သူတို့ ပြောင်းချင်ရင် Admin က အသစ်ပြန်သတ်မှတ်ပေးပါ။
- Vercel ရဲ့ `GEMINI_API_KEY` ကိုလည်း အသစ်လဲတာ ကောင်းပါတယ်။

## အလုပ်လုပ်ပုံ အကျဉ်း
- Login ကို Vercel server က စစ်ပါတယ်။ ID နဲ့ Password မှန်မှ Firebase token ပေးပါတယ်။ Token ထဲမှာ `vbsId` (အကောင့်) နဲ့ `admin` (Admin ဆိုမှ true) ပါပါတယ်။
- Firestore Rules က အဲဒီ token ကိုပဲ ကြည့်ပါတယ်။ ဒါကြောင့် ဘရောက်ဇာထဲက code ကို ပြင်ပြီး Admin လုပ်လို့မရတော့ပါဘူး။
- Gemini / AssemblyAI / Render server ကို server key နဲ့ သုံးတဲ့အခါ token လိုပါတယ်။ ကိုယ်ပိုင် key ထည့်ထားရင်တော့ token မလိုပါဘူး။
- PC Worker (ffmpeg) ကို ဘာမှ မထိပါဘူး။

## ကျန်နေတဲ့ အားနည်းချက်များ (အမှန်အတိုင်း)
- User တစ်ယောက်က ကိုယ့် `dailyUsage` (နေ့စဉ် အသုံးပြုမှု) ကို ကိုယ်တိုင်လျှော့ပြီး limit ကို ရှောင်နိုင်ပါသေးတယ်။ (Credits ကိုတော့ လျှော့ပဲ ရပြီး မြှင့်လို့မရပါ။)
- Login ကြိုးစားမှု ကန့်သတ်ချက်က Vercel instance တစ်ခုချင်းစီရဲ့ memory ထဲမှာပဲ ရှိလို့ လုံးဝမပိတ်နိုင်ပါဘူး (နှေးကွေးစေတာပါ)။
- Admin က User အတွက် သတ်မှတ်တဲ့ password ကို စာသားအတိုင်း သိမ်းတုန်းပါပဲ (အကောင့်အသစ် ကိုယ်တိုင်ဖွင့်တဲ့သူတွေကတော့ hash နဲ့ သိမ်းပါတယ်)။

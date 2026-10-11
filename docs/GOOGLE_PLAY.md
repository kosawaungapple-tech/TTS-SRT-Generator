# Google Play release guide – Vlogs By Saw

## 1. One-time setup
- Google Play Console developer account (US$25 one-time). New *personal* accounts must run a **closed test with 12+ testers for 14 days** before Production.
- Install Android Studio (JDK 17+).

## 2. Build the Android App Bundle (AAB)
```bash
npm install
npm run build:mobile          # vite build + cap sync
cd android
keytool -genkey -v -keystore vbs-release.jks -keyalg RSA -keysize 2048 -validity 10000 -alias vbs
# BACK UP vbs-release.jks + passwords somewhere safe. Losing it = cannot update the app.
```
Create `android/keystore.properties` (git-ignored):
```
storeFile=vbs-release.jks
storePassword=****
keyAlias=vbs
keyPassword=****
```
Then `./gradlew bundleRelease` → `android/app/build/outputs/bundle/release/app-release.aab`.
Upload to Play Console (enrol in **Play App Signing**). Before every update, increase `versionCode` in `android/app/build.gradle`.

## 3. Store listing
- App name, short (80) + full (4000) description, 512×512 icon, 1024×500 feature graphic, ≥2 phone screenshots.
- Privacy policy URL: `https://tts-srt-generator.vercel.app/privacy-policy`
- Terms URL: `https://tts-srt-generator.vercel.app/terms-of-service`
- Account deletion: in-app *Settings → Delete Account & Data*; also provide a web URL/contact email in the Data safety form.

## 4. Forms in Play Console
- **Data safety**: collects access code / user ID, usage history (stored in Firebase), text & audio/video you submit (sent to Google Gemini and AssemblyAI for processing). Data encrypted in transit; users can request deletion.
- **Content rating** questionnaire, **Target audience** (18+ recommended), **Ads**: none, **App access**: provide a test access code for reviewers.
- **AI-generated content** policy: app produces AI voice/text; include a report/feedback contact and a notice that users must have rights to the media they upload.

## 5. Payments
Selling Premium for digital features inside the app must use **Google Play Billing**. Currently access codes are issued outside the app; if the app *sells* codes or points to external payment, Play may reject it. Decide before submitting (free app / Play Billing / reader-style "login only").

## 6. Known limits of the native app
- Backend calls go to `https://tts-srt-generator.vercel.app/api/*` (needs internet).
- PC-worker video rendering (localhost) is hidden in the native app; in-browser/phone tools still work.
- Large video uploads to AssemblyAI via Vercel are limited (~4.5 MB body).

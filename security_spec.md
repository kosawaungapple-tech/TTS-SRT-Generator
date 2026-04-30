# Security Specification for VlogsBySaw TTS-Recap

## Data Invariants
1. **User Control**: Every access code must have a corresponding `user_controls` document.
2. **Session Integrity**: A session document must exist for every authenticated user who has entered a valid access code.
3. **Identity Ownership**: Users can only read and write their own `history` items based on their `accessCode`.
4. **Admin Escalation**: Only users with the master access code (`saw_vlogs_2026`) in their session can perform administrative tasks (writing to settings, rules, system config, and other users' records).
5. **System Config**: Only the `main` document in `system_config` should exist, and it must be admin-only.

## The "Dirty Dozen" Payloads (Denial Tests)

1. **Self-Promotion**: Anonymously attempting to set `role: 'admin'` in `user_controls/anonymous_user`.
2. **Settings Poisoning**: Attempting to write to `settings/global` as a standard user.
3. **Session Hijacking**: Attempting to create a `sessions` document for another user's UID.
4. **History Scraping**: Attempting to list `history` items without a valid session.
5. **History Spoofing**: Attempting to write a `history` item with another user's `userId`.
6. **Rule Tampering**: Attempting to delete or modify `globalRules` as a standard user.
7. **Control Circumvention**: Attempting to set `isUnlimited: true` on their own `user_controls` document.
8. **Admin Key Extraction**: Attempting to read `settings/global` (which contains admin API keys) without a session.
9. **Log Injection**: Attempting to write junk data to `activity_logs`.
10. **System Config Access**: Attempting to read `system_config/main`.
11. **ID Poisoning**: Attempting to use a 2MB string as a `vbsId` in `user_controls`.
12. **State Shortcutting**: Attempting to update `dailyUsage` to a negative number.

## Test Runner (firestore.rules.test.ts)

```typescript
// This is a conceptual test runner for Firebase Security Rules
// In a real environment, this would run with @firebase/rules-unit-testing

import { assertFails, assertSucceeds, initializeTestEnvironment, RulesTestEnvironment } from '@firebase/rules-unit-testing';

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'vbs-tts-recap',
    firestore: {
      rules: fs.readFileSync('firestore.rules', 'utf8'),
    },
  });
});

test('Standard anonymous user cannot read settings', async () => {
  const alice = testEnv.authenticatedContext('alice');
  await assertFails(getDoc(doc(alice.firestore(), 'settings/global')));
});

test('Master admin can read and write settings', async () => {
  const master = testEnv.authenticatedContext('master_uid');
  // Mock session doc
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'sessions/master_uid'), { accessCode: 'saw_vlogs_2026' });
  });
  await assertSucceeds(getDoc(doc(master.firestore(), 'settings/global')));
});

test('User cannot read other users controls', async () => {
  const bob = testEnv.authenticatedContext('bob');
  await assertFails(getDoc(doc(bob.firestore(), 'user_controls/alice_code')));
});
```

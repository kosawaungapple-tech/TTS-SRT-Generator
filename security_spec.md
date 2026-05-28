# Security Specification: VLOGS_BY_SAW TTS-Recap

## 1. Data Invariants
- **Users**: Only authenticated users can create their own profile. Only admins can view all profiles or manage roles.
- **Global Settings**: Only admins can read/write global settings.
- **Pronunciation Rules**: Anyone can read global rules. Only admins can create/update/delete them.
- **History Items**: Users can only read and write their own history.
- **Authorized Users (Access Codes)**: Only admins can manage access codes. Authenticated users can read their own access code document if it matches their ID.
- **User Controls**: Authenticated users can read their own control document. Only admins can modify them.
- **System Config**: Only admins can read/write system configuration.
- **Activity Logs**: Only admins can read logs. Authenticated users can write (append) logs.

## 2. The "Dirty Dozen" Payloads (Red Team Test Cases)

1. **Identity Spoofing**: Attempt to create a user profile for a different UID.
   - `CREATE /users/other-uid { uid: 'other-uid', email: 'attacker@evil.com', role: 'admin' }` -> DENIED.
2. **Privilege Escalation**: Attempt to update own role to 'admin'.
   - `UPDATE /users/my-uid { role: 'admin' }` -> DENIED.
3. **Shadow Field Injection**: Attempt to create a history item with an extra hidden field.
   - `CREATE /history/123 { userId: 'my-uid', text: '...', ghost_field: 'leak' }` -> DENIED.
4. **ID Poisoning**: Attempt to use a 2MB string as a document ID.
   - `CREATE /history/[2MB_STRING] { ... }` -> DENIED (Limit 128 chars).
5. **PII Breach**: Unauthenticated user attempts to read user emails.
   - `LIST /users` -> DENIED.
6. **Relational Orphan**: Create a history item without a valid user ID link.
   - `CREATE /history/123 { userId: 'non-existent', ... }` -> DENIED.
7. **System Field Tampering**: User attempts to update `total_generations` in global settings.
   - `UPDATE /settings/global { total_generations: 999999 }` -> DENIED.
8. **Resource Exhaustion**: Attempt to write a 2MB string into a text field.
   - `CREATE /history/123 { text: '[2MB_STRING]' }` -> DENIED (Limit 5000 chars).
9. **Timestamp Spoofing**: Attempt to set `createdAt` to a past date.
   - `CREATE /history/123 { createdAt: '1970-01-01' }` -> DENIED (Must be server time).
10. **State Bypassing**: Attempt to update an access code that is already expired.
    - `UPDATE /vlogs_users/code123 { isActive: true }` -> DENIED.
11. **Query Scraping**: Authenticated user attempts to list history items belonging to everyone.
    - `LIST /history where userId != my-uid` -> DENIED.
12. **Malicious ID Injection**: Use characters like `../` or `$` in document IDs.
    - `CREATE /users/%2E%2E%2Fsecret { ... }` -> DENIED (Regex Validation).

## 3. Test Runner (Draft)
The `firestore.rules.test.ts` will implement these checks using the `@firebase/rules-unit-testing` framework (once environment permits).

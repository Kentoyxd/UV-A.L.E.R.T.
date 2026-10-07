# UV-A.L.E.R.T. — local test guide

## What changed (this pass)

- **Login now goes through Firebase Authentication instead of MSAL.** Students and staff still sign in with their school **Microsoft 365** account — the identity provider hasn't changed — but the app now uses Firebase Auth's built-in **Microsoft (`microsoft.com`) OAuth provider** to do it, instead of talking to Azure AD directly with `@azure/msal-browser`.
  - `js/lib/msal-browser.min.js` is gone; `js/lib/firebase-auth-compat.js` (same 12.19.0 build as the other bundled Firebase compat libraries) takes its place.
  - `js/auth.js` was rewritten around `firebase.auth()`: `signInWithPopup(new firebase.auth.OAuthProvider("microsoft.com"))` instead of `msalInstance.loginPopup()`. The `UVAuth` interface (`init`, `signIn`, `signOut`, `getAccount`, `isStaff`) is unchanged, so `student.js` and `security.js` needed no edits.
  - `js/config.js`: `msalConfig` was replaced with `microsoftAuthConfig` (tenant ID + Graph scopes). `firebaseConfig` is untouched.
  - **Why this matters:** previously Firebase Auth and Microsoft sign-in were two separate, unlinked systems — Firestore/RTDB security rules had no way to verify "this request came from a signed-in UV account," so the staff check in `security.js` was a UX gate, not a security boundary (this was called out explicitly in the old README). Now that Microsoft sign-in _is_ the Firebase Auth session, rules can check `request.auth` directly. See "Recommended security rules" below.

## What changed (previous pass, still true)

- **UI**: rebuilt in the University of the Visayas green/white palette (calm baseline, red reserved for a genuinely live alarm). Mobile-first wizard for students, dense scan-first queue for security.
- **No CDN**: all vendor libraries (`firebase-app-compat`, `firebase-auth-compat`, `firebase-firestore-compat`, `firebase-database-compat`) are bundled locally under `site/js/lib/` instead of loaded from a CDN. The app works fully offline once the page itself has loaded (only actual Firebase/Microsoft API calls need network).
- `css/style.css`, `css/student.css`, `css/security.css`, `js/student.js`, `js/security.js` — unchanged from the last pass.
- The ESP32 firmware (`MyAlarmProject.ino`, `web_server.h`) is unchanged — this pass was scoped to the web app.

## Run it on localhost

No build step — it's static files.

```bash
cd uv-alert\site
python3 -m http.server 5500
# or: npx serve -l 5500
```

cd C:\UV-ALERT\uv-alert
firebase deploy --only hosting

https://uv-main-alert.web.app
Then open `http://localhost:5500/student.html` and `http://localhost:5500/security.html`.

## One-time setup before login will work

Firebase Auth's Microsoft provider needs an Azure AD app registration _and_ Firebase Console configuration linking to it. This is a bit more setup than plain MSAL (it needs a client secret, since Firebase does the token exchange server-side), but it's what gives you real `request.auth` in security rules.

1. **Azure Portal → Entra ID → App registrations → New registration**
   - Account type: "Accounts in this organizational directory only"
   - **Certificates & secrets → New client secret** — copy the secret value now, it's only shown once.
   - Leave redirect URIs for now; you'll add one in step 3.
2. **Firebase Console → Authentication → Sign-in method → Add new provider → Microsoft**
   - Paste in the **Application (client) ID** and the **client secret** from step 1.
   - Firebase will show you a redirect URI that looks like `https://<project-id>.firebaseapp.com/__/auth/handler`. Copy it.
3. Back in **Azure Portal → your app registration → Authentication → Add a platform → Web** (not SPA this time — the redirect happens server-side), and paste in the redirect URI from step 2.
4. In `js/config.js`, set `microsoftAuthConfig.tenantId` to your Azure AD tenant ID (Entra ID → Overview → Tenant ID) so sign-in is restricted to your school's tenant. Use `"organizations"` or `"common"` only if you deliberately want to allow other tenants.
5. In **Firebase Console → Authentication → Settings → Authorized domains**, make sure `localhost` is listed (it is by default) for local testing, and add your real domain before deploying.

**Firebase Firestore/Realtime Database:** these aren't restricted by domain the way Firebase Auth sign-in is — access is entirely governed by your security rules (see below).

Add a staff record so the security dashboard will let someone in:
`staff/{their-lowercased-email}` → `{ "name": "Jane Dela Cruz" }`

## Recommended security rules

Now that sign-in flows through Firebase Auth, rules can check `request.auth` instead of trusting the client. A reasonable starting point:

```
// Firestore rules
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /alerts/{alertId} {
      allow create: if request.auth != null
                    && request.auth.token.email == request.resource.data.studentEmail;
      allow read: if request.auth != null;
      allow update, delete: if request.auth != null
                             && exists(/databases/$(database)/documents/staff/$(request.auth.token.email));
    }
    match /staff/{email} {
      allow read: if request.auth != null;
      allow write: if false; // manage this collection from the Firebase Console
    }
  }
}
```

```
// Realtime Database rules — the ESP32 reads /alarm anonymously (it has
// no Firebase Auth session), so this path still needs to stay open to
// reads; writes should require a signed-in user.
{
  "rules": {
    "alarm": {
      ".read": true,
      ".write": "auth != null"
    }
  }
}
```

For purely local testing you can still use the wide-open rules from before (`allow read, write: if true;` / `".read": true, ".write": true`), but don't ship those.

## ⚠️ Still worth a look before a real deployment

- `MyAlarmProject.ino` has a real-looking Wi-Fi password in plaintext — worth swapping for a placeholder before sharing that file anywhere.
- The ESP32 firmware talks to Realtime Database anonymously (no Firebase Auth session), so the `/alarm` path's read access has to stay unauthenticated by design — keep that path narrowly scoped to just what `web_server.h`'s `pollFirebaseAlarm()` needs.
- `DEV_SKIP_LOGIN` in `js/config.js` bypasses both Microsoft and Firebase sign-in entirely for local testing — double-check it's `false` before deploying anywhere real.

## Data model (unchanged)

**Firestore**

- `alerts/{id}`: `studentName, studentEmail, building, emergencyType, emergencyLabel, details, status ("active" → "acknowledged" → "resolved", or "cancelled" if the student self-clears it), createdAt, acknowledgedAt, acknowledgedBy, resolvedAt, resolvedBy`
- `staff/{email}`: `{ name }` — allow-list gating the security dashboard

**Realtime Database**

- `/alarm`: `{ active, alertId, message }` — the single "live" record the ESP32 polls (`web_server.h`'s `pollFirebaseAlarm()`). Sending an alert sets it; resolving/cancelling clears it back to `{active:false, alertId:"", message:"SYSTEM IDLE"}`.

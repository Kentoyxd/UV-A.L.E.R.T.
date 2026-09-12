// ============================================================
// UV-A.L.E.R.T. — shared auth + Firebase bootstrap
// Loaded by both student.html and security.html, after config.js
// and the vendor scripts (firebase compat SDKs).
//
// Identity: Microsoft 365, signed in through Firebase Authentication's
// built-in "Microsoft" OAuth provider (popup flow). Firebase mints a
// real Firebase Auth session for the signed-in user, so Firestore and
// Realtime Database security rules can check request.auth — unlike the
// old MSAL-only setup, this is a real security boundary, not just a
// UX gate. See config.js for the one-time Azure AD + Firebase Console
// setup this requires, and README.md for recommended security rules.
// ============================================================

const UVAuth = (() => {
  if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
  }

  const db = firebase.firestore();
  const rtdb = firebase.database();
  const authSvc = firebase.auth();

  // Fake account used only when DEV_SKIP_LOGIN is true (see config.js).
  const DEV_ACCOUNT = { name: "Dev Tester", username: "dev.tester@uv.edu.ph" };

  function buildMicrosoftProvider() {
    const provider = new firebase.auth.OAuthProvider("microsoft.com");
    if (microsoftAuthConfig.tenantId) {
      provider.setCustomParameters({ tenant: microsoftAuthConfig.tenantId });
    }
    (microsoftAuthConfig.scopes || []).forEach((scope) => provider.addScope(scope));
    return provider;
  }

  // Normalizes a Firebase User into the { name, username } shape the
  // rest of the app expects (username = work email, used as the
  // Firestore doc id in the staff allow-list and as studentEmail).
  function toAccount(user) {
    if (!user) return null;
    return {
      name: user.displayName || user.email,
      username: (user.email || "").toLowerCase(),
      uid: user.uid,
    };
  }

  function init() {
    if (typeof DEV_SKIP_LOGIN !== "undefined" && DEV_SKIP_LOGIN) {
      return Promise.resolve(DEV_ACCOUNT);
    }
    // Firebase restores any existing session async; onAuthStateChanged
    // fires once with the current user (or null) on load.
    return new Promise((resolve) => {
      const unsubscribe = authSvc.onAuthStateChanged((user) => {
        unsubscribe();
        resolve(toAccount(user));
      });
    });
  }

  async function signIn() {
    if (typeof DEV_SKIP_LOGIN !== "undefined" && DEV_SKIP_LOGIN) {
      return DEV_ACCOUNT;
    }
    const result = await authSvc.signInWithPopup(buildMicrosoftProvider());
    return toAccount(result.user);
  }

  async function signOut() {
    if (typeof DEV_SKIP_LOGIN !== "undefined" && DEV_SKIP_LOGIN) {
      return;
    }
    await authSvc.signOut();
  }

  function getAccount() {
    if (typeof DEV_SKIP_LOGIN !== "undefined" && DEV_SKIP_LOGIN) {
      return DEV_ACCOUNT;
    }
    return toAccount(authSvc.currentUser);
  }

  // Looks up staff/{email} in Firestore. Doc id is the lowercase
  // work email, per config.js: staff/{email} = { name: "..." }.
  async function isStaff(email) {
    if (typeof DEV_SKIP_LOGIN !== "undefined" && DEV_SKIP_LOGIN) {
      return { name: "Dev Tester" };
    }
    const id = (email || "").trim().toLowerCase();
    if (!id) return false;
    const snap = await db.collection(STAFF_COLLECTION).doc(id).get();
    return snap.exists ? snap.data() : null;
  }

  return { init, signIn, signOut, getAccount, isStaff, db, rtdb };
})();
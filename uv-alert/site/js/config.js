// ============================================================
// UV-A.L.E.R.T. — deployment config
// Fill these in once per school deployment. Nothing else in the
// app needs to change.
// ============================================================

// --- TEMPORARY: skip Microsoft sign-in for local testing ---
// When true, both pages log you in as a fake account instantly
// (no Microsoft popup, no Azure app registration needed) so you can
// test the alert flow, Firestore, and the dashboard on their own.
// Set this back to false before you rely on real staff/student
// sign-in or deploy anywhere real people will use it.
const DEV_SKIP_LOGIN = false;

// --- Firebase project (Project settings > General > Your apps > SDK setup) ---
const firebaseConfig = {
  apiKey: "AIzaSyAqNljPeelGEldokzAKi-QrajQZESoJH-k",
  authDomain: "uv-main-alert.firebaseapp.com",
  databaseURL: "https://uv-main-alert-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "uv-main-alert",
  storageBucket: "uv-main-alert.firebasestorage.app",
  messagingSenderId: "26950771659",
  appId: "1:26950771659:web:09773b2055fb787c808c4e"
};

// --- Microsoft 365 sign-in, via Firebase Authentication ---
// Students and staff still sign in with their school Microsoft 365
// account — but the identity now flows through Firebase Auth's
// "Microsoft" OAuth provider instead of talking to Azure AD directly.
// This is what lets Firestore/Realtime Database security rules check
// request.auth (see README "Before this goes beyond local testing").
//
// One-time setup, both sides:
//   1. Azure Portal > Entra ID > App registrations > New registration
//        - Account type: "Accounts in this organizational directory only"
//        - Add a client secret (Certificates & secrets > New client secret)
//        - Redirect URI (Web, not SPA): the URL Firebase gives you in
//          step 2 below — looks like
//          https://<project-id>.firebaseapp.com/__/auth/handler
//   2. Firebase Console > Authentication > Sign-in method > Add provider
//      > Microsoft. Paste in the Application (client) ID and the client
//      secret from step 1, then copy the redirect URI Firebase shows you
//      back into the Azure app registration from step 1.
//   3. Fill in your tenant ID below so students/staff outside your
//      school tenant can't sign in.
const microsoftAuthConfig = {
  // Directory (tenant) ID from Azure AD, or "common" to allow any
  // Microsoft/Entra tenant to sign in (not recommended for production).
  tenantId: "33064638-3984-4354-9202-8cf6420737f4",
  // Scopes requested from Microsoft Graph. "User.Read" lets the app
  // read the signed-in user's basic profile; add more if you need them.
  scopes: ["User.Read"]
};

// --- School buildings shown on the student page ---
// Edit this list to match your campus.
const BUILDINGS = [
  "Administration Building",
  "Inday Pining Building",
  "Inday Teresing Building",
  "Inday Teresita Building",
  "Don Vincente Building",
  "Don Juan Building",
  "Quadrangle",
  "Gymnasium",
];

// --- Emergency types shown on the student page ---
const EMERGENCY_TYPES = [
  { id: "medical",  label: "Medical Emergency",  hint: "Injury, illness, someone needs medical help" },
  { id: "security", label: "Security Threat",    hint: "Intruder, fight, weapon, unsafe person" },
  { id: "general",  label: "General Emergency",  hint: "Fire, evacuation, anything else urgent" },
  { id: "elevator", label: "Stuck in Elevator",  hint: "Trapped or malfunctioning elevator" }
];

// Firebase Firestore doc path for the allow-list of security staff emails.
// Add one document per staff member: staff/{email} = { name: "..." }
const STAFF_COLLECTION = "staff";
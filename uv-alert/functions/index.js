// Sends a push notification to every registered security device
// whenever a student creates a new alert.
//
// Sends DATA-ONLY messages: firebase-messaging-sw.js builds the
// notification itself (siren vibration, requireInteraction, etc).

const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { setGlobalOptions } = require("firebase-functions/v2");
const admin = require("firebase-admin");

admin.initializeApp();

// IMPORTANT: use the same region as your Firestore database
// (Firebase Console > Firestore > Data shows the location).
// Your Realtime DB is in asia-southeast1; change this if Firestore differs.
setGlobalOptions({ region: "asia-southeast1", maxInstances: 10 });

const DEAD_TOKEN_CODES = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
  "messaging/invalid-argument",
]);

exports.notifyStaffOnAlert = onDocumentCreated("alerts/{alertId}", async (event) => {
  const snap = event.data;
  if (!snap) return;

  const alert = snap.data();
  if (alert.status !== "active") return;

  const db = admin.firestore();
  const tokenDocs = await db.collection("staffTokens").get();
  const tokens = tokenDocs.docs.map((d) => d.id);
  if (!tokens.length) {
    console.log("No staff tokens registered; nothing to send.");
    return;
  }

  const label = alert.emergencyLabel || alert.emergencyType || "Emergency";
  const data = {
    title: `🚨 ${label}`,
    body: `${alert.building || "Unknown location"} — ${alert.studentName || "A student"}`,
    alertId: event.params.alertId,
  };

  const dead = [];
  for (let i = 0; i < tokens.length; i += 500) {
    const batch = tokens.slice(i, i + 500);
    const res = await admin.messaging().sendEachForMulticast({
      tokens: batch,
      data,
      android: { priority: "high" },
      webpush: { headers: { Urgency: "high", TTL: "300" } },
    });
    res.responses.forEach((r, idx) => {
      if (!r.success && r.error && DEAD_TOKEN_CODES.has(r.error.code)) {
        dead.push(batch[idx]);
      }
    });
  }

  // Remove tokens FCM says are no longer valid.
  await Promise.all(dead.map((t) => db.collection("staffTokens").doc(t).delete()));
  console.log(`Sent to ${tokens.length - dead.length} devices, removed ${dead.length} dead tokens.`);
});
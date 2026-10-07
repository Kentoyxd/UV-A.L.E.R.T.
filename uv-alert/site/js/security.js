// ============================================================
// UV-A.L.E.R.T. — security dashboard logic
// ============================================================

(async function () {
  const VAPID_KEY = "BHNwZ5gfFH5Owl6q1qXt72ugbWrDQmjVskV-3KbqRYAVlprcDO2OZrJ9f-Uz3ncFSWmpTC1kCj6h1d-FqTOEKMc"; // Firebase console → Project settings → Cloud Messaging → Web Push certificates

  const loginScreen = document.getElementById("loginScreen");
  const msLoginBtn = document.getElementById("msLoginBtn");
  const loginError = document.getElementById("loginError");

  const dashScreen = document.getElementById("dashScreen");
  const staffNameEl = document.getElementById("staffName");
  const signOutBtn = document.getElementById("signOutBtn");

  const statActive = document.getElementById("statActive");
  const statAck = document.getElementById("statAck");
  const statResolved = document.getElementById("statResolved");

  const queueEl = document.getElementById("queue");
  const tabs = [...document.querySelectorAll(".tab")];

  const espIpInput = document.getElementById("espIp");
  const espTrigger = document.getElementById("espTrigger");
  const espSilence = document.getElementById("espSilence");
  const espMsg = document.getElementById("espMsg");
  const espSend = document.getElementById("espSend");
  const espStatus = document.getElementById("espStatus");

  const enableBtn = document.getElementById("enableAlertsBtn");
  const pushStatus = document.getElementById("pushStatus");

  let currentStaff = null;
  let filter = "open"; // "open" | "all"
  let allAlerts = [];
  let unsubscribe = null;

  // Opened from a push notification tap → start the siren as soon as data loads
  const openedFromPush = new URLSearchParams(location.search).get("alarm") === "1";

  // ---------- browser alarm (sound + vibration + wake lock) ----------
  let audioCtx = null;
  let sirenOsc = null;
  let sirenGain = null;
  let vibrateInterval = null;
  let wakeLock = null;
  let isAlarming = false;
  let sawFirstSnapshot = false;
  const seenActiveIds = new Set();

  const silenceBtn = document.getElementById("silenceBtn");
  silenceBtn.addEventListener("click", stopBrowserAlarm);

  function ensureAudioContext() {
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      audioCtx = new AC();
    }
    if (audioCtx.state === "suspended") audioCtx.resume();
    return audioCtx;
  }

  // Any tap/click anywhere unlocks audio, so later alarms are allowed to play.
  function unlockAudioOnce() {
    try {
      ensureAudioContext();
    } catch (e) {}
    if (audioCtx && audioCtx.state === "running") {
      window.removeEventListener("pointerdown", unlockAudioOnce);
      window.removeEventListener("keydown", unlockAudioOnce);
    }
  }
  window.addEventListener("pointerdown", unlockAudioOnce);
  window.addEventListener("keydown", unlockAudioOnce);

  async function requestWakeLock() {
    try {
      if ("wakeLock" in navigator && !wakeLock) {
        wakeLock = await navigator.wakeLock.request("screen");
        wakeLock.addEventListener("release", () => (wakeLock = null));
      }
    } catch (e) {}
  }
  function releaseWakeLock() {
    if (wakeLock) {
      wakeLock.release().catch(() => {});
      wakeLock = null;
    }
  }

  // Wake locks are dropped when the page is hidden; re-acquire when it's back.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      if (isAlarming) requestWakeLock();
      if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
    }
  });

  function startBrowserAlarm() {
    if (isAlarming) return;
    isAlarming = true;
    silenceBtn.hidden = false;

    try {
      const ctx = ensureAudioContext();
      sirenGain = ctx.createGain();
      sirenGain.gain.value = 0.25;
      sirenGain.connect(ctx.destination);
      sirenOsc = ctx.createOscillator();
      sirenOsc.type = "sine";
      sirenOsc.connect(sirenGain);

      // Pre-schedule 5 minutes of two-tone wail on the audio clock.
      // No setInterval, so background-tab timer throttling can't stall it.
      const t0 = ctx.currentTime;
      for (let i = 0; i < 600; i++) {
        sirenOsc.frequency.setValueAtTime(i % 2 ? 660 : 880, t0 + i * 0.5);
      }
      sirenOsc.start();
      sirenOsc.stop(t0 + 300);
      sirenOsc.onended = () => {
        if (isAlarming) {
          // Siren ran its 5 minutes; if alerts are still active, restart it.
          isAlarming = false;
          if (allAlerts.some((a) => a.status === "active")) startBrowserAlarm();
          else stopBrowserAlarm();
        }
      };
    } catch (err) {
      console.error("Couldn't start audio alarm:", err);
    }

    requestWakeLock();

    // Vibration — Android Chrome/Edge only. No-op on iOS.
    if (navigator.vibrate) {
      navigator.vibrate([400, 200, 400, 200, 400]);
      vibrateInterval = setInterval(() => {
        navigator.vibrate([400, 200, 400, 200, 400]);
      }, 1400);
    }
  }

  function stopBrowserAlarm() {
    isAlarming = false;
    silenceBtn.hidden = true;

    if (sirenOsc) {
      sirenOsc.onended = null;
      try {
        sirenOsc.stop();
      } catch (e) {}
      sirenOsc.disconnect();
      sirenOsc = null;
    }
    if (sirenGain) {
      sirenGain.disconnect();
      sirenGain = null;
    }

    if (vibrateInterval) {
      clearInterval(vibrateInterval);
      vibrateInterval = null;
    }
    if (navigator.vibrate) navigator.vibrate(0);

    releaseWakeLock();
  }

  // Fires the browser alarm for alerts that arrive while the dashboard is open
  // (or when opened from a push notification), and stops it once none are active.
  function checkForNewAlerts() {
    const currentlyActive = allAlerts.filter((a) => a.status === "active");

    if (!sawFirstSnapshot) {
      currentlyActive.forEach((a) => seenActiveIds.add(a.id));
      sawFirstSnapshot = true;
      // Opened by tapping a push → there's an alert the person came to see.
      if (openedFromPush && currentlyActive.length) startBrowserAlarm();
      return;
    }

    const hasNewAlert = currentlyActive.some((a) => !seenActiveIds.has(a.id));
    currentlyActive.forEach((a) => seenActiveIds.add(a.id));

    if (hasNewAlert) {
      startBrowserAlarm();
    } else if (currentlyActive.length === 0 && isAlarming) {
      stopBrowserAlarm();
    }
  }

  // Service worker tells an already-open window to start the siren (notification tap)
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.addEventListener("message", (e) => {
      if (e.data && e.data.type === "alarm") startBrowserAlarm();
    });
  }

  // ---------- push notifications (background alerts) ----------
  let messagingInstance = null;
  let onMessageBound = false;

  function pushSupported() {
    return (
      "serviceWorker" in navigator &&
      "Notification" in window &&
      "PushManager" in window &&
      firebase.messaging.isSupported()
    );
  }

  function setPushUi(text, done) {
    pushStatus.textContent = text || "";
    if (done) {
      enableBtn.textContent = "✅ Background alerts enabled";
      enableBtn.disabled = true;
    }
  }

  async function registerPush() {
    const reg = await navigator.serviceWorker.register("firebase-messaging-sw.js");
    await navigator.serviceWorker.ready;

    messagingInstance = firebase.messaging();
    const token = await messagingInstance.getToken({
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: reg,
    });
    if (!token) throw new Error("No FCM token returned");

    await UVAuth.db.collection("staffTokens").doc(token).set(
      {
        email: currentStaff.email,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    localStorage.setItem("uvalert_push_token", token);

    // Push arriving while the app is open also triggers the siren.
    if (!onMessageBound) {
      messagingInstance.onMessage(() => startBrowserAlarm());
      onMessageBound = true;
    }
    setPushUi("", true);
  }

  async function enableBackgroundAlerts() {
    ensureAudioContext(); // unlock audio with this tap

    if (!pushSupported()) {
      setPushUi(
        "This browser can't receive background alerts. On iPhone, use Share → Add to Home Screen, then open the app from there."
      );
      return;
    }

    const perm = await Notification.requestPermission();
    if (perm !== "granted") {
      setPushUi("Notifications are blocked. Allow them in your browser/site settings, then try again.");
      return;
    }

    try {
      await registerPush();
    } catch (err) {
      console.error("Push setup failed", err);
      setPushUi("Couldn't enable background alerts. Please try again.");
    }
  }
  enableBtn.addEventListener("click", enableBackgroundAlerts);

  async function removePushToken() {
    const token = localStorage.getItem("uvalert_push_token");
    if (!token) return;
    try {
      await UVAuth.db.collection("staffTokens").doc(token).delete();
      if (messagingInstance) await messagingInstance.deleteToken();
    } catch (e) {}
    localStorage.removeItem("uvalert_push_token");
  }

  // ---------- auth ----------
  const existingAccount = await UVAuth.init();
  if (existingAccount) {
    await tryEnterDashboard(existingAccount);
  }

  msLoginBtn.addEventListener("click", async () => {
    loginError.textContent = "";
    msLoginBtn.disabled = true;
    try {
      const account = await UVAuth.signIn();
      await tryEnterDashboard(account);
    } catch (err) {
      loginError.textContent = "Sign-in didn't go through. Please try again.";
      console.error(err);
    } finally {
      msLoginBtn.disabled = false;
    }
  });

  async function tryEnterDashboard(account) {
    const staff = await UVAuth.isStaff(account.username);
    if (!staff) {
      loginError.textContent = "This Microsoft 365 account isn't on the security staff list. Contact your admin to be added.";
      await UVAuth.signOut();
      return;
    }
    currentStaff = { ...staff, email: account.username };
    staffNameEl.textContent = staff.name || account.name || account.username;
    loginScreen.hidden = true;
    dashScreen.hidden = false;
    subscribeToAlerts();

    // Already allowed on a previous visit → quietly refresh the push token.
    if (pushSupported() && Notification.permission === "granted") {
      registerPush().catch((err) => console.error("Push refresh failed", err));
    } else if (pushSupported() && Notification.permission === "denied") {
      setPushUi("Notifications are blocked. Allow them in your browser/site settings.");
    }
  }

  signOutBtn.addEventListener("click", async () => {
    stopBrowserAlarm();
    if (unsubscribe) unsubscribe();
    await removePushToken(); // signed-out devices shouldn't keep getting alerts
    await UVAuth.signOut();
    location.href = "security.html";
  });

  // ---------- live queue ----------
  function subscribeToAlerts() {
    unsubscribe = UVAuth.db
      .collection("alerts")
      .orderBy("createdAt", "desc")
      .limit(50)
      .onSnapshot(
        (snap) => {
          allAlerts = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
          renderQueue();
          renderStats();
          checkForNewAlerts();
        },
        (err) => console.error("alerts subscription failed", err)
      );
  }

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      tabs.forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      filter = tab.dataset.filter;
      renderQueue();
    });
  });

  function renderStats() {
    const active = allAlerts.filter((a) => a.status === "active").length;
    const acked = allAlerts.filter((a) => a.status === "acknowledged").length;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const resolvedToday = allAlerts.filter((a) => {
      if (!["resolved", "cancelled"].includes(a.status) || !a.resolvedAt) return false;
      return a.resolvedAt.toDate() >= today;
    }).length;

    statActive.textContent = active;
    statAck.textContent = acked;
    statResolved.textContent = resolvedToday;
  }

  function renderQueue() {
    const visible =
      filter === "open"
        ? allAlerts.filter((a) => a.status === "active" || a.status === "acknowledged")
        : allAlerts;

    if (!visible.length) {
      queueEl.innerHTML = `<div class="queue-empty">${
        filter === "open" ? "No open alerts right now." : "No alerts yet."
      }</div>`;
      return;
    }

    queueEl.innerHTML = visible.map(renderCard).join("");

    queueEl.querySelectorAll("[data-ack]").forEach((btn) => {
      btn.addEventListener("click", () => acknowledgeAlert(btn.dataset.ack));
    });
    queueEl.querySelectorAll("[data-resolve]").forEach((btn) => {
      btn.addEventListener("click", () => resolveAlert(btn.dataset.resolve));
    });
  }

  function renderCard(alert) {
    const statusClass = alert.status === "active" ? "active" : alert.status === "acknowledged" ? "acked" : "resolved";
    const statusLabel = { active: "Active", acknowledged: "Acknowledged", resolved: "Resolved", cancelled: "Cancelled" }[alert.status] || alert.status;
    const cardStateClass = alert.status === "active" ? "is-active" : ["resolved", "cancelled"].includes(alert.status) ? "is-resolved" : "";
    const time = alert.createdAt ? timeAgo(alert.createdAt.toDate()) : "just now";

    const actions = [];
    if (alert.status === "active") {
      actions.push(`<button class="chip-btn ack-btn" data-ack="${alert.id}">Acknowledge</button>`);
    }
    if (alert.status === "active" || alert.status === "acknowledged") {
      actions.push(`<button class="chip-btn resolve-btn" data-resolve="${alert.id}">Resolve</button>`);
    }

    return `
      <div class="alert-card ${cardStateClass}">
        <div class="alert-card-top">
          <div>
            <div class="alert-title">${escapeHtml(alert.emergencyLabel || alert.emergencyType)} \u2014 ${escapeHtml(alert.building)}</div>
            <div class="alert-meta">${escapeHtml(alert.studentName)} \u00b7 ${escapeHtml(alert.studentEmail)}</div>
          </div>
          <div style="text-align:right;">
            <span class="status-pill ${statusClass}">${statusLabel}</span>
            <div class="alert-time">${time}</div>
          </div>
        </div>
        ${alert.details ? `<div class="alert-details">${escapeHtml(alert.details)}</div>` : ""}
        ${actions.length ? `<div class="alert-actions">${actions.join("")}</div>` : ""}
      </div>`;
  }

  async function acknowledgeAlert(id) {
    await UVAuth.db.collection("alerts").doc(id).update({
      status: "acknowledged",
      acknowledgedAt: firebase.firestore.FieldValue.serverTimestamp(),
      acknowledgedBy: currentStaff.email,
    });
  }

  async function resolveAlert(id) {
    await UVAuth.db.collection("alerts").doc(id).update({
      status: "resolved",
      resolvedAt: firebase.firestore.FieldValue.serverTimestamp(),
      resolvedBy: currentStaff.email,
    });

    const alarmSnap = await UVAuth.rtdb.ref("alarm").get();
    const alarm = alarmSnap.val();
    if (alarm && alarm.alertId === id) {
      // Keep the same alertId here — the ESP32 only turns the buzzer off
      // when alertId still matches the one it's currently reacting to
      // (see web_server.h). Clearing it to "" would break that match.
      await UVAuth.rtdb.ref("alarm").set({ active: false, alertId: id, message: "SYSTEM IDLE" });
    }
  }

  function timeAgo(date) {
    const seconds = Math.round((Date.now() - date.getTime()) / 1000);
    if (seconds < 60) return "just now";
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return date.toLocaleDateString();
  }

  function escapeHtml(str) {
    return String(str ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // ---------- ESP32 manual controls ----------
  const savedIp = localStorage.getItem("uvalert_esp_ip");
  if (savedIp) espIpInput.value = savedIp;

  espIpInput.addEventListener("change", () => {
    localStorage.setItem("uvalert_esp_ip", espIpInput.value.trim());
  });

  async function espCall(path, params) {
    const ip = espIpInput.value.trim();
    if (!ip) {
      setEspStatus("Enter the ESP32's IP address first.", "err");
      return;
    }
    const base = ip.includes(":") ? ip : `${ip}:8080`;
    const url = new URL(`http://${base}${path}`);
    if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

    setEspStatus("Sending\u2026");
    try {
      const res = await fetch(url, { method: "GET" });
      const text = await res.text();
      setEspStatus(res.ok ? text : `Board responded with an error: ${text}`, res.ok ? "ok" : "err");
    } catch (err) {
      setEspStatus("Couldn't reach the board. Check the IP and that you're on the same network.", "err");
    }
  }

  function setEspStatus(text, kind) {
    espStatus.textContent = text;
    espStatus.className = "esp-status" + (kind ? ` ${kind}` : "");
  }

  espTrigger.addEventListener("click", () => espCall("/alarm/on"));
  espSilence.addEventListener("click", () => espCall("/alarm/off"));
  espSend.addEventListener("click", () => {
    const msg = espMsg.value.trim();
    if (!msg) return setEspStatus("Type a message first.", "err");
    espCall("/setmessage", { msg });
  });
})();
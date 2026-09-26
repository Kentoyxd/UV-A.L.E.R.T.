// ============================================================
// UV-A.L.E.R.T. — security dashboard logic
// ============================================================

(async function () {
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

  let currentStaff = null;
  let filter = "open"; // "open" | "all"
  let allAlerts = [];
  let unsubscribe = null;

  // ---------- browser alarm (sound + vibration) ----------
  let audioCtx = null;
  let sirenOsc = null;
  let sirenGain = null;
  let sirenInterval = null;
  let vibrateInterval = null;
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

  function startBrowserAlarm() {
    if (isAlarming) return;
    isAlarming = true;
    silenceBtn.hidden = false;

    try {
      const ctx = ensureAudioContext();
      sirenGain = ctx.createGain();
      sirenGain.gain.value = 0.15; // keep it from being painfully loud
      sirenGain.connect(ctx.destination);
      sirenOsc = ctx.createOscillator();
      sirenOsc.type = "sine";
      sirenOsc.connect(sirenGain);
      sirenOsc.start();

      // Two-tone wail, alternating every 500ms.
      let high = true;
      sirenOsc.frequency.setValueAtTime(880, ctx.currentTime);
      sirenInterval = setInterval(() => {
        high = !high;
        sirenOsc.frequency.setTargetAtTime(high ? 880 : 660, ctx.currentTime, 0.05);
      }, 500);
    } catch (err) {
      console.error("Couldn't start audio alarm:", err);
    }

    // Vibration — Android Chrome/Edge only. No-op (silently) on iOS Safari.
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

    if (sirenInterval) {
      clearInterval(sirenInterval);
      sirenInterval = null;
    }
    if (sirenOsc) {
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
  }

  // Fires the browser alarm only for alerts that arrive while the
  // dashboard is already open, and stops it once none are left active.
  function checkForNewAlerts() {
    const currentlyActive = allAlerts.filter((a) => a.status === "active");

    if (!sawFirstSnapshot) {
      // Don't blast the alarm for alerts that already existed on page load.
      currentlyActive.forEach((a) => seenActiveIds.add(a.id));
      sawFirstSnapshot = true;
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
  }

  signOutBtn.addEventListener("click", async () => {
    stopBrowserAlarm();
    if (unsubscribe) unsubscribe();
    await UVAuth.signOut();
    location.reload();
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
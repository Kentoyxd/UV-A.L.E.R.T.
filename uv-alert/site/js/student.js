// ============================================================
// UV-A.L.E.R.T. — student page logic
// ============================================================

(async function () {
  const loginScreen = document.getElementById("loginScreen");
  const msLoginBtn = document.getElementById("msLoginBtn");
  const loginError = document.getElementById("loginError");

  const appScreen = document.getElementById("appScreen");
  const studentNameEl = document.getElementById("studentName");
  const signOutBtn = document.getElementById("signOutBtn");

  const buildingGrid = document.getElementById("buildingGrid");
  const emergencyGrid = document.getElementById("emergencyGrid");

  const detailsToggle = document.getElementById("detailsToggle");
  const detailsBox = document.getElementById("detailsBox");
  const detailsInput = document.getElementById("detailsInput");

  const selectionSummary = document.getElementById("selectionSummary");
  const sendBtn = document.getElementById("sendBtn");

  const sentScreen = document.getElementById("sentScreen");
  const sentBuilding = document.getElementById("sentBuilding");
  const sentType = document.getElementById("sentType");
  const sentNoteRow = document.getElementById("sentNoteRow");
  const sentNote = document.getElementById("sentNote");
  const sentTime = document.getElementById("sentTime");
  const safeBtn = document.getElementById("safeBtn");

  let selectedBuilding = null;
  let selectedType = null; // { id, label, hint }
  let activeAlertId = null;
  let activeAlertUnsub = null;
  let resolvedByStaff = false;

  // ---------- render pickers ----------
  BUILDINGS.forEach((name) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tile";
    btn.innerHTML = `<span class="tile-label">${name}</span>`;
    btn.addEventListener("click", () => {
      selectedBuilding = name;
      [...buildingGrid.children].forEach((c) => c.classList.remove("selected"));
      btn.classList.add("selected");
      updateSummary();
    });
    buildingGrid.appendChild(btn);
  });

  EMERGENCY_TYPES.forEach((type) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tile emergency";
    btn.innerHTML = `<span class="tile-label">${type.label}</span><span class="tile-hint">${type.hint}</span>`;
    btn.addEventListener("click", () => {
      selectedType = type;
      [...emergencyGrid.children].forEach((c) => c.classList.remove("selected"));
      btn.classList.add("selected");
      updateSummary();
    });
    emergencyGrid.appendChild(btn);
  });

  detailsToggle.addEventListener("click", () => {
    const open = detailsBox.hidden;
    detailsBox.hidden = !open;
    detailsToggle.setAttribute("aria-expanded", String(open));
    detailsToggle.textContent = open ? "\u2212 Hide details" : "+ Add specific details (optional)";
    if (open) detailsInput.focus();
  });

  function updateSummary() {
    if (selectedBuilding && selectedType) {
      selectionSummary.textContent = `${selectedType.label} \u2014 ${selectedBuilding}`;
      sendBtn.disabled = false;
    } else if (selectedBuilding || selectedType) {
      selectionSummary.textContent = "Almost there \u2014 pick both a building and an emergency type.";
      sendBtn.disabled = true;
    } else {
      selectionSummary.textContent = "Choose a building and an emergency type to continue.";
      sendBtn.disabled = true;
    }
  }

  // ---------- auth ----------
  const existingAccount = await UVAuth.init();
  if (existingAccount) {
    showApp(existingAccount);
  }

  msLoginBtn.addEventListener("click", async () => {
    loginError.textContent = "";
    msLoginBtn.disabled = true;
    try {
      const account = await UVAuth.signIn();
      showApp(account);
    } catch (err) {
      loginError.textContent = "Sign-in didn't go through. Please try again.";
      console.error(err);
    } finally {
      msLoginBtn.disabled = false;
    }
  });

  function showApp(account) {
    studentNameEl.textContent = account.name || account.username;
    loginScreen.hidden = true;
    appScreen.hidden = false;
  }

  signOutBtn.addEventListener("click", async () => {
    if (activeAlertUnsub) activeAlertUnsub();
    await UVAuth.signOut();
    location.reload();
  });

  // ---------- send alert ----------
  sendBtn.addEventListener("click", async () => {
    if (!selectedBuilding || !selectedType) return;
    sendBtn.disabled = true;
    sendBtn.textContent = "Send Emergency Alert";

    const account = UVAuth.getAccount();
    const details = detailsInput.value.trim();

    try {
      const docRef = await UVAuth.db.collection("alerts").add({
        studentName: account.name || account.username,
        studentEmail: account.username,
        building: selectedBuilding,
        emergencyType: selectedType.id,
        emergencyLabel: selectedType.label,
        details: details || null,
        status: "active",
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      });

      activeAlertId = docRef.id;

      // Drive the physical alarm — the ESP32 polls this node (web_server.h).
      await UVAuth.rtdb.ref("alarm").set({
        active: true,
        alertId: docRef.id,
        message: selectedType.id.toUpperCase(),
      });

      showSentScreen(selectedBuilding, selectedType.label, details);
      watchAlert(docRef.id);
    } catch (err) {
      console.error(err);
      selectionSummary.textContent = "Couldn't send the alert. Check your connection and try again.";
      sendBtn.disabled = false;
      sendBtn.textContent = "Send alert";
    }
  });

  function showSentScreen(building, typeLabel, details) {
    sentBuilding.textContent = building;
    sentType.textContent = typeLabel;
    if (details) {
      sentNoteRow.hidden = false;
      sentNote.textContent = details;
    } else {
      sentNoteRow.hidden = true;
    }
    sentTime.textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    appScreen.hidden = true;
    sentScreen.hidden = false;
    safeBtn.disabled = false;
    safeBtn.textContent = "I'm safe now \u2014 cancel this alert";
  }

  function watchAlert(id) {
    activeAlertUnsub = UVAuth.db.collection("alerts").doc(id).onSnapshot((snap) => {
      const data = snap.data();
      if (!data) return;
      if (data.status === "resolved") {
        resolvedByStaff = true;
        safeBtn.textContent = "Security marked this resolved \u2014 back to home";
        safeBtn.disabled = false;
      } else if (data.status === "acknowledged") {
        resolvedByStaff = false;
        safeBtn.textContent = "I'm safe now \u2014 cancel this alert";
        safeBtn.disabled = false;
      }
    });
  }

  function resetToHome() {
    if (activeAlertUnsub) activeAlertUnsub();
    activeAlertId = null;
    resolvedByStaff = false;

    // Reset the picker for a possible next alert.
    selectedBuilding = null;
    selectedType = null;
    [...buildingGrid.children, ...emergencyGrid.children].forEach((c) => c.classList.remove("selected"));
    updateSummary();

    safeBtn.disabled = false;
    safeBtn.textContent = "I'm safe now \u2014 cancel this alert";
    sentScreen.hidden = true;
    appScreen.hidden = false;
  }

  safeBtn.addEventListener("click", async () => {
    if (!activeAlertId) return;

    // Security already closed this out — just head back, no writes needed.
    if (resolvedByStaff) {
      resetToHome();
      return;
    }

    safeBtn.disabled = true;
    safeBtn.textContent = "Cancelling\u2026";
    try {
      await UVAuth.db.collection("alerts").doc(activeAlertId).update({
        status: "cancelled",
        resolvedAt: firebase.firestore.FieldValue.serverTimestamp(),
      });

      const alarmSnap = await UVAuth.rtdb.ref("alarm").get();
      const alarm = alarmSnap.val();
      if (alarm && alarm.alertId === activeAlertId) {
        // Keep the same alertId here — the ESP32 only turns the buzzer off
        // when alertId still matches the one it's currently reacting to
        // (see web_server.h). Clearing it to "" would break that match.
        await UVAuth.rtdb.ref("alarm").set({ active: false, alertId: activeAlertId, message: "SYSTEM IDLE" });
      }

      resetToHome();
    } catch (err) {
      console.error(err);
      safeBtn.disabled = false;
      safeBtn.textContent = "Try again";
    }
  });
})();
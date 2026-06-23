// app.js

const AUTO_HIDE_MS = 0;

const msg1 = document.getElementById("msg1");
const msg2 = document.getElementById("msg2");
const mtcEl = document.getElementById("mtc");

const alertTitleEl = document.getElementById("alertTitle");
const alertMessageEl = document.getElementById("alertMessage");
const alertSinceEl = document.getElementById("alertSince");
const alertAckButton = document.getElementById("alertAckButton");

const readyTitleEl = document.getElementById("readyTitle");
const readyMessageEl = document.getElementById("readyMessage");
const readySinceEl = document.getElementById("readySince");
const readyConfirmButton = document.getElementById("readyConfirmButton");

const wsStateEl = document.getElementById("wsState");
const oscStateEl = document.getElementById("oscState");
const midiStateEl = document.getElementById("midiState");
const mtcStateEl = document.getElementById("mtcState");
const alertStateEl = document.getElementById("alertState");
const readyStateEl = document.getElementById("readyState");

let hideTimer = null;
let alertStartedAt = null;
let alertSinceTimer = null;
let readyRequestedAt = null;
let readySinceTimer = null;

const wsUrl = (location.protocol === "https:" ? "wss://" : "ws://") + location.host;

let ws = null;
let reconnectTimer = null;
let watchdogTimer = null;
let lastWsMessageAt = 0;
let reconnecting = false;

const RECONNECT_DELAY_MS = 2000;
const WS_STALE_MS = 15000;

function setState(el, text, stateClass) {
  if (!el) return;
  el.textContent = text;
  el.classList.remove("state-ok", "state-warn", "state-bad", "state-alert");
  if (stateClass) el.classList.add(stateClass);
}

function setWsState(text, stateClass) {
  setState(wsStateEl, text, stateClass);
}

function setOscState(ok) {
  setState(oscStateEl, ok ? "ok" : "waiting", ok ? "state-ok" : "state-warn");
}

function setMidiState(ok) {
  setState(midiStateEl, ok ? "ok" : "disconnected", ok ? "state-ok" : "state-bad");
}

function setMtcState(running) {
  setState(mtcStateEl, running ? "running" : "stopped", running ? "state-ok" : "state-warn");
}

function setAlertState(active) {
  setState(alertStateEl, active ? "active" : "off", active ? "state-alert" : "state-warn");
}

function setReadyState(active) {
  setState(readyStateEl, active ? "active" : "off", active ? "state-ok" : "state-warn");
}

function connectWebSocket() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }

  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  reconnecting = true;
  ws = new WebSocket(wsUrl);

  ws.addEventListener("open", () => {
    console.log("WS CONNECTED", wsUrl);
    reconnecting = false;
    lastWsMessageAt = Date.now();
    setWsState("connected", "state-ok");
    startWatchdog();
  });

  ws.addEventListener("close", () => {
    console.log("WS CLOSED");
    reconnecting = false;
    setWsState("closed", "state-bad");
    ws = null;
    scheduleReconnect();
  });

  ws.addEventListener("error", (e) => {
    console.log("WS ERROR", e);
    setWsState("error", "state-bad");
    try { ws.close(); } catch (err) {}
  });

  ws.addEventListener("message", handleWsMessage);
}

function forceReconnect() {
  if (ws) {
    try { ws.close(); } catch (err) {}
    ws = null;
  }

  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  connectWebSocket();
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectWebSocket();
  }, RECONNECT_DELAY_MS);
}

function startWatchdog() {
  if (watchdogTimer) clearInterval(watchdogTimer);

  watchdogTimer = setInterval(() => {
    if (document.hidden) return;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    const age = Date.now() - lastWsMessageAt;
    if (age > WS_STALE_MS) {
      console.warn("WS stale -> reconnect");
      forceReconnect();
    }
  }, 5000);
}

function handleWsMessage(event) {
  lastWsMessageAt = Date.now();

  let data;

  try {
    data = JSON.parse(event.data);
  } catch (err) {
    console.error("JSON PARSE ERROR:", err);
    return;
  }

  if (data && data.type === "status") {
    setOscState(Boolean(data.osc));
    setMidiState(Boolean(data.midi));
    setMtcState(Boolean(data.mtc));
    setAlertState(Boolean(data.alert));
    setReadyState(Boolean(data.ready));

    if (data.alert && data.alertStartedAt && document.body.classList.contains("alert-active")) {
      alertStartedAt = Number(data.alertStartedAt);
      updateAlertSince();
    }

    if (data.ready && data.readyRequestedAt && document.body.classList.contains("ready-active")) {
      readyRequestedAt = Number(data.readyRequestedAt);
      updateReadySince();
    }

    return;
  }

  if (data && data.type === "alert") {
    setAlert(Boolean(data.active), data.title, data.message, data.startedAt);
    return;
  }

  if (data && data.type === "ready") {
    setReady(Boolean(data.active), data.title, data.message, data.requestedAt);
    return;
  }

  if (data && data.type === "mtc") {
    setMtc(data.visible, data.value, data.label);
    return;
  }

  if (data && data.type === "clear") {
    clearAll();
    return;
  }

  if (data && data.type === "text") {
    showText(data.line1, data.color1, data.line2, data.color2);
    return;
  }
}

function showText(line1, color1, line2, color2) {
  setLine(msg1, line1, color1);
  setLine(msg2, line2, color2);

  if (AUTO_HIDE_MS > 0) {
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(clearAll, AUTO_HIDE_MS);
  }
}

function setLine(el, text, color) {
  if (!el) return;

  const t = (text ?? "").toString();

  el.textContent = t;
  el.style.color = (color ?? "white").toString();

  if (t.trim().length === 0) {
    el.classList.remove("visible");
    return;
  }

  el.classList.remove("visible");
  void el.offsetWidth;
  el.classList.add("visible");
}

function clearAll() {
  msg1.textContent = "";
  msg2.textContent = "";
  msg1.classList.remove("visible");
  msg2.classList.remove("visible");
}

function setMtc(visible, value, label) {
  if (!mtcEl) return;

  if (visible) {
    mtcEl.textContent = (label || "MTC") + " " + (value || "00:00:00");
    mtcEl.style.display = "block";
  } else {
    mtcEl.style.display = "none";
  }
}

function setAlert(active, title, message, startedAt) {
  if (active) {
    if (alertTitleEl) alertTitleEl.textContent = title || "STAGE ALERT";
    if (alertMessageEl) alertMessageEl.textContent = message || "";

    alertStartedAt = Number(startedAt) || Date.now();

    document.body.classList.add("alert-active");
    startAlertSinceTimer();
  } else {
    document.body.classList.remove("alert-active");

    if (alertTitleEl) alertTitleEl.textContent = "STAGE ALERT";
    if (alertMessageEl) alertMessageEl.textContent = "";

    alertStartedAt = null;
    stopAlertSinceTimer();
  }
}

function setReady(active, title, message, requestedAt) {
  if (active) {
    if (readyTitleEl) readyTitleEl.textContent = title || "BÜHNE BEREIT?";
    if (readyMessageEl) readyMessageEl.textContent = message || "";

    readyRequestedAt = Number(requestedAt) || Date.now();

    document.body.classList.add("ready-active");
    startReadySinceTimer();
  } else {
    document.body.classList.remove("ready-active");

    if (readyTitleEl) readyTitleEl.textContent = "BÜHNE BEREIT?";
    if (readyMessageEl) readyMessageEl.textContent = "";

    readyRequestedAt = null;
    stopReadySinceTimer();
  }
}

function startAlertSinceTimer() {
  stopAlertSinceTimer();
  updateAlertSince();
  alertSinceTimer = setInterval(updateAlertSince, 1000);
}

function stopAlertSinceTimer() {
  if (alertSinceTimer) {
    clearInterval(alertSinceTimer);
    alertSinceTimer = null;
  }

  if (alertSinceEl) {
    alertSinceEl.textContent = "Alert seit 00:00";
  }
}

function updateAlertSince() {
  if (!alertSinceEl) return;

  if (!alertStartedAt) {
    alertSinceEl.textContent = "Alert seit 00:00";
    return;
  }

  const elapsed = Math.max(0, Math.floor((Date.now() - alertStartedAt) / 1000));
  const min = Math.floor(elapsed / 60);
  const sec = elapsed % 60;

  alertSinceEl.textContent =
    "Alert seit " +
    String(min).padStart(2, "0") +
    ":" +
    String(sec).padStart(2, "0");
}

function startReadySinceTimer() {
  stopReadySinceTimer();
  updateReadySince();
  readySinceTimer = setInterval(updateReadySince, 1000);
}

function stopReadySinceTimer() {
  if (readySinceTimer) {
    clearInterval(readySinceTimer);
    readySinceTimer = null;
  }

  if (readySinceEl) {
    readySinceEl.textContent = "Anfrage seit 00:00";
  }
}

function updateReadySince() {
  if (!readySinceEl) return;

  if (!readyRequestedAt) {
    readySinceEl.textContent = "Anfrage seit 00:00";
    return;
  }

  const elapsed = Math.max(0, Math.floor((Date.now() - readyRequestedAt) / 1000));
  const min = Math.floor(elapsed / 60);
  const sec = elapsed % 60;

  readySinceEl.textContent =
    "Anfrage seit " +
    String(min).padStart(2, "0") +
    ":" +
    String(sec).padStart(2, "0");
}

async function acknowledgeAlert() {
  // const confirmed = confirm("Alert wirklich als erledigt quittieren?");
  // if (!confirmed) return;

  try {
    const res = await fetch("/api/alert/off", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({})
    });

    if (!res.ok) {
      console.error("Alert konnte nicht quittiert werden:", await res.text());
    }
  } catch (err) {
    console.error("Fehler beim Quittieren des Alerts:", err);
  }
}

async function confirmReady() {
  // const confirmed = confirm("Bühne wirklich als bereit bestätigen?");
  // if (!confirmed) return;

  try {
    const res = await fetch("/api/ready/confirm", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({})
    });

    if (!res.ok) {
      console.error("Ready konnte nicht bestätigt werden:", await res.text());
    }
  } catch (err) {
    console.error("Fehler beim Bestätigen von Ready:", err);
  }
}

if (alertAckButton) {
  alertAckButton.addEventListener("click", acknowledgeAlert);
}

if (readyConfirmButton) {
  readyConfirmButton.addEventListener("click", confirmReady);
}

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    console.log("Browser sichtbar -> WS prüfen");
    forceReconnect();
  }
});

window.addEventListener("pageshow", () => {
  console.log("pageshow -> WS prüfen");
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    connectWebSocket();
  }
});

window.addEventListener("online", () => {
  console.log("online -> WS reconnect");
  forceReconnect();
});

connectWebSocket();

window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !document.body.classList.contains("alert-active") && !document.body.classList.contains("ready-active")) {
    clearAll();
  }
});

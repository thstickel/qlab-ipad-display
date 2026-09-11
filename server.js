// server.js
const fs = require("fs");
const path = require("path");
const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const osc = require("osc");
const { execFileSync } = require("child_process");
const {
  oscArgToString,
  normalizeMidiName,
  formatTime,
  parseAconnectInputs,
  decodeMtcFromNibbles
} = require("./lib/core");

// Debug-Schalter
const DEBUG_WS = false;
const DEBUG_OSC = true;
const DEBUG_MTC = false;
const DEBUG_MIDI_RAW = false;

let easymidi = null;
try {
  easymidi = require("easymidi");
} catch (err) {
  console.warn("easymidi ist nicht installiert. MIDI/MTC ist deaktiviert.");
}

const CONFIG_PATH = path.join(__dirname, "config.json");

const DEFAULT_CONFIG = {
  httpPort: 3000,
  oscPort: 53000,
  midi: {
    enabled: true,
    inputName: "",
    reconnectIntervalMs: 30000
  },
  mtc: {
    visibleOnStartup: false,
    showFrames: false,
    label: "MTC"
  },
  status: {
    oscTimeoutMs: 5000,
    mtcTimeoutMs: 1500
  },
  alert: {
    title: "STAGE ALERT",
    presets: [
      "Ausfall Mikrofon 1",
      "Batterie tauschen InEar 4",
      "Funkstrecke prüfen",
      "Umbau verzögert sich",
      "Darsteller bitte zur Bühne",
      "Technik bitte melden"
    ]
  },
  ready: {
    title: "BÜHNE BEREIT?",
    message: "Bitte bestätigen, wenn alle Positionen bereit sind.",
    qlabHost: "127.0.0.1",
    qlabPort: 53000,
    oscAddress: "/cue/READY/start"
  }
};

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function loadConfig() {
  try {
    if (!fs.existsSync(CONFIG_PATH)) {
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2));
      return clone(DEFAULT_CONFIG);
    }

    const raw = fs.readFileSync(CONFIG_PATH, "utf8");
    const userConfig = JSON.parse(raw);

    return {
      ...DEFAULT_CONFIG,
      ...userConfig,
      midi: { ...DEFAULT_CONFIG.midi, ...(userConfig.midi || {}) },
      mtc: { ...DEFAULT_CONFIG.mtc, ...(userConfig.mtc || {}) },
      status: { ...DEFAULT_CONFIG.status, ...(userConfig.status || {}) },
      alert: { ...DEFAULT_CONFIG.alert, ...(userConfig.alert || {}) },
      ready: { ...DEFAULT_CONFIG.ready, ...(userConfig.ready || {}) }
    };
  } catch (err) {
    console.error("Fehler beim Lesen der config.json:", err);
    return clone(DEFAULT_CONFIG);
  }
}

function saveConfig(nextConfig) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(nextConfig, null, 2));
}

let config = loadConfig();

const HTTP_PORT = Number(config.httpPort) || 3000;
const OSC_PORT = Number(config.oscPort) || 53000;

const app = express();
app.use(express.json());
app.use(express.static("public"));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

let countdownTimer = null;
let countupTimer = null;

let currentDisplayState = { type: "clear" };
let countdownState = null;
let countupState = null;

let mtcVisible = Boolean(config.mtc.visibleOnStartup);
let currentMTC = config.mtc.showFrames ? "00:00:00:00" : "00:00:00";
let mtcRunning = false;

let alertActive = false;
let alertTitle = config.alert.title || "STAGE ALERT";
let alertMessage = "";
let alertStartedAt = null;

let readyActive = false;
let readyTitle = config.ready.title || "BÜHNE BEREIT?";
let readyMessage = config.ready.message || "Bitte bestätigen, wenn alle Positionen bereit sind.";
let readyRequestedAt = null;
let readyConfirmedAt = null;
let readyReturnOscAddress = config.ready.oscAddress || "/cue/READY/start";

let lastOscAt = 0;
let lastMtcAt = 0;

let midiInput = null;
let midiConnected = false;
let midiReconnectTimer = null;
let lastMidiMissingLogAt = 0;

const mtcNibbles = new Array(8).fill(0);

function broadcast(obj) {
  const msg = JSON.stringify(obj);
  let sent = 0;

  wss.clients.forEach((c) => {
    if (c.readyState === WebSocket.OPEN) {
      c.send(msg);
      sent++;
    }
  });

  if (DEBUG_WS) {
    console.log("BROADCAST:", msg, "| clients:", sent);
  }
}

function stopCountdown() {
  if (countdownTimer) {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }
}

function stopCountup() {
  if (countupTimer) {
    clearInterval(countupTimer);
    countupTimer = null;
  }
}

function stopAllTimers() {
  stopCountdown();
  stopCountup();
}

function getStatusPayload() {
  const now = Date.now();

  return {
    type: "status",
    ws: true,
    osc: now - lastOscAt < Number(config.status.oscTimeoutMs || 5000),
    midi: midiConnected,
    mtc: mtcRunning,
    mtcVisible,
    mtcValue: currentMTC,
    alert: alertActive,
    alertStartedAt,
    ready: readyActive,
    readyRequestedAt,
    readyConfirmedAt
  };
}

function broadcastStatus() {
  broadcast(getStatusPayload());
}

function setCurrentDisplayState(state) {
  currentDisplayState = state || { type: "clear" };
}

function sendDisplayStateToClient(ws) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;

  if (currentDisplayState) {
    ws.send(JSON.stringify(currentDisplayState));
  }

  ws.send(JSON.stringify({
    type: "mtc",
    visible: mtcVisible,
    value: currentMTC,
    label: config.mtc.label || "MTC"
  }));

  if (alertActive) {
    ws.send(JSON.stringify({
      type: "alert",
      active: true,
      title: alertTitle,
      message: alertMessage,
      startedAt: alertStartedAt
    }));
  }

  if (readyActive) {
    ws.send(JSON.stringify({
      type: "ready",
      active: true,
      title: readyTitle,
      message: readyMessage,
      requestedAt: readyRequestedAt,
      returnOscAddress: readyReturnOscAddress
    }));
  }

  ws.send(JSON.stringify(getStatusPayload()));
}

function showText(line1, color1, line2, color2) {
  stopAllTimers();
  countdownState = null;
  countupState = null;

  const payload = {
    type: "text",
    line1: String(line1 || ""),
    color1: String(color1 || "white"),
    line2: String(line2 || ""),
    color2: String(color2 || "white")
  };

  setCurrentDisplayState(payload);
  broadcast(payload);
}

function startCountdown(line1, color1, seconds, color2) {
  stopAllTimers();

  let remaining = parseInt(seconds, 10);

  if (!Number.isFinite(remaining) || remaining < 0) {
    console.log("Invalid countdown seconds:", seconds);
    return;
  }

  countdownState = {
    line1: String(line1 || ""),
    color1: String(color1 || "white"),
    color2: String(color2 || "white")
  };
  countupState = null;

  function sendCountdown() {
    const payload = {
      type: "text",
      line1: countdownState.line1,
      color1: countdownState.color1,
      line2: formatTime(remaining),
      color2: countdownState.color2
    };

    setCurrentDisplayState(payload);
    broadcast(payload);
  }

  sendCountdown();

  countdownTimer = setInterval(() => {
    remaining--;

    if (remaining <= 0) {
      const payload = {
        type: "text",
        line1: countdownState.line1,
        color1: countdownState.color1,
        line2: "LOS",
        color2: countdownState.color2
      };

      setCurrentDisplayState(payload);
      broadcast(payload);

      stopCountdown();
      countdownState = null;
      return;
    }

    sendCountdown();
  }, 1000);
}

function startCountup(line1, color1, color2) {
  stopAllTimers();

  let elapsed = 0;

  countupState = {
    line1: String(line1 || ""),
    color1: String(color1 || "white"),
    color2: String(color2 || "white")
  };
  countdownState = null;

  function sendCountup() {
    const payload = {
      type: "text",
      line1: countupState.line1,
      color1: countupState.color1,
      line2: formatTime(elapsed),
      color2: countupState.color2
    };

    setCurrentDisplayState(payload);
    broadcast(payload);
  }

  sendCountup();

  countupTimer = setInterval(() => {
    elapsed++;
    sendCountup();
  }, 1000);
}

function setMtcVisible(visible) {
  mtcVisible = Boolean(visible);

  broadcast({
    type: "mtc",
    visible: mtcVisible,
    value: currentMTC,
    label: config.mtc.label || "MTC"
  });

  broadcastStatus();
}

function setAlertActive(active, title = "", message = "") {
  alertActive = Boolean(active);

  if (alertActive) {
    alertTitle = String(title || config.alert.title || "STAGE ALERT");
    alertMessage = String(message || "").trim();
    alertStartedAt = Date.now();

    broadcast({
      type: "alert",
      active: true,
      title: alertTitle,
      message: alertMessage,
      startedAt: alertStartedAt
    });

    console.log("ALERT AKTIV:", alertTitle, "-", alertMessage);
  } else {
    alertActive = false;
    alertMessage = "";
    alertStartedAt = null;

    broadcast({
      type: "alert",
      active: false
    });

    console.log("ALERT quittiert.");
  }

  broadcastStatus();
}


function setReadyActive(active, title = "", message = "", returnOscAddress = "") {
  readyActive = Boolean(active);

  if (readyActive) {
    readyTitle = String(title || config.ready.title || "BÜHNE BEREIT?");
    readyMessage = String(message || config.ready.message || "Bitte bestätigen, wenn alle Positionen bereit sind.");
    readyReturnOscAddress = String(returnOscAddress || config.ready.oscAddress || "/cue/READY/start");
    readyRequestedAt = Date.now();
    readyConfirmedAt = null;

    broadcast({
      type: "ready",
      active: true,
      title: readyTitle,
      message: readyMessage,
      requestedAt: readyRequestedAt,
      returnOscAddress: readyReturnOscAddress
    });

    console.log("READY angefragt:", readyTitle, "-", readyMessage);
  } else {
    readyActive = false;
    readyRequestedAt = null;

    broadcast({
      type: "ready",
      active: false
    });

    console.log("READY Overlay aufgehoben.");
  }

  broadcastStatus();
}

function sendReadyOscToQlab() {
  const host = config.ready.qlabHost || "127.0.0.1";
  const port = Number(config.ready.qlabPort || 53000);
  const address = readyReturnOscAddress || config.ready.oscAddress || "/cue/READY/start";

  try {
    udpPort.send(
      {
        address,
        args: []
      },
      host,
      port
    );

    console.log(`READY OSC gesendet: ${address} -> ${host}:${port}`);
    return true;
  } catch (err) {
    console.error("READY OSC konnte nicht gesendet werden:", err);
    return false;
  }
}

function confirmReady() {
  if (!readyActive) {
    return {
      ok: false,
      message: "Keine Ready-Anfrage aktiv."
    };
  }

  readyConfirmedAt = Date.now();
  const sent = sendReadyOscToQlab();

  readyActive = false;
  readyRequestedAt = null;

  broadcast({
    type: "ready",
    active: false,
    confirmed: true,
    sent
  });

  broadcastStatus();

  return {
    ok: sent,
    sent,
    confirmedAt: readyConfirmedAt
  };
}

function getMidiInputs() {
  if (process.platform === "linux") {
    try {
      const output = execFileSync("aconnect", ["-i"], {
        encoding: "utf8",
        timeout: 2000
      });

      return parseAconnectInputs(output);
    } catch (err) {
      console.error("ALSA MIDI Inputs konnten nicht gelesen werden:", err.message || err);
      return [];
    }
  }

  if (!easymidi) return [];

  try {
    return easymidi.getInputs();
  } catch (err) {
    console.error("MIDI Inputs konnten nicht gelesen werden:", err.message || err);
    return [];
  }
}

function handleMidiMessage(msg) {
  if (DEBUG_MIDI_RAW) {
    console.log("MIDI RAW:", msg);
  }

  if (!msg || msg._type !== "mtc") return;

  const messageType = msg.type;
  const dataNibble = msg.value;

  if (
    typeof messageType !== "number" ||
    typeof dataNibble !== "number" ||
    messageType < 0 ||
    messageType > 7
  ) {
    return;
  }

  mtcNibbles[messageType] = dataNibble;

  const decoded = decodeMtcFromNibbles(mtcNibbles, {
    showFrames: Boolean(config.mtc.showFrames)
  });
  if (!decoded) return;

  const oldMTC = currentMTC;
  currentMTC = decoded;
  lastMtcAt = Date.now();

  if (!mtcRunning) {
    mtcRunning = true;
    console.log("MTC Signal erkannt");
    broadcastStatus();
  }

  if (DEBUG_MTC && oldMTC !== currentMTC) {
    console.log("MTC:", currentMTC);
  }

  if (mtcVisible && oldMTC !== currentMTC) {
    broadcast({
      type: "mtc",
      visible: true,
      value: currentMTC,
      label: config.mtc.label || "MTC"
    });
  }
}

function closeMidiInput() {
  if (midiInput) {
    try {
      midiInput.close();
    } catch (err) {
      console.warn("MIDI Input konnte nicht sauber geschlossen werden:", err.message);
    }
  }

  midiInput = null;
  midiConnected = false;
}

function setupMidi() {
  if (!config.midi.enabled) {
    if (midiConnected || midiInput) {
      closeMidiInput();
    }
    console.log("MIDI ist in config.json deaktiviert.");
    return false;
  }

  if (!easymidi) {
    console.log("MIDI nicht verfügbar, weil easymidi nicht geladen werden konnte.");
    return false;
  }

  if (midiConnected && midiInput) {
    return true;
  }

  const inputs = getMidiInputs();

  if (!config.midi.inputName) {
    console.log("Kein MIDI Input in config.json gesetzt.");
    return false;
  }

  if (!inputs.includes(config.midi.inputName)) {
    midiConnected = false;

    const now = Date.now();
    if (now - lastMidiMissingLogAt > 30000) {
      console.warn(`MIDI Input nicht gefunden: ${config.midi.inputName}`);
      console.warn("Verfügbare MIDI Inputs:", inputs);
      lastMidiMissingLogAt = now;
    }

    return false;
  }

  try {
    midiInput = new easymidi.Input(config.midi.inputName);

    midiInput.on("mtc", handleMidiMessage);

    midiInput.on("sysex", (msg) => {
      if (DEBUG_MIDI_RAW) console.log("MIDI SYSEX:", msg);
    });

    midiInput.on("clock", (msg) => {
      if (DEBUG_MIDI_RAW) console.log("MIDI CLOCK:", msg);
    });

    midiInput.on("start", (msg) => {
      if (DEBUG_MIDI_RAW) console.log("MIDI START:", msg);
    });

    midiInput.on("stop", (msg) => {
      if (DEBUG_MIDI_RAW) console.log("MIDI STOP:", msg);
    });

    midiInput.on("continue", (msg) => {
      if (DEBUG_MIDI_RAW) console.log("MIDI CONTINUE:", msg);
    });

    midiConnected = true;
    console.log(`MIDI Input geöffnet: ${config.midi.inputName}`);
    broadcastStatus();
    return true;
  } catch (err) {
    midiConnected = false;
    midiInput = null;
    console.error("MIDI Input konnte nicht geöffnet werden:", err.message);
    return false;
  }
}

function startMidiReconnectLoop() {
  const intervalMs = Number(config.midi.reconnectIntervalMs);

  if (midiReconnectTimer) {
    clearInterval(midiReconnectTimer);
    midiReconnectTimer = null;
  }

  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    console.log("MIDI Auto-Reconnect deaktiviert.");
    return;
  }

  midiReconnectTimer = setInterval(() => {
    if (!config.midi.enabled) return;
    if (midiConnected && midiInput) return;
    setupMidi();
  }, intervalMs);
}

// === API: Control ===
app.post("/api/text", (req, res) => {
  const { line1, color1, line2, color2 } = req.body;
  showText(line1, color1, line2, color2);
  res.json({ ok: true, alertActive });
});

app.post("/api/countdown", (req, res) => {
  const { line1, color1, seconds, color2 } = req.body;
  startCountdown(line1, color1, seconds, color2);
  res.json({ ok: true, alertActive });
});

app.post("/api/countup", (req, res) => {
  const { line1, color1, color2 } = req.body;
  startCountup(line1, color1, color2);
  res.json({ ok: true, alertActive });
});

app.post("/api/mtc/on", (req, res) => {
  setMtcVisible(true);
  res.json({ ok: true });
});

app.post("/api/mtc/off", (req, res) => {
  setMtcVisible(false);
  res.json({ ok: true });
});

app.post("/api/clear", (req, res) => {
  stopAllTimers();
  countdownState = null;
  countupState = null;
  setCurrentDisplayState({ type: "clear" });
  broadcast({ type: "clear" });
  res.json({ ok: true, alertActive });
});

// === API: Alert ===
app.get("/api/alert", (req, res) => {
  res.json({
    active: alertActive,
    title: alertTitle,
    message: alertMessage,
    startedAt: alertStartedAt,
    presets: config.alert.presets || []
  });
});

app.post("/api/alert/on", (req, res) => {
  const title = req.body.title || config.alert.title || "STAGE ALERT";
  const message = req.body.message || "";

  if (!String(message).trim()) {
    res.status(400).json({ ok: false, message: "Keine Alert-Nachricht angegeben." });
    return;
  }

  setAlertActive(true, title, message);
  res.json({ ok: true, active: true });
});

app.post("/api/alert/off", (req, res) => {
  setAlertActive(false);
  res.json({ ok: true, active: false });
});


// === API: Ready ===
app.get("/api/ready", (req, res) => {
  res.json({
    active: readyActive,
    title: readyTitle,
    message: readyMessage,
    requestedAt: readyRequestedAt,
    confirmedAt: readyConfirmedAt,
    qlabHost: config.ready.qlabHost,
    qlabPort: config.ready.qlabPort,
    oscAddress: config.ready.oscAddress,
    returnOscAddress: readyReturnOscAddress
  });
});

app.post("/api/ready/request", (req, res) => {
  const title = req.body.title || config.ready.title || "BÜHNE BEREIT?";
  const message = req.body.message || config.ready.message || "Bitte bestätigen, wenn alle Positionen bereit sind.";
  const returnOscAddress = req.body.returnOscAddress || req.body.oscAddress || config.ready.oscAddress || "/cue/READY/start";

  setReadyActive(true, title, message, returnOscAddress);
  res.json({ ok: true, active: true });
});

app.post("/api/ready/cancel", (req, res) => {
  setReadyActive(false);
  res.json({ ok: true, active: false });
});

app.post("/api/ready/confirm", (req, res) => {
  const result = confirmReady();
  res.json(result);
});


// === API: Config ===
app.get("/api/config", (req, res) => {
  res.json(config);
});

app.post("/api/config", (req, res) => {
  const previousMidiInput = config.midi.inputName;
  const previousMidiEnabled = config.midi.enabled;

  const nextConfig = {
    ...config,
    ...req.body,
    midi: { ...config.midi, ...(req.body.midi || {}) },
    mtc: { ...config.mtc, ...(req.body.mtc || {}) },
    status: { ...config.status, ...(req.body.status || {}) },
    alert: { ...config.alert, ...(req.body.alert || {}) },
    ready: { ...config.ready, ...(req.body.ready || {}) }
  };

  saveConfig(nextConfig);
  config = nextConfig;

  if (!readyActive) {
    readyReturnOscAddress = config.ready.oscAddress || "/cue/READY/start";
  }

  const midiChanged =
    previousMidiInput !== config.midi.inputName ||
    previousMidiEnabled !== config.midi.enabled;

  if (midiChanged) {
    closeMidiInput();
    setupMidi();
    startMidiReconnectLoop();
  }

  res.json({
    ok: true,
    restartRequired: true,
    config
  });
});

app.get("/api/midi/inputs", (req, res) => {
  const inputs = Array.from(new Set(getMidiInputs().map(normalizeMidiName)));

  res.json({
    ok: true,
    inputs
  });
});

app.get("/api/status", (req, res) => {
  res.json(getStatusPayload());
});

// === WebSocket ===
wss.on("connection", (ws) => {
  if (DEBUG_WS) {
    console.log("WS client connected");
  }
  sendDisplayStateToClient(ws);
});

// === OSC ===
const udpPort = new osc.UDPPort({
  localAddress: "0.0.0.0",
  localPort: OSC_PORT
});

udpPort.on("message", (m) => {
  lastOscAt = Date.now();

  if (DEBUG_OSC) {
    console.log("OSC IN:", m.address, m.args);
  }

  // === Alert/Ready OSC-Eingänge von QLab ===
  // Diese Befehle werden bewusst ganz am Anfang des OSC-Handlers verarbeitet,
  // damit sie nicht versehentlich von anderen /display/... Routinen übergangen werden.

  // Alert starten:
  // /alert/on
  // /alert/on "STAGE ALERT" "Ausfall Mikrofon 1"
  if (m.address === "/alert/on") {
    const args = Array.isArray(m.args) ? m.args : [];

    const title = oscArgToString(args[0]) || config.alert.title || "STAGE ALERT";
    const message = oscArgToString(args[1]) || "Alert";

    setAlertActive(true, title, message);
    return;
  }

  // Alert aufheben:
  // /alert/off
  if (m.address === "/alert/off") {
    setAlertActive(false);
    return;
  }

  // Ready-Abfrage starten:
  // /ready/request
  // /ready/request "BÜHNE BEREIT?" "Bitte bestätigen, wenn alle Positionen bereit sind."
  if (m.address === "/ready/request") {
    const args = Array.isArray(m.args) ? m.args : [];

    const title = oscArgToString(args[0]) || config.ready.title || "BÜHNE BEREIT?";
    const message = oscArgToString(args[1]) || config.ready.message || "Bitte bestätigen, wenn alle Positionen bereit sind.";
    const returnOscAddress = oscArgToString(args[2]) || config.ready.oscAddress || "/cue/READY/start";

    setReadyActive(true, title, message, returnOscAddress);
    return;
  }

  // Ready-Abfrage abbrechen:
  // /ready/cancel
  if (m.address === "/ready/cancel") {
    setReadyActive(false);
    return;
  }

  // MTC-Steuerung darf intern weiter angenommen werden,
  // die View blendet MTC bei aktivem Alert aber aus.
  if (m.address === "/display/mtc/on") {
    setMtcVisible(true);
    return;
  }

  if (m.address === "/display/mtc/off") {
    setMtcVisible(false);
    return;
  }


  if (m.address === "/display/text") {
    const args = Array.isArray(m.args) ? m.args : [];
    const line1 = oscArgToString(args[0]);
    const color1 = oscArgToString(args[1]) || "white";
    const line2 = oscArgToString(args[2]);
    const color2 = oscArgToString(args[3]) || "white";

    if (!String(line1).trim()) {
      stopAllTimers();
      countdownState = null;
      countupState = null;
      setCurrentDisplayState({ type: "clear" });
      broadcast({ type: "clear" });
      return;
    }

    showText(line1, color1, line2, color2);
    return;
  }

  if (m.address === "/display/countdown") {
    const args = Array.isArray(m.args) ? m.args : [];
    startCountdown(
      oscArgToString(args[0]),
      oscArgToString(args[1]) || "white",
      oscArgToString(args[2]),
      oscArgToString(args[3]) || "white"
    );
    return;
  }

  if (m.address === "/display/countup") {
    const args = Array.isArray(m.args) ? m.args : [];
    startCountup(
      oscArgToString(args[0]),
      oscArgToString(args[1]) || "white",
      oscArgToString(args[2]) || "white"
    );
    return;
  }

  if (m.address === "/display/clear") {
    stopAllTimers();
    countdownState = null;
    countupState = null;
    setCurrentDisplayState({ type: "clear" });
    broadcast({ type: "clear" });
    return;
  }
});

udpPort.on("error", (err) => {
  console.error("OSC UDP error:", err);
});

udpPort.open();
setupMidi();
startMidiReconnectLoop();

setInterval(() => {
  const now = Date.now();

  if (mtcRunning && now - lastMtcAt > Number(config.status.mtcTimeoutMs || 1500)) {
    mtcRunning = false;
    console.log("MTC Signal verloren");
  }

  broadcastStatus();
}, 1000);

server.listen(HTTP_PORT, () => {
  console.log(`Web: http://localhost:${HTTP_PORT}`);
  console.log(`OSC UDP: ${OSC_PORT}`);
  console.log(`MTC sichtbar beim Start: ${mtcVisible ? "ja" : "nein"}`);
});

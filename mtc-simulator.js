// mtc-simulator.js
// Sendet MIDI Timecode Quarter Frame über einen MIDI-Ausgang.
// Standard-Ziel: IAC-Treiber Bus 1
//
// Start:
//   node mtc-simulator.js
//
// Optional mit anderem Output:
//   node mtc-simulator.js "IAC-Treiber Bus 1"

const easymidi = require("easymidi");

const OUTPUT_NAME = process.argv[2] || "IAC-Treiber Bus 1";
const FPS = 25;

const outputs = easymidi.getOutputs();

console.log("MIDI Outputs:", outputs);
console.log("Gewählter Output:", OUTPUT_NAME);

if (!outputs.includes(OUTPUT_NAME)) {
  console.error(`MIDI Output nicht gefunden: ${OUTPUT_NAME}`);
  console.error("");
  console.error("Verfügbare Outputs:");
  outputs.forEach((name) => console.error(" - " + name));
  process.exit(1);
}

const output = new easymidi.Output(OUTPUT_NAME);

// easymidi unterstützt keine generische send(\"message\", ...)-Funktion.
// Für MTC Quarter Frame senden wir rohe MIDI-Bytes über die interne node-midi Schnittstelle.
if (!output._output || typeof output._output.sendMessage !== "function") {
  console.error("Dieser easymidi Output erlaubt keinen Raw-MIDI-Versand.");
  output.close();
  process.exit(1);
}

let hours = 0;
let minutes = 0;
let seconds = 0;
let frames = 0;

// MTC Rate Code:
// 0 = 24 fps
// 1 = 25 fps
// 2 = 29.97 drop
// 3 = 30 fps
const rateCode = FPS === 24 ? 0 : FPS === 25 ? 1 : FPS === 30 ? 3 : 1;

function sendRaw(bytes) {
  output._output.sendMessage(bytes);
}

function sendQuarterFrame(type, value) {
  const dataByte = ((type & 0x07) << 4) | (value & 0x0f);

  // MIDI Timecode Quarter Frame:
  // Status 0xF1, danach ein Datenbyte
  sendRaw([0xf1, dataByte]);
}

function sendFullMtcFrame() {
  // MTC Quarter Frame besteht aus 8 Messages:
  // 0: frame low nibble
  // 1: frame high nibble
  // 2: seconds low
  // 3: seconds high
  // 4: minutes low
  // 5: minutes high
  // 6: hours low
  // 7: rate + hours high

  sendQuarterFrame(0, frames & 0x0f);
  sendQuarterFrame(1, (frames >> 4) & 0x01);

  sendQuarterFrame(2, seconds & 0x0f);
  sendQuarterFrame(3, (seconds >> 4) & 0x03);

  sendQuarterFrame(4, minutes & 0x0f);
  sendQuarterFrame(5, (minutes >> 4) & 0x03);

  sendQuarterFrame(6, hours & 0x0f);
  sendQuarterFrame(7, ((rateCode & 0x03) << 1) | ((hours >> 4) & 0x01));
}

function tickFrame() {
  sendFullMtcFrame();

  frames++;

  if (frames >= FPS) {
    frames = 0;
    seconds++;

    if (seconds >= 60) {
      seconds = 0;
      minutes++;

      if (minutes >= 60) {
        minutes = 0;
        hours = (hours + 1) % 24;
      }
    }

    const time = [
      String(hours).padStart(2, "0"),
      String(minutes).padStart(2, "0"),
      String(seconds).padStart(2, "0")
    ].join(":");

    console.log("MTC OUT:", time);
  }
}

const intervalMs = 1000 / FPS;

console.log("Sende MTC. Stoppen mit CTRL+C.");
console.log(`FPS: ${FPS}`);
console.log("");

const timer = setInterval(tickFrame, intervalMs);

process.on("SIGINT", () => {
  clearInterval(timer);
  output.close();
  console.log("");
  console.log("MTC Simulator beendet.");
  process.exit(0);
});

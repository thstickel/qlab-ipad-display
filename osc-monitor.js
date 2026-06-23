const osc = require("osc");

const PORT = 53001;

const udpPort = new osc.UDPPort({
  localAddress: "0.0.0.0",
  localPort: PORT
});

udpPort.on("ready", () => {
  console.log(`OSC Monitor läuft auf Port ${PORT}`);
});

udpPort.on("message", (msg, timeTag, info) => {
  console.log("================================");
  console.log("Von:", info.address + ":" + info.port);
  console.log("Adresse:", msg.address);
  console.log("Args:", JSON.stringify(msg.args, null, 2));
  console.log("================================");
});

udpPort.on("error", (err) => {
  console.error("OSC Fehler:", err);
});

udpPort.open();
function oscArgToString(a) {
  if (a == null) return "";
  return String(a.value ?? a);
}

function normalizeMidiName(name) {
  return String(name || "").replace(/\s+/g, " ").trim();
}

function formatTime(totalSeconds) {
  const min = Math.floor(totalSeconds / 60);
  const sec = totalSeconds % 60;
  return `${min}:${String(sec).padStart(2, "0")}`;
}

function parseAconnectInputs(output) {
  const inputs = [];
  let currentClientName = "";
  let currentClientId = "";

  const lines = String(output || "").split(/\r?\n/);

  for (const line of lines) {
    const clientMatch = line.match(/^client\s+(\d+):\s+'([^']+)'/);
    if (clientMatch) {
      currentClientId = clientMatch[1];
      currentClientName = normalizeMidiName(clientMatch[2]);
      continue;
    }

    const portMatch = line.match(/^\s*(\d+)\s+'([^']+)'/);
    if (portMatch && currentClientName && currentClientId) {
      const portId = portMatch[1];
      const portName = normalizeMidiName(portMatch[2]);
      const clientName = normalizeMidiName(currentClientName);

      inputs.push(normalizeMidiName(`${clientName}:${portName} ${currentClientId}:${portId}`));
    }
  }

  return inputs;
}

function decodeMtcFromNibbles(nibbles, options = {}) {
  const frames = (nibbles[1] << 4) | nibbles[0];
  const seconds = (nibbles[3] << 4) | nibbles[2];
  const minutes = (nibbles[5] << 4) | nibbles[4];

  const hoursLow = nibbles[6];
  const hoursHighAndRate = nibbles[7];
  const hoursHigh = hoursHighAndRate & 0x01;
  const hours = (hoursHigh << 4) | hoursLow;

  if (hours > 23 || minutes > 59 || seconds > 59 || frames > 99) {
    return null;
  }

  const simple = [
    String(hours).padStart(2, "0"),
    String(minutes).padStart(2, "0"),
    String(seconds).padStart(2, "0")
  ].join(":");

  if (!options.showFrames) {
    return simple;
  }

  return `${simple}:${String(frames).padStart(2, "0")}`;
}

module.exports = {
  oscArgToString,
  normalizeMidiName,
  formatTime,
  parseAconnectInputs,
  decodeMtcFromNibbles
};

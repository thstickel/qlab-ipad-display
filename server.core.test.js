const {
  formatTime,
  oscArgToString,
  normalizeMidiName,
  parseAconnectInputs,
  decodeMtcFromNibbles
} = require("./lib/core");

function buildNibbles({ hours = 0, minutes = 0, seconds = 0, frames = 0, rateCode = 0 } = {}) {
  return [
    frames & 0x0f,
    (frames >> 4) & 0x01,
    seconds & 0x0f,
    (seconds >> 4) & 0x03,
    minutes & 0x0f,
    (minutes >> 4) & 0x03,
    hours & 0x0f,
    ((rateCode & 0x03) << 1) | ((hours >> 4) & 0x01)
  ];
}

describe("formatTime", () => {
  test("formatiert Sekunden als m:ss", () => {
    expect(formatTime(0)).toBe("0:00");
    expect(formatTime(9)).toBe("0:09");
    expect(formatTime(65)).toBe("1:05");
    expect(formatTime(600)).toBe("10:00");
  });
});

describe("oscArgToString", () => {
  test("nimmt OSC-Arg mit value", () => {
    expect(oscArgToString({ value: "Hallo" })).toBe("Hallo");
  });

  test("nimmt Rohwert und behandelt null/undefined", () => {
    expect(oscArgToString("gelb")).toBe("gelb");
    expect(oscArgToString(null)).toBe("");
    expect(oscArgToString(undefined)).toBe("");
  });
});

describe("normalizeMidiName", () => {
  test("trimmt und verdichtet Whitespace", () => {
    expect(normalizeMidiName("  IAC   Bus  1  ")).toBe("IAC Bus 1");
  });

  test("leere Eingaben werden zu leerem String", () => {
    expect(normalizeMidiName("")).toBe("");
    expect(normalizeMidiName(null)).toBe("");
  });
});

describe("parseAconnectInputs", () => {
  test("parst typische aconnect -i Ausgabe", () => {
    const output = `
client 14: 'Midi Through' [type=kernel]
    0 'Midi Through Port-0'
client 28: 'CH345' [type=kernel]
    0 'CH345 MIDI 1'
`;
    expect(parseAconnectInputs(output)).toEqual([
      "Midi Through:Midi Through Port-0 14:0",
      "CH345:CH345 MIDI 1 28:0"
    ]);
  });

  test("leere/kaputte Ausgabe liefert []", () => {
    expect(parseAconnectInputs("")).toEqual([]);
    expect(parseAconnectInputs(null)).toEqual([]);
  });
});

describe("decodeMtcFromNibbles", () => {
  test("decodiert gültige Zeit ohne Frames", () => {
    const nibbles = buildNibbles({ hours: 1, minutes: 12, seconds: 45, frames: 12 });
    expect(decodeMtcFromNibbles(nibbles, { showFrames: false })).toBe("01:12:45");
  });

  test("decodiert mit Frames", () => {
    const nibbles = buildNibbles({ hours: 1, minutes: 12, seconds: 45, frames: 12 });
    expect(decodeMtcFromNibbles(nibbles, { showFrames: true })).toBe("01:12:45:12");
  });

  test("verwirft ungültige Minuten (Edge Case)", () => {
    const badMinutes = buildNibbles({ hours: 0, minutes: 63, seconds: 0, frames: 0 });
    expect(decodeMtcFromNibbles(badMinutes, { showFrames: false })).toBeNull();
  });

  test("verwirft ungültige Stunden (Edge Case)", () => {
    const badHours = buildNibbles({ hours: 24, minutes: 0, seconds: 0, frames: 0 });
    expect(decodeMtcFromNibbles(badHours, { showFrames: false })).toBeNull();
  });
});

# QLab Backstage Display System

## Übersicht

Das QLab Backstage Display System ist ein webbasiertes Informations- und Kommunikationssystem für Theater-, Musical-, Konzert-, Show- und Eventproduktionen.

Das System empfängt OSC-Nachrichten und MIDI Timecode (MTC) von QLab und stellt diese auf beliebigen Endgeräten dar.

Typische Einsatzorte:

* Backstage-Monitore
* Inspizientenplätze
* Seitenbühnen
* Technikräume
* Tablets
* iPads
* Smartphones

Zusätzlich ermöglicht das System die Kommunikation zwischen FOH und Backstage über Ready- und Alert-Meldungen.

---

# Funktionen

## Textanzeige

Anzeige von Informationen, Songtiteln oder Regieanweisungen.

Beispiel:

```text
Liedtitel Musterlied

Liedername
```

---

## Countdown

Anzeige eines Countdowns.

Beispiel:

```text
Vorhang schließen in

00:10
```

---

## Count-Up

Anzeige einer aufwärts laufenden Zeit.

Beispiel:

```text
Pause läuft

01:42
```

---

## MIDI Timecode (MTC)

Empfang von MIDI Timecode über:

* USB MIDI Adapter
* Focusrite Interfaces
* DIN-MIDI Adapter
* IAC Driver (macOS)

Anzeige:

```text
MTC 01:12:45
```

Optional:

```text
MTC 01:12:45:12
```

(Frame-Anzeige)

---

## Alert-System

Priorisierte Backstage-Meldungen.

Beispiele:

```text
Ausfall Mikrofon 1
```

```text
Batterie tauschen InEar 4
```

```text
Darsteller bitte zur Bühne
```

Eigenschaften:

* rotes Vollbild-Overlay
* bestehende Anzeige bleibt sichtbar
* MTC läuft weiter
* Countdowns laufen weiter
* Count-Ups laufen weiter
* Quittierung direkt auf dem Display möglich

---

## Ready-System

Kommunikation zwischen FOH und Backstage.

Beispiel:

FOH:

```text
READY ANFRAGEN
```

Backstage:

```text
BESTÄTIGEN
```

Nach der Bestätigung sendet das System automatisch einen OSC-Befehl an QLab zurück.

---

# Webseiten

## index.html

Hauptanzeige.

Darstellung von:

* Text
* Countdown
* Count-Up
* MIDI Timecode
* Alert Overlay
* Ready Overlay

Statuszeile:

```text
WS | OSC | MIDI | MTC | ALERT | READY
```

---

## control.html

Manuelle Steuerung.

Funktionen:

* Text senden
* Countdown starten
* Count-Up starten
* Anzeige löschen
* MTC einblenden
* MTC ausblenden

---

## alert.html

Mobile Alert-Seite.

Optimiert für:

* iPhone
* iPad
* Android Smartphones
* Android Tablets

---

## ready.html

Mobile Ready-Seite.

Optimiert für:

* iPhone
* iPad
* Android Smartphones
* Android Tablets

---

## config.html

Zentrale Konfiguration.

Konfigurierbar:

* HTTP-Port
* OSC-Port
* MIDI Input
* MTC Optionen
* Alert Optionen
* Ready Optionen
* Timeouts

---

# OSC Befehle

## Text anzeigen

Mit Farbnamen:

```text
/display/text "Liedtitel Musterlied" white "Liedername" yellow
```

Mit HEX-Farben:

```text
/display/text "Liedtitel Musterlied" "#ffffff" "Liedername" "#ffcc00"
```

Weiteres Beispiel:

```text
/display/text "Umbau läuft" "#00ff00" "Bitte Bühne räumen" "#ffffff"
```

---

## Anzeige löschen

```text
/display/clear
```

---

## Countdown starten

```text
/display/countdown "Vorhang schließen in" yellow 10 white
```

Parameter:

```text
Text
Textfarbe
Sekunden
Zeitfarbe
```

---

## Count-Up starten

```text
/display/countup "Pause läuft" yellow white
```

Parameter:

```text
Text
Textfarbe
Zeitfarbe
```

---

## MTC einblenden

```text
/display/mtc/on
```

---

## MTC ausblenden

```text
/display/mtc/off
```

---

## Ready-Anfrage starten

Standard:

```text
/ready/request
```

Eigener Titel:

```text
/ready/request "SHOWSTART" "Bitte Freigabe für Showbeginn bestätigen."
```

Mit individuellem OSC-Rückkanal:

```text
/ready/request "SHOWSTART" "Bitte Freigabe für Showbeginn bestätigen." "/cue/100/start"
```

Beispiel für die Pause:

```text
/ready/request "PAUSENENDE" "Bitte Freigabe für Akt 2 bestätigen." "/cue/200/start"
```

---

## Ready-Anfrage abbrechen

```text
/ready/cancel
```

---

## Alert anzeigen

```text
/alert/on "STAGE ALERT" "Ausfall Mikrofon 1"
```

Weitere Beispiele:

```text
/alert/on "STAGE ALERT" "Batterie tauschen InEar 4"
```

```text
/alert/on "STAGE ALERT" "Darsteller bitte zur Bühne"
```

---

## Alert aufheben

```text
/alert/off
```

---

# Farben

Folgende Farbnamen werden unterstützt:

```text
white
yellow
red
green
blue
orange
cyan
magenta
black
```

HEX-Farben können ebenfalls verwendet werden:

```text
#ffffff
#ff0000
#00ff00
#0000ff
#ffcc00
#ff9900
```

---

# Rückmeldung an QLab

Nach der Bestätigung einer Ready-Anfrage sendet der Server automatisch den definierten OSC-Befehl zurück.

Beispiele:

```text
/cue/100/start
```

```text
/cue/CREW_READY/start
```

Wichtig:

QLab verwendet hierbei die Cue Number und nicht den Cue-Namen.

---

# QLab Konfiguration

## OSC aktivieren

In QLab:

```text
Workspace Settings
→ Network
→ OSC Access
```

aktivieren:

```text
Enable OSC
Allow Control Without Passcode
```

Ohne diese Freigabe empfängt QLab OSC-Nachrichten zwar, führt diese jedoch nicht aus.

---

# Empfohlene Utility Cue List

Beispiel:

```text
UTILITY
├─ CREW_READY
├─ ACT2_READY
├─ TECH_ALERT
└─ BACKSTAGE_CALL
```

Beispiel Cue:

```text
Type: Blind Cue
Cue Number: CREW_READY
Cue Name: Backstage bereit
```

---

# Installation

## Voraussetzungen

Node.js 20 oder neuer

Prüfen:

```bash
node -v
npm -v
```

---

## Abhängigkeiten installieren

```bash
npm install
npm install osc
npm install ws
npm install express
npm install easymidi
```

---

# Raspberry Pi Installation

## System aktualisieren

```bash
sudo apt update
sudo apt upgrade
```

---

## Node.js installieren

```bash
sudo apt install nodejs npm
```

---

## ALSA Tools installieren

Für die MIDI-Erkennung auf Linux:

```bash
sudo apt install alsa-utils
```

---

## MIDI Geräte anzeigen

```bash
node midi-list.js
```

Beispiel:

```text
INPUTS:
[
  'CH345:CH345 MIDI 1 28:0'
]
```

Diesen MIDI Input anschließend in der config.html auswählen.

---

# Server starten

```bash
node server.js
```

Typische Ausgabe:

```text
Web: http://localhost:3000
OSC UDP: 53000
MTC sichtbar beim Start: nein
```

---

# Automatischer Start mit systemd

Datei erstellen:

```bash
sudo nano /etc/systemd/system/qlab-display.service
```

Inhalt:

```ini
[Unit]
Description=QLab Backstage Display
After=network.target

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/qlab-ipad-display
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Aktivieren:

```bash
sudo systemctl daemon-reload
sudo systemctl enable qlab-display
sudo systemctl start qlab-display
```

Status prüfen:

```bash
sudo systemctl status qlab-display
```

Live-Log:

```bash
journalctl -u qlab-display -f
```

---

# Typischer Showablauf

## Showbeginn

QLab:

```text
/ready/request "SHOWSTART" "Bitte Freigabe für Showbeginn bestätigen." "/cue/100/start"
```

Backstage bestätigt.

Server:

```text
/cue/100/start
```

QLab startet Cue 100.

---

## Pause

QLab:

```text
/ready/request "PAUSENENDE" "Bitte Freigabe für Akt 2 bestätigen." "/cue/200/start"
```

Backstage bestätigt.

Server:

```text
/cue/200/start
```

QLab startet Cue 200.

---

# Lizenz

Interne Nutzung für Theater-, Musical-, Konzert-, Show- und Eventproduktionen.
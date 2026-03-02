<p align="center">
  <img src="https://img.shields.io/badge/Node.js-20+-339933?logo=node.js&logoColor=white" alt="Node.js">
  <img src="https://img.shields.io/badge/Express-5-000000?logo=express&logoColor=white" alt="Express">
  <img src="https://img.shields.io/badge/Socket.io-4-010101?logo=socket.io&logoColor=white" alt="Socket.io">
  <img src="https://img.shields.io/badge/Globe.gl-3D-00ccff?logo=three.js&logoColor=white" alt="Globe.gl">
  <img src="https://img.shields.io/badge/License-MIT-blue" alt="MIT License">
</p>

# 🌐 TCPGEO

**Echtzeit-Visualisierung von Server-Traffic auf einer interaktiven 2D- und 3D-Weltkarte mittels tcpdump über ssh.**

TCPGEO verbindet sich per SSH mit Servern, führt `tcpdump` aus, löst die erfassten IPs über MaxMind GeoIP auf und zeigt den Traffic live auf einem Cyber-3D-Globus sowie einer 2D-Leaflet-Karte an.

![TCPGEO Screenshot](Screenshot.jpg)

---

## ✨ Features

- **Echtzeit-Traffic-Visualisierung** — Live-Arcs und Geo-Punkte auf 3D-Globus und 2D-Karte
- **SSH-basiertes Capturing** — Verbindung zu beliebigen Servern via Passwort oder SSH-Key
- **GeoIP-Auflösung** — Automatische IP → Standort-Zuordnung (Stadt, Land, Koordinaten)
- **Cyber-UI** — Dunkles Design mit Neon-Akzenten, HUD-Overlays und Starfield-Hintergrund
- **Presets** — Konfigurierbare tcpdump-Filter pro Server (Interface, Filter, Regex)
- **Multi-User** — JWT-basierte Authentifizierung mit Admin/Viewer-Rollen
- **Server-Verwaltung** — CRUD für SSH-Server mit Verbindungstest
- **Auto-GeoIP-Update** — Wöchentlicher Cron-Job aktualisiert die GeoIP-Datenbank
- **systemd-Integration** — Service-Datei und Management-Script inklusive
- **Beschriftete Geo-Punkte** — Flexible Labels mit Stadt/Land an jedem Traffic-Punkt

---

## 📋 Voraussetzungen

| Komponente | Version |
|---|---|
| **OS** | Debian / Ubuntu (oder kompatibel) |
| **Node.js** | ≥ 18 (empfohlen: 20+) |
| **MaxMind Account** | Kostenlos unter [maxmind.com/en/geolite2/signup](https://www.maxmind.com/en/geolite2/signup) |
| **Zielserver** | SSH-Zugang + `tcpdump` installiert |

---

## 🚀 Quick Install

```bash
git clone https://github.com/bmetallica/TCPGEO.git /opt/tcpgeo
cd /opt/tcpgeo
sudo bash setup.sh
```

Das Setup-Script erledigt alles automatisch:
- Installiert Node.js 20 (falls nötig)
- Installiert npm-Abhängigkeiten
- Fragt den MaxMind License Key ab
- Initialisiert die Datenbank
- Lädt die GeoIP-Datenbank herunter
- Legt einen Admin-User an
- Installiert optional den systemd-Service

---

## 🔧 Manuelle Installation

### 1. Repository klonen

```bash
git clone https://github.com/bmetallica/TCPGEO.git /opt/tcpgeo
cd /opt/tcpgeo
```

### 2. Abhängigkeiten installieren

```bash
npm install --production
```

### 3. Umgebungsvariablen konfigurieren

```bash
cp .env.example .env
nano .env
```

```dotenv
MAXMIND_LICENSE_KEY=dein_license_key_hier
JWT_SECRET=ein_langer_zufaelliger_string
PORT=3333
```

> **Tipp**: JWT_SECRET generieren: `openssl rand -hex 32`

### 4. GeoIP-Datenbank herunterladen

```bash
npm run download-geoip
```

### 5. Datenbank initialisieren

```bash
npm run init-db
```

### 6. Admin-User anlegen

```bash
npm run create-admin -- admin deinPasswort
```

### 7. Server starten

```bash
npm start
```

Dashboard öffnen: **http://deine-ip:3333**

---

## 🖥️ systemd Service

```bash
# Service installieren und aktivieren
sudo cp service/tcpgeo.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now tcpgeo

# Oder über das mitgelieferte Script:
sudo bash service/tcpgeo-ctl.sh install
sudo bash service/tcpgeo-ctl.sh start
```

**Verfügbare Befehle:**

```bash
bash service/tcpgeo-ctl.sh {install|start|stop|restart|status|logs}
```

---

## 📁 Projektstruktur

```
tcpgeo/
├── server.js                  # Haupt-Entry-Point
├── setup.sh                   # Quick-Install-Script
├── .env                       # Umgebungsvariablen
├── package.json
│
├── backend/
│   ├── auth.js                # JWT-Authentifizierung
│   ├── aggregation.js         # Paket-Aggregation (Anti-Flood)
│   ├── tcpdump-streamer.js    # SSH + tcpdump Streaming
│   └── routes/
│       ├── auth-routes.js     # Login / User-Management
│       ├── server-routes.js   # Server CRUD + Verbindungstest
│       └── preset-routes.js   # Preset CRUD
│
├── frontend/
│   ├── index.html             # SPA Entry
│   ├── app.js                 # Client-Logik (Maps, Socket.io, UI)
│   └── cyberpunk.css          # Cyberpunk-Theme
│
├── db/
│   ├── database.js            # SQLite Zugriffs-Layer
│   ├── init-db.js             # Schema-Migration
│   └── create-admin.js        # Admin-User anlegen
│
├── geoip/
│   ├── geoip-resolver.js      # IP → Geo-Daten
│   ├── download-geoip.js      # MaxMind DB Download
│   └── geoip-update-scheduler.js  # Auto-Update Cron
│
└── service/
    ├── tcpgeo.service         # systemd Unit
    └── tcpgeo-ctl.sh          # Service-Management
```

---

## ⚙️ Konfiguration

### Umgebungsvariablen (.env)

| Variable | Standard | Beschreibung |
|---|---|---|
| `MAXMIND_LICENSE_KEY` | — | MaxMind GeoLite2 License Key (erforderlich) |
| `JWT_SECRET` | `tcpgeo-secret-change-me` | Secret für JWT-Token-Signierung |
| `PORT` | `3333` | HTTP-Port des Dashboards |
| `GEOIP_UPDATE_SCHEDULE` | `0 3 * * 0` | Cron-Schedule für GeoIP-Updates |

### Server hinzufügen

1. Im Dashboard einloggen
2. **Admin-Panel** → **Server** → **Neuer Server**
3. SSH-Daten eingeben (Host, Port, User, Passwort oder Key)
4. Verbindung testen
5. Optional: **Presets** mit tcpdump-Filtern anlegen

### Presets

Presets definieren tcpdump-Parameter pro Server:

| Feld | Beispiel | Beschreibung |
|---|---|---|
| **Interface** | `eth0` | Netzwerk-Interface |
| **Filter** | `port 80 or port 443` | tcpdump BPF-Filter |
| **Regex** | *(leer = Standard)* | Eigener Regex zur IP-Extraktion |

---

## 🔒 Sicherheitshinweise

- **JWT_SECRET** unbedingt in Produktion ändern
- Standard-Admin-Passwort nach Setup sofort ändern
- SSH-Keys statt Passwörter wenn möglich verwenden
- Zugriff auf Port 3333 per Firewall einschränken oder Reverse-Proxy (nginx) vorschalten
- Die `.env`-Datei enthält Secrets — **nicht ins Repository committen**

---

## 📜 Lizenz

MIT License — siehe [LICENSE](LICENSE)

---

<p align="center">
  <b>Made with ☕ and tcpdump</b>
</p>

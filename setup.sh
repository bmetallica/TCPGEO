#!/bin/bash
# ============================================================
#  TCPGEO – Quick Install Script
#  Automatische Installation auf Debian/Ubuntu
#  https://github.com/bmetallica/TCPGEO
# ============================================================
set -e

GREEN='\033[0;32m'
CYAN='\033[0;36m'
RED='\033[0;31m'
BOLD='\033[1m'
NC='\033[0m'

INSTALL_DIR="/opt/tcpgeo"

banner() {
  echo -e "${CYAN}${BOLD}"
  echo "  ╔═══════════════════════════════════════╗"
  echo "  ║           TCPGEO Setup                ║"
  echo "  ║   Real-Time Traffic Visualization     ║"
  echo "  ╚═══════════════════════════════════════╝"
  echo -e "${NC}"
}

info()  { echo -e "${GREEN}[✓]${NC} $1"; }
warn()  { echo -e "${CYAN}[i]${NC} $1"; }
fail()  { echo -e "${RED}[✗]${NC} $1"; exit 1; }

# ---- Voraussetzungen prüfen ----
check_root() {
  if [[ $EUID -ne 0 ]]; then
    fail "Bitte als root ausführen: sudo bash setup.sh"
  fi
}

check_os() {
  if ! command -v apt &>/dev/null; then
    fail "Dieses Script unterstützt nur Debian/Ubuntu (apt)"
  fi
}

# ---- Node.js installieren (falls nötig) ----
install_node() {
  if command -v node &>/dev/null; then
    NODE_VER=$(node -v)
    info "Node.js gefunden: $NODE_VER"
    # Mindestversion 18 prüfen
    NODE_MAJOR=$(echo "$NODE_VER" | sed 's/v//' | cut -d. -f1)
    if [[ "$NODE_MAJOR" -lt 18 ]]; then
      warn "Node.js $NODE_VER ist zu alt. Installiere Node.js 20..."
      install_node_20
    fi
  else
    warn "Node.js nicht gefunden. Installiere Node.js 20..."
    install_node_20
  fi
}

install_node_20() {
  apt-get update -qq
  apt-get install -y -qq ca-certificates curl gnupg
  mkdir -p /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | \
    gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg 2>/dev/null
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main" | \
    tee /etc/apt/sources.list.d/nodesource.list >/dev/null
  apt-get update -qq
  apt-get install -y -qq nodejs
  info "Node.js $(node -v) installiert"
}

# ---- System-Abhängigkeiten ----
install_deps() {
  info "Installiere System-Abhängigkeiten..."
  apt-get update -qq
  apt-get install -y -qq build-essential python3 git
}

# ---- Projekt klonen oder bestätigen ----
setup_project() {
  if [[ -f "$INSTALL_DIR/package.json" ]]; then
    info "Projekt bereits vorhanden in $INSTALL_DIR"
  else
    warn "Klone TCPGEO nach $INSTALL_DIR..."
    git clone https://github.com/bmetallica/TCPGEO.git "$INSTALL_DIR"
    info "Repository geklont"
  fi
  cd "$INSTALL_DIR"
}

# ---- npm install ----
install_npm() {
  info "Installiere Node.js-Abhängigkeiten..."
  cd "$INSTALL_DIR"
  npm install --production 2>&1 | tail -1
  info "npm-Pakete installiert"
}

# ---- .env konfigurieren ----
setup_env() {
  cd "$INSTALL_DIR"
  if [[ ! -f .env ]] || ! grep -q 'MAXMIND_LICENSE_KEY=.' .env; then
    echo ""
    echo -e "${CYAN}${BOLD}── MaxMind GeoLite2 Konfiguration ──${NC}"
    echo -e "Für die GeoIP-Auflösung wird ein kostenloser MaxMind-Schlüssel benötigt."
    echo -e "Registrierung: ${BOLD}https://www.maxmind.com/en/geolite2/signup${NC}"
    echo ""
    read -rp "MaxMind License Key eingeben (Enter zum Überspringen): " MM_KEY

    # JWT Secret generieren
    JWT_SEC=$(openssl rand -hex 32 2>/dev/null || head -c 64 /dev/urandom | base64 | tr -d '/+=' | head -c 64)

    cat > .env <<EOF
MAXMIND_LICENSE_KEY=${MM_KEY}
JWT_SECRET=${JWT_SEC}
PORT=3333
EOF
    info ".env erstellt"
  else
    info ".env bereits konfiguriert"
  fi
}

# ---- Datenbank initialisieren ----
init_database() {
  cd "$INSTALL_DIR"
  info "Initialisiere Datenbank..."
  node db/init-db.js
  info "Datenbank bereit"
}

# ---- GeoIP herunterladen ----
download_geoip() {
  cd "$INSTALL_DIR"
  if [[ -f geoip/GeoLite2-City.mmdb ]]; then
    info "GeoIP-Datenbank bereits vorhanden"
    return
  fi
  if grep -q 'MAXMIND_LICENSE_KEY=.' .env; then
    info "Lade GeoIP-Datenbank herunter..."
    node geoip/download-geoip.js && info "GeoIP-Datenbank geladen" || warn "GeoIP-Download fehlgeschlagen – kann später nachgeholt werden"
  else
    warn "Kein MaxMind Key → GeoIP-Download übersprungen (später: npm run download-geoip)"
  fi
}

# ---- Admin-User anlegen ----
create_admin() {
  cd "$INSTALL_DIR"
  echo ""
  echo -e "${CYAN}${BOLD}── Admin-Benutzer anlegen ──${NC}"
  read -rp "Admin Username [admin]: " ADMIN_USER
  ADMIN_USER=${ADMIN_USER:-admin}
  read -rsp "Admin Passwort [admin]: " ADMIN_PASS
  echo ""
  ADMIN_PASS=${ADMIN_PASS:-admin}
  node db/create-admin.js "$ADMIN_USER" "$ADMIN_PASS"
  info "Admin-User '$ADMIN_USER' erstellt"
}

# ---- systemd Service installieren ----
install_service() {
  cd "$INSTALL_DIR"
  echo ""
  read -rp "systemd-Service installieren? [J/n]: " INSTALL_SVC
  INSTALL_SVC=${INSTALL_SVC:-J}
  if [[ "$INSTALL_SVC" =~ ^[JjYy]$ ]]; then
    cp service/tcpgeo.service /etc/systemd/system/tcpgeo.service
    systemctl daemon-reload
    systemctl enable tcpgeo
    systemctl start tcpgeo
    info "Service installiert und gestartet"
  else
    warn "Service übersprungen – manuell starten: cd $INSTALL_DIR && node server.js"
  fi
}

# ---- Abschluss ----
finish() {
  PORT=$(grep -oP 'PORT=\K\d+' "$INSTALL_DIR/.env" 2>/dev/null || echo "3333")
  echo ""
  echo -e "${GREEN}${BOLD}════════════════════════════════════════${NC}"
  echo -e "${GREEN}${BOLD}  TCPGEO Installation abgeschlossen!${NC}"
  echo -e "${GREEN}${BOLD}════════════════════════════════════════${NC}"
  echo ""
  echo -e "  Dashboard:  ${BOLD}http://$(hostname -I | awk '{print $1}'):${PORT}${NC}"
  echo -e "  Verzeichnis: ${INSTALL_DIR}"
  echo ""
  echo -e "  Service: ${CYAN}systemctl status tcpgeo${NC}"
  echo -e "  Logs:    ${CYAN}journalctl -u tcpgeo -f${NC}"
  echo ""
}

# ============================================================
#  Main
# ============================================================
banner
check_root
check_os
install_deps
install_node
setup_project
install_npm
setup_env
init_database
download_geoip
create_admin
install_service
finish

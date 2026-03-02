#!/bin/bash
# tcpgeo Service-Management (Debian/Ubuntu)
# Nutzung: ./tcpgeo-ctl.sh {install|start|stop|restart|status|logs}

SERVICE_FILE="/opt/tcpgeo/service/tcpgeo.service"
SYSTEMD_LINK="/etc/systemd/system/tcpgeo.service"

case "$1" in
  install)
    echo "[tcpgeo] Installiere systemd-Service..."
    cp "$SERVICE_FILE" "$SYSTEMD_LINK"
    systemctl daemon-reload
    systemctl enable tcpgeo
    echo "[tcpgeo] Service installiert und aktiviert."
    ;;
  start)
    systemctl start tcpgeo
    echo "[tcpgeo] Gestartet."
    ;;
  stop)
    systemctl stop tcpgeo
    echo "[tcpgeo] Gestoppt."
    ;;
  restart)
    systemctl restart tcpgeo
    echo "[tcpgeo] Neugestartet."
    ;;
  status)
    systemctl status tcpgeo
    ;;
  logs)
    journalctl -u tcpgeo -f
    ;;
  *)
    echo "Nutze: $0 {install|start|stop|restart|status|logs}"
    exit 1
    ;;
esac

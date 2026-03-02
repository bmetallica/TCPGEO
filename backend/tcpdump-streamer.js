// SSH/tcpdump-Streamer: Verbindet sich via SSH, startet tcpdump, extrahiert IPs
const { Client } = require('ssh2');
const EventEmitter = require('events');

// Standard-Regex: Extrahiert Source-IP aus tcpdump -nn Output
// Format: "12:34:56.789 IP 1.2.3.4.12345 > 5.6.7.8.80: ..."
// Regex matcht die Source-IP (4 Oktet-Gruppen) vor dem Port-Suffix
const DEFAULT_IP_REGEX = 'IP\\s+(\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3})\\.\\d+\\s+>';

class TcpDumpStreamer extends EventEmitter {
  constructor({ host, port = 22, username, privateKey, password, authType = 'key', interfaceName = 'eth0', filter = '', regex = '' }) {
    super();
    this.sshConfig = {
      host,
      port: parseInt(port),
      username,
      readyTimeout: 15000
    };
    if (authType === 'password' && password) {
      this.sshConfig.password = password;
      this.sshConfig.tryKeyboard = true;
    } else if (privateKey && privateKey.trim()) {
      this.sshConfig.privateKey = privateKey;
    }
    this.interfaceName = interfaceName;
    this.filter = filter;
    this.ipRegex = new RegExp(regex || DEFAULT_IP_REGEX);
    this.conn = null;
    this.stream = null;
    this.running = false;
    this.capturing = false;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.capturing = false;
    this.conn = new Client();

    // -nn = keine Hostname-Auflösung, keine Port-Name-Auflösung → nur numerische IPs
    const cmd = `sudo tcpdump -l -nn -i ${this.interfaceName}${this.filter ? ' ' + this.filter : ''}`;
    console.log(`[TcpDump] SSH -> ${this.sshConfig.host}: ${cmd}`);

    this.conn.on('ready', () => {
      this.emit('status', 'connected');
      // pty:true → stderr wird in stdout gemerged, wichtig für sudo + tcpdump
      this.conn.exec(cmd, { pty: true }, (err, stream) => {
        if (err) {
          console.error('[TcpDump] exec Fehler:', err.message);
          this.emit('error', 'exec Fehler: ' + err.message);
          this.stop();
          return;
        }
        this.stream = stream;

        stream.on('data', (data) => {
          const text = data.toString();
          const lines = text.split('\n');
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            // tcpdump Info-Zeilen (stderr via PTY in stdout gemerged)
            if (trimmed.includes('listening on')) {
              this.capturing = true;
              this.emit('status', 'capturing');
              console.log('[TcpDump] ' + trimmed);
              continue;
            }
            if (trimmed.includes('packets captured') || trimmed.includes('packets received') || trimmed.includes('packets dropped')) {
              console.log('[TcpDump] ' + trimmed);
              continue;
            }

            // Fehler erkennen (sudo, tcpdump nicht gefunden, Interface-Fehler usw.)
            if (/tcpdump:\s+(.*error|permission|no suitable|can.*open|unknown)/i.test(trimmed) ||
                /sudo.*password|command not found|No such device/i.test(trimmed)) {
              console.error('[TcpDump] Fehler:', trimmed);
              this.emit('error', trimmed);
              continue;
            }

            // IP-Regex anwenden
            const match = trimmed.match(this.ipRegex);
            if (match && match[1]) {
              this.emit('ip', match[1], trimmed);
            }
          }
        });

        // Mit pty:true kommt stderr normalerweise nicht separat, aber sicherheitshalber
        stream.stderr.on('data', (data) => {
          const msg = data.toString().trim();
          if (msg.includes('listening on')) {
            this.capturing = true;
            this.emit('status', 'capturing');
          } else if (msg) {
            console.error('[TcpDump stderr]', msg);
          }
        });

        stream.on('close', (code) => {
          console.log(`[TcpDump] Stream geschlossen (code=${code}, capturing=${this.capturing})`);
          this.running = false;
          if (!this.capturing) {
            this.emit('error', 'tcpdump beendet ohne zu starten – prüfe Interface, Filter und Berechtigungen');
          }
          this.emit('close');
        });
      });
    });

    this.conn.on('error', (err) => {
      console.error('[TcpDump] SSH Fehler:', err.message);
      this.emit('error', 'SSH Fehler: ' + err.message);
      this.running = false;
    });

    this.conn.on('keyboard-interactive', (name, instructions, lang, prompts, finish) => {
      finish([this.sshConfig.password || '']);
    });

    this.conn.connect(this.sshConfig);
  }

  stop() {
    if (!this.running && !this.conn) return; // Verhindere doppeltes close
    this.running = false;
    try {
      if (this.stream) {
        this.stream.write('\x03'); // Ctrl+C an tcpdump senden
        setTimeout(() => {
          try {
            if (this.stream) { this.stream.close(); this.stream = null; }
            if (this.conn) { this.conn.end(); this.conn = null; }
          } catch (e) { /* ignorieren */ }
        }, 300);
      } else {
        if (this.conn) { this.conn.end(); this.conn = null; }
      }
    } catch (e) { /* Verbindung war schon geschlossen */ }
  }

  isRunning() {
    return this.running;
  }
}

module.exports = TcpDumpStreamer;

// Paket-Aggregation: Sammelt IPs und sendet sie gebündelt ans Frontend
// Verhindert, dass bei DDoS das Frontend einfriert

const FLUSH_INTERVAL_MS = 500; // Alle 500ms aggregierte Daten senden
const MAX_BUFFER_SIZE = 200;   // Max. Pakete pro Flush

class PacketAggregator {
  constructor(io) {
    this.io = io;
    this.buffers = new Map(); // socketId -> [{ ip, lat, lon, country, city }]
    this.interval = null;
  }

  start() {
    this.interval = setInterval(() => this.flush(), FLUSH_INTERVAL_MS);
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  addPacket(socketId, packet) {
    if (!this.buffers.has(socketId)) {
      this.buffers.set(socketId, []);
    }
    const buf = this.buffers.get(socketId);
    buf.push(packet);
    // Overflow-Schutz
    if (buf.length > MAX_BUFFER_SIZE) {
      buf.splice(0, buf.length - MAX_BUFFER_SIZE);
    }
  }

  flush() {
    for (const [socketId, packets] of this.buffers.entries()) {
      if (packets.length === 0) continue;
      const socket = this.io.sockets.sockets.get(socketId);
      if (socket) {
        socket.emit('packets', packets);
      }
      this.buffers.set(socketId, []);
    }
  }

  removeSocket(socketId) {
    this.buffers.delete(socketId);
  }
}

module.exports = PacketAggregator;

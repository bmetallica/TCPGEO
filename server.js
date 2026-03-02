// tcpgeo - Haupt-Entry-Point
// Verbindet alle Module: Express, Socket.io, Auth, GeoIP, SSH-Streaming
require('dotenv').config();

const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

// Module
const { initGeoIP, resolveIP, isReady: geoReady } = require('./geoip/geoip-resolver');
const { startGeoIPScheduler } = require('./geoip/geoip-update-scheduler');
const { verifySocketToken } = require('./backend/auth');
const { dbGet } = require('./db/database');
const TcpDumpStreamer = require('./backend/tcpdump-streamer');
const PacketAggregator = require('./backend/aggregation');

// Routes
const authRoutes = require('./backend/routes/auth-routes');
const serverRoutes = require('./backend/routes/server-routes');
const presetRoutes = require('./backend/routes/preset-routes');

// ---- Express Setup ----
const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3333;

// ---- Socket.io ----
const io = new Server(server, {
  cors: { origin: '*' }
});

// ---- Middleware ----
app.use(express.json());
app.use(express.static(path.join(__dirname, 'frontend')));

// ---- API-Routen ----
app.use('/api', authRoutes);
app.use('/api', serverRoutes);
app.use('/api', presetRoutes);

// GeoIP Status-Endpunkt
app.get('/api/geoip/status', (req, res) => {
  res.json({ ready: geoReady() });
});

// Fallback -> Frontend
app.get('/{0,}', (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend', 'index.html'));
});

// ---- Aggregator ----
const aggregator = new PacketAggregator(io);
aggregator.start();

// ---- Aktive Streams ----
const activeStreams = new Map(); // socketId -> TcpDumpStreamer

// ---- Socket.io Verbindungen ----
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) return next(new Error('Token fehlt'));
  const user = verifySocketToken(token);
  if (!user) return next(new Error('Token ungültig'));
  socket.user = user;
  next();
});

io.on('connection', (socket) => {
  console.log(`[WS] Client verbunden: ${socket.user.username} (${socket.id})`);

  socket.on('start', async ({ serverId, presetId }) => {
    if (activeStreams.has(socket.id)) {
      socket.emit('error', 'Stream läuft bereits');
      return;
    }

    try {
      // Server-Daten aus DB laden
      const srv = await dbGet('SELECT * FROM servers WHERE id = ?', [serverId]);
      if (!srv) {
        socket.emit('error', 'Server nicht gefunden');
        return;
      }

      // Preset laden (optional)
      let preset = { interface: 'eth0', filter: '', regex: '' };
      if (presetId) {
        const p = await dbGet('SELECT * FROM presets WHERE id = ? AND server_id = ?', [presetId, serverId]);
        if (p) preset = p;
      }

      console.log(`[WS] Start: ${socket.user.username} -> ${srv.name} (${srv.host}) iface=${preset.interface} filter="${preset.filter}"`);

      const streamer = new TcpDumpStreamer({
        host: srv.host,
        port: srv.port,
        username: srv.ssh_user,
        authType: srv.ssh_auth_type || 'key',
        privateKey: srv.ssh_key || undefined,
        password: srv.ssh_password || undefined,
        interfaceName: preset.interface,
        filter: preset.filter,
        regex: preset.regex
      });

      // IP extrahiert -> GeoIP auflösen -> aggregieren
      streamer.on('ip', (ip, rawLine) => {
        const geo = resolveIP(ip);
        if (geo) {
          aggregator.addPacket(socket.id, {
            ip,
            lat: geo.lat,
            lon: geo.lon,
            country: geo.country,
            city: geo.city
          });
        }
      });

      streamer.on('status', (status) => {
        socket.emit('status', status);
      });

      streamer.on('error', (msg) => {
        console.error(`[WS] Error (${socket.user.username}):`, msg);
        socket.emit('error', msg);
      });

      streamer.on('close', () => {
        activeStreams.delete(socket.id);
        aggregator.removeSocket(socket.id);
        socket.emit('stopped');
      });

      streamer.start();
      activeStreams.set(socket.id, streamer);
      socket.emit('started');

    } catch (err) {
      console.error('[WS] Start-Fehler:', err.message);
      socket.emit('error', err.message);
    }
  });

  socket.on('stop', () => {
    const streamer = activeStreams.get(socket.id);
    if (streamer) {
      console.log(`[WS] Stop: ${socket.user.username}`);
      streamer.stop();
      activeStreams.delete(socket.id);
      aggregator.removeSocket(socket.id);
      socket.emit('stopped');
    }
  });

  socket.on('disconnect', () => {
    const streamer = activeStreams.get(socket.id);
    if (streamer) {
      streamer.stop();
      activeStreams.delete(socket.id);
      aggregator.removeSocket(socket.id);
    }
    console.log(`[WS] Getrennt: ${socket.user.username}`);
  });
});

// ---- Start ----
async function boot() {
  console.log('[tcpgeo] Starte...');

  // GeoIP laden
  await initGeoIP();
  startGeoIPScheduler();

  server.listen(PORT, () => {
    console.log(`[tcpgeo] Server läuft auf http://0.0.0.0:${PORT}`);
    console.log(`[tcpgeo] GeoIP bereit: ${geoReady()}`);
  });
}

boot().catch(err => {
  console.error('[tcpgeo] Start fehlgeschlagen:', err);
  process.exit(1);
});

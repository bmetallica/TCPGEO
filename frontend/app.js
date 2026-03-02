// tcpgeo Frontend - Vollständige Client-Logik
// Auth, Server/Preset-Auswahl, Socket.io-Streaming, Leaflet 2D, Globe.gl 3D
// Admin: Server-CRUD, Preset-CRUD, User-Management

(function () {
  'use strict';

  // ---- State ----
  let token = localStorage.getItem('tcpgeo_token');
  let user = null;
  let socket = null;
  let map = null;
  let globe = null;
  let markers = [];
  let arcsData = [];
  let pointsData = [];
  let labelsData = [];
  let viewMode = '3d';
  let streaming = false;
  let servers = [];
  let presets = [];
  let editingServerId = null;
  let editingPresetId = null;

  // ---- DOM ----
  const $ = (id) => document.getElementById(id);
  const loginOverlay = $('login-overlay');
  const loginUser = $('login-user');
  const loginPass = $('login-pass');
  const loginBtn = $('login-btn');
  const loginError = $('login-error');
  const appEl = $('app');
  const serverSelect = $('server-select');
  const presetSelect = $('preset-select');
  const btnStart = $('btn-start');
  const btnStop = $('btn-stop');
  const statusBadge = $('status-badge');
  const btnViewToggle = $('btn-view-toggle');
  const btnLogToggle = $('btn-log-toggle');
  const btnSidebarToggle = $('btn-sidebar-toggle');
  const userInfo = $('user-info');
  const btnLogout = $('btn-logout');
  const mapEl = $('map');
  const globeEl = $('globeViz');
  const sidebar = $('sidebar');
  const adminPanel = $('admin-panel');
  const packetLog = $('packet-log');

  // ---- API Helper ----
  async function api(method, url, body) {
    const opts = { method, headers: { 'Content-Type': 'application/json' } };
    if (token) opts.headers['Authorization'] = 'Bearer ' + token;
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch('/api' + url, opts);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'API Fehler');
    return data;
  }

  // ---- Login ----
  async function doLogin() {
    loginError.style.display = 'none';
    try {
      const result = await api('POST', '/login', {
        username: loginUser.value,
        password: loginPass.value
      });
      token = result.token;
      user = result.user;
      localStorage.setItem('tcpgeo_token', token);
      showApp();
    } catch (err) {
      loginError.textContent = err.message;
      loginError.style.display = 'block';
    }
  }
  loginBtn.onclick = doLogin;
  loginPass.onkeydown = (e) => { if (e.key === 'Enter') doLogin(); };

  function logout() {
    token = null; user = null;
    localStorage.removeItem('tcpgeo_token');
    if (socket) socket.disconnect();
    appEl.style.display = 'none';
    loginOverlay.style.display = 'flex';
  }
  btnLogout.onclick = logout;

  // ---- App Init ----
  async function showApp() {
    loginOverlay.style.display = 'none';
    appEl.style.display = 'flex';
    try { user = await api('GET', '/me'); } catch { logout(); return; }
    userInfo.textContent = user.username + ' (' + user.role + ')';
    initMap();
    applyDefaultView();
    initHUD();
    await loadServers();
    if (user.role === 'admin') renderAdminPanel();
    connectSocket();
  }

  // ---- Map (2D Leaflet) ----
  function initMap() {
    if (map) return;
    map = L.map('map', { center: [30, 10], zoom: 3, zoomControl: true });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18, attribution: '&copy; OpenStreetMap'
    }).addTo(map);
    setTimeout(() => map.invalidateSize(), 200);
  }

  // ---- Globe (3D Cyberpunk) ----
  const ARC_COLORS = [
    ['rgba(0,255,255,0.9)', 'rgba(0,100,255,0.4)'],   // cyan → blue
    ['rgba(255,0,255,0.9)', 'rgba(100,0,255,0.4)'],   // magenta → purple
    ['rgba(0,200,255,0.9)', 'rgba(0,255,255,0.4)'],   // sky → cyan
    ['rgba(255,50,150,0.85)', 'rgba(255,0,255,0.4)'],  // pink → magenta
    ['rgba(0,255,200,0.85)', 'rgba(0,255,255,0.4)'],   // teal → cyan
    ['rgba(140,80,255,0.85)', 'rgba(255,0,255,0.4)'],  // violet → magenta
  ];
  const POINT_COLORS = ['#0ff', '#f0f', '#00aaff', '#ff3399', '#00ffcc', '#8855ff'];

  function initGlobe() {
    if (globe) return;
    globe = Globe()(globeEl)
      .backgroundColor('rgba(0,0,0,0)')
      .showGlobe(true)
      .showAtmosphere(true)
      .atmosphereColor('rgba(0,170,255,0.15)')
      .atmosphereAltitude(0.18)
      .pointOfView({ lat: 30, lng: 10, altitude: 2.2 })
      .arcColor('color')
      .arcAltitude(() => 0.04 + Math.random() * 0.25)
      .arcStroke(() => 0.3 + Math.random() * 0.7)
      .arcDashLength(0.6)
      .arcDashGap(0.3)
      .arcDashAnimateTime(() => 800 + Math.random() * 1500)
      .pointColor('color')
      .pointAltitude(0.01)
      .pointRadius('size')
      .pointsMerge(false)
      .labelsData([])
      .labelText('label')
      .labelSize(d => d.labelSize || 0.5)
      .labelDotRadius(0.08)
      .labelColor(d => d.labelColor || 'rgba(0,220,255,0.85)')
      .labelResolution(2)
      .labelAltitude(0.05)
      .labelIncludeDot(false);

    // Dark globe material
    const globeMat = globe.globeMaterial();
    globeMat.color = new THREE.Color(0x020818);
    globeMat.emissive = new THREE.Color(0x010410);
    globeMat.emissiveIntensity = 0.8;

    const scene = globe.scene();
    const GLOBE_R = 100;

    // Subtle wireframe grid behind everything
    const gridGeo = new THREE.SphereGeometry(GLOBE_R + 0.15, 48, 24);
    const gridMat = new THREE.MeshBasicMaterial({
      color: 0x0055aa,
      wireframe: true,
      transparent: true,
      opacity: 0.06,
      depthWrite: false
    });
    scene.add(new THREE.Mesh(gridGeo, gridMat));

    // Load countries → draw border outlines only (no polygon fill)
    fetch('https://unpkg.com/world-atlas@2/countries-110m.json')
      .then(r => r.json())
      .then(topology => {
        const countries = topojsonFeature(topology, topology.objects.countries).features;

        // Batch all border segments into one geometry for performance
        const allPts = [];
        for (const feat of countries) {
          const coords = feat.geometry.type === 'Polygon'
            ? [feat.geometry.coordinates]
            : feat.geometry.coordinates;
          for (const poly of coords) {
            for (const ring of poly) {
              for (let i = 0; i < ring.length - 1; i++) {
                const [lon1, lat1] = ring[i];
                const [lon2, lat2] = ring[i + 1];
                const phi1 = (90 - lat1) * Math.PI / 180;
                const th1 = (90 - lon1) * Math.PI / 180;
                const phi2 = (90 - lat2) * Math.PI / 180;
                const th2 = (90 - lon2) * Math.PI / 180;
                const r = GLOBE_R + 0.5;
                allPts.push(
                  r * Math.sin(phi1) * Math.cos(th1), r * Math.cos(phi1), r * Math.sin(phi1) * Math.sin(th1),
                  r * Math.sin(phi2) * Math.cos(th2), r * Math.cos(phi2), r * Math.sin(phi2) * Math.sin(th2)
                );
              }
            }
          }
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(allPts, 3));

        // Bright neon line
        const lineMat = new THREE.LineBasicMaterial({
          color: 0x00ccff,
          transparent: true,
          opacity: 0.9
        });
        scene.add(new THREE.LineSegments(geo, lineMat));

        // Glow layer (wider, more transparent, additive)
        const glowMat = new THREE.LineBasicMaterial({
          color: 0x00aaff,
          transparent: true,
          opacity: 0.3,
          blending: THREE.AdditiveBlending,
          depthWrite: false
        });
        const glowLines = new THREE.LineSegments(geo, glowMat);
        glowLines.scale.setScalar(1.003);
        scene.add(glowLines);
      })
      .catch(() => {});

    // Auto-Rotation
    globe.controls().autoRotate = true;
    globe.controls().autoRotateSpeed = 0.4;

    // Scene lighting
    const ambientOld = scene.children.find(c => c.type === 'AmbientLight');
    if (ambientOld) ambientOld.intensity = 0.5;
    const dirLight = new THREE.DirectionalLight(0x3388ff, 0.4);
    dirLight.position.set(5, 3, 5);
    scene.add(dirLight);
  }

  // topojson helper (inline minimal)
  function topojsonFeature(topology, object) {
    const arcs = topology.arcs;
    function arcToCoords(arcIdx) {
      let arc = arcIdx < 0 ? arcs[~arcIdx].slice().reverse() : arcs[arcIdx].slice();
      let x = 0, y = 0;
      return arc.map(p => { x += p[0]; y += p[1]; return [x, y]; });
    }
    function decodeArc(arcIdx) {
      const coords = arcToCoords(arcIdx);
      const tf = topology.transform;
      if (!tf) return coords;
      return coords.map(c => [c[0] * tf.scale[0] + tf.translate[0], c[1] * tf.scale[1] + tf.translate[1]]);
    }
    function decodeRing(indices) {
      let coords = [];
      for (const idx of indices) coords = coords.concat(decodeArc(idx));
      return coords;
    }
    function decodeGeometry(geom) {
      if (geom.type === 'Polygon') return { type: 'Polygon', coordinates: geom.arcs.map(decodeRing) };
      if (geom.type === 'MultiPolygon') return { type: 'MultiPolygon', coordinates: geom.arcs.map(poly => poly.map(decodeRing)) };
      return geom;
    }
    const geometries = object.geometries || [];
    return {
      type: 'FeatureCollection',
      features: geometries.map(g => ({
        type: 'Feature',
        id: g.id,
        properties: g.properties || {},
        geometry: decodeGeometry(g)
      }))
    };
  }

  function showHUDs(visible) {
    const hs = document.getElementById('hud-status');
    const hr = document.getElementById('hud-stats');
    if (hs) hs.style.display = visible ? 'block' : 'none';
    if (hr) hr.style.display = visible ? 'block' : 'none';
  }

  // ---- View Toggle (default = 3D) ----
  btnViewToggle.onclick = () => {
    if (viewMode === '2d') {
      viewMode = '3d';
      mapEl.style.display = 'none';
      globeEl.style.display = 'block';
      btnViewToggle.textContent = '2D';
      showHUDs(true);
      initGlobe();
    } else {
      viewMode = '2d';
      mapEl.style.display = 'block';
      globeEl.style.display = 'none';
      btnViewToggle.textContent = '3D';
      showHUDs(false);
      setTimeout(() => map.invalidateSize(), 100);
    }
  };

  // Apply default 3D view on load
  function applyDefaultView() {
    mapEl.style.display = 'none';
    globeEl.style.display = 'block';
    btnViewToggle.textContent = '2D';
    showHUDs(true);
    initGlobe();
  }

  btnLogToggle.onclick = () => { packetLog.classList.toggle('open'); };
  btnSidebarToggle.onclick = () => { sidebar.classList.toggle('open'); };

  // ---- Server / Preset Auswahl (Topbar) ----
  async function loadServers() {
    try {
      servers = await api('GET', '/servers');
      serverSelect.innerHTML = '<option value="">-- Server --</option>';
      for (const s of servers) {
        const opt = document.createElement('option');
        opt.value = s.id;
        opt.textContent = s.name + ' (' + s.host + ')';
        serverSelect.appendChild(opt);
      }
    } catch (err) { console.error('Server laden fehlgeschlagen:', err); }
  }

  serverSelect.onchange = async () => {
    const sid = serverSelect.value;
    presetSelect.innerHTML = '<option value="">-- Preset --</option>';
    if (!sid) return;
    try {
      presets = await api('GET', '/servers/' + sid + '/presets');
      for (const p of presets) {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = p.name + ' (' + p.interface + ')';
        presetSelect.appendChild(opt);
      }
    } catch (err) { console.error('Presets laden fehlgeschlagen:', err); }
  };

  // ---- Start / Stop ----
  btnStart.onclick = () => {
    const sid = serverSelect.value;
    if (!sid) return alert('Bitte Server auswählen');
    const pid = presetSelect.value || null;
    socket.emit('start', { serverId: parseInt(sid), presetId: pid ? parseInt(pid) : null });
    btnStart.disabled = true; btnStop.disabled = false;
    setStatus('connecting');
    addLogEntry('SYS', 'Verbindung wird aufgebaut…');
  };

  btnStop.onclick = () => {
    socket.emit('stop');
    btnStart.disabled = false; btnStop.disabled = true;
    setStatus('stopped'); streaming = false;
    addLogEntry('SYS', 'Gestoppt.');
  };

  function setStatus(state) {
    statusBadge.className = 'status-badge';
    if (state === 'running') { statusBadge.classList.add('status-running'); statusBadge.textContent = 'LIVE'; }
    else if (state === 'connecting') { statusBadge.classList.add('status-connecting'); statusBadge.textContent = 'VERBINDE…'; }
    else { statusBadge.classList.add('status-stopped'); statusBadge.textContent = 'OFFLINE'; }
  }

  // ---- Socket.io ----
  function connectSocket() {
    if (socket) socket.disconnect();
    socket = io({ auth: { token } });
    socket.on('connect', () => { addLogEntry('WS', 'WebSocket verbunden'); });
    socket.on('started', () => {
      streaming = true; setStatus('running'); addLogEntry('SYS', 'Capture gestartet');
      stats.startTime = Date.now();
      const sel = serverSelect.options[serverSelect.selectedIndex];
      updateHUDStatus('LIVE', sel ? sel.textContent : '—');
    });
    socket.on('stopped', () => {
      streaming = false; btnStart.disabled = false; btnStop.disabled = true;
      setStatus('stopped'); addLogEntry('SYS', 'Capture beendet');
      updateHUDStatus('OFFLINE', '—');
    });
    socket.on('status', (msg) => {
      if (msg === 'capturing') { setStatus('running'); addLogEntry('SSH', 'tcpdump aktiv'); }
      if (msg === 'connected') {
        setStatus('connecting'); addLogEntry('SSH', 'SSH verbunden, starte tcpdump…');
        const sel = serverSelect.options[serverSelect.selectedIndex];
        updateHUDStatus('VERBINDE', sel ? sel.textContent : '—');
      }
    });
    socket.on('error', (msg) => {
      console.error('[WS] Fehler:', msg);
      addLogEntry('ERR', msg, 'error');
      setStatus('stopped'); btnStart.disabled = false; btnStop.disabled = true; streaming = false;
      updateHUDStatus('FEHLER', '—');
    });
    socket.on('packets', (packets) => {
      for (const pkt of packets) { addPacketToMap(pkt); addPacketToLog(pkt); }
    });
    socket.on('connect_error', (err) => {
      if (err.message === 'Token ungültig' || err.message === 'Token fehlt') logout();
    });
  }

  // ---- Pakete auf Karte ----
  const MAX_MARKERS = 300;
  const MAX_ARCS = 150;
  const MAX_POINTS = 200;
  const MAX_LABELS = 100;
  let serverLat = 50, serverLon = 10;

  let leafletArcs = []; // 2D arc polylines
  const MAX_LEAFLET_ARCS = 100;

  // ---- HUD Stats ----
  let stats = { total: 0, ips: new Set(), countries: new Set(), countryCount: {}, ppsBuffer: [], startTime: null };
  let hudInterval = null;

  function initHUD() {
    stats = { total: 0, ips: new Set(), countries: new Set(), countryCount: {}, ppsBuffer: [], startTime: null };
    updateHUDStatus('OFFLINE', '—');
    updateHUDStats();
    if (hudInterval) clearInterval(hudInterval);
    hudInterval = setInterval(updateHUDTick, 1000);
  }

  function updateHUDStatus(connState, serverName) {
    const el = document.getElementById('hud-conn');
    if (el) {
      el.textContent = connState;
      el.style.color = connState === 'LIVE' ? 'var(--neon-cyan)' : connState === 'VERBINDE' ? '#ffaa00' : 'var(--danger)';
    }
    const s = document.getElementById('hud-server');
    if (s) s.textContent = serverName || '—';
  }

  function updateHUDTick() {
    // Uptime
    if (stats.startTime && streaming) {
      const diff = Math.floor((Date.now() - stats.startTime) / 1000);
      const h = String(Math.floor(diff / 3600)).padStart(2, '0');
      const m = String(Math.floor((diff % 3600) / 60)).padStart(2, '0');
      const s = String(diff % 60).padStart(2, '0');
      const el = document.getElementById('hud-uptime');
      if (el) el.textContent = h + ':' + m + ':' + s;
    }
    // PPS (packets per second)
    const now = Date.now();
    stats.ppsBuffer = stats.ppsBuffer.filter(t => now - t < 1000);
    const pps = stats.ppsBuffer.length;
    const el = document.getElementById('hud-pps');
    if (el) el.textContent = pps;
    const bar = document.getElementById('hud-pps-bar');
    if (bar) bar.style.width = Math.min(pps * 2, 100) + '%';
  }

  function updateHUDStats() {
    const t = document.getElementById('hud-total');
    if (t) t.textContent = stats.total.toLocaleString('de-DE');
    const i = document.getElementById('hud-ips');
    if (i) i.textContent = stats.ips.size.toLocaleString('de-DE');
    const c = document.getElementById('hud-countries');
    if (c) c.textContent = stats.countries.size;
    const bar = document.getElementById('hud-countries-bar');
    if (bar) bar.style.width = Math.min(stats.countries.size * 1.5, 100) + '%';
    // Top country
    let topC = '—', topN = 0;
    for (const [k, v] of Object.entries(stats.countryCount)) {
      if (v > topN) { topN = v; topC = k; }
    }
    const tc = document.getElementById('hud-top-country');
    if (tc) tc.textContent = topC;
  }

  function trackPacket(pkt) {
    stats.total++;
    stats.ips.add(pkt.ip);
    if (pkt.country) {
      stats.countries.add(pkt.country);
      stats.countryCount[pkt.country] = (stats.countryCount[pkt.country] || 0) + 1;
    }
    stats.ppsBuffer.push(Date.now());
    updateHUDStats();
  }

  function addPacketToMap(pkt) {
    trackPacket(pkt);

    // 2D: marker + arc
    const ci = stats.total % POINT_COLORS.length;
    const marker = L.circleMarker([pkt.lat, pkt.lon], {
      radius: 5, color: POINT_COLORS[ci], fillColor: POINT_COLORS[ci], fillOpacity: 0.7, weight: 1
    }).addTo(map);
    marker.bindTooltip(pkt.ip + '<br>' + pkt.city + ', ' + pkt.country);
    markers.push(marker);
    if (markers.length > MAX_MARKERS) map.removeLayer(markers.shift());

    // 2D arc
    const arcLine = createLeafletArc([pkt.lat, pkt.lon], [serverLat, serverLon], POINT_COLORS[ci]);
    if (arcLine) {
      arcLine.addTo(map);
      leafletArcs.push(arcLine);
      if (leafletArcs.length > MAX_LEAFLET_ARCS) map.removeLayer(leafletArcs.shift());
    }

    // 3D: arc + point (multicolor)
    if (globe) {
      const ac = ARC_COLORS[stats.total % ARC_COLORS.length];
      arcsData.push({
        startLat: pkt.lat, startLng: pkt.lon,
        endLat: serverLat, endLng: serverLon,
        color: ac
      });
      if (arcsData.length > MAX_ARCS) arcsData.shift();
      globe.arcsData([...arcsData]);
      pointsData.push({ lat: pkt.lat, lng: pkt.lon, size: 0.3 + Math.random() * 0.4, color: POINT_COLORS[stats.total % POINT_COLORS.length] });
      if (pointsData.length > MAX_POINTS) pointsData.shift();
      globe.pointsData([...pointsData]);

      // Labels: show city/country at geo point
      const labelText = (pkt.city && pkt.country) ? pkt.city + ', ' + pkt.country
        : pkt.country || pkt.city || pkt.ip;
      labelsData.push({
        lat: pkt.lat, lng: pkt.lon,
        label: labelText,
        labelSize: 0.55,
        labelColor: POINT_COLORS[stats.total % POINT_COLORS.length]
      });
      if (labelsData.length > MAX_LABELS) labelsData.shift();
      globe.labelsData([...labelsData]);
    }
  }

  // Create a curved arc for Leaflet (quadratic bezier approximation)
  function createLeafletArc(from, to, color) {
    try {
      const steps = 30;
      const latlngs = [];
      const midLat = (from[0] + to[0]) / 2;
      const midLon = (from[1] + to[1]) / 2;
      const dx = to[1] - from[1];
      const dy = to[0] - from[0];
      const offsetLat = midLat + (dx * 0.15);
      const offsetLon = midLon - (dy * 0.15);
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const lat = (1-t)*(1-t)*from[0] + 2*(1-t)*t*offsetLat + t*t*to[0];
        const lon = (1-t)*(1-t)*from[1] + 2*(1-t)*t*offsetLon + t*t*to[1];
        latlngs.push([lat, lon]);
      }
      return L.polyline(latlngs, {
        color: color || '#0ff', weight: 1.2, opacity: 0.45,
        dashArray: '6,4', className: 'arc-line'
      });
    } catch (e) { return null; }
  }

  // ---- Packet Log ----
  function addPacketToLog(pkt) {
    const e = document.createElement('div');
    e.className = 'log-entry';
    const ts = new Date().toLocaleTimeString('de-DE');
    e.innerHTML = '<span class="log-ts">' + ts + '</span> <span class="log-ip">' + pkt.ip + '</span> <span class="log-geo">' + (pkt.city || '?') + ', ' + (pkt.country || '?') + ' (' + pkt.lat.toFixed(2) + ', ' + pkt.lon.toFixed(2) + ')</span>';
    packetLog.appendChild(e);
    trimLog();
  }

  function addLogEntry(type, msg, cls) {
    const e = document.createElement('div');
    e.className = 'log-entry' + (cls ? ' log-' + cls : ' log-sys');
    const ts = new Date().toLocaleTimeString('de-DE');
    e.innerHTML = '<span class="log-ts">' + ts + '</span> <span class="log-type">[' + type + ']</span> ' + esc(msg);
    packetLog.appendChild(e);
    trimLog();
  }

  function ensureLogOpen() {
    if (!packetLog.classList.contains('open')) packetLog.classList.add('open');
  }
  function trimLog() {
    while (packetLog.childElementCount > 300) packetLog.removeChild(packetLog.firstChild);
    packetLog.scrollTop = packetLog.scrollHeight;
  }

  // ==========================================
  // ---- ADMIN PANEL ----
  // ==========================================
  function renderAdminPanel() {
    adminPanel.innerHTML = '';
    const tabBar = document.createElement('div');
    tabBar.className = 'admin-tabs';
    tabBar.innerHTML = '<button class="admin-tab active" data-tab="servers">Server</button>' +
      '<button class="admin-tab" data-tab="presets">Presets</button>' +
      '<button class="admin-tab" data-tab="users">Benutzer</button>';
    adminPanel.appendChild(tabBar);
    const content = document.createElement('div');
    content.id = 'admin-content';
    adminPanel.appendChild(content);
    tabBar.querySelectorAll('.admin-tab').forEach(btn => {
      btn.onclick = () => {
        tabBar.querySelectorAll('.admin-tab').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        renderTab(btn.dataset.tab);
      };
    });
    renderTab('servers');
  }

  function renderTab(tab) {
    const el = $('admin-content');
    if (tab === 'servers') renderServerTab(el);
    else if (tab === 'presets') renderPresetTab(el);
    else if (tab === 'users') renderUserTab(el);
  }

  // ==== SERVER TAB ====
  function renderServerTab(el) {
    editingServerId = null;
    el.innerHTML = '<div id="server-list" class="admin-list"></div>' +
      '<hr class="admin-hr"/>' +
      '<h4 class="admin-section-title" id="srv-form-title">Neuer Server</h4>' +
      '<div id="server-form">' +
      '<label>Name</label><input id="as-name" placeholder="Mein Server"/>' +
      '<label>Host / IP</label><input id="as-host" placeholder="1.2.3.4"/>' +
      '<label>Port</label><input id="as-port" value="22" type="number"/>' +
      '<label>SSH User</label><input id="as-user" placeholder="root"/>' +
      '<label>Auth-Methode</label>' +
      '<select id="as-auth-type"><option value="key">SSH Key</option><option value="password">Passwort</option></select>' +
      '<div id="as-key-section"><label>SSH Key (Private)</label>' +
      '<textarea id="as-key" rows="3" placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"></textarea>' +
      '<input type="file" id="as-key-file" accept=".pem,.key,.pub,*"/></div>' +
      '<div id="as-pass-section" style="display:none"><label>SSH Passwort</label>' +
      '<input id="as-password" type="password" placeholder="Passwort"/></div>' +
      '<div class="admin-btn-row"><button id="as-save" class="btn-ok">Speichern</button>' +
      '<button id="as-cancel" class="btn-cancel" style="display:none">Abbrechen</button></div>' +
      '<div id="as-msg" class="admin-msg"></div></div>';

    $('as-auth-type').onchange = () => {
      $('as-key-section').style.display = $('as-auth-type').value === 'key' ? '' : 'none';
      $('as-pass-section').style.display = $('as-auth-type').value === 'key' ? 'none' : '';
    };
    $('as-key-file').onchange = (e) => {
      const f = e.target.files[0]; if (!f) return;
      const r = new FileReader();
      r.onload = (ev) => { $('as-key').value = ev.target.result; };
      r.readAsText(f);
    };
    $('as-save').onclick = saveServer;
    $('as-cancel').onclick = () => { editingServerId = null; clearServerForm(); };
    loadServerList();
  }

  async function loadServerList() {
    try {
      servers = await api('GET', '/servers');
      const el = $('server-list');
      if (!el) return;
      el.innerHTML = servers.length === 0 ? '<div class="admin-empty">Keine Server vorhanden</div>' :
        servers.map(s => '<div class="admin-list-item">' +
          '<div class="admin-list-info"><strong>' + esc(s.name) + '</strong>' +
          '<span class="dim">' + esc(s.host) + ':' + s.port + ' · ' + esc(s.ssh_user) + ' · ' + s.ssh_auth_type + '</span></div>' +
          '<div class="admin-list-actions">' +
          '<button class="btn-sm btn-edit" data-id="' + s.id + '" title="Bearbeiten">✎</button>' +
          '<button class="btn-sm btn-del danger" data-id="' + s.id + '" title="Löschen">✕</button></div></div>').join('');

      el.querySelectorAll('.btn-edit').forEach(b => { b.onclick = () => editServer(+b.dataset.id); });
      el.querySelectorAll('.btn-del').forEach(b => { b.onclick = () => deleteServer(+b.dataset.id); });

      // Also update topbar
      serverSelect.innerHTML = '<option value="">-- Server --</option>';
      for (const s of servers) {
        const o = document.createElement('option'); o.value = s.id;
        o.textContent = s.name + ' (' + s.host + ')'; serverSelect.appendChild(o);
      }
    } catch (err) { console.error(err); }
  }

  async function editServer(id) {
    try {
      const s = await api('GET', '/servers/' + id);
      editingServerId = id;
      $('srv-form-title').textContent = 'Server bearbeiten';
      $('as-name').value = s.name; $('as-host').value = s.host;
      $('as-port').value = s.port; $('as-user').value = s.ssh_user;
      $('as-auth-type').value = s.ssh_auth_type || 'key'; $('as-auth-type').onchange();
      if (s.ssh_key) $('as-key').value = s.ssh_key;
      if (s.ssh_password) $('as-password').value = s.ssh_password;
      $('as-cancel').style.display = ''; $('as-save').textContent = 'Aktualisieren';
      $('server-form').scrollIntoView({ behavior: 'smooth' });
    } catch (err) { alert(err.message); }
  }

  async function saveServer() {
    try {
      const at = $('as-auth-type').value;
      const body = { name: $('as-name').value, host: $('as-host').value,
        port: parseInt($('as-port').value) || 22, ssh_user: $('as-user').value, ssh_auth_type: at };
      if (at === 'key') body.ssh_key = $('as-key').value;
      else body.ssh_password = $('as-password').value;
      if (editingServerId) { await api('PUT', '/servers/' + editingServerId, body); showMsg('as-msg', 'Aktualisiert!', true); }
      else { await api('POST', '/servers', body); showMsg('as-msg', 'Angelegt!', true); }
      editingServerId = null; clearServerForm(); await loadServerList();
    } catch (err) { showMsg('as-msg', err.message, false); }
  }

  async function deleteServer(id) {
    const s = servers.find(x => x.id === id);
    if (!confirm('Server "' + (s ? s.name : id) + '" wirklich löschen?')) return;
    try { await api('DELETE', '/servers/' + id); await loadServerList(); } catch (err) { alert(err.message); }
  }

  function clearServerForm() {
    $('srv-form-title').textContent = 'Neuer Server';
    ['as-name', 'as-host', 'as-key', 'as-password'].forEach(id => $(id).value = '');
    $('as-port').value = '22'; $('as-user').value = '';
    $('as-auth-type').value = 'key'; $('as-auth-type').onchange();
    $('as-cancel').style.display = 'none'; $('as-save').textContent = 'Speichern';
    $('as-msg').textContent = '';
  }

  // ==== PRESET TAB ====
  function renderPresetTab(el) {
    editingPresetId = null;
    el.innerHTML = '<label>Server wählen</label><select id="ap-server-sel"></select>' +
      '<div id="preset-list" class="admin-list"></div><hr class="admin-hr"/>' +
      '<h4 class="admin-section-title" id="prs-form-title">Neues Preset</h4>' +
      '<div id="preset-form">' +
      '<label>Preset-Name</label><input id="ap-name" placeholder="HTTPS Traffic"/>' +
      '<label>Interface</label><input id="ap-iface" value="eth0"/>' +
      '<label>Filter</label><input id="ap-filter" placeholder="port 443"/>' +
      '<label>Regex (IP-Extraktion)</label><input id="ap-regex" placeholder=""/>' +
      '<div class="admin-btn-row"><button id="ap-save" class="btn-ok">Speichern</button>' +
      '<button id="ap-cancel" class="btn-cancel" style="display:none">Abbrechen</button></div>' +
      '<div id="ap-msg" class="admin-msg"></div></div>';

    const sel = $('ap-server-sel');
    sel.innerHTML = '<option value="">-- Server --</option>';
    for (const s of servers) {
      const o = document.createElement('option'); o.value = s.id;
      o.textContent = s.name + ' (' + s.host + ')'; sel.appendChild(o);
    }
    sel.onchange = () => { editingPresetId = null; clearPresetForm(); loadPresetList(sel.value); };
    $('ap-save').onclick = savePreset;
    $('ap-cancel').onclick = () => { editingPresetId = null; clearPresetForm(); };
  }

  async function loadPresetList(sid) {
    const el = $('preset-list');
    if (!sid) { el.innerHTML = ''; return; }
    try {
      const items = await api('GET', '/servers/' + sid + '/presets');
      el.innerHTML = items.length === 0 ? '<div class="admin-empty">Keine Presets</div>' :
        items.map(p => '<div class="admin-list-item">' +
          '<div class="admin-list-info"><strong>' + esc(p.name) + '</strong>' +
          '<span class="dim">' + esc(p.interface) + ' · ' + esc(p.filter || '—') + '</span></div>' +
          '<div class="admin-list-actions">' +
          '<button class="btn-sm btn-edit" data-id="' + p.id + '">✎</button>' +
          '<button class="btn-sm btn-del danger" data-id="' + p.id + '">✕</button></div></div>').join('');
      el.querySelectorAll('.btn-edit').forEach(b => { b.onclick = () => editPreset(+b.dataset.id); });
      el.querySelectorAll('.btn-del').forEach(b => { b.onclick = () => deletePreset(+b.dataset.id); });
    } catch (err) { el.innerHTML = '<div class="admin-empty">' + esc(err.message) + '</div>'; }
  }

  async function editPreset(id) {
    try {
      const p = await api('GET', '/presets/' + id);
      editingPresetId = id;
      $('prs-form-title').textContent = 'Preset bearbeiten';
      $('ap-name').value = p.name; $('ap-iface').value = p.interface;
      $('ap-filter').value = p.filter || ''; $('ap-regex').value = p.regex || '';
      $('ap-cancel').style.display = ''; $('ap-save').textContent = 'Aktualisieren';
      $('preset-form').scrollIntoView({ behavior: 'smooth' });
    } catch (err) { alert(err.message); }
  }

  async function savePreset() {
    try {
      const sid = $('ap-server-sel').value;
      if (!sid && !editingPresetId) { showMsg('ap-msg', 'Bitte Server wählen', false); return; }
      const body = { server_id: parseInt(sid), name: $('ap-name').value,
        interface: $('ap-iface').value, filter: $('ap-filter').value, regex: $('ap-regex').value };
      if (editingPresetId) { await api('PUT', '/presets/' + editingPresetId, body); showMsg('ap-msg', 'Aktualisiert!', true); }
      else { await api('POST', '/presets', body); showMsg('ap-msg', 'Angelegt!', true); }
      editingPresetId = null; clearPresetForm(); await loadPresetList(sid);
    } catch (err) { showMsg('ap-msg', err.message, false); }
  }

  async function deletePreset(id) {
    if (!confirm('Preset wirklich löschen?')) return;
    try { await api('DELETE', '/presets/' + id); await loadPresetList($('ap-server-sel').value); }
    catch (err) { alert(err.message); }
  }

  function clearPresetForm() {
    $('prs-form-title').textContent = 'Neues Preset';
    $('ap-name').value = ''; $('ap-iface').value = 'eth0';
    $('ap-filter').value = ''; $('ap-regex').value = '';
    $('ap-cancel').style.display = 'none'; $('ap-save').textContent = 'Speichern';
    $('ap-msg').textContent = '';
  }

  // ==== USER TAB ====
  function renderUserTab(el) {
    el.innerHTML = '<div id="user-list" class="admin-list"></div><hr class="admin-hr"/>' +
      '<h4 class="admin-section-title">Neuer Benutzer</h4>' +
      '<div id="user-create-form">' +
      '<label>Username</label><input id="au-name" placeholder="username"/>' +
      '<label>Passwort</label><input id="au-pass" type="password" placeholder="Passwort"/>' +
      '<label>Rolle</label><select id="au-role"><option value="viewer">Viewer</option><option value="admin">Admin</option></select>' +
      '<div class="admin-btn-row"><button id="au-save" class="btn-ok">Anlegen</button></div>' +
      '<div id="au-msg" class="admin-msg"></div></div>' +
      '<hr class="admin-hr"/>' +
      '<h4 class="admin-section-title">Eigenes Passwort ändern</h4>' +
      '<div id="user-pw-form">' +
      '<label>Aktuelles Passwort</label><input id="pw-old" type="password"/>' +
      '<label>Neues Passwort</label><input id="pw-new" type="password"/>' +
      '<div class="admin-btn-row"><button id="pw-save" class="btn-ok">Ändern</button></div>' +
      '<div id="pw-msg" class="admin-msg"></div></div>';

    $('au-save').onclick = createNewUser;
    $('pw-save').onclick = changeOwnPassword;
    loadUserList();
  }

  async function loadUserList() {
    try {
      const users = await api('GET', '/users');
      const el = $('user-list'); if (!el) return;
      el.innerHTML = users.map(u =>
        '<div class="admin-list-item"><div class="admin-list-info">' +
        '<strong>' + esc(u.username) + '</strong>' +
        '<span class="dim">' + u.role + '</span></div>' +
        '<div class="admin-list-actions">' +
        '<select class="role-sel btn-sm" data-id="' + u.id + '" data-cur="' + u.role + '">' +
        '<option value="viewer"' + (u.role === 'viewer' ? ' selected' : '') + '>viewer</option>' +
        '<option value="admin"' + (u.role === 'admin' ? ' selected' : '') + '>admin</option></select>' +
        '<button class="btn-sm btn-pw" data-id="' + u.id + '" data-name="' + esc(u.username) + '" title="Passwort">🔑</button>' +
        '<button class="btn-sm btn-del danger" data-id="' + u.id + '" title="Löschen">✕</button>' +
        '</div></div>').join('');

      el.querySelectorAll('.role-sel').forEach(s => {
        s.onchange = async () => {
          try { await api('PUT', '/users/' + s.dataset.id, { role: s.value }); }
          catch (err) { alert(err.message); s.value = s.dataset.cur; }
        };
      });
      el.querySelectorAll('.btn-pw').forEach(b => {
        b.onclick = async () => {
          const pw = prompt('Neues Passwort für ' + b.dataset.name + ':');
          if (!pw) return;
          try { await api('PUT', '/users/' + b.dataset.id + '/password', { password: pw }); alert('Passwort geändert!'); }
          catch (err) { alert(err.message); }
        };
      });
      el.querySelectorAll('.btn-del').forEach(b => {
        b.onclick = async () => {
          if (!confirm('Benutzer wirklich löschen?')) return;
          try { await api('DELETE', '/users/' + b.dataset.id); await loadUserList(); }
          catch (err) { alert(err.message); }
        };
      });
    } catch (err) { console.error(err); }
  }

  async function createNewUser() {
    try {
      await api('POST', '/users', { username: $('au-name').value, password: $('au-pass').value, role: $('au-role').value });
      showMsg('au-msg', 'Angelegt!', true);
      $('au-name').value = ''; $('au-pass').value = '';
      await loadUserList();
    } catch (err) { showMsg('au-msg', err.message, false); }
  }

  async function changeOwnPassword() {
    try {
      await api('PUT', '/users/' + user.id + '/password', { currentPassword: $('pw-old').value, password: $('pw-new').value });
      showMsg('pw-msg', 'Passwort geändert!', true);
      $('pw-old').value = ''; $('pw-new').value = '';
    } catch (err) { showMsg('pw-msg', err.message, false); }
  }

  // ==== Helpers ====
  function showMsg(id, msg, ok) {
    const el = $(id); if (!el) return;
    el.textContent = msg; el.style.color = ok ? 'var(--neon-green)' : 'var(--danger)';
  }
  function esc(s) { if (!s) return ''; const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

  // ---- Boot ----
  if (token) showApp();
})();

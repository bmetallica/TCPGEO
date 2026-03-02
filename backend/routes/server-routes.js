// API-Routen: Serververwaltung (CRUD)
const express = require('express');
const { authenticateToken, requireAdmin } = require('../auth');
const { dbRun, dbGet, dbAll } = require('../../db/database');
const router = express.Router();

// Alle Server auflisten (jeder eingeloggte User)
router.get('/servers', authenticateToken, async (req, res) => {
  try {
    const servers = await dbAll('SELECT id, name, host, port, ssh_user, ssh_auth_type, created_at FROM servers');
    res.json(servers);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Einzelner Server (mit SSH-Key/Passwort nur für Admin)
router.get('/servers/:id', authenticateToken, async (req, res) => {
  try {
    const fields = req.user.role === 'admin'
      ? 'id, name, host, port, ssh_user, ssh_auth_type, ssh_key, ssh_password, created_at'
      : 'id, name, host, port, ssh_user, ssh_auth_type, created_at';
    const server = await dbGet(`SELECT ${fields} FROM servers WHERE id = ?`, [req.params.id]);
    if (!server) return res.status(404).json({ error: 'Server nicht gefunden' });
    res.json(server);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Server anlegen (nur Admin)
router.post('/servers', authenticateToken, requireAdmin, express.json(), async (req, res) => {
  try {
    const { name, host, port, ssh_user, ssh_auth_type, ssh_key, ssh_password } = req.body;
    if (!name || !host || !ssh_user) {
      return res.status(400).json({ error: 'name, host und ssh_user erforderlich' });
    }
    const authType = ssh_auth_type || 'key';
    if (authType === 'key' && !ssh_key) {
      return res.status(400).json({ error: 'SSH-Key erforderlich bei Key-Authentifizierung' });
    }
    if (authType === 'password' && !ssh_password) {
      return res.status(400).json({ error: 'SSH-Passwort erforderlich bei Passwort-Authentifizierung' });
    }
    const result = await dbRun(
      'INSERT INTO servers (name, host, port, ssh_user, ssh_auth_type, ssh_key, ssh_password) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [name, host, port || 22, ssh_user, authType, ssh_key || '', ssh_password || '']
    );
    res.json({ id: result.lastID });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Server bearbeiten (nur Admin)
router.put('/servers/:id', authenticateToken, requireAdmin, express.json(), async (req, res) => {
  try {
    const { name, host, port, ssh_user, ssh_auth_type, ssh_key, ssh_password } = req.body;
    const result = await dbRun(
      'UPDATE servers SET name=?, host=?, port=?, ssh_user=?, ssh_auth_type=?, ssh_key=?, ssh_password=? WHERE id=?',
      [name, host, port || 22, ssh_user, ssh_auth_type || 'key', ssh_key || '', ssh_password || '', req.params.id]
    );
    res.json({ updated: result.changes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Server löschen (nur Admin)
router.delete('/servers/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const result = await dbRun('DELETE FROM servers WHERE id = ?', [req.params.id]);
    res.json({ deleted: result.changes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

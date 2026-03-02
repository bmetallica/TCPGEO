// API-Routen: Auth (Login/Register)
const express = require('express');
const { login, createUser, authenticateToken, requireAdmin } = require('../auth');
const { dbAll, dbRun, dbGet } = require('../../db/database');
const router = express.Router();

// Login
router.post('/login', express.json(), async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username und Passwort erforderlich' });
    }
    const result = await login(username, password);
    if (!result) {
      return res.status(401).json({ error: 'Ungültige Zugangsdaten' });
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// User anlegen (nur Admin)
router.post('/users', authenticateToken, requireAdmin, express.json(), async (req, res) => {
  try {
    const { username, password, role } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username und Passwort erforderlich' });
    }
    const result = await createUser(username, password, role || 'viewer');
    res.json({ id: result.lastID });
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      return res.status(409).json({ error: 'Username bereits vergeben' });
    }
    res.status(500).json({ error: err.message });
  }
});

// User auflisten (nur Admin)
router.get('/users', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const users = await dbAll('SELECT id, username, role, created_at FROM users');
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Eigene Session prüfen
router.get('/me', authenticateToken, (req, res) => {
  res.json(req.user);
});

// Passwort ändern (eigenes oder als Admin für andere)
router.put('/users/:id/password', authenticateToken, express.json(), async (req, res) => {
  try {
    const targetId = parseInt(req.params.id);
    // Nur eigenes Passwort oder Admin darf alle ändern
    if (req.user.id !== targetId && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Keine Berechtigung' });
    }
    const { password, currentPassword } = req.body;
    if (!password || password.length < 3) {
      return res.status(400).json({ error: 'Neues Passwort erforderlich (min. 3 Zeichen)' });
    }
    // Wenn nicht Admin, altes Passwort prüfen
    if (req.user.role !== 'admin') {
      const bcrypt = require('bcryptjs');
      const user = await dbGet('SELECT password_hash FROM users WHERE id = ?', [targetId]);
      if (!user) return res.status(404).json({ error: 'User nicht gefunden' });
      const valid = await bcrypt.compare(currentPassword || '', user.password_hash);
      if (!valid) return res.status(401).json({ error: 'Aktuelles Passwort falsch' });
    }
    const bcrypt = require('bcryptjs');
    const hash = await bcrypt.hash(password, 10);
    await dbRun('UPDATE users SET password_hash = ? WHERE id = ?', [hash, targetId]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// User-Rolle ändern (nur Admin)
router.put('/users/:id', authenticateToken, requireAdmin, express.json(), async (req, res) => {
  try {
    const { role } = req.body;
    if (!role || !['admin', 'viewer'].includes(role)) {
      return res.status(400).json({ error: 'Ungültige Rolle (admin oder viewer)' });
    }
    await dbRun('UPDATE users SET role = ? WHERE id = ?', [role, req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// User löschen (nur Admin, nicht sich selbst)
router.delete('/users/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const targetId = parseInt(req.params.id);
    if (targetId === req.user.id) {
      return res.status(400).json({ error: 'Eigenen Account nicht löschen' });
    }
    const result = await dbRun('DELETE FROM users WHERE id = ?', [targetId]);
    res.json({ deleted: result.changes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

// API-Routen: Presets pro Server (CRUD)
const express = require('express');
const { authenticateToken, requireAdmin } = require('../auth');
const { dbRun, dbGet, dbAll } = require('../../db/database');
const router = express.Router();

// Alle Presets für einen Server
router.get('/servers/:serverId/presets', authenticateToken, async (req, res) => {
  try {
    const presets = await dbAll(
      'SELECT * FROM presets WHERE server_id = ? ORDER BY name',
      [req.params.serverId]
    );
    res.json(presets);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Einzelnes Preset
router.get('/presets/:id', authenticateToken, async (req, res) => {
  try {
    const preset = await dbGet('SELECT * FROM presets WHERE id = ?', [req.params.id]);
    if (!preset) return res.status(404).json({ error: 'Preset nicht gefunden' });
    res.json(preset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Preset anlegen (nur Admin)
router.post('/presets', authenticateToken, requireAdmin, express.json(), async (req, res) => {
  try {
    const { server_id, name, interface: iface, filter, regex } = req.body;
    if (!server_id || !name) {
      return res.status(400).json({ error: 'server_id und name erforderlich' });
    }
    const result = await dbRun(
      'INSERT INTO presets (server_id, name, interface, filter, regex) VALUES (?, ?, ?, ?, ?)',
      [server_id, name, iface || 'eth0', filter || '', regex || '']
    );
    res.json({ id: result.lastID });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Preset bearbeiten (nur Admin)
router.put('/presets/:id', authenticateToken, requireAdmin, express.json(), async (req, res) => {
  try {
    const { name, interface: iface, filter, regex } = req.body;
    const result = await dbRun(
      'UPDATE presets SET name=?, interface=?, filter=?, regex=? WHERE id=?',
      [name, iface, filter, regex, req.params.id]
    );
    res.json({ updated: result.changes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Preset löschen (nur Admin)
router.delete('/presets/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const result = await dbRun('DELETE FROM presets WHERE id = ?', [req.params.id]);
    res.json({ deleted: result.changes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

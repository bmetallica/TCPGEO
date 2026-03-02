// Authentifizierung: JWT-basiert, User-Management
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { dbRun, dbGet } = require('../db/database');

const JWT_SECRET = process.env.JWT_SECRET || 'tcpgeo-secret-change-me';
const JWT_EXPIRES = '24h';

// ---- User CRUD ----

async function createUser(username, password, role = 'viewer') {
  const hash = await bcrypt.hash(password, 10);
  return dbRun(
    'INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)',
    [username, hash, role]
  );
}

async function login(username, password) {
  const user = await dbGet('SELECT * FROM users WHERE username = ?', [username]);
  if (!user) return null;
  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) return null;
  const token = jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES }
  );
  return { token, user: { id: user.id, username: user.username, role: user.role } };
}

// ---- Middleware ----

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token fehlt' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch {
    return res.status(403).json({ error: 'Token ungültig' });
  }
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Adminrechte erforderlich' });
  }
  next();
}

// Socket.io Token-Verifizierung
function verifySocketToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

module.exports = {
  createUser, login,
  authenticateToken, requireAdmin, verifySocketToken,
  JWT_SECRET
};

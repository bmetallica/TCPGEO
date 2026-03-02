// Erstellt einen Admin-User in der Datenbank
// Nutzung: node db/create-admin.js <username> <password>

const bcrypt = require('bcryptjs');
const { dbRun, closeDb } = require('./database');

async function createAdmin() {
  const username = process.argv[2] || 'admin';
  const password = process.argv[3] || 'admin';

  try {
    const hash = await bcrypt.hash(password, 10);
    await dbRun(
      'INSERT OR REPLACE INTO users (username, password_hash, role) VALUES (?, ?, ?)',
      [username, hash, 'admin']
    );
    console.log(`Admin-User "${username}" erstellt.`);
  } catch (err) {
    console.error('Fehler:', err.message);
  } finally {
    closeDb();
  }
}

createAdmin();

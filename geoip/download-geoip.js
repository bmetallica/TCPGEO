// GeoIP-Datenbank herunterladen (MaxMind GeoLite2 City)
// Nutzung: node geoip/download-geoip.js
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs');
const https = require('https');
const path = require('path');
const zlib = require('zlib');
const tar = require('tar-stream');

const LICENSE_KEY = process.env.MAXMIND_LICENSE_KEY || '';
if (!LICENSE_KEY) {
  console.error('[GeoIP] MAXMIND_LICENSE_KEY nicht in .env gesetzt!');
  process.exit(1);
}

const DB_FILE = path.join(__dirname, 'GeoLite2-City.mmdb');
const GEOIP_URL = `https://download.maxmind.com/app/geoip_download?edition_id=GeoLite2-City&license_key=${LICENSE_KEY}&suffix=tar.gz`;

async function downloadGeoIP() {
  console.log('[GeoIP] Lade GeoLite2-City Datenbank...');

  await new Promise((resolve, reject) => {
    function doGet(url) {
      https.get(url, (response) => {
        // Redirects folgen
        if (response.statusCode === 301 || response.statusCode === 302) {
          return doGet(response.headers.location);
        }
        if (response.statusCode !== 200) {
          reject(new Error('Download fehlgeschlagen: HTTP ' + response.statusCode));
          return;
        }

        const extract = tar.extract();
        let found = false;

        extract.on('entry', (header, stream, next) => {
          if (header.name.endsWith('.mmdb')) {
            found = true;
            console.log('[GeoIP] Entpacke:', header.name);
            const out = fs.createWriteStream(DB_FILE);
            stream.pipe(out);
            out.on('finish', next);
          } else {
            stream.on('end', next);
            stream.resume();
          }
        });

        extract.on('finish', () => {
          if (found) {
            console.log('[GeoIP] Datenbank bereit:', DB_FILE);
            resolve();
          } else {
            reject(new Error('Keine .mmdb Datei im Archiv gefunden'));
          }
        });

        extract.on('error', reject);

        response.pipe(zlib.createGunzip()).pipe(extract);
      }).on('error', reject);
    }
    doGet(GEOIP_URL);
  });
}

if (require.main === module) {
  downloadGeoIP().catch(err => {
    console.error('[GeoIP] Fehler:', err.message);
    process.exit(1);
  });
}

module.exports = { downloadGeoIP };

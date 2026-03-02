// GeoIP Resolver: IP -> { lat, lon, country, city }
// Nutzt lokal gespeicherte MaxMind GeoLite2-City-Datenbank

const maxmind = require('maxmind');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, 'GeoLite2-City.mmdb');

let lookup = null;

async function initGeoIP() {
  if (lookup) return;
  if (!fs.existsSync(DB_PATH)) {
    console.warn('[GeoIP] Datenbank nicht gefunden:', DB_PATH);
    console.warn('[GeoIP] Bitte zuerst "npm run download-geoip" ausführen.');
    return;
  }
  lookup = await maxmind.open(DB_PATH);
  console.log('[GeoIP] Datenbank geladen.');
}

/**
 * Löst eine IP in Geo-Daten auf
 * @param {string} ip
 * @returns {{ lat: number, lon: number, country: string, city: string } | null}
 */
function resolveIP(ip) {
  if (!lookup) return null;
  try {
    const geo = lookup.get(ip);
    if (!geo || !geo.location) return null;
    return {
      lat: geo.location.latitude,
      lon: geo.location.longitude,
      country: (geo.country && geo.country.names && geo.country.names.de) || '',
      city: (geo.city && geo.city.names && geo.city.names.de) || ''
    };
  } catch {
    return null;
  }
}

/**
 * Prüft ob die GeoIP-Datenbank geladen ist
 */
function isReady() {
  return lookup !== null;
}

module.exports = { initGeoIP, resolveIP, isReady };

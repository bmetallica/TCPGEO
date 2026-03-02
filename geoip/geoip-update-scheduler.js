// Automatisches GeoIP-Datenbank-Update (wöchentlich Sonntag 03:00)
const cron = require('node-cron');
const { downloadGeoIP } = require('./download-geoip');

const SCHEDULE = process.env.GEOIP_UPDATE_SCHEDULE || '0 3 * * 0';

function startGeoIPScheduler() {
  cron.schedule(SCHEDULE, async () => {
    console.log('[GeoIP-Update] Starte automatisches Update...');
    try {
      await downloadGeoIP();
      console.log('[GeoIP-Update] Update abgeschlossen.');
    } catch (err) {
      console.error('[GeoIP-Update] Fehler:', err.message);
    }
  });
  console.log('[GeoIP-Update] Scheduler aktiv (Schedule:', SCHEDULE, ')');
}

module.exports = { startGeoIPScheduler };

/* eslint-disable no-console */
// Genera las versiones reducidas del logo y el banner (sql/089) de los clubes que los subieron
// antes y todavía no las tienen. Idempotente: los que ya tienen versión reducida no se tocan.
// Uso: `npm run media:club-thumbs` (una vez, después de desplegar sql/089).
require('dotenv').config();
const { pool } = require('../config/database');
const { makeClubThumb } = require('../helpers/clubMedia');

(async () => {
  const [clubs] = await pool.query(
    `SELECT id, name, logo_url, logo_thumb_url, banner_url, banner_thumb_url FROM clubs
     WHERE deleted_at IS NULL AND ((logo_url IS NOT NULL AND logo_thumb_url IS NULL) OR (banner_url IS NOT NULL AND banner_thumb_url IS NULL))`
  );
  let made = 0;
  for (const club of clubs) {
    for (const kind of ['logo', 'banner']) {
      if (!club[`${kind}_url`] || club[`${kind}_thumb_url`]) continue;
      // eslint-disable-next-line no-await-in-loop
      const thumb = await makeClubThumb(club[`${kind}_url`], kind);
      if (!thumb) {
        console.log(`[club-thumbs] ${club.name}: no se pudo generar el ${kind} (¿falta el archivo?), se sigue usando el original.`);
        continue;
      }
      // eslint-disable-next-line no-await-in-loop
      await pool.query(`UPDATE clubs SET ${kind}_thumb_url = ? WHERE id = ?`, [thumb, club.id]);
      made += 1;
      console.log(`[club-thumbs] ${club.name}: ${kind} → ${thumb}`);
    }
  }
  console.log(`[club-thumbs] ${made} versiones reducidas generadas (${clubs.length} clubes revisados).`);
  await pool.end();
})().catch((err) => {
  console.error('[club-thumbs] Error:', err.message);
  process.exit(1);
});

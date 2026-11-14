/* eslint-disable no-console */
// Recalcula los "no aplica" por pertenencia (retirado / antes de su ingreso) de cobros y
// asistencias de TODOS los miembros, según su historial de ingresos y retiros. Idempotente: lo que
// ya está bien no cambia. Uso: `npm run db:resync-coverage` (después de desplegar un cambio en
// members.service.js#syncCoverage, para corregir los datos que quedaron con la regla anterior).
require('dotenv').config();
const { pool } = require('../config/database');
const membersService = require('../services/members.service');

(async () => {
  const [members] = await pool.query('SELECT id FROM members WHERE deleted_at IS NULL');
  for (const m of members) {
    // eslint-disable-next-line no-await-in-loop
    await membersService.syncCoverage(m.id, null);
  }
  console.log(`[resync-coverage] ${members.length} miembros recalculados.`);
  await pool.end();
})().catch((err) => {
  console.error('[resync-coverage] Error:', err.message);
  process.exit(1);
});

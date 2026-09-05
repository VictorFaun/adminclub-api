/**
 * Genera dist/ con únicamente lo que hay que subir al VPS: código fuente + package.json.
 * Deja afuera node_modules, .git, logs/*, uploads/*, docs y el .env real (los secretos no
 * viajan por este script; el .env de producción se crea a mano en el servidor).
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

const INCLUDE = [
  'app.js',
  'server.js',
  'package.json',
  'package-lock.json',
  'config',
  'controllers',
  'cron',
  'database',
  'helpers',
  'middlewares',
  'models',
  'repositories',
  'routes',
  'services',
  'sockets',
  'sql',
  'utils',
  'validations',
];

console.log('[build] Limpiando dist/...');
fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });

for (const entry of INCLUDE) {
  const src = path.join(ROOT, entry);
  if (!fs.existsSync(src)) {
    console.warn(`[build] Aviso: no existe "${entry}", se omite.`);
    continue;
  }
  fs.cpSync(src, path.join(DIST, entry), { recursive: true });
  console.log(`[build] Copiado: ${entry}`);
}

// La app crea uploads/ y logs/ solos en runtime (fs.mkdirSync recursive), pero los dejamos
// listos con permisos correctos desde el primer arranque.
fs.mkdirSync(path.join(DIST, 'uploads'), { recursive: true });
fs.mkdirSync(path.join(DIST, 'logs'), { recursive: true });

// Referencia de variables de entorno, NO el .env real (que tiene secretos y credenciales de BD).
fs.copyFileSync(path.join(ROOT, '.env.example'), path.join(DIST, '.env.example'));

console.log('\n[build] Listo -> ' + DIST);
console.log('[build] En el VPS:');
console.log('  1) Subir el contenido de dist/');
console.log('  2) Crear .env real en el servidor (a partir de .env.example)');
console.log('  3) npm ci --omit=dev');
console.log('  4) npm run db:migrate   (solo si hay migraciones nuevas)');
console.log('  5) npm start (o pm2 start server.js --name admin-club-api)');

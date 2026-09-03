const fs = require('fs');
const path = require('path');
const env = require('../config/env');

const UPLOAD_ROOT = path.join(__dirname, '..', env.upload.dir);

/**
 * Convierte una ruta relativa servida desde /uploads (p. ej. "/uploads/logos/x.png")
 * en una URL absoluta con el origen público de la API. Sin esto, el navegador
 * resuelve la ruta relativa contra el origen del frontend, que suele correr en
 * un puerto distinto al backend (Angular dev server vs. Express), y la imagen
 * nunca carga. Deja intactas las URLs que ya son absolutas.
 */
function toAbsoluteMediaUrl(relativePath) {
  if (!relativePath) return relativePath;
  if (/^https?:\/\//i.test(relativePath)) return relativePath;
  const path = relativePath.startsWith('/') ? relativePath : `/${relativePath}`;
  return `${env.publicUrl}${path}`;
}

/**
 * Borra del disco un archivo previamente subido a /uploads (avatar/logo/banner
 * reemplazado), a partir de la ruta relativa guardada en BD (p. ej.
 * "/uploads/avatars/x.jpg"). Sin esto, cada vez que alguien cambia su avatar o
 * un club su logo/banner, el archivo anterior queda huérfano en disco para
 * siempre — nada más lo referencia ni lo limpia (a diferencia de refresh
 * tokens/invitaciones vencidas, que sí tienen un cron de limpieza).
 *
 * Solo borra rutas que caen DENTRO de `UPLOAD_ROOT` una vez resueltas (evita
 * borrar fuera de esa carpeta si algún día `relativePath` viniera corrompido)
 * y nunca lanza si el valor es una URL externa (absoluta) o el archivo ya no
 * existe — es "mejor esfuerzo", nunca debe tumbar la request que lo llama.
 */
function deleteUploadedFile(relativePath) {
  if (!relativePath || /^https?:\/\//i.test(relativePath)) return;
  const withoutUploadsPrefix = relativePath.replace(/^\/?uploads\//, '');
  const absolutePath = path.join(UPLOAD_ROOT, withoutUploadsPrefix);
  if (!absolutePath.startsWith(UPLOAD_ROOT)) return;

  fs.unlink(absolutePath, (err) => {
    if (err && err.code !== 'ENOENT') {
      // eslint-disable-next-line global-require
      require('./logger').warn(`[uploads] No se pudo borrar el archivo anterior: ${absolutePath}`, { error: err.message });
    }
  });
}

module.exports = { toAbsoluteMediaUrl, deleteUploadedFile };

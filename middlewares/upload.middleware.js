const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const env = require('../config/env');
const AppError = require('../helpers/AppError');

const UPLOAD_ROOT = path.join(__dirname, '..', env.upload.dir);
// SVG deliberadamente excluido: a diferencia de un raster, un SVG puede llevar <script>/
// event handlers embebidos, y estos archivos se sirven tal cual vía `express.static('/uploads')`
// (app.js) — subir un SVG malicioso como avatar/logo y compartir su URL directa es un vector de
// XSS almacenado clásico. El cropper del frontend (image-crop-modal.component.ts) además
// siempre reexporta a JPEG sin importar el formato original, así que ningún flujo legítimo
// depende de aceptar SVG acá; solo alguien llamando a la API directamente se vería afectado.
const ALLOWED_MIME_TO_EXT = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' };

function ensureSubdir(subdir) {
  const dir = path.join(UPLOAD_ROOT, subdir);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Genera un storage de Multer con destino por subcarpeta (logos, banners, avatars)
 * y nombre de archivo aleatorio para evitar colisiones y path traversal.
 * La extensión se deriva del `mimetype` ya validado por `fileFilter`, nunca del
 * `file.originalname` que manda el cliente — de lo contrario alguien podía declarar
 * `Content-Type: image/png` (pasa el filtro) con un nombre de archivo `algo.svg`/`algo.php`
 * y el archivo terminaba guardado en disco con esa extensión arbitraria, no la real.
 */
function makeStorage(subdir) {
  return multer.diskStorage({
    destination: (req, file, cb) => cb(null, ensureSubdir(subdir)),
    filename: (req, file, cb) => {
      const ext = ALLOWED_MIME_TO_EXT[file.mimetype] || '';
      cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`);
    },
  });
}

function fileFilter(req, file, cb) {
  if (!ALLOWED_MIME_TO_EXT[file.mimetype]) {
    return cb(AppError.badRequest('Formato de imagen no permitido. Usa PNG, JPG o WEBP.'));
  }
  cb(null, true);
}

function uploadFor(subdir) {
  return multer({
    storage: makeStorage(subdir),
    fileFilter,
    limits: { fileSize: env.upload.maxMb * 1024 * 1024 },
  });
}

module.exports = { uploadFor };

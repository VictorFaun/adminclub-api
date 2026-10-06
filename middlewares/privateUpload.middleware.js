const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const AppError = require('../helpers/AppError');

/**
 * Subidas PRIVADAS: a diferencia de upload.middleware.js (avatares/logos, servidos tal cual por
 * `express.static('/uploads')`), estos archivos se guardan fuera de la carpeta pública y solo se
 * entregan por un endpoint autenticado que revalida permisos (documentos de miembros,
 * comprobantes de pago). La extensión se deriva del mimetype validado, nunca del nombre que
 * declara el cliente.
 */
const PRIVATE_ROOT = path.join(__dirname, '..', 'private_uploads');

const DOCUMENT_MIME_TO_EXT = {
  'application/pdf': '.pdf',
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
};
const PROOF_MIME_TO_EXT = {
  'application/pdf': '.pdf',
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
};

/**
 * Multer (busboy) entrega el nombre original del archivo decodificado como latin1 aunque el
 * navegador lo mande en UTF-8: "cáceres.pdf" llegaba como "cÃ¡ceres.pdf". Se recodifica una vez,
 * acá, para todas las subidas. Si el resultado no es UTF-8 válido, se deja como venía.
 */
function fixFileName(file) {
  if (!file?.originalname || !/[-ÿ]/.test(file.originalname)) return;
  const decoded = Buffer.from(file.originalname, 'latin1').toString('utf8');
  if (!decoded.includes('�')) file.originalname = decoded;
}

function ensureSubdir(subdir) {
  const dir = path.join(PRIVATE_ROOT, subdir);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function uploadPrivate(subdir, { mimeToExt = DOCUMENT_MIME_TO_EXT, maxMb = 10, maxFiles = undefined, errorMessage = 'Formato de archivo no permitido.' } = {}) {
  return multer({
    storage: multer.diskStorage({
      destination: (req, file, cb) => cb(null, ensureSubdir(subdir)),
      filename: (req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${mimeToExt[file.mimetype] || ''}`),
    }),
    fileFilter: (req, file, cb) => {
      fixFileName(file);
      return mimeToExt[file.mimetype] ? cb(null, true) : cb(AppError.badRequest(errorMessage));
    },
    limits: { fileSize: maxMb * 1024 * 1024, ...(maxFiles ? { files: maxFiles } : {}) },
  });
}

/** Ruta absoluta de un archivo privado guardado como "subdir/archivo.ext"; `null` si cae fuera de
 * la carpeta privada (dato corrupto). */
function resolvePrivatePath(relativePath) {
  if (!relativePath) return null;
  const absolute = path.join(PRIVATE_ROOT, relativePath);
  return absolute.startsWith(PRIVATE_ROOT) ? absolute : null;
}

/** Borrado de mejor esfuerzo — nunca debe tumbar la request que lo llama. */
function deletePrivateFile(relativePath) {
  const absolute = resolvePrivatePath(relativePath);
  if (!absolute) return;
  fs.unlink(absolute, () => {});
}

module.exports = { fixFileName, uploadPrivate, resolvePrivatePath, deletePrivateFile, DOCUMENT_MIME_TO_EXT, PROOF_MIME_TO_EXT };

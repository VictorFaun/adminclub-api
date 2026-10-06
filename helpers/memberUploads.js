const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const env = require('../config/env');
const AppError = require('./AppError');
const { resolvePrivatePath, deletePrivateFile } = require('../middlewares/privateUpload.middleware');
const { parseSettings, acceptedMimes, maxFilesOf, DOC_FORMATS, MAX_FILES_MULTIPLE } = require('./memberFieldTypes');

/**
 * Imágenes y archivos de la ficha enviados JUNTO con los datos (multipart) — formulario público
 * de inscripción y autoregistro. Cada archivo llega con el nombre de campo `file_<id del campo>`
 * y multer lo deja en la carpeta privada temporal `member-uploads/`. Acá se agrupan por campo, se
 * validan (tipo, cantidad, obligatorios) y después se mueven a su destino definitivo.
 */

const IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/webp'];
const TEMP_SUBDIR = 'member-uploads';
const PUBLIC_ROOT = path.join(__dirname, '..', env.upload.dir);

/** `fields` llega como texto JSON en un multipart: se convierte a objeto antes de validar. */
function parseMultipartFields(req, res, next) {
  if (typeof req.body?.fields === 'string') {
    try {
      req.body.fields = JSON.parse(req.body.fields);
    } catch {
      req.body.fields = null;
    }
  }
  next();
}

/** Ruta relativa (dentro de la carpeta privada) de un archivo recién recibido por multer. */
const tempPath = (file) => `${TEMP_SUBDIR}/${file.filename}`;

function discard(files) {
  for (const f of files || []) deletePrivateFile(tempPath(f));
}

/**
 * Agrupa los archivos por campo y valida contra los campos de subida del club (`catalog`: filas
 * de member_fields). `requireAll`: exige los obligatorios. Devuelve
 * `[{ field, files: [{ file_path, name, mime_type, size_bytes }] }]`. Si algo falla, borra lo
 * recibido y lanza el error.
 */
function collectUploads(catalog, files, { requireAll = true } = {}) {
  const list = files || [];
  try {
    const byId = new Map(catalog.filter((f) => f.field_type === 'image' || f.field_type === 'file').map((f) => [String(f.id), f]));
    const grouped = new Map();
    for (const file of list) {
      const match = /^file_(\d+)$/.exec(file.fieldname || '');
      const field = match && byId.get(match[1]);
      if (!field) throw AppError.badRequest('Se envió un archivo para un campo que no existe.');
      if (!grouped.has(field.id)) grouped.set(field.id, []);
      grouped.get(field.id).push(file);
    }
    const missing = [];
    const result = [];
    for (const field of byId.values()) {
      const got = grouped.get(field.id) || [];
      if (!got.length) {
        if (requireAll && field.is_required) missing.push(field.label);
        continue;
      }
      if (field.field_type === 'image') {
        const max = maxFilesOf(field);
        if (got.length > max) throw AppError.badRequest(max === 1 ? `${field.label}: solo se permite una imagen.` : `${field.label}: máximo ${max} imágenes.`);
        if (got.some((f) => !IMAGE_MIMES.includes(f.mimetype))) throw AppError.badRequest(`${field.label}: las imágenes deben ser PNG, JPG o WEBP.`);
      } else {
        assertDocuments(field, got);
      }
      result.push({
        field,
        files: got.map((f) => ({
          file_path: tempPath(f),
          name: String(f.originalname || 'Archivo').slice(0, 160),
          mime_type: f.mimetype,
          size_bytes: f.size,
        })),
      });
    }
    if (missing.length) throw AppError.badRequest(`Faltan campos obligatorios: ${missing.join(', ')}.`);
    return result;
  } catch (error) {
    discard(list);
    throw error;
  }
}

/** Cantidad y formatos permitidos de un campo de documento (ver member_fields.settings). */
function assertDocuments(field, files, existingCount = 0) {
  const settings = parseSettings(field);
  const max = settings.multiple ? MAX_FILES_MULTIPLE : 1;
  if (files.length + existingCount > max) {
    throw AppError.badRequest(max === 1 ? `${field.label}: solo se permite un documento.` : `${field.label}: máximo ${max} documentos.`);
  }
  const mimes = acceptedMimes(field);
  const wrong = files.find((f) => !mimes.includes(f.mimetype));
  if (wrong) {
    throw AppError.badRequest(`${field.label}: "${wrong.originalname}" no es un formato aceptado (${settings.formats.map((k) => DOC_FORMATS[k].label).join(', ')}).`);
  }
}

function moveFile(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  try {
    fs.renameSync(from, to);
  } catch {
    fs.copyFileSync(from, to);
    fs.unlink(from, () => {});
  }
}

const newName = (relative) => `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${path.extname(relative)}`;

/** Mueve un archivo privado a la carpeta pública `/uploads/<subdir>` (imágenes de la ficha). */
function moveToPublic(relativePrivate, subdir) {
  const from = resolvePrivatePath(relativePrivate);
  if (!from || !fs.existsSync(from)) return null;
  const name = newName(relativePrivate);
  moveFile(from, path.join(PUBLIC_ROOT, subdir, name));
  return `/uploads/${subdir}/${name}`;
}

/** Mueve un archivo privado a otra subcarpeta privada (documentos de la ficha). */
function moveToPrivate(relativePrivate, subdir) {
  const from = resolvePrivatePath(relativePrivate);
  if (!from || !fs.existsSync(from)) return null;
  const relative = `${subdir}/${newName(relativePrivate)}`;
  moveFile(from, resolvePrivatePath(relative));
  return relative;
}

module.exports = { TEMP_SUBDIR, IMAGE_MIMES, parseMultipartFields, collectUploads, assertDocuments, discard, moveToPublic, moveToPrivate };

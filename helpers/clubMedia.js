const path = require('path');
const sharp = require('sharp');
const env = require('../config/env');
const { toAbsoluteMediaUrl } = require('./mediaUrl');

const UPLOAD_ROOT = path.join(__dirname, '..', env.upload.dir);

/**
 * Versiones de menor resolución del logo y el banner del club (sql/089). Las grandes se usan solo
 * donde se ven grandes (inicio del club, página pública y formulario público); en el resto
 * (menú lateral, vista previa, correos, notificaciones, recibos) va la reducida, que carga rápido.
 *  - Logo: hasta 256×256, PNG (conserva la transparencia; los correos y pdfkit no leen WEBP).
 *  - Banner: hasta 960 de ancho, JPG.
 */
const SPECS = {
  logo: { suffix: '-sm.png', build: (img) => img.resize(256, 256, { fit: 'inside', withoutEnlargement: true }).png({ compressionLevel: 9, palette: true, quality: 95 }) },
  banner: { suffix: '-sm.jpg', build: (img) => img.resize(960, null, { fit: 'inside', withoutEnlargement: true }).flatten({ background: '#ffffff' }).jpeg({ quality: 80, mozjpeg: true }) },
};

/**
 * Genera la versión reducida de `relativeUrl` (`/uploads/logos/x.png`) junto a la original y
 * devuelve su ruta relativa, o `null` si no se pudo (se sigue usando la original).
 */
async function makeClubThumb(relativeUrl, kind) {
  const spec = SPECS[kind];
  if (!spec || !relativeUrl || /^https?:/i.test(relativeUrl)) return null;
  const rel = relativeUrl.replace(/^\/?uploads\//, '');
  const source = path.join(UPLOAD_ROOT, rel);
  if (!source.startsWith(UPLOAD_ROOT)) return null;
  const outRel = rel.replace(/\.[^./]+$/, '') + spec.suffix;
  try {
    await spec.build(sharp(source, { animated: false }).rotate()).toFile(path.join(UPLOAD_ROOT, outRel));
    return `/uploads/${outRel}`;
  } catch (error) {
    // eslint-disable-next-line global-require
    require('./logger').warn(`[uploads] No se pudo generar la versión reducida del ${kind}: ${source}`, { error: error.message });
    return null;
  }
}

/** URL absoluta del logo/banner reducido del club (fila MySQL), o la original si no hay reducida. */
function clubThumbUrl(club, kind) {
  if (!club) return null;
  return toAbsoluteMediaUrl(club[`${kind}_thumb_url`] || club[`${kind}_url`]);
}

module.exports = { makeClubThumb, clubThumbUrl, UPLOAD_ROOT };

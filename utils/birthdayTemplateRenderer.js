/**
 * Compone en el servidor una `BirthdayTemplateDesign` (ver birthdays.service.js) a un PNG final,
 * con los datos reales de un socio — es el equivalente en Node de
 * app/src/app/core/utils/birthday-template.util.ts (que solo corre en el navegador, para el
 * editor y la descarga/compartir manual). Se necesita una versión propia acá porque el cron de
 * cumpleaños (sin navegador) también debe poder adjuntar la imagen de la plantilla a la
 * notificación/correo — ver birthdays.service.js#_generateBirthdayImage.
 *
 * Usa @napi-rs/canvas (binarios precompilados, sin toolchain nativo) en vez de node-canvas.
 *
 * Limitación conocida: las fuentes del diseño (`fontFamily`, ej. "Segoe UI") no están instaladas
 * en el servidor, así que el texto cae a la fuente por defecto de @napi-rs/canvas en vez de la
 * elegida en el editor — el layout/colores/foto sí quedan idénticos. Si esto molesta, se puede
 * registrar cada fuente de FONT_FAMILY_OPTIONS (birthday-template.model.ts) con
 * `GlobalFonts.registerFromPath(...)` al arrancar el servidor.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const env = require('../config/env');
const logger = require('../helpers/logger');

const UPLOAD_ROOT = path.join(__dirname, '..', env.upload.dir);
const OUTPUT_SUBDIR = 'birthday-notifications';

// Mismo tamaño que TEMPLATE_SIZES.story en core/models/birthday-template.model.ts — solo existe
// el formato "historia", ver ese archivo para el porqué.
const TEMPLATE_SIZES = { story: { width: 1080, height: 1920 } };

/** Resuelve una URL/ruta relativa ("/uploads/xxx") a una ruta de archivo en disco — se lee
 * directo del filesystem en vez de por HTTP porque el cron corre en el mismo proceso que sirve
 * esos archivos: es más rápido y no depende de que el propio servidor pueda alcanzarse a sí
 * mismo por red. Una URL absoluta (http/https) se deja tal cual para que `loadImage` la baje. */
function resolveImageSource(url) {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  const withoutPrefix = url.replace(/^\/?uploads\//, '');
  return path.join(UPLOAD_ROOT, withoutPrefix);
}

async function safeLoadImage(url) {
  const src = resolveImageSource(url);
  if (!src) return null;
  try {
    return await loadImage(src);
  } catch (error) {
    logger.warn(`[birthdayTemplateRenderer] No se pudo cargar la imagen "${url}"`, { error: error.message });
    return null;
  }
}

function wrapText(ctx, text, maxWidth) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** Dibuja `img` centrado en [0,0,w,h] cubriendo todo el rectángulo (equivalente a CSS
 * `object-fit: cover`), igual que birthday-template.util.ts#drawCover. */
function drawCover(ctx, img, w, h) {
  const scale = Math.max(w / img.width, h / img.height);
  const iw = img.width * scale;
  const ih = img.height * scale;
  ctx.drawImage(img, (w - iw) / 2, (h - ih) / 2, iw, ih);
}

function drawPhotoPlaceholder(ctx, w, h) {
  ctx.fillStyle = 'rgba(0,0,0,0.12)';
  ctx.fillRect(0, 0, w, h);
}

function textForElement(el, data) {
  switch (el.variant) {
    case 'name':
      return data.name;
    case 'age':
      return data.age !== null && data.age !== undefined ? String(data.age) : '';
    case 'date':
      return data.dateLabel;
    default:
      return el.content;
  }
}

function drawElement(ctx, el, images, data) {
  ctx.save();
  ctx.translate(el.x + el.width / 2, el.y + el.height / 2);
  ctx.rotate((el.rotation * Math.PI) / 180);
  ctx.translate(-el.width / 2, -el.height / 2);

  if (el.type === 'image') {
    const img = images.get(el.url);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, el.width, el.height);
    ctx.clip();
    if (img) drawCover(ctx, img, el.width, el.height);
    ctx.restore();
  } else if (el.type === 'photo') {
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, el.width, el.height);
    ctx.clip();
    const img = data.photoUrl ? images.get(data.photoUrl) : null;
    if (img) drawCover(ctx, img, el.width, el.height);
    else drawPhotoPlaceholder(ctx, el.width, el.height);
    ctx.restore();
  } else if (el.type === 'shape') {
    if (el.fillType === 'gradient') {
      const g = ctx.createLinearGradient(0, 0, el.width, el.height);
      g.addColorStop(0, el.color);
      g.addColorStop(1, el.gradientColor);
      ctx.fillStyle = g;
    } else {
      ctx.fillStyle = el.color;
    }
    if (el.shapeKind === 'circle') {
      ctx.beginPath();
      ctx.ellipse(el.width / 2, el.height / 2, el.width / 2, el.height / 2, 0, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillRect(0, 0, el.width, el.height);
    }
  } else if (el.type === 'text') {
    ctx.font = `${el.fontWeight} ${el.fontSize}px ${el.fontFamily}`;
    ctx.fillStyle = el.color;
    ctx.textAlign = el.align;
    ctx.textBaseline = 'top';
    const tx = el.align === 'left' ? 0 : el.align === 'right' ? el.width : el.width / 2;
    const lineHeight = el.fontSize * 1.25;
    let ty = 0;
    for (const line of wrapText(ctx, textForElement(el, data), el.width)) {
      ctx.fillText(line, tx, ty);
      ty += lineHeight;
    }
  }

  ctx.restore();
}

/**
 * Renderiza el diseño con los datos de un socio y devuelve el PNG resultante como Buffer.
 * `data`: { name, age (number|null), dateLabel, photoUrl (relativa "/uploads/..." o absoluta) }.
 */
async function renderBirthdayTemplateToBuffer(design, data) {
  const { width, height } = TEMPLATE_SIZES[design.format] || TEMPLATE_SIZES.story;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  const urls = new Set();
  for (const el of design.elements) if (el.type === 'image') urls.add(el.url);
  if (data.photoUrl) urls.add(data.photoUrl);
  const images = new Map();
  await Promise.all(
    [...urls].map(async (url) => {
      images.set(url, await safeLoadImage(url));
    })
  );

  const sorted = [...design.elements].sort((a, b) => a.zIndex - b.zIndex);
  for (const el of sorted) drawElement(ctx, el, images, data);

  return canvas.toBuffer('image/png');
}

/** Guarda el PNG generado en uploads/birthday-notifications y devuelve su ruta relativa (misma
 * convención que el resto de /uploads, ver helpers/mediaUrl.js). */
function saveBirthdayNotificationImage(buffer) {
  const dir = path.join(UPLOAD_ROOT, OUTPUT_SUBDIR);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const filename = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}.png`;
  fs.writeFileSync(path.join(dir, filename), buffer);
  return `/uploads/${OUTPUT_SUBDIR}/${filename}`;
}

module.exports = { renderBirthdayTemplateToBuffer, saveBirthdayNotificationImage };

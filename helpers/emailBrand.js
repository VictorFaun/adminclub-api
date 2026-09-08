/**
 * Utilidades de color para plantillas de correo — mismo cálculo que el frontend usa para aplicar
 * la marca de cada club como variables CSS (ver app/src/app/shared/utils/color.utils.ts), portado
 * a Node para que el botón/encabezado de un correo con los colores del club usen el mismo criterio
 * de contraste que ya ve el usuario en la app.
 */

function hexToRgb(hex) {
  let value = hex.replace('#', '');
  if (value.length === 3) {
    value = value
      .split('')
      .map((c) => c + c)
      .join('');
  }
  const int = parseInt(value, 16);
  return { r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255 };
}

function toHex(n) {
  return Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
}

/** Oscurece un color hexadecimal en el porcentaje indicado (0-1). */
function shadeColor(hex, percent = 0.12) {
  const { r, g, b } = hexToRgb(hex);
  const factor = 1 - percent;
  return `#${toHex(r * factor)}${toHex(g * factor)}${toHex(b * factor)}`;
}

/** Aclara un color hexadecimal en el porcentaje indicado (0-1). */
function tintColor(hex, percent = 0.12) {
  const { r, g, b } = hexToRgb(hex);
  return `#${toHex(r + (255 - r) * percent)}${toHex(g + (255 - g) * percent)}${toHex(b + (255 - b) * percent)}`;
}

/** Devuelve blanco o negro según cuál ofrezca mejor contraste sobre el color de fondo dado. */
function getContrastColor(hex) {
  const { r, g, b } = hexToRgb(hex);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? '#16151f' : '#ffffff';
}

module.exports = { hexToRgb, shadeColor, tintColor, getContrastColor };

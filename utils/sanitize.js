const xss = require('xss');

/**
 * Sanitiza recursivamente strings dentro de un objeto/array contra XSS almacenado,
 * conservando otros tipos de dato intactos. Se aplica a todo `req.body` en
 * validation.middleware.js antes de llegar al controller.
 */
function sanitizeValue(value) {
  if (typeof value === 'string') {
    return xss(value.trim(), { whiteList: {}, stripIgnoreTag: true, stripIgnoreTagBody: ['script', 'style'] });
  }
  if (Array.isArray(value)) {
    return value.map(sanitizeValue);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, sanitizeValue(v)]));
  }
  return value;
}

module.exports = { sanitizeValue };

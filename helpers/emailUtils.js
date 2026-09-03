/**
 * Opciones para `normalizeEmail` de validator.js que solo normalizan mayúsculas/minúsculas.
 * Los defaults de la librería son mucho más agresivos: quitan los puntos y el "+alias" en
 * Gmail, el "-alias" en Yahoo, etc. — mutando en silencio la dirección que la persona
 * realmente escribió (ej. "juan.perez@gmail.com" se guardaba como "juanperez@gmail.com").
 */
const NORMALIZE_EMAIL_OPTIONS = {
  gmail_remove_dots: false,
  gmail_remove_subaddress: false,
  gmail_convert_googlemaildotcom: false,
  outlookdotcom_remove_subaddress: false,
  yahoo_remove_subaddress: false,
  icloud_remove_subaddress: false,
  yandex_convert_yandexru: false,
};

module.exports = { NORMALIZE_EMAIL_OPTIONS };

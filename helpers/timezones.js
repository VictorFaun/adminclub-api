// Lista de zonas horarias soportadas por el motor ICU embebido en Node (>=18) — evita mantener
// a mano una lista propia que se desactualice. "UTC" es un identificador válido y ampliamente
// usado que `supportedValuesOf` deliberadamente NO incluye (solo enumera nombres de zona IANA
// como "America/Santiago"; ver ECMA-402) — se agrega a mano o cualquiera que elija "UTC" quedaría
// rechazado pese a ser una elección perfectamente válida. Fuente única usada por la validación
// de configuración de plataforma y de club, para que ambas acepten exactamente las mismas zonas.
const VALID_TIMEZONES = new Set([...Intl.supportedValuesOf('timeZone'), 'UTC']);

function isValidTimezone(value) {
  return typeof value === 'string' && VALID_TIMEZONES.has(value);
}

module.exports = { VALID_TIMEZONES, isValidTimezone };

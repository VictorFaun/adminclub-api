/**
 * RUT chileno — formato canónico ÚNICO en toda la app: "12345678-9" (sin puntos, con guion,
 * verificador en mayúscula). Todo RUT que entra por la API se normaliza a esto y se rechaza si no
 * calza; en BD ya está así (migración 043).
 */
const RUT_CANONICAL = /^\d{6,8}-[0-9K]$/;

/** Quita todo lo que no sea dígito o K. */
function clean(raw) {
  return String(raw ?? '').replace(/[^0-9kK]/g, '').toUpperCase();
}

/** "11.004.517-4" / "110045174" / "11004517k" → "11004517-4" / "11004517-K"; `null` si no parece un RUT. */
function normalizeRut(raw) {
  const c = clean(raw);
  if (!/^\d{6,8}[0-9K]$/.test(c)) return null;
  return `${c.slice(0, -1)}-${c.slice(-1)}`;
}

function isCanonicalRut(value) {
  return RUT_CANONICAL.test(String(value ?? ''));
}

module.exports = { normalizeRut, isCanonicalRut, RUT_CANONICAL };

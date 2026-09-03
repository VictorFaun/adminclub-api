/**
 * Arma el objeto `changes` de una fila de auditoría como un diff legible, no un volcado
 * plano del valor nuevo — así el modal "Más información" del frontend puede mostrar
 * "Nombre: «X» → «Y»" en vez de solo el valor final.
 */

/** `{from, to}` si el valor cambió, `undefined` si no (para que buildDiff lo descarte). */
function diffValue(previous, next) {
  if (previous === next) return undefined;
  return { from: previous ?? null, to: next ?? null };
}

/** `{added, removed}` si el set cambió, `undefined` si no. Compara por valor, no por orden. */
function diffArray(previous = [], next = []) {
  const prevSet = new Set(previous);
  const nextSet = new Set(next);
  const added = next.filter((v) => !prevSet.has(v));
  const removed = previous.filter((v) => !nextSet.has(v));
  if (added.length === 0 && removed.length === 0) return undefined;
  return { added, removed };
}

/** Descarta las entradas `undefined` (campos sin cambios); devuelve `null` si no queda nada. */
function buildDiff(fields) {
  const entries = Object.entries(fields).filter(([, v]) => v !== undefined);
  return entries.length ? Object.fromEntries(entries) : null;
}

module.exports = { diffValue, diffArray, buildDiff };

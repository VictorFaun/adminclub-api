/**
 * Datos de un miembro con "uso especial" (nombre, identificador, nacimiento, foto…). Ya no son
 * columnas de `members`: salen de sus campos (vista `member_profiles`, sql/052). Estos fragmentos
 * permiten a cualquier consulta seguir leyéndolos con los mismos nombres de antes:
 *
 *   SELECT m.*, ${PROFILE_COLS} FROM members m ${profileJoin('m')} ...
 */
const PROFILE_FIELDS = ['first_name', 'middle_name', 'last_name', 'second_last_name', 'rut', 'email', 'phone', 'birth_date', 'birthday_photo_url', 'avatar_url'];

const profileJoin = (memberAlias = 'm', profileAlias = 'mp') => `LEFT JOIN member_profiles ${profileAlias} ON ${profileAlias}.member_id = ${memberAlias}.id`;

const profileCols = (profileAlias = 'mp') => PROFILE_FIELDS.map((f) => `${profileAlias}.${f}`).join(', ');

/** Nombre completo / corto (NULL si el club no tiene campos de nombre o están vacíos). */
const fullNameSql = (p = 'mp') => `NULLIF(CONCAT_WS(' ', ${p}.first_name, ${p}.middle_name, ${p}.last_name, ${p}.second_last_name), '')`;
const shortNameSql = (p = 'mp') => `NULLIF(CONCAT_WS(' ', ${p}.first_name, ${p}.last_name), '')`;

module.exports = { PROFILE_FIELDS, PROFILE_COLS: profileCols(), profileJoin, profileCols, fullNameSql, shortNameSql };

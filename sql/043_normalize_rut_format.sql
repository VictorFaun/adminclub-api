-- ============================================================================
-- 043: los RUT se guardan SIEMPRE en el formato canónico "12345678-9": sin puntos, con guion y
-- dígito verificador en mayúscula (la API valida y normaliza desde ahora; ver helpers/rut.js).
-- Esta migración convierte los ya ingresados ("12.345.678-9", "123456789", "12345678k"...).
--
--  * Solo toca los que parecen un RUT (6-8 dígitos + verificador); cualquier otro valor queda igual.
--  * Si al normalizar chocara con otro miembro del mismo club (uk_members_club_rut), ese registro
--    se deja sin cambiar en vez de fallar la migración — se pueden listar con:
--      SELECT id, club_id, rut FROM members WHERE rut IS NOT NULL AND rut NOT REGEXP '^[0-9]{6,8}-[0-9K]$';
-- ============================================================================
USE `admin_club`;

UPDATE `members` m
JOIN (
  SELECT
    id,
    club_id,
    UPPER(REGEXP_REPLACE(rut, '[^0-9kK]', '')) AS clean
  FROM `members`
  WHERE rut IS NOT NULL
) c ON c.id = m.id
SET m.rut = CONCAT(LEFT(c.clean, CHAR_LENGTH(c.clean) - 1), '-', RIGHT(c.clean, 1))
WHERE c.clean REGEXP '^[0-9]{6,8}[0-9K]$'
  AND m.rut <> CONCAT(LEFT(c.clean, CHAR_LENGTH(c.clean) - 1), '-', RIGHT(c.clean, 1))
  AND NOT EXISTS (
    SELECT 1 FROM (SELECT id, club_id, rut FROM `members`) o
    WHERE o.club_id = m.club_id
      AND o.id <> m.id
      AND o.rut = CONCAT(LEFT(c.clean, CHAR_LENGTH(c.clean) - 1), '-', RIGHT(c.clean, 1))
  );

-- ============================================================================
-- 084: vista member_profiles sin subconsulta derivada (mÃ¡s simple, mismos datos).
--
-- La de sql/083 sacaba la ficha del Identificador con un LEFT JOIN a una subconsulta
-- (SELECT DISTINCT ...); ahora se une directo al campo Identificador del club (uno por club) y
-- a su fila en member_form_fields (un campo es de una sola ficha), sin multiplicar filas.
-- Misma prioridad que en 083: fichas que responde el miembro, la del Identificador, el orden.
-- (La bÃºsqueda del listado ya no combina esta vista con un EXISTS: ver
-- members.repository.js#paginateByClub, por un fallo del optimizador de MariaDB.)
-- ============================================================================

CREATE OR REPLACE VIEW `member_profiles` AS
SELECT m.id AS member_id,
       MAX(CASE WHEN f.role = 'first_name' THEN v.value END) AS first_name,
       MAX(CASE WHEN f.role = 'middle_name' THEN v.value END) AS middle_name,
       MAX(CASE WHEN f.role = 'last_name' THEN v.value END) AS last_name,
       MAX(CASE WHEN f.role = 'second_last_name' THEN v.value END) AS second_last_name,
       MAX(CASE WHEN f.role = 'identifier' THEN v.value END) AS rut,
       SUBSTRING(MIN(CASE WHEN f.role = 'email' AND v.value <> '' THEN CONCAT(IF(mfm.member_id IS NULL, '1', '0'), IF(idff.form_id IS NULL, '1', '0'), LPAD(COALESCE(fm.sort_order, 999999), 10, '0'), LPAD(COALESCE(fm.id, 0), 10, '0'), v.value) END), 23) AS email,
       SUBSTRING(MIN(CASE WHEN f.role = 'phone' AND v.value <> '' THEN CONCAT(IF(mfm.member_id IS NULL, '1', '0'), IF(idff.form_id IS NULL, '1', '0'), LPAD(COALESCE(fm.sort_order, 999999), 10, '0'), LPAD(COALESCE(fm.id, 0), 10, '0'), v.value) END), 23) AS phone,
       CAST(SUBSTRING(MIN(CASE WHEN f.role = 'birth_date' AND v.value <> '' THEN CONCAT(IF(mfm.member_id IS NULL, '1', '0'), IF(idff.form_id IS NULL, '1', '0'), LPAD(COALESCE(fm.sort_order, 999999), 10, '0'), LPAD(COALESCE(fm.id, 0), 10, '0'), v.value) END), 23) AS DATE) AS birth_date,
       SUBSTRING(MIN(CASE WHEN f.role = 'birthday_photo' AND v.value <> '' THEN CONCAT(IF(mfm.member_id IS NULL, '1', '0'), IF(idff.form_id IS NULL, '1', '0'), LPAD(COALESCE(fm.sort_order, 999999), 10, '0'), LPAD(COALESCE(fm.id, 0), 10, '0'), v.value) END), 23) AS birthday_photo_url,
       SUBSTRING(MIN(CASE WHEN f.role = 'avatar' AND v.value <> '' THEN CONCAT(IF(mfm.member_id IS NULL, '1', '0'), IF(idff.form_id IS NULL, '1', '0'), LPAD(COALESCE(fm.sort_order, 999999), 10, '0'), LPAD(COALESCE(fm.id, 0), 10, '0'), v.value) END), 23) AS avatar_url
FROM `members` m
LEFT JOIN `member_field_values` v ON v.member_id = m.id
LEFT JOIN `member_fields` f ON f.id = v.field_id AND f.role IS NOT NULL
-- Ficha del campo (una sola, uk_mff_field) y si el miembro la responde.
LEFT JOIN `member_form_fields` mff ON mff.field_id = f.id
LEFT JOIN `member_forms` fm ON fm.id = mff.form_id
LEFT JOIN `member_form_members` mfm ON mfm.form_id = mff.form_id AND mfm.member_id = m.id
-- Â¿Esa ficha es la del Identificador? (un Identificador por club; su campo estÃ¡ en una sola ficha)
LEFT JOIN `member_fields` idf ON idf.club_id = f.club_id AND idf.role = 'identifier'
LEFT JOIN `member_form_fields` idff ON idff.field_id = idf.id AND idff.form_id = mff.form_id
GROUP BY m.id;

-- ============================================================================
-- 083: algunos usos especiales van una vez POR FICHA (antes, una vez por club).
--
-- Fecha de nacimiento, Foto para cumpleaños, Foto de perfil, Correo y Teléfono de contacto pueden
-- estar en varias fichas (cada ficha con su propio campo): así se pide, por ejemplo, el cumpleaños
-- solo en las fichas de los grupos que lo necesitan, sin crear una ficha aparte para eso. Los
-- nombres y el Identificador siguen una sola vez en el club (los valida
-- memberFields.service.js#_validateRole; ver helpers/memberFieldTypes.js#ROLES `perForm`).
--
-- El dato del miembro (vista member_profiles) sale de la primera ficha que lo tenga respondido:
-- primero las fichas que responde el miembro, entre ellas la del Identificador, y luego el orden de
-- las fichas. Para eso cada valor se antepone con una clave de prioridad de largo fijo (22
-- caracteres), se toma el MIN y se le quita la clave.
-- ============================================================================

ALTER TABLE `member_fields` DROP INDEX `uk_member_fields_club_role`;
ALTER TABLE `member_fields` ADD KEY `idx_member_fields_club_role` (`club_id`, `role`);

CREATE OR REPLACE VIEW `member_profiles` AS
SELECT m.id AS member_id,
       MAX(CASE WHEN f.role = 'first_name' THEN v.value END) AS first_name,
       MAX(CASE WHEN f.role = 'middle_name' THEN v.value END) AS middle_name,
       MAX(CASE WHEN f.role = 'last_name' THEN v.value END) AS last_name,
       MAX(CASE WHEN f.role = 'second_last_name' THEN v.value END) AS second_last_name,
       MAX(CASE WHEN f.role = 'identifier' THEN v.value END) AS rut,
       -- Clave de prioridad (22 caracteres) + valor: ¿responde esa ficha? · ¿es la del Identificador? · orden de la ficha.
       SUBSTRING(MIN(CASE WHEN f.role = 'email' AND v.value <> '' THEN CONCAT(IF(mfm.member_id IS NULL, '1', '0'), IF(idf.form_id IS NULL, '1', '0'), LPAD(COALESCE(fm.sort_order, 999999), 10, '0'), LPAD(COALESCE(fm.id, 0), 10, '0'), v.value) END), 23) AS email,
       SUBSTRING(MIN(CASE WHEN f.role = 'phone' AND v.value <> '' THEN CONCAT(IF(mfm.member_id IS NULL, '1', '0'), IF(idf.form_id IS NULL, '1', '0'), LPAD(COALESCE(fm.sort_order, 999999), 10, '0'), LPAD(COALESCE(fm.id, 0), 10, '0'), v.value) END), 23) AS phone,
       CAST(SUBSTRING(MIN(CASE WHEN f.role = 'birth_date' AND v.value <> '' THEN CONCAT(IF(mfm.member_id IS NULL, '1', '0'), IF(idf.form_id IS NULL, '1', '0'), LPAD(COALESCE(fm.sort_order, 999999), 10, '0'), LPAD(COALESCE(fm.id, 0), 10, '0'), v.value) END), 23) AS DATE) AS birth_date,
       SUBSTRING(MIN(CASE WHEN f.role = 'birthday_photo' AND v.value <> '' THEN CONCAT(IF(mfm.member_id IS NULL, '1', '0'), IF(idf.form_id IS NULL, '1', '0'), LPAD(COALESCE(fm.sort_order, 999999), 10, '0'), LPAD(COALESCE(fm.id, 0), 10, '0'), v.value) END), 23) AS birthday_photo_url,
       SUBSTRING(MIN(CASE WHEN f.role = 'avatar' AND v.value <> '' THEN CONCAT(IF(mfm.member_id IS NULL, '1', '0'), IF(idf.form_id IS NULL, '1', '0'), LPAD(COALESCE(fm.sort_order, 999999), 10, '0'), LPAD(COALESCE(fm.id, 0), 10, '0'), v.value) END), 23) AS avatar_url
FROM `members` m
LEFT JOIN `member_field_values` v ON v.member_id = m.id
LEFT JOIN `member_fields` f ON f.id = v.field_id AND f.role IS NOT NULL
-- Cada campo es de una sola ficha (uk_mff_field): estos joins no multiplican filas.
LEFT JOIN `member_form_fields` mff ON mff.field_id = f.id
LEFT JOIN `member_forms` fm ON fm.id = mff.form_id
LEFT JOIN `member_form_members` mfm ON mfm.form_id = mff.form_id AND mfm.member_id = m.id
LEFT JOIN (
  SELECT DISTINCT x.form_id FROM `member_form_fields` x INNER JOIN `member_fields` y ON y.id = x.field_id AND y.role = 'identifier'
) idf ON idf.form_id = mff.form_id
GROUP BY m.id;

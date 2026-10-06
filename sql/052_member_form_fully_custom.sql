-- ============================================================================
-- 052: ficha de miembro 100% configurable.
-- Todos los datos del miembro (nombres, RUT, correo, teléfono, nacimiento, foto, documentos…)
-- pasan a ser CAMPOS de la ficha (member_fields + member_field_values). `members` queda solo con
-- lo que identifica la fila (id, club, estado, usuario vinculado).
--  * member_fields.role: "uso especial" opcional de un campo, para que el resto de la app sepa
--    qué campo es el nombre (listas, cobros…), el identificador (página pública de pagos, evita
--    duplicados), la fecha de nacimiento (cumpleaños), la foto (plantillas), etc. Uno por club.
--  * Nuevos tipos: texto largo, alternativas, selección múltiple, correo, teléfono, RUT, imagen
--    y archivos.
--  * member_documents.field_id: los archivos pertenecen a un campo de tipo "archivos".
--  * member_profiles (vista): los datos con uso especial de cada miembro, armados desde sus valores
--    (no duplica datos: se calcula al consultar).
-- Los campos que antes eran fijos se crean como campos normales (con las etiquetas/obligatorios/
-- visibles que el club tenía configurados) y sus valores se copian antes de borrar las columnas.
-- ============================================================================
USE `admin_club`;

ALTER TABLE `member_fields`
  MODIFY COLUMN `field_type` ENUM('text','textarea','number','date','boolean','select','radio','multiselect','email','phone','rut','address','image','file') NOT NULL DEFAULT 'text',
  ADD COLUMN `role` VARCHAR(30) NULL AFTER `field_type`,
  ADD COLUMN `help_text` VARCHAR(255) NULL AFTER `options`,
  ADD COLUMN `in_public_form` TINYINT(1) NOT NULL DEFAULT 1 AFTER `is_required`,
  ADD UNIQUE KEY `uk_member_fields_club_role` (`club_id`, `role`);

ALTER TABLE `member_documents`
  ADD COLUMN `field_id` BIGINT UNSIGNED NULL AFTER `member_id`,
  ADD CONSTRAINT `fk_member_documents_field` FOREIGN KEY (`field_id`) REFERENCES `member_fields` (`id`) ON DELETE CASCADE;

-- Los campos personalizados existentes van después de los que eran fijos.
UPDATE `member_fields` SET `sort_order` = `sort_order` + 100;

-- Campos que eran fijos → campos de la ficha (por club), respetando su configuración guardada.
INSERT IGNORE INTO `member_fields` (`club_id`, `code`, `label`, `field_type`, `role`, `is_required`, `in_public_form`, `sort_order`)
SELECT c.id, d.code,
       COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(cs.setting_value, CONCAT('$.', d.setting_key, '.label'))), ''), d.label),
       d.field_type, d.role,
       CASE WHEN d.locked = 1 THEN 1 WHEN JSON_UNQUOTE(JSON_EXTRACT(cs.setting_value, CONCAT('$.', d.setting_key, '.required'))) = 'true' THEN 1 ELSE 0 END,
       d.in_public_form, d.sort_order
FROM `clubs` c
CROSS JOIN (
  SELECT 'nombre' AS code, 'Primer nombre' AS label, 'text' AS field_type, 'first_name' AS role, 'firstName' AS setting_key, 1 AS locked, 1 AS in_public_form, 1 AS sort_order
  UNION ALL SELECT 'segundo-nombre', 'Segundo nombre', 'text', 'middle_name', 'middleName', 0, 1, 2
  UNION ALL SELECT 'apellido', 'Primer apellido', 'text', 'last_name', 'lastName', 1, 1, 3
  UNION ALL SELECT 'segundo-apellido', 'Segundo apellido', 'text', 'second_last_name', 'secondLastName', 0, 1, 4
  UNION ALL SELECT 'rut', 'RUT', 'rut', 'identifier', 'rut', 0, 1, 5
  UNION ALL SELECT 'fecha-nacimiento', 'Fecha de nacimiento', 'date', 'birth_date', 'birthDate', 0, 1, 6
  UNION ALL SELECT 'correo', 'Correo', 'email', 'email', 'email', 0, 1, 7
  UNION ALL SELECT 'telefono', 'Teléfono', 'phone', 'phone', 'phone', 0, 1, 8
  UNION ALL SELECT 'foto', 'Foto', 'image', 'photo', 'photo', 0, 0, 9
  UNION ALL SELECT 'documentos', 'Documentos', 'file', NULL, 'documents', 0, 0, 10
) d
LEFT JOIN `club_settings` cs ON cs.club_id = c.id AND cs.setting_key = 'member_default_fields'
WHERE d.locked = 1 OR COALESCE(JSON_UNQUOTE(JSON_EXTRACT(cs.setting_value, CONCAT('$.', d.setting_key, '.visible'))), 'true') <> 'false';

-- Valores: de las columnas de `members` a member_field_values.
INSERT IGNORE INTO `member_field_values` (`member_id`, `field_id`, `value`)
SELECT m.id, f.id, m.first_name FROM `members` m JOIN `member_fields` f ON f.club_id = m.club_id AND f.role = 'first_name' WHERE COALESCE(m.first_name, '') <> ''
UNION ALL SELECT m.id, f.id, m.middle_name FROM `members` m JOIN `member_fields` f ON f.club_id = m.club_id AND f.role = 'middle_name' WHERE COALESCE(m.middle_name, '') <> ''
UNION ALL SELECT m.id, f.id, m.last_name FROM `members` m JOIN `member_fields` f ON f.club_id = m.club_id AND f.role = 'last_name' WHERE COALESCE(m.last_name, '') <> ''
UNION ALL SELECT m.id, f.id, m.second_last_name FROM `members` m JOIN `member_fields` f ON f.club_id = m.club_id AND f.role = 'second_last_name' WHERE COALESCE(m.second_last_name, '') <> ''
UNION ALL SELECT m.id, f.id, m.rut FROM `members` m JOIN `member_fields` f ON f.club_id = m.club_id AND f.role = 'identifier' WHERE COALESCE(m.rut, '') <> ''
UNION ALL SELECT m.id, f.id, DATE_FORMAT(m.birth_date, '%Y-%m-%d') FROM `members` m JOIN `member_fields` f ON f.club_id = m.club_id AND f.role = 'birth_date' WHERE m.birth_date IS NOT NULL
UNION ALL SELECT m.id, f.id, m.email FROM `members` m JOIN `member_fields` f ON f.club_id = m.club_id AND f.role = 'email' WHERE COALESCE(m.email, '') <> ''
UNION ALL SELECT m.id, f.id, m.phone FROM `members` m JOIN `member_fields` f ON f.club_id = m.club_id AND f.role = 'phone' WHERE COALESCE(m.phone, '') <> ''
UNION ALL SELECT m.id, f.id, m.photo_url FROM `members` m JOIN `member_fields` f ON f.club_id = m.club_id AND f.role = 'photo' WHERE COALESCE(m.photo_url, '') <> '';

-- Documentos existentes → al campo "Documentos" de su club.
UPDATE `member_documents` d
  JOIN `members` m ON m.id = d.member_id
  JOIN `member_fields` f ON f.club_id = m.club_id AND f.code = 'documentos' AND f.field_type = 'file'
  SET d.field_id = f.id
  WHERE d.field_id IS NULL;

-- Solicitudes del formulario público: todo pasa a `fields` (código → valor).
ALTER TABLE `member_applications` CHANGE COLUMN `custom_fields` `fields` JSON NULL;
UPDATE `member_applications` SET `fields` = JSON_MERGE_PATCH(
  COALESCE(`fields`, JSON_OBJECT()),
  JSON_OBJECT('nombre', first_name, 'segundo-nombre', middle_name, 'apellido', last_name, 'segundo-apellido', second_last_name,
              'rut', rut, 'fecha-nacimiento', DATE_FORMAT(birth_date, '%Y-%m-%d'), 'correo', email, 'telefono', phone)
);
ALTER TABLE `member_applications`
  DROP INDEX `idx_member_applications_rut`,
  DROP COLUMN `first_name`, DROP COLUMN `middle_name`, DROP COLUMN `last_name`, DROP COLUMN `second_last_name`,
  DROP COLUMN `email`, DROP COLUMN `phone`, DROP COLUMN `rut`, DROP COLUMN `birth_date`;

-- `members` queda solo con lo que identifica la fila. La unicidad del identificador (antes el
-- índice único club+rut) la valida ahora members.service.js sobre el campo con uso "identificador".
ALTER TABLE `members`
  DROP INDEX `uk_members_club_rut`,
  DROP COLUMN `first_name`, DROP COLUMN `middle_name`, DROP COLUMN `last_name`, DROP COLUMN `second_last_name`,
  DROP COLUMN `email`, DROP COLUMN `phone`, DROP COLUMN `rut`, DROP COLUMN `birth_date`, DROP COLUMN `photo_url`;

-- La configuración de "campos por defecto" ya no aplica: ahora todos son campos de la ficha.
DELETE FROM `club_settings` WHERE `setting_key` = 'member_default_fields';

-- Datos con uso especial de cada miembro (nombre, identificador, nacimiento, foto…).
CREATE OR REPLACE VIEW `member_profiles` AS
SELECT m.id AS member_id,
       MAX(CASE WHEN f.role = 'first_name' THEN v.value END) AS first_name,
       MAX(CASE WHEN f.role = 'middle_name' THEN v.value END) AS middle_name,
       MAX(CASE WHEN f.role = 'last_name' THEN v.value END) AS last_name,
       MAX(CASE WHEN f.role = 'second_last_name' THEN v.value END) AS second_last_name,
       MAX(CASE WHEN f.role = 'identifier' THEN v.value END) AS rut,
       MAX(CASE WHEN f.role = 'email' THEN v.value END) AS email,
       MAX(CASE WHEN f.role = 'phone' THEN v.value END) AS phone,
       CAST(MAX(CASE WHEN f.role = 'birth_date' THEN v.value END) AS DATE) AS birth_date,
       MAX(CASE WHEN f.role = 'photo' THEN v.value END) AS photo_url
FROM `members` m
LEFT JOIN `member_field_values` v ON v.member_id = m.id
LEFT JOIN `member_fields` f ON f.id = v.field_id AND f.role IS NOT NULL
GROUP BY m.id;

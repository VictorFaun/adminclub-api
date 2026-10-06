-- =============================================================================
-- 055 — Foto de perfil (avatar) y foto para cumpleaños como usos especiales separados
-- =============================================================================
-- Antes un único uso "photo" servía para todo. Ahora:
--   * birthday_photo → la imagen que usan las plantillas de cumpleaños (siempre una, 9:16).
--   * avatar         → la foto de perfil: avatares en listas y cabecera de la ficha (siempre una, 1:1).
-- La foto existente pasa a ser la de cumpleaños (es 9:16) y cada club recibe un campo nuevo
-- "Foto de perfil" justo después, vacío (una foto 9:16 no sirve como avatar cuadrado).

UPDATE `member_fields` SET `role` = 'birthday_photo', `settings` = '{"aspect":"9:16","multiple":false}' WHERE `role` = 'photo';
UPDATE `member_fields` SET `label` = 'Foto para cumpleaños' WHERE `role` = 'birthday_photo' AND `label` = 'Foto';

-- Hace lugar para el campo nuevo justo después de la foto de cumpleaños.
UPDATE `member_fields` f
JOIN (SELECT `club_id`, `sort_order` AS s FROM `member_fields` WHERE `role` = 'birthday_photo') p ON p.club_id = f.club_id
SET f.`sort_order` = f.`sort_order` + 1
WHERE f.`sort_order` > p.s;

INSERT IGNORE INTO `member_fields` (`club_id`, `code`, `label`, `field_type`, `role`, `options`, `settings`, `help_text`, `is_required`, `in_public_form`, `sort_order`)
SELECT f.`club_id`, 'foto-perfil', 'Foto de perfil', 'image', 'avatar', NULL, '{"aspect":"1:1","multiple":false}', NULL, 0, 1, f.`sort_order` + 1
FROM `member_fields` f
WHERE f.`role` = 'birthday_photo'
  AND NOT EXISTS (SELECT 1 FROM `member_fields` x WHERE x.`club_id` = f.`club_id` AND x.`role` = 'avatar');

-- Datos con uso especial de cada miembro.
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
       MAX(CASE WHEN f.role = 'birthday_photo' THEN v.value END) AS birthday_photo_url,
       MAX(CASE WHEN f.role = 'avatar' THEN v.value END) AS avatar_url
FROM `members` m
LEFT JOIN `member_field_values` v ON v.member_id = m.id
LEFT JOIN `member_fields` f ON f.id = v.field_id AND f.role IS NOT NULL
GROUP BY m.id;

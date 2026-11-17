-- ============================================================================
-- 086: fichas libres y prioridad de los datos especiales por miembro.
--
-- * Ya no hay fichas "por defecto" ni una ficha que vaya siempre (la del Identificador): cada
--   ficha es libre. Un miembro puede no responder ninguna.
-- * Todos los usos especiales (nombres e Identificador incluidos) pueden repetirse entre fichas;
--   en una misma ficha, una sola vez (memberFields.service.js#_validateRole).
-- * Si un miembro tiene el mismo dato especial en varias fichas (ej. "Foto para cumpleaños" en
--   dos), `member_role_priority` dice en qué orden mirarlas (la elige el código de invitación al
--   inscribirse: invitations.form_settings.rolePriority). Se usa el de la primera que lo tenga
--   respondido; si no hay prioridad, el orden de las fichas.
-- ============================================================================

UPDATE `member_forms` SET `is_default` = 0;

CREATE TABLE IF NOT EXISTS `member_role_priority` (
  `member_id` BIGINT UNSIGNED NOT NULL,
  `role` VARCHAR(40) NOT NULL,
  `form_id` BIGINT UNSIGNED NOT NULL,
  `position` INT NOT NULL,
  PRIMARY KEY (`member_id`, `role`, `form_id`),
  KEY `idx_mrp_form` (`form_id`),
  CONSTRAINT `fk_mrp_member` FOREIGN KEY (`member_id`) REFERENCES `members` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_mrp_form` FOREIGN KEY (`form_id`) REFERENCES `member_forms` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Datos especiales de cada miembro: por cada uso, el valor de la ficha con más prioridad que lo
-- tenga respondido (sin texto concatenado: ver sql/085).
CREATE OR REPLACE VIEW `member_profiles` AS
SELECT m.id AS member_id,
       MAX(CASE WHEN r.role = 'first_name' AND r.rn = 1 THEN r.value END) AS first_name,
       MAX(CASE WHEN r.role = 'middle_name' AND r.rn = 1 THEN r.value END) AS middle_name,
       MAX(CASE WHEN r.role = 'last_name' AND r.rn = 1 THEN r.value END) AS last_name,
       MAX(CASE WHEN r.role = 'second_last_name' AND r.rn = 1 THEN r.value END) AS second_last_name,
       MAX(CASE WHEN r.role = 'identifier' AND r.rn = 1 THEN r.value END) AS rut,
       MAX(CASE WHEN r.role = 'email' AND r.rn = 1 THEN r.value END) AS email,
       MAX(CASE WHEN r.role = 'phone' AND r.rn = 1 THEN r.value END) AS phone,
       CAST(MAX(CASE WHEN r.role = 'birth_date' AND r.rn = 1 THEN r.value END) AS DATE) AS birth_date,
       MAX(CASE WHEN r.role = 'birthday_photo' AND r.rn = 1 THEN r.value END) AS birthday_photo_url,
       MAX(CASE WHEN r.role = 'avatar' AND r.rn = 1 THEN r.value END) AS avatar_url
FROM `members` m
LEFT JOIN (
  SELECT v.member_id,
         f.role,
         v.value,
         ROW_NUMBER() OVER (
           PARTITION BY v.member_id, f.role
           ORDER BY (v.value IS NULL OR v.value = ''),
                    (p.position IS NULL),
                    p.position,
                    (mfm.member_id IS NULL),
                    COALESCE(fm.sort_order, 999999),
                    COALESCE(fm.id, 0),
                    f.id
         ) AS rn
  FROM `member_field_values` v
  INNER JOIN `member_fields` f ON f.id = v.field_id AND f.role IS NOT NULL
  -- Ficha del campo (una sola, uk_mff_field), si el miembro la responde y su prioridad.
  LEFT JOIN `member_form_fields` mff ON mff.field_id = f.id
  LEFT JOIN `member_forms` fm ON fm.id = mff.form_id
  LEFT JOIN `member_form_members` mfm ON mfm.form_id = mff.form_id AND mfm.member_id = v.member_id
  LEFT JOIN `member_role_priority` p ON p.member_id = v.member_id AND p.role = f.role AND p.form_id = mff.form_id
) r ON r.member_id = m.id
GROUP BY m.id;

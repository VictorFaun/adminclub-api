-- =============================================================================
-- 056 — Ficha: secciones, campos sensibles y categoría en la inscripción pública
-- =============================================================================
-- * field_type 'section': un título que agrupa los campos que le siguen (no guarda valores).
-- * VIEW_SENSITIVE_MEMBER_FIELDS: ver/editar los campos marcados como sensibles (ej. salud).
--   Backfill: el rol de sistema "Administrador" de cada club la recibe.
-- * member_applications.group_id: categoría/grupo al que postula la persona.

ALTER TABLE `member_fields`
  MODIFY COLUMN `field_type` ENUM('text','textarea','number','date','boolean','select','radio','multiselect','email','phone','rut','address','image','file','section') NOT NULL DEFAULT 'text';

INSERT INTO `functions` (`code`, `name`, `description`, `category`, `is_club_assignable`) VALUES
  ('VIEW_SENSITIVE_MEMBER_FIELDS', 'Ver datos sensibles de la ficha', 'Ver y editar los campos de la ficha marcados como sensibles (salud, alergias, documentos privados…)', 'miembros', 1)
ON DUPLICATE KEY UPDATE `name` = VALUES(`name`), `description` = VALUES(`description`), `category` = VALUES(`category`), `is_club_assignable` = VALUES(`is_club_assignable`);

INSERT IGNORE INTO `role_functions` (`role_id`, `function_id`)
SELECT r.id, f.id FROM `roles` r CROSS JOIN `functions` f
WHERE r.club_id IS NOT NULL AND r.is_system = 1 AND r.name = 'Administrador'
  AND f.code = 'VIEW_SENSITIVE_MEMBER_FIELDS';

ALTER TABLE `member_applications`
  ADD COLUMN `group_id` BIGINT UNSIGNED NULL AFTER `fields`,
  ADD CONSTRAINT `fk_member_applications_group` FOREIGN KEY (`group_id`) REFERENCES `member_groups` (`id`) ON DELETE SET NULL;

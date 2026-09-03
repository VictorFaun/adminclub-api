-- ============================================================================
-- "Funcionalidades" deja de ser una vista de club (salía duplicada del selector
-- de funcionalidades al editar un rol) y pasa a ser una vista de nivel plataforma,
-- junto a "Todos los clubes" — muestra el catálogo COMPLETO, incluidas las
-- funcionalidades exclusivas de plataforma (is_club_assignable = 0) que un club
-- nunca ve. Nueva funcionalidad de plataforma para protegerla, asignada solo a
-- SUPER_ADMIN por ahora.
-- ============================================================================
USE `admin_club`;

INSERT INTO `functions` (`code`, `name`, `description`, `category`, `is_club_assignable`)
VALUES (
  'VIEW_ALL_FUNCTIONS',
  'Ver todas las funcionalidades',
  'Ver el catálogo completo de funcionalidades de la plataforma, incluidas las exclusivas de plataforma',
  'plataforma',
  0
)
ON DUPLICATE KEY UPDATE
  `name` = VALUES(`name`),
  `description` = VALUES(`description`),
  `category` = VALUES(`category`),
  `is_club_assignable` = VALUES(`is_club_assignable`);

INSERT IGNORE INTO `role_functions` (`role_id`, `function_id`)
SELECT r.id, f.id FROM `roles` r CROSS JOIN `functions` f
WHERE r.club_id IS NULL AND r.name = 'SUPER_ADMIN' AND f.code = 'VIEW_ALL_FUNCTIONS';

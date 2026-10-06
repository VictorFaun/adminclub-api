-- ============================================================================
-- Agrega MANAGE_BIRTHDAY_TEMPLATE (editar el diseño general de la plantilla de
-- cumpleaños para redes sociales, por club y por formato post/historia).
-- Backfill: el rol de sistema "Administrador" de cada club existente la recibe
-- (los clubes creados después de esta migración ya la reciben solos, ver
-- defaultClubRoles.js).
-- ============================================================================
USE `admin_club`;

INSERT INTO `functions` (`code`, `name`, `description`, `category`, `is_club_assignable`) VALUES
  ('MANAGE_BIRTHDAY_TEMPLATE', 'Administrar plantilla de cumpleaños', 'Diseñar la plantilla general (post e historia) usada para generar las imágenes de cumpleaños de los socios', 'miembros', 1)
ON DUPLICATE KEY UPDATE
  `name` = VALUES(`name`),
  `description` = VALUES(`description`),
  `category` = VALUES(`category`),
  `is_club_assignable` = VALUES(`is_club_assignable`);

INSERT IGNORE INTO `role_functions` (`role_id`, `function_id`)
SELECT r.id, f.id FROM `roles` r CROSS JOIN `functions` f
WHERE r.club_id IS NOT NULL AND r.is_system = 1 AND r.name = 'Administrador'
  AND f.code = 'MANAGE_BIRTHDAY_TEMPLATE';

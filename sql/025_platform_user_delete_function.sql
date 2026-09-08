-- ============================================================================
-- Agrega DELETE_ALL_USERS (nivel plataforma, is_club_assignable = 0 igual que
-- el resto de 022_platform_users.sql) — eliminar (soft-delete) la cuenta de un
-- usuario de plataforma que ya esté suspendido o bloqueado.
-- ============================================================================
USE `admin_club`;

INSERT INTO `functions` (`code`, `name`, `description`, `category`, `is_club_assignable`) VALUES
  ('DELETE_ALL_USERS', 'Eliminar usuarios', 'Eliminar la cuenta de un usuario de la plataforma ya suspendido o bloqueado', 'plataforma', 0)
ON DUPLICATE KEY UPDATE
  `name` = VALUES(`name`),
  `description` = VALUES(`description`),
  `category` = VALUES(`category`),
  `is_club_assignable` = VALUES(`is_club_assignable`);

-- SUPER_ADMIN y DEVELOPER: mismo criterio que el resto de acciones sobre usuarios de plataforma.
INSERT IGNORE INTO `role_functions` (`role_id`, `function_id`)
SELECT r.id, f.id FROM `roles` r CROSS JOIN `functions` f
WHERE r.club_id IS NULL AND r.name IN ('SUPER_ADMIN', 'DEVELOPER') AND f.code = 'DELETE_ALL_USERS';

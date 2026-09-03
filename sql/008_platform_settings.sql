-- ============================================================================
-- 008: configuración de plataforma (fila única) + zona horaria para mostrar
-- fechas/horas en toda la app, y las funcionalidades para verla/editarla.
-- ============================================================================
USE `admin_club`;

CREATE TABLE IF NOT EXISTS `platform_settings` (
  `id` TINYINT UNSIGNED NOT NULL PRIMARY KEY,
  -- Nombre de zona horaria IANA (ej. "America/Santiago", "UTC") — se valida contra
  -- Intl.supportedValuesOf('timeZone') tanto en el frontend como en el backend antes de
  -- guardar, nunca se confía en el string tal cual llega.
  `timezone` VARCHAR(60) NOT NULL DEFAULT 'America/Santiago',
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  -- Fuerza que la tabla tenga como máximo una fila (id siempre 1) — es configuración
  -- global de plataforma, no una entidad con múltiples registros.
  CONSTRAINT `chk_platform_settings_singleton` CHECK (`id` = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO `platform_settings` (`id`, `timezone`) VALUES (1, 'America/Santiago');

INSERT INTO `functions` (`code`, `name`, `description`, `category`, `is_club_assignable`) VALUES
  ('VIEW_PLATFORM_SETTINGS', 'Ver configuración de plataforma', 'Ver la configuración general de la plataforma (ej. zona horaria)', 'plataforma', 0),
  ('EDIT_PLATFORM_SETTINGS', 'Editar configuración de plataforma', 'Editar la configuración general de la plataforma (ej. zona horaria)', 'plataforma', 0)
ON DUPLICATE KEY UPDATE
  `name` = VALUES(`name`),
  `description` = VALUES(`description`),
  `category` = VALUES(`category`),
  `is_club_assignable` = VALUES(`is_club_assignable`);

-- Igual que 005_view_all_functions.sql: nueva funcionalidad de plataforma, asignada solo a
-- SUPER_ADMIN por ahora (no se backfillea DEVELOPER, siguiendo el mismo criterio ya usado ahí).
INSERT IGNORE INTO `role_functions` (`role_id`, `function_id`)
SELECT r.id, f.id FROM `roles` r CROSS JOIN `functions` f
WHERE r.club_id IS NULL AND r.name = 'SUPER_ADMIN' AND f.code IN ('VIEW_PLATFORM_SETTINGS', 'EDIT_PLATFORM_SETTINGS');

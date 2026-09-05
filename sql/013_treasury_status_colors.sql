-- ============================================================================
-- Colores configurables por estado de cobro (charge_instances.status + el
-- "overdue" calculado) — usado por la matriz de estado por cobro y por la
-- ficha de pagos de un miembro, para que cada club pueda ajustar la paleta
-- sin tocar código. Fila ausente para un status_code = usa el default del
-- backend (ver treasurySettings.service.js#DEFAULT_COLORS), no NULL a secas
-- (NULL guardado explícitamente = "sin color", el caso de "pendiente").
-- ============================================================================
USE `admin_club`;

CREATE TABLE IF NOT EXISTS `charge_status_colors` (
  `club_id` BIGINT UNSIGNED NOT NULL,
  `status_code` ENUM('pending','partial','paid','exempt','overdue') NOT NULL,
  `color` VARCHAR(9) NULL,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`club_id`, `status_code`),
  CONSTRAINT `fk_csc_club` FOREIGN KEY (`club_id`) REFERENCES `clubs` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `functions` (`code`, `name`, `description`, `category`, `is_club_assignable`) VALUES
  ('VIEW_TREASURY_SETTINGS', 'Ver configuración de tesorería', 'Ver la configuración del módulo de tesorería (colores de estado, etc.)', 'tesoreria', 1),
  ('EDIT_TREASURY_SETTINGS', 'Editar configuración de tesorería', 'Editar la configuración del módulo de tesorería (colores de estado, etc.)', 'tesoreria', 1)
ON DUPLICATE KEY UPDATE
  `name` = VALUES(`name`),
  `description` = VALUES(`description`),
  `category` = VALUES(`category`),
  `is_club_assignable` = VALUES(`is_club_assignable`);

INSERT IGNORE INTO `role_functions` (`role_id`, `function_id`)
SELECT r.id, f.id FROM `roles` r CROSS JOIN `functions` f
WHERE r.club_id IS NOT NULL AND r.is_system = 1 AND r.name = 'Administrador'
  AND f.code IN ('VIEW_TREASURY_SETTINGS', 'EDIT_TREASURY_SETTINGS');

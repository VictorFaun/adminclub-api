-- ============================================================================
-- Preferencias arbitrarias POR USUARIO Y POR CLUB ACTIVO (mismo patrón
-- clave/valor que `club_settings`, 001_schema.sql, pero además por usuario).
-- `club_id` es obligatorio a propósito (no nullable): las dos primeras
-- preferencias que lo usan (qué cards mostrar en un dashboard, el acceso
-- rápido de cobros del menú) solo tienen sentido "dentro" de un club activo —
-- una columna nullable para una futura preferencia global agregaría el problema
-- de que MySQL nunca considera dos NULL iguales en un UNIQUE KEY (upsert
-- dejaría de funcionar), sin que hoy haya ningún caso de uso real para eso.
-- ============================================================================
USE `admin_club`;

CREATE TABLE IF NOT EXISTS `user_settings` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `club_id` BIGINT UNSIGNED NOT NULL,
  `setting_key` VARCHAR(100) NOT NULL,
  `setting_value` TEXT NULL,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `uk_user_settings` (`user_id`, `club_id`, `setting_key`),
  KEY `idx_user_settings_user_club` (`user_id`, `club_id`),
  CONSTRAINT `fk_user_settings_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_user_settings_club` FOREIGN KEY (`club_id`) REFERENCES `clubs` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

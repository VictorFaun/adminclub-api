-- ============================================================================
-- 041: días especiales de entrenamiento.
--  training_sessions guarda SOLO las excepciones al horario semanal de un entrenamiento:
--   * 'extra'     → día agregado a mano (recuperación, sesión extra, o TODOS los días de un
--                   entrenamiento sin horario fijo).
--   * 'cancelled' → un día del horario semanal que no se realiza (no genera asistencia).
--   * 'modified'  → un día del horario semanal con otra hora/nota solo ese día.
--  Un entrenamiento puede no tener horario semanal (training_schedules vacío): en ese caso todas
--  sus sesiones son 'extra'.
-- ============================================================================
USE `admin_club`;

CREATE TABLE IF NOT EXISTS `training_sessions` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `training_id` BIGINT UNSIGNED NOT NULL,
  `session_date` DATE NOT NULL,
  `kind` ENUM('extra','cancelled','modified') NOT NULL,
  `start_time` TIME NULL,
  `end_time` TIME NULL,
  `note` VARCHAR(255) NULL,
  `created_by` BIGINT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY `uk_training_sessions` (`training_id`, `session_date`),
  KEY `idx_training_sessions_date` (`session_date`),
  CONSTRAINT `fk_tsess_training` FOREIGN KEY (`training_id`) REFERENCES `trainings` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_tsess_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

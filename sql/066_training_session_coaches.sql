-- =============================================================================
-- 066 — Entrenador de cada día de entrenamiento
-- =============================================================================
-- Por defecto, el entrenador de un día son los responsables del entrenamiento
-- (training_responsible_members). Al editar un día se puede cambiar solo para ese día — mismo
-- espíritu que cambiar el monto de un mes en Cobros —: `coaches_overridden` = 1 en su fila de
-- training_sessions y los elegidos en training_session_coaches (sin filas = día sin entrenador).
-- El resumen mensual separa las horas por entrenador y las de días sin entrenador.
USE `admin_club`;

ALTER TABLE `training_sessions`
  ADD COLUMN `coaches_overridden` TINYINT(1) NOT NULL DEFAULT 0 AFTER `was_extra`;

CREATE TABLE IF NOT EXISTS `training_session_coaches` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `training_id` BIGINT UNSIGNED NOT NULL,
  `session_date` DATE NOT NULL,
  `member_id` BIGINT UNSIGNED NOT NULL,
  UNIQUE KEY `uk_training_session_coaches` (`training_id`, `session_date`, `member_id`),
  KEY `idx_tsc_member` (`member_id`),
  CONSTRAINT `fk_tsc_training` FOREIGN KEY (`training_id`) REFERENCES `trainings` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_tsc_member` FOREIGN KEY (`member_id`) REFERENCES `members` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

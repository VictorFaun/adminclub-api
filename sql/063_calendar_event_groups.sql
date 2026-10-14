-- =============================================================================
-- 063 — Calendario: grupos de eventos propios
-- =============================================================================
-- Además de los filtros fijos (Mis eventos, Entrenamientos, Cumpleaños), cada persona crea sus
-- propios grupos (ej. "Partidos", "Reuniones") con nombre y color, los asigna a SUS eventos y los
-- puede prender/apagar como filtro. Son personales, como los eventos: nadie más los ve.
-- El recordatorio deja de estar limitado a una lista fija de opciones (se puede elegir cualquier
-- cantidad de minutos/horas/días/semanas antes) — eso es solo validación, no cambia el esquema.
USE `admin_club`;

CREATE TABLE IF NOT EXISTS `calendar_event_groups` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `club_id` BIGINT UNSIGNED NOT NULL,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `name` VARCHAR(60) NOT NULL,
  `color` VARCHAR(7) NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY `idx_ceg_owner` (`club_id`, `user_id`),
  CONSTRAINT `fk_ceg_club` FOREIGN KEY (`club_id`) REFERENCES `clubs` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_ceg_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE `calendar_events`
  ADD COLUMN `group_id` BIGINT UNSIGNED NULL AFTER `color`,
  ADD CONSTRAINT `fk_calendar_events_group` FOREIGN KEY (`group_id`) REFERENCES `calendar_event_groups` (`id`) ON DELETE SET NULL;

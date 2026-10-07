-- =============================================================================
-- 059 — Calendario: eventos propios (compartibles) con recordatorio
-- =============================================================================
-- Vista Calendario (ver calendar.service.js): además de mostrar entrenamientos y cumpleaños
-- (según los permisos de cada uno), cada usuario crea sus propios eventos. Por defecto son solo
-- suyos; puede sumar a otros usuarios del club (calendar_event_participants), a quienes también
-- les aparece y les llega el aviso. El recordatorio se guarda ya calculado (remind_at, UTC) y lo
-- envía cron/calendarReminders.cron.js una sola vez (reminder_sent_at).
USE `admin_club`;

CREATE TABLE IF NOT EXISTS `calendar_events` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `club_id` BIGINT UNSIGNED NOT NULL,
  `created_by` BIGINT UNSIGNED NOT NULL,
  `title` VARCHAR(150) NOT NULL,
  `description` VARCHAR(1000) NULL,
  `color` VARCHAR(7) NULL,
  `all_day` TINYINT(1) NOT NULL DEFAULT 0,
  -- Fechas tal como las eligió el usuario (locales); un evento de un solo día tiene ambas iguales.
  `start_date` DATE NOT NULL,
  `end_date` DATE NOT NULL,
  -- Horas locales (NULL si es de todo el día).
  `start_time` TIME NULL,
  `end_time` TIME NULL,
  -- Minutos antes del inicio para el aviso (NULL = sin recordatorio) y su instante ya calculado.
  `reminder_minutes` INT NULL,
  `remind_at` DATETIME NULL,
  `reminder_sent_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY `idx_calendar_events_club_dates` (`club_id`, `start_date`, `end_date`),
  KEY `idx_calendar_events_remind` (`remind_at`, `reminder_sent_at`),
  CONSTRAINT `fk_calendar_events_club` FOREIGN KEY (`club_id`) REFERENCES `clubs` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_calendar_events_creator` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `calendar_event_participants` (
  `event_id` BIGINT UNSIGNED NOT NULL,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `added_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`event_id`, `user_id`),
  KEY `idx_calendar_event_participants_user` (`user_id`),
  CONSTRAINT `fk_cep_event` FOREIGN KEY (`event_id`) REFERENCES `calendar_events` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_cep_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

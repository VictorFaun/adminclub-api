-- ============================================================================
-- 071: varios avisos por evento y notificaciones de cumpleaños asignables.
--  * calendar_event_reminders: un evento puede tener varios recordatorios (p. ej. 1 día antes y
--    1 hora antes). Cada uno guarda su instante ya calculado (remind_at, UTC) y se envía una sola
--    vez (sent_at). Reemplaza a calendar_events.reminder_minutes/remind_at/reminder_sent_at, que
--    se copian acá y dejan de usarse.
--  * MANAGE_BIRTHDAY_NOTIFICATIONS: configurar la notificación de cumpleaños de OTROS usuarios del
--    club (a quién le llega, en qué horarios y de qué grupos). La configuración sigue viviendo en
--    user_settings ('birthday_notification') de cada usuario. Backfill: rol "Administrador".
-- ============================================================================
USE `admin_club`;

CREATE TABLE IF NOT EXISTS `calendar_event_reminders` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `event_id` BIGINT UNSIGNED NOT NULL,
  `minutes_before` INT NOT NULL,
  `remind_at` DATETIME NOT NULL,
  `sent_at` DATETIME NULL,
  UNIQUE KEY `uk_cer_event_minutes` (`event_id`, `minutes_before`),
  KEY `idx_cer_due` (`sent_at`, `remind_at`),
  CONSTRAINT `fk_cer_event` FOREIGN KEY (`event_id`) REFERENCES `calendar_events` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO `calendar_event_reminders` (`event_id`, `minutes_before`, `remind_at`, `sent_at`)
SELECT `id`, `reminder_minutes`, `remind_at`, `reminder_sent_at`
FROM `calendar_events`
WHERE `reminder_minutes` IS NOT NULL AND `remind_at` IS NOT NULL;

INSERT INTO `functions` (`code`, `name`, `description`, `category`, `is_club_assignable`) VALUES
  ('MANAGE_BIRTHDAY_NOTIFICATIONS', 'Asignar notificaciones de cumpleaños', 'Activar y configurar la notificación de cumpleaños de otros usuarios del club (horarios y grupos)', 'miembros', 1)
ON DUPLICATE KEY UPDATE
  `name` = VALUES(`name`),
  `description` = VALUES(`description`),
  `category` = VALUES(`category`),
  `is_club_assignable` = VALUES(`is_club_assignable`);

INSERT IGNORE INTO `role_functions` (`role_id`, `function_id`)
SELECT r.id, f.id FROM `roles` r CROSS JOIN `functions` f
WHERE r.club_id IS NOT NULL AND r.is_system = 1 AND r.name = 'Administrador'
  AND f.code = 'MANAGE_BIRTHDAY_NOTIFICATIONS';

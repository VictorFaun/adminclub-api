-- =============================================================================
-- 067 — Notificaciones push (Web Push) por dispositivo
-- =============================================================================
-- Una fila por navegador/dispositivo que activó las notificaciones (ver push.service.js y
-- ../notificaciones-push-pwa.md). Va ligada a la SESIÓN con la que se activó: al cerrar esa
-- sesión (logout, "Cerrar sesión" desde Perfil → Sesiones, cambio de contraseña) la suscripción
-- se borra, así un equipo compartido no recibe avisos de una cuenta que ya salió. El envío solo
-- considera suscripciones cuya sesión sigue activa.
-- Única por endpoint (su hash: el endpoint puede ser muy largo para indexar): si en el mismo
-- navegador inicia sesión otra persona, la fila se reasigna a la cuenta/sesión nueva.
USE `admin_club`;

CREATE TABLE IF NOT EXISTS `push_subscriptions` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `session_id` BIGINT UNSIGNED NULL,
  `endpoint` TEXT NOT NULL,
  `endpoint_hash` CHAR(64) NOT NULL,
  `p256dh` VARCHAR(255) NOT NULL,
  `auth` VARCHAR(255) NOT NULL,
  `user_agent` VARCHAR(255) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `last_seen_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `last_success_at` DATETIME NULL,
  `failures` INT UNSIGNED NOT NULL DEFAULT 0,
  UNIQUE KEY `uk_push_endpoint` (`endpoint_hash`),
  KEY `idx_push_user` (`user_id`),
  KEY `idx_push_session` (`session_id`),
  CONSTRAINT `fk_push_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_push_session` FOREIGN KEY (`session_id`) REFERENCES `sessions` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

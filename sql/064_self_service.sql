-- =============================================================================
-- 064 — "Mi club": acceso de socios a lo suyo + apoderados
-- =============================================================================
-- Un socio con ficha vinculada (members.user_id) ve sus pagos, asistencia y ficha sin roles.
-- Un apoderado es una cuenta que administra fichas de otras personas (hijos): puede tener
-- varias, y una ficha puede tener varios apoderados. No necesita ficha propia.
-- Los interruptores del club van en club_settings (self_service_*), sin cambio de esquema; el
-- "editable por el socio" de cada campo va en member_fields.settings (selfEditable).
USE `admin_club`;

CREATE TABLE IF NOT EXISTS `member_guardians` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `member_id` BIGINT UNSIGNED NOT NULL,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `relation` VARCHAR(40) NULL,
  `created_by` BIGINT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY `uk_member_guardian` (`member_id`, `user_id`),
  KEY `idx_member_guardians_user` (`user_id`),
  CONSTRAINT `fk_mg_member` FOREIGN KEY (`member_id`) REFERENCES `members` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_mg_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_mg_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Invitación por correo de un apoderado: fichas que quedará administrando al aceptar
-- (arreglo JSON de ids de members; ver services/clubEntry.service.js).
ALTER TABLE `club_user_invitations`
  ADD COLUMN `guardian_member_ids` JSON NULL AFTER `member_id`,
  ADD COLUMN `guardian_relation` VARCHAR(40) NULL AFTER `guardian_member_ids`;

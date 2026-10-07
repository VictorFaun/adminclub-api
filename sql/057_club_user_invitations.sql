-- =============================================================================
-- 057 — Invitaciones del club a un usuario existente (buscado por correo)
-- =============================================================================
-- Antes, buscar a alguien por correo en Usuarios lo agregaba al club directamente. Ahora se le
-- envía una invitación que la persona acepta o rechaza desde su perfil (pestaña "Invitaciones"),
-- con un mensaje opcional y los roles que tendrá al aceptar. Ver clubUserInvitations.service.js.
--
-- * club_user_invitations: una invitación PENDIENTE por (club, usuario); al aceptarla o
--   rechazarla se elimina la fila (queda en la auditoría).
-- * club_user_invitation_roles: roles que recibirá al aceptar (un rol borrado se cae solo).
-- * notifications.type 'invitation': la notificación lleva a esa pestaña del perfil.
-- * CREATE_USERS pasa a ser "Invitar usuarios" (ya no se crean cuentas desde el club) y
--   EDIT_USERS se elimina: el club ya no edita datos personales de sus usuarios (solo roles y
--   ficha). Cascada a role_functions (fk_role_functions_function ON DELETE CASCADE).
-- =============================================================================
USE `admin_club`;

CREATE TABLE IF NOT EXISTS `club_user_invitations` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `club_id` BIGINT UNSIGNED NOT NULL,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `invited_by` BIGINT UNSIGNED NULL,
  `message` VARCHAR(500) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY `uk_club_user_invitations` (`club_id`, `user_id`),
  KEY `idx_club_user_invitations_user` (`user_id`),
  CONSTRAINT `fk_club_user_invitations_club` FOREIGN KEY (`club_id`) REFERENCES `clubs` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_club_user_invitations_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_club_user_invitations_inviter` FOREIGN KEY (`invited_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `club_user_invitation_roles` (
  `invitation_id` BIGINT UNSIGNED NOT NULL,
  `role_id` BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (`invitation_id`, `role_id`),
  CONSTRAINT `fk_cui_roles_invitation` FOREIGN KEY (`invitation_id`) REFERENCES `club_user_invitations` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_cui_roles_role` FOREIGN KEY (`role_id`) REFERENCES `roles` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE `notifications`
  MODIFY COLUMN `type` ENUM('info','success','warning','error','birthday','invitation') NOT NULL DEFAULT 'info';

UPDATE `functions`
SET `name` = 'Invitar usuarios', `description` = 'Buscar por correo a personas con cuenta e invitarlas al club'
WHERE `code` = 'CREATE_USERS';

DELETE FROM `functions` WHERE `code` = 'EDIT_USERS';

-- ============================================================================
-- Permite marcar una invitación puntual para que, al usarse, exija completar la
-- ficha de miembro (vinculada automáticamente a la cuenta) antes de poder operar
-- en el club — ver clubs.service.js#joinByCode, members.service.js#createSelf y
-- middlewares/permission.middleware.js#assertProfileNotPending.
-- ============================================================================
USE `admin_club`;

ALTER TABLE `invitations`
  ADD COLUMN `requires_member_profile` TINYINT(1) NOT NULL DEFAULT 0 AFTER `default_role_id`;

ALTER TABLE `user_clubs`
  ADD COLUMN `requires_profile_completion` TINYINT(1) NOT NULL DEFAULT 0 AFTER `status`;

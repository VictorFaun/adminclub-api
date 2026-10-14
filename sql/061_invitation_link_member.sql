-- =============================================================================
-- 061 — Invitación por correo que vincula una ficha existente
-- =============================================================================
-- Al invitar por correo a alguien que ya tiene ficha en el club (creada por la directiva o
-- desde el link público), se puede indicar cuál: al aceptar, su cuenta queda vinculada a esa
-- ficha en vez de pedirle crear otra (ver services/clubEntry.service.js).
USE `admin_club`;

ALTER TABLE `club_user_invitations`
  ADD COLUMN `member_id` BIGINT UNSIGNED NULL AFTER `user_id`,
  ADD CONSTRAINT `fk_cui_member` FOREIGN KEY (`member_id`) REFERENCES `members` (`id`) ON DELETE SET NULL;

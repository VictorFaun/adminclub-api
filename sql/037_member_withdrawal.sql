-- ============================================================================
-- 037: retiro/archivo de miembros en vez de borrado.
--  * user_clubs.status suma 'withdrawn' ("retirado"): la cuenta conserva su fila (y sus roles,
--    que no aplican mientras no esté activa) pero el club deja de aparecerle en su lista y no
--    puede entrar a él. Reactivable en cualquier momento.
--  * members.deactivated_at: desde cuándo está inactivo el miembro (archivado). Mientras esté
--    inactivo no se le generan cobros ni asistencias nuevas ("se le saltan los meses").
-- ============================================================================
USE `admin_club`;

ALTER TABLE `user_clubs`
  MODIFY COLUMN `status` ENUM('active','suspended','pending','withdrawn') NOT NULL DEFAULT 'active';

ALTER TABLE `members`
  ADD COLUMN `deactivated_at` DATETIME NULL AFTER `status`;

UPDATE `members` SET `deactivated_at` = `updated_at` WHERE `status` = 'inactive' AND `deactivated_at` IS NULL;

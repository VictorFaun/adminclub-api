-- ============================================================================
-- Agrega `is_club_assignable` a `functions` para bases ya provisionadas antes
-- de que esta columna existiera en 001_schema.sql. Idempotente vía IF NOT
-- EXISTS (soportado por MariaDB en ADD COLUMN).
--
-- Distingue funcionalidades de plataforma (solo para roles globales como
-- SUPER_ADMIN/DEVELOPER, por encima del administrador de un club) de las
-- asignables a roles de club: MANAGE_PLATFORM, VIEW_ALL_CLUBS y EDIT_ALL_CLUBS
-- no deben aparecer en el catálogo que usa el club (GET /functions) ni poder
-- asignarse a un rol de club.
-- ============================================================================
USE `admin_club`;

ALTER TABLE `functions` ADD COLUMN IF NOT EXISTS `is_club_assignable` TINYINT(1) NOT NULL DEFAULT 1 AFTER `category`;

UPDATE `functions` SET `is_club_assignable` = 0 WHERE `code` IN ('MANAGE_PLATFORM', 'VIEW_ALL_CLUBS', 'EDIT_ALL_CLUBS');

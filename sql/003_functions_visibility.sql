-- ============================================================================
-- Agrega `is_club_assignable` a `functions` para bases ya provisionadas antes
-- de que esta columna existiera en 001_schema.sql. Idempotente vía chequeo
-- manual contra INFORMATION_SCHEMA: `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`
-- solo lo soportan MariaDB y MySQL 8.0.29+, y falla con error de sintaxis en
-- MySQL más viejo.
--
-- Distingue funcionalidades de plataforma (solo para roles globales como
-- SUPER_ADMIN/DEVELOPER, por encima del administrador de un club) de las
-- asignables a roles de club: MANAGE_PLATFORM, VIEW_ALL_CLUBS y EDIT_ALL_CLUBS
-- no deben aparecer en el catálogo que usa el club (GET /functions) ni poder
-- asignarse a un rol de club.
-- ============================================================================
USE `admin_club`;

SET @col_exists = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'functions' AND COLUMN_NAME = 'is_club_assignable'
);

SET @ddl = IF(@col_exists = 0,
  'ALTER TABLE `functions` ADD COLUMN `is_club_assignable` TINYINT(1) NOT NULL DEFAULT 1 AFTER `category`',
  'SELECT 1'
);

PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

UPDATE `functions` SET `is_club_assignable` = 0 WHERE `code` IN ('MANAGE_PLATFORM', 'VIEW_ALL_CLUBS', 'EDIT_ALL_CLUBS');

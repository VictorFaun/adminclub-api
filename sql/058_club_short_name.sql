-- =============================================================================
-- 058 — Nombre corto del club (opcional)
-- =============================================================================
-- Versión corta del nombre para lugares con poco espacio (la marca del menú lateral). Si está
-- vacío se usa el nombre completo.
USE `admin_club`;

ALTER TABLE `clubs`
  ADD COLUMN `short_name` VARCHAR(40) NULL AFTER `name`;

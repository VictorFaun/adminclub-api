-- ============================================================================
-- 075: límite de sesiones abiertas por cuenta.
--
-- Cada cuenta elige cuántos dispositivos pueden tener la sesión abierta a la vez (Perfil →
-- Sesiones), 10 por defecto. Al iniciar sesión en uno nuevo por encima del límite, se cierran
-- las sesiones usadas hace más tiempo (ver auth.service.js#_enforceSessionLimit).
-- ============================================================================
USE `admin_club`;

ALTER TABLE `users`
  ADD COLUMN `max_sessions` SMALLINT UNSIGNED NOT NULL DEFAULT 10 AFTER `status`;

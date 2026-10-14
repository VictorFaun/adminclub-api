-- =============================================================================
-- 065 — Recuperación de días suspendidos en entrenamientos
-- =============================================================================
-- Un día agregado a mano ('extra') puede recuperar un día suspendido ('cancelled'):
-- `recovers_date` apunta a esa fecha (opcional: un día extra puede ser independiente). Así se
-- sabe cuántos días se perdieron y cuáles se recuperaron.
-- Un día extra suspendido ya no se borra: queda 'cancelled' con `was_extra` = 1, para que salga
-- en la lista de suspendidos (y se pueda recuperar o restaurar como extra).
USE `admin_club`;

ALTER TABLE `training_sessions`
  ADD COLUMN `recovers_date` DATE NULL AFTER `note`,
  ADD COLUMN `was_extra` TINYINT(1) NOT NULL DEFAULT 0 AFTER `recovers_date`;

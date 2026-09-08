-- ============================================================================
-- 030: zona horaria propia por usuario. Prioridad más alta que la del club activo
-- y que la de plataforma (ver `clubs.timezone`/`platform_settings.timezone`,
-- migraciones 008/009) — nullable a propósito: sin valor, se sigue heredando la
-- del club (y esta, en cascada, la de plataforma si el club tampoco tiene una
-- propia). Se aplica igual sin importar a qué club esté conectado el usuario.
-- ============================================================================
USE `admin_club`;

ALTER TABLE `users`
  ADD COLUMN `timezone` VARCHAR(60) NULL AFTER `avatar_url`;

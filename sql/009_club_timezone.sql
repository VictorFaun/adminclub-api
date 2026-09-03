-- ============================================================================
-- 009: zona horaria propia por club. Igual que `platform_settings.timezone`,
-- se usa para mostrar fechas/horas absolutas — pero acotado al club activo,
-- pisando el default de plataforma para quien esté viendo/trabajando en él.
-- ============================================================================
USE `admin_club`;

ALTER TABLE `clubs`
  ADD COLUMN `timezone` VARCHAR(60) NOT NULL DEFAULT 'UTC' AFTER `theme`;

-- Los clubes que ya existían (creados antes de esta migración) no tienen forma de saber qué
-- zona horaria "debieron" tener — se les asigna la de plataforma vigente hoy, mejor default
-- razonable que UTC a secas para instalaciones ya en marcha.
UPDATE `clubs` SET `timezone` = (SELECT `timezone` FROM `platform_settings` WHERE `id` = 1);

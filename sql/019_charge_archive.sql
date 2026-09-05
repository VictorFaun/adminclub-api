-- ============================================================================
-- Archivar un cobro: a diferencia de `deleted_at` (elimina, ya no cuenta en
-- ninguna suma de dinero), archivar solo lo saca de la vista "Cobros" y de
-- "Pagos" para bajar el ruido de cobros que ya no se usan — su dinero (pagos,
-- transferencias de responsables) sigue contando en el dashboard de Tesorería
-- normalmente, y deja de generar nuevas instancias mientras esté archivado.
-- Se puede restaurar en cualquier momento desde la vista de archivados.
-- ============================================================================
USE `admin_club`;

ALTER TABLE `charges`
  ADD COLUMN `archived_at` DATETIME NULL AFTER `deleted_at`;

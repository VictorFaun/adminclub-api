-- ============================================================================
-- 073: archivar solicitudes (de acceso y de ficha) y comprobantes de pago ya revisados.
--
-- Con el tiempo esas vistas se llenan de lo ya resuelto. Archivar solo los saca de las pestañas
-- Aceptadas/Rechazadas (quedan en "Archivadas", y se pueden desarchivar): no borra ni cambia nada
-- de lo que se aprobó o rechazó. Solo lo ya revisado se archiva (lo pendiente nunca se esconde).
-- `archived_by` es informativo (quién lo archivó), sin FK: si la cuenta se borra, queda el id.
-- ============================================================================
USE `admin_club`;

ALTER TABLE `member_applications`
  ADD COLUMN `archived_at` DATETIME NULL AFTER `review_note`,
  ADD COLUMN `archived_by` BIGINT UNSIGNED NULL AFTER `archived_at`,
  ADD KEY `idx_member_applications_archived` (`club_id`, `archived_at`);

ALTER TABLE `join_requests`
  ADD COLUMN `archived_at` DATETIME NULL AFTER `reviewed_at`,
  ADD COLUMN `archived_by` BIGINT UNSIGNED NULL AFTER `archived_at`,
  ADD KEY `idx_join_requests_archived` (`club_id`, `archived_at`);

ALTER TABLE `payment_proofs`
  ADD COLUMN `archived_at` DATETIME NULL AFTER `reviewed_at`,
  ADD COLUMN `archived_by` BIGINT UNSIGNED NULL AFTER `archived_at`,
  ADD KEY `idx_payment_proofs_archived` (`club_id`, `archived_at`);

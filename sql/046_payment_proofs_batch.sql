-- ============================================================================
-- 046: pago MÚLTIPLE desde la página pública de pagos. Un mismo comprobante (un archivo) puede
-- cubrir varios períodos: se crea una fila de `payment_proofs` por período, todas con el mismo
-- `batch_uuid` y el mismo archivo. Cada fila sigue siendo un período completo (en un envío
-- múltiple no se permite abonar), y al revisarlo se aprueba/rechaza el lote entero.
-- Los comprobantes existentes quedan como lotes de 1 (`batch_uuid = uuid`).
-- ============================================================================
USE `admin_club`;

ALTER TABLE `payment_proofs`
  ADD COLUMN `batch_uuid` CHAR(36) NULL AFTER `uuid`;

UPDATE `payment_proofs` SET `batch_uuid` = `uuid` WHERE `batch_uuid` IS NULL;

ALTER TABLE `payment_proofs`
  MODIFY COLUMN `batch_uuid` CHAR(36) NOT NULL,
  ADD KEY `idx_payment_proofs_batch` (`batch_uuid`);

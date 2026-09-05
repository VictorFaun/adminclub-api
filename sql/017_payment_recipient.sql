-- ============================================================================
-- Responsable de un cobro (opcional, ej. el entrenador de una categoría que
-- junta la plata antes de entregarla a tesorería) + a quién se le entrega
-- cada pago: al responsable del cobro, o directo a tesorería (NULL). Ambas
-- columnas NULL = "sin responsable" / "tesorería" respectivamente, mismo
-- significado — un cobro sin responsable solo puede recibir pagos con
-- `paid_to_member_id` NULL (ver payments.service.js#create/update).
-- ============================================================================
USE `admin_club`;

ALTER TABLE `charges`
  ADD COLUMN `responsible_member_id` BIGINT UNSIGNED NULL AFTER `status`,
  ADD CONSTRAINT `fk_charges_responsible_member` FOREIGN KEY (`responsible_member_id`) REFERENCES `members` (`id`) ON DELETE SET NULL;

ALTER TABLE `payments`
  ADD COLUMN `paid_to_member_id` BIGINT UNSIGNED NULL AFTER `member_id`,
  ADD CONSTRAINT `fk_payments_paid_to_member` FOREIGN KEY (`paid_to_member_id`) REFERENCES `members` (`id`) ON DELETE SET NULL;

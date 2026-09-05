-- ============================================================================
-- Destino del dinero de un cobro — 'treasury' (default, va a Tesorería, como
-- hasta ahora) o 'external' (ej. la inscripción de un campeonato: el
-- responsable junta la plata de los miembros y al final la entrega afuera del
-- club, nunca pasa por Tesorería). Solo tiene sentido para cobros únicos —
-- charges.service.js lo valida al crear/editar. Un cobro 'external' EXIGE
-- responsable (sin él no habría a quién pagarle, ver
-- payments.service.js#create: un cobro externo nunca admite pagos directos).
-- ============================================================================
USE `admin_club`;

ALTER TABLE `charges`
  ADD COLUMN `purpose` ENUM('treasury','external') NOT NULL DEFAULT 'treasury' AFTER `status`;

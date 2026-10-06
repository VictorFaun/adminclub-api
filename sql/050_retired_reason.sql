-- ============================================================================
-- 050: los períodos que se congelaban al pasar un miembro a inactivo usaban el motivo
-- "Miembro inactivo"; desde el historial de pertenencia (049) el motivo es "Retirado".
-- ============================================================================
USE `admin_club`;

UPDATE `charge_instances` SET `exempt_reason` = 'Retirado' WHERE `status` = 'exempt' AND `exempt_reason` = 'Miembro inactivo';
UPDATE `training_attendances` SET `exempt_reason` = 'Retirado' WHERE `status` = 'exempt' AND `exempt_reason` = 'Miembro inactivo';

-- =============================================================================
-- 060 — Modificar el monto de UN período de un miembro
-- =============================================================================
-- Nueva funcionalidad EDIT_PAYMENT_AMOUNT: al registrar el pago de un período puntual se puede
-- cambiar lo que ese miembro debe ese período (ej. $10.000 → $8.000 solo en marzo). El período
-- queda marcado (`amount_overridden_*`) para que las actualizaciones automáticas de monto
-- (editar el monto del cobro con vigencia, prorrateo del mes de ingreso/retiro) no lo pisen.
USE `admin_club`;

ALTER TABLE `charge_instances`
  ADD COLUMN `amount_overridden_by` BIGINT UNSIGNED NULL AFTER `amount`,
  ADD COLUMN `amount_overridden_at` DATETIME NULL AFTER `amount_overridden_by`;

INSERT INTO `functions` (`code`, `name`, `description`, `category`, `is_club_assignable`) VALUES
  ('EDIT_PAYMENT_AMOUNT', 'Modificar monto máximo', 'Cambiar el monto que un miembro debe pagar en un período puntual al registrar su pago', 'tesoreria', 1)
ON DUPLICATE KEY UPDATE `name` = VALUES(`name`), `description` = VALUES(`description`), `category` = VALUES(`category`), `is_club_assignable` = VALUES(`is_club_assignable`);

INSERT IGNORE INTO `role_functions` (`role_id`, `function_id`)
SELECT r.id, f.id FROM `roles` r CROSS JOIN `functions` f
WHERE r.club_id IS NOT NULL AND r.is_system = 1 AND r.name = 'Administrador'
  AND f.code = 'EDIT_PAYMENT_AMOUNT';

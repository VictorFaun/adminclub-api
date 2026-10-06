-- ============================================================================
-- 048: saldo por cuenta de Tesorería.
--  * Cada movimiento de dinero de Tesorería guarda la cuenta a la que entró/salió EN EL MOMENTO en
--    que se registró (no se deduce del cobro, que puede cambiar de cuenta después):
--      - payments.treasury_account_id: pago directo a Tesorería (paid_to_member_id NULL).
--      - charge_settlements.treasury_account_id: entrega de un responsable a Tesorería.
--      - expense_payments.treasury_account_id: de qué cuenta salió el pago de un gasto.
--    NULL = "sin cuenta asignada" (movimientos anteriores a las cuentas, o el club no tiene cuentas).
--  * treasury_account_transfers: traspasos entre cuentas (from NULL = desde "sin cuenta asignada").
--  * treasury_accounts.deleted_at: una cuenta eliminada se oculta pero NO se borra, así los
--    movimientos que se hicieron a ella la siguen nombrando. Solo se elimina con saldo 0 (o
--    transfiriendo antes su saldo a otra cuenta, ver treasuryAccounts.service.js#remove).
-- ============================================================================
USE `admin_club`;

ALTER TABLE `treasury_accounts`
  ADD COLUMN `deleted_at` DATETIME NULL AFTER `updated_at`;

ALTER TABLE `payments`
  ADD COLUMN `treasury_account_id` BIGINT UNSIGNED NULL AFTER `paid_to_member_id`,
  ADD KEY `idx_payments_treasury_account` (`treasury_account_id`),
  ADD CONSTRAINT `fk_payments_treasury_account` FOREIGN KEY (`treasury_account_id`) REFERENCES `treasury_accounts` (`id`) ON DELETE SET NULL;

ALTER TABLE `charge_settlements`
  ADD COLUMN `treasury_account_id` BIGINT UNSIGNED NULL AFTER `responsible_member_id`,
  ADD KEY `idx_cs_treasury_account` (`treasury_account_id`),
  ADD CONSTRAINT `fk_cs_treasury_account` FOREIGN KEY (`treasury_account_id`) REFERENCES `treasury_accounts` (`id`) ON DELETE SET NULL;

ALTER TABLE `expense_payments`
  ADD COLUMN `treasury_account_id` BIGINT UNSIGNED NULL AFTER `expense_instance_id`,
  ADD KEY `idx_ep_treasury_account` (`treasury_account_id`),
  ADD CONSTRAINT `fk_ep_treasury_account` FOREIGN KEY (`treasury_account_id`) REFERENCES `treasury_accounts` (`id`) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS `treasury_account_transfers` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `uuid` CHAR(36) NOT NULL,
  `club_id` BIGINT UNSIGNED NOT NULL,
  `from_account_id` BIGINT UNSIGNED NULL,
  `to_account_id` BIGINT UNSIGNED NOT NULL,
  `amount` DECIMAL(12,2) NOT NULL,
  `transferred_at` DATE NOT NULL,
  `note` VARCHAR(255) NULL,
  `registered_by` BIGINT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY `uk_tat_uuid` (`uuid`),
  KEY `idx_tat_club` (`club_id`),
  CONSTRAINT `fk_tat_club` FOREIGN KEY (`club_id`) REFERENCES `clubs` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_tat_from` FOREIGN KEY (`from_account_id`) REFERENCES `treasury_accounts` (`id`),
  CONSTRAINT `fk_tat_to` FOREIGN KEY (`to_account_id`) REFERENCES `treasury_accounts` (`id`),
  CONSTRAINT `fk_tat_registered_by` FOREIGN KEY (`registered_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Todo club tiene SIEMPRE al menos una cuenta ("Cuenta principal", aunque no tenga datos): se crea
-- en los clubes que no tienen ninguna (los nuevos la reciben al crearse, ver clubs.service.js).
INSERT INTO `treasury_accounts` (`uuid`, `club_id`, `name`, `position`)
SELECT UUID(), c.id, 'Cuenta principal', 0
FROM `clubs` c
WHERE NOT EXISTS (SELECT 1 FROM `treasury_accounts` ta WHERE ta.club_id = c.id AND ta.deleted_at IS NULL);

-- Backfill: pagos directos y entregas de responsables toman la cuenta que hoy tiene su cobro...
UPDATE `payments` p
  INNER JOIN `payment_allocations` pa ON pa.payment_id = p.id
  INNER JOIN `charge_instances` ci ON ci.id = pa.charge_instance_id
  INNER JOIN `charges` c ON c.id = ci.charge_id
  SET p.treasury_account_id = c.treasury_account_id
  WHERE p.paid_to_member_id IS NULL AND c.purpose = 'treasury' AND p.treasury_account_id IS NULL;

UPDATE `charge_settlements` cs
  INNER JOIN `charges` c ON c.id = cs.charge_id
  SET cs.treasury_account_id = c.treasury_account_id
  WHERE c.purpose = 'treasury' AND cs.treasury_account_id IS NULL;

-- ...y en clubes con UNA sola cuenta, todo lo que quedó sin cuenta va a esa (incluidos los gastos).
UPDATE `payments` p
  INNER JOIN `payment_allocations` pa ON pa.payment_id = p.id
  INNER JOIN `charge_instances` ci ON ci.id = pa.charge_instance_id
  INNER JOIN `charges` c ON c.id = ci.charge_id
  INNER JOIN (SELECT club_id, MIN(id) AS account_id FROM `treasury_accounts` GROUP BY club_id HAVING COUNT(*) = 1) one ON one.club_id = p.club_id
  SET p.treasury_account_id = one.account_id
  WHERE p.paid_to_member_id IS NULL AND c.purpose = 'treasury' AND p.treasury_account_id IS NULL;

UPDATE `charge_settlements` cs
  INNER JOIN `charges` c ON c.id = cs.charge_id
  INNER JOIN (SELECT club_id, MIN(id) AS account_id FROM `treasury_accounts` GROUP BY club_id HAVING COUNT(*) = 1) one ON one.club_id = c.club_id
  SET cs.treasury_account_id = one.account_id
  WHERE c.purpose = 'treasury' AND cs.treasury_account_id IS NULL;

UPDATE `expense_payments` ep
  INNER JOIN (SELECT club_id, MIN(id) AS account_id FROM `treasury_accounts` GROUP BY club_id HAVING COUNT(*) = 1) one ON one.club_id = ep.club_id
  SET ep.treasury_account_id = one.account_id
  WHERE ep.treasury_account_id IS NULL;

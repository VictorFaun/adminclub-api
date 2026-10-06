-- ============================================================================
-- 047: cuentas de destino de los pagos.
--  * treasury_accounts: varias cuentas de Tesorería por club (Tesorería → Configuración), cada una
--    con sus datos de transferencia.
--  * charges.treasury_account_id: a qué cuenta de Tesorería pertenece el cobro. NULL = sin elegir
--    (si el club tiene UNA sola cuenta se usa esa, ver treasuryAccounts.service.js#resolveForCharge).
--  * charge_responsible_members.account: datos de la cuenta que usa ese responsable para ESTE cobro
--    (JSON: bankName, accountType, accountNumber, holderName, holderRut, email, notes). NULL = sin datos.
--  * payment_proofs.paid_to_member_id: a quién dice haber pagado la persona desde la página pública
--    (NULL = Tesorería, la cuenta del cobro). Al aprobar, el pago queda a nombre de ese destino.
-- ============================================================================
USE `admin_club`;

CREATE TABLE IF NOT EXISTS `treasury_accounts` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `uuid` CHAR(36) NOT NULL,
  `club_id` BIGINT UNSIGNED NOT NULL,
  `name` VARCHAR(100) NOT NULL,
  `bank_name` VARCHAR(100) NULL,
  `account_type` VARCHAR(60) NULL,
  `account_number` VARCHAR(60) NULL,
  `holder_name` VARCHAR(150) NULL,
  `holder_rut` VARCHAR(12) NULL,
  `email` VARCHAR(150) NULL,
  `notes` VARCHAR(500) NULL,
  `position` INT NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `uk_treasury_accounts_uuid` (`uuid`),
  KEY `idx_treasury_accounts_club` (`club_id`, `position`),
  CONSTRAINT `fk_treasury_accounts_club` FOREIGN KEY (`club_id`) REFERENCES `clubs` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE `charges`
  ADD COLUMN `treasury_account_id` BIGINT UNSIGNED NULL AFTER `purpose`,
  ADD CONSTRAINT `fk_charges_treasury_account` FOREIGN KEY (`treasury_account_id`) REFERENCES `treasury_accounts` (`id`) ON DELETE SET NULL;

ALTER TABLE `charge_responsible_members`
  ADD COLUMN `account` JSON NULL AFTER `position`;

ALTER TABLE `payment_proofs`
  ADD COLUMN `paid_to_member_id` BIGINT UNSIGNED NULL AFTER `member_id`,
  ADD CONSTRAINT `fk_pp_paid_to_member` FOREIGN KEY (`paid_to_member_id`) REFERENCES `members` (`id`) ON DELETE SET NULL;

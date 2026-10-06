-- ============================================================================
-- 040: comprobantes de pago enviados desde la vista PÚBLICA de pago.
--  * members.payment_token: token secreto por miembro (enlace de pago que un admin le comparte).
--    Sin él no se puede ver ni reportar nada: no hay búsqueda pública de miembros por nombre/RUT.
--  * payment_proofs: cada comprobante queda 'pending' hasta que alguien con permiso lo aprueba
--    (se registra el pago real y se marca 'approved') o lo rechaza con un motivo. El archivo es
--    PRIVADO (fuera de /uploads), solo descargable por un endpoint autenticado.
-- ============================================================================
USE `admin_club`;

ALTER TABLE `members`
  ADD COLUMN `payment_token` CHAR(32) NULL AFTER `photo_url`,
  ADD UNIQUE KEY `uk_members_payment_token` (`payment_token`);

CREATE TABLE IF NOT EXISTS `payment_proofs` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `uuid` CHAR(36) NOT NULL,
  `club_id` BIGINT UNSIGNED NOT NULL,
  `member_id` BIGINT UNSIGNED NOT NULL,
  `charge_instance_id` BIGINT UNSIGNED NOT NULL,
  `amount` DECIMAL(12,2) NOT NULL,
  `paid_at` DATE NOT NULL,
  `note` VARCHAR(255) NULL,
  `file_path` VARCHAR(255) NOT NULL,
  `mime_type` VARCHAR(100) NOT NULL,
  `status` ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  `reviewed_by` BIGINT UNSIGNED NULL,
  `reviewed_at` DATETIME NULL,
  `review_note` VARCHAR(255) NULL,
  `payment_id` BIGINT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY `uk_payment_proofs_uuid` (`uuid`),
  KEY `idx_payment_proofs_club_status` (`club_id`, `status`),
  KEY `idx_payment_proofs_instance` (`charge_instance_id`),
  CONSTRAINT `fk_pp_club` FOREIGN KEY (`club_id`) REFERENCES `clubs` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_pp_member` FOREIGN KEY (`member_id`) REFERENCES `members` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_pp_instance` FOREIGN KEY (`charge_instance_id`) REFERENCES `charge_instances` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_pp_reviewed_by` FOREIGN KEY (`reviewed_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_pp_payment` FOREIGN KEY (`payment_id`) REFERENCES `payments` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

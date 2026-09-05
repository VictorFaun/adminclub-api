-- ============================================================================
-- Transferencias del responsable de un cobro hacia Tesorería. Una fila = una
-- transferencia (parcial o total) para UN período de UN cobro — mismo patrón
-- que `payments` (varias filas posibles por período, "abono" incluido), pero
-- sin `charge_instance_id`: no es el pago de un miembro puntual, es el
-- traspaso agregado de lo que el responsable juntó ese período (ver
-- payments.service.js#getChargeMatrix, que calcula "cuánto quedó en manos
-- del responsable" sumando payments.paid_to_member_id = charges.responsible_member_id).
-- ============================================================================
USE `admin_club`;

CREATE TABLE IF NOT EXISTS `charge_settlements` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `uuid` CHAR(36) NOT NULL,
  `charge_id` BIGINT UNSIGNED NOT NULL,
  `period_label` VARCHAR(9) NOT NULL,
  `amount` DECIMAL(12,2) NOT NULL,
  `transferred_at` DATETIME NOT NULL,
  `note` VARCHAR(255) NULL,
  `registered_by` BIGINT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY `uk_charge_settlements_uuid` (`uuid`),
  KEY `idx_cs_charge_period` (`charge_id`, `period_label`),
  CONSTRAINT `fk_cs_charge` FOREIGN KEY (`charge_id`) REFERENCES `charges` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_cs_registered_by` FOREIGN KEY (`registered_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- 032: reemplaza `charges.responsible_member_id` (escalar, un solo responsable
-- por cobro) por una tabla relacional — un cobro puede tener VARIOS
-- responsables, cada uno opcionalmente vinculado a un grupo específico
-- (`group_id NULL` = "todos los grupos", el catch-all). Mismo patrón exacto
-- que `charge_target_groups` (016_charge_pricing.sql): columna `position`
-- para desempatar cuando un miembro pertenece a 2+ grupos con responsable
-- propio (gana el de menor `position`, ver charges.repository.js#resolveResponsibles).
--
-- PK con `id` propio (no compuesta) porque `group_id` es NULLable y MySQL no
-- permite columnas NULL en una PK compuesta.
--
-- Backfill: el responsable actual de cada cobro (si tenía uno) pasa a ser un
-- responsable "todos los grupos" — mismo comportamiento visible que hoy (ve a
-- TODOS los participantes del cobro), sin sorpresas para cobros ya creados.
--
-- `charge_settlements` (transferencias del responsable a Tesorería) también pasa a llevar SU
-- PROPIO `responsible_member_id` — con varios responsables por cobro, cada uno tiene un saldo
-- pendiente de transferir INDEPENDIENTE (la plata que junta Pedro del Grupo A no es la misma que
-- junta Juan del Grupo B), antes era un solo saldo agregado por cobro. El backfill toma el
-- responsable ACTUAL de cada cobro (todo settlement existente se creó cuando solo podía haber
-- uno), antes de borrar esa columna.
-- ============================================================================
USE `admin_club`;

CREATE TABLE IF NOT EXISTS `charge_responsible_members` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `charge_id` BIGINT UNSIGNED NOT NULL,
  `member_id` BIGINT UNSIGNED NOT NULL,
  `group_id` BIGINT UNSIGNED NULL,
  `position` TINYINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_crm_charge` (`charge_id`),
  KEY `idx_crm_group` (`group_id`),
  CONSTRAINT `fk_crm_charge` FOREIGN KEY (`charge_id`) REFERENCES `charges` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_crm_member` FOREIGN KEY (`member_id`) REFERENCES `members` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_crm_group` FOREIGN KEY (`group_id`) REFERENCES `member_groups` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `charge_responsible_members` (`charge_id`, `member_id`, `group_id`, `position`)
SELECT `id`, `responsible_member_id`, NULL, 0 FROM `charges` WHERE `responsible_member_id` IS NOT NULL;

ALTER TABLE `charge_settlements` ADD COLUMN `responsible_member_id` BIGINT UNSIGNED NULL AFTER `charge_id`;

UPDATE `charge_settlements` cs
  INNER JOIN `charges` c ON c.id = cs.charge_id
  SET cs.responsible_member_id = c.responsible_member_id;

ALTER TABLE `charge_settlements`
  MODIFY COLUMN `responsible_member_id` BIGINT UNSIGNED NOT NULL,
  DROP INDEX `idx_cs_charge_period`,
  ADD INDEX `idx_cs_charge_resp_period` (`charge_id`, `responsible_member_id`, `period_label`),
  ADD CONSTRAINT `fk_cs_responsible_member` FOREIGN KEY (`responsible_member_id`) REFERENCES `members` (`id`) ON DELETE CASCADE;

ALTER TABLE `charges` DROP FOREIGN KEY `fk_charges_responsible_member`;
ALTER TABLE `charges` DROP COLUMN `responsible_member_id`;

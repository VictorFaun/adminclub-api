-- ============================================================================
-- Precio por grupo/etiqueta/miembro específico dentro de un mismo cobro —
-- antes `charges.amount` era el único monto posible para todo el mundo. Ahora
-- cada fila de "a quién aplica" (grupo, etiqueta o miembro puntual) lleva su
-- propio monto, con prioridad: default del cobro < grupo < etiqueta <
-- miembro específico (cada nivel más específico pisa por completo al
-- anterior). Empate dentro del mismo nivel (un miembro que califica para 2+
-- grupos/etiquetas apuntados) lo resuelve `position` — gana el de menor
-- `position` (el primero de la lista, reordenable en el frontend con
-- flechas subir/bajar) — ver charges.repository.js#resolveAmounts.
--
-- `amount`/`position` se agregan con un DEFAULT temporal y se hace backfill
-- de las filas ya existentes con el monto del cobro padre (antes de esto,
-- todo cobro ya creado cobraba lo mismo a todo el mundo, así que heredar el
-- monto del cobro es exactamente el comportamiento previo, sin sorpresas).
-- ============================================================================
USE `admin_club`;

ALTER TABLE `charge_target_groups`
  ADD COLUMN `amount` DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER `group_id`,
  ADD COLUMN `position` TINYINT UNSIGNED NOT NULL DEFAULT 0 AFTER `amount`;

UPDATE `charge_target_groups` ctg
  INNER JOIN `charges` c ON c.id = ctg.charge_id
  SET ctg.amount = c.amount
  WHERE ctg.amount = 0;

ALTER TABLE `charge_target_members`
  ADD COLUMN `amount` DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER `member_id`;

UPDATE `charge_target_members` ctm
  INNER JOIN `charges` c ON c.id = ctm.charge_id
  SET ctm.amount = c.amount
  WHERE ctm.amount = 0;

CREATE TABLE IF NOT EXISTS `charge_target_tags` (
  `charge_id` BIGINT UNSIGNED NOT NULL,
  `tag_id` BIGINT UNSIGNED NOT NULL,
  `amount` DECIMAL(12,2) NOT NULL,
  `position` TINYINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`charge_id`, `tag_id`),
  KEY `idx_ctt_tag` (`tag_id`),
  CONSTRAINT `fk_ctt_charge` FOREIGN KEY (`charge_id`) REFERENCES `charges` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_ctt_tag` FOREIGN KEY (`tag_id`) REFERENCES `member_tags` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

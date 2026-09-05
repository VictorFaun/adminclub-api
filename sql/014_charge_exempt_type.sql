-- ============================================================================
-- Distingue dos "sabores" de una instancia `exempt`: FROZEN ("congelado" — ej.
-- un jugador de licencia) vs NOT_APPLICABLE ("no aplica" — ej. el entrenador
-- un mes puntual). Ambos bloquean el registro de un pago igual (misma
-- condición en payments.service.js#create), solo cambia la etiqueta/color
-- mostrados — se guarda en su propia columna en vez de inferirlo del texto
-- libre de `exempt_reason`. También suma 'not_applicable' como un sexto
-- "estado visual" configurable en charge_status_colors.
-- ============================================================================
USE `admin_club`;

ALTER TABLE `charge_instances`
  ADD COLUMN `exempt_type` ENUM('frozen','not_applicable') NULL AFTER `exempt_reason`;

ALTER TABLE `charge_status_colors`
  MODIFY COLUMN `status_code` ENUM('pending','partial','paid','exempt','overdue','not_applicable') NOT NULL;

-- ============================================================================
-- Módulo "Tesorería": cobros (definiciones), cargos generados por período
-- (charge_instances, lo que un miembro debe en un mes/año puntual, con monto
-- congelado al generarse), pagos reales (payments) que se reparten entre uno o
-- más cargos vía payment_allocations (permite pagar varios cobros a la vez o
-- abonar parcialmente uno solo), y el scope de "de quién puedo ver la plata"
-- (role_payment_scope/role_payment_group_scope), independiente pero pensado
-- para combinarse en runtime con el scope de Miembros (ver payments.service.js).
-- ============================================================================
USE `admin_club`;

-- ----------------------------------------------------------------------------
-- charges (definición del cobro: nombre, monto, recurrencia, a quién aplica)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `charges` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `uuid` CHAR(36) NOT NULL,
  `club_id` BIGINT UNSIGNED NOT NULL,
  `name` VARCHAR(150) NOT NULL,
  `description` VARCHAR(500) NULL,
  `color` VARCHAR(9) NOT NULL DEFAULT '#6366F1',
  `amount` DECIMAL(12,2) NOT NULL,
  `recurrence` ENUM('once','monthly','yearly') NOT NULL DEFAULT 'once',
  `start_date` DATE NOT NULL,
  -- Día del mes de vencimiento (1-31, solo monthly/yearly). Si el mes no tiene ese día
  -- (ej. 31 en febrero), members.service.js#computeDueDate lo recorta al último día real.
  `due_day` TINYINT UNSIGNED NULL,
  -- Mes de vencimiento (1-12, solo yearly).
  `due_month` TINYINT UNSIGNED NULL,
  `end_date` DATE NULL,
  `status` ENUM('active','inactive') NOT NULL DEFAULT 'active',
  `created_by` BIGINT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` DATETIME NULL,
  UNIQUE KEY `uk_charges_uuid` (`uuid`),
  KEY `idx_charges_club` (`club_id`),
  KEY `idx_charges_status` (`status`),
  CONSTRAINT `fk_charges_club` FOREIGN KEY (`club_id`) REFERENCES `clubs` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_charges_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- A quién aplica un cobro: miembros puntuales + grupos completos (mismo patrón
-- que role_member_scope/role_member_group_scope) + exclusiones permanentes
-- (ej. el entrenador es miembro de la categoría pero nunca paga mensualidad).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `charge_target_members` (
  `charge_id` BIGINT UNSIGNED NOT NULL,
  `member_id` BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (`charge_id`, `member_id`),
  KEY `idx_ctm_member` (`member_id`),
  CONSTRAINT `fk_ctm_charge` FOREIGN KEY (`charge_id`) REFERENCES `charges` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_ctm_member` FOREIGN KEY (`member_id`) REFERENCES `members` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `charge_target_groups` (
  `charge_id` BIGINT UNSIGNED NOT NULL,
  `group_id` BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (`charge_id`, `group_id`),
  KEY `idx_ctg_group` (`group_id`),
  CONSTRAINT `fk_ctg_charge` FOREIGN KEY (`charge_id`) REFERENCES `charges` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_ctg_group` FOREIGN KEY (`group_id`) REFERENCES `member_groups` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `charge_target_exclusions` (
  `charge_id` BIGINT UNSIGNED NOT NULL,
  `member_id` BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (`charge_id`, `member_id`),
  KEY `idx_cte_member` (`member_id`),
  CONSTRAINT `fk_cte_charge` FOREIGN KEY (`charge_id`) REFERENCES `charges` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_cte_member` FOREIGN KEY (`member_id`) REFERENCES `members` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- charge_instances: lo que UN miembro debe en UN período puntual (generado por
-- cron desde la definición — ver chargeInstances.service.js). Monto congelado:
-- si el cobro cambia de precio después, las instancias ya generadas no cambian.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `charge_instances` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `uuid` CHAR(36) NOT NULL,
  `charge_id` BIGINT UNSIGNED NOT NULL,
  `member_id` BIGINT UNSIGNED NOT NULL,
  -- 'YYYY-MM' (monthly), 'YYYY' (yearly) o 'unico' (once) — nunca NULL, así la UNIQUE de abajo
  -- previene duplicados también para cobros únicos (MySQL trata múltiples NULL como distintos).
  `period_label` VARCHAR(9) NOT NULL,
  `amount` DECIMAL(12,2) NOT NULL,
  `due_date` DATE NOT NULL,
  `status` ENUM('pending','partial','paid','exempt') NOT NULL DEFAULT 'pending',
  `exempt_reason` VARCHAR(255) NULL,
  `exempt_by` BIGINT UNSIGNED NULL,
  `exempt_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY `uk_charge_instances` (`charge_id`, `member_id`, `period_label`),
  UNIQUE KEY `uk_charge_instances_uuid` (`uuid`),
  KEY `idx_ci_member` (`member_id`),
  KEY `idx_ci_status` (`status`),
  KEY `idx_ci_due_date` (`due_date`),
  CONSTRAINT `fk_ci_charge` FOREIGN KEY (`charge_id`) REFERENCES `charges` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_ci_member` FOREIGN KEY (`member_id`) REFERENCES `members` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_ci_exempt_by` FOREIGN KEY (`exempt_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- payments + payment_allocations: un pago real de un miembro, repartido entre
-- uno o más charge_instances. `payments.amount` es la suma de sus allocations
-- (se guarda igual para no recalcular en cada lectura del historial).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `payments` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `uuid` CHAR(36) NOT NULL,
  `club_id` BIGINT UNSIGNED NOT NULL,
  `member_id` BIGINT UNSIGNED NOT NULL,
  `amount` DECIMAL(12,2) NOT NULL,
  `paid_at` DATETIME NOT NULL,
  `note` VARCHAR(255) NULL,
  `registered_by` BIGINT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY `uk_payments_uuid` (`uuid`),
  KEY `idx_payments_member` (`member_id`),
  KEY `idx_payments_club` (`club_id`),
  CONSTRAINT `fk_payments_club` FOREIGN KEY (`club_id`) REFERENCES `clubs` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_payments_member` FOREIGN KEY (`member_id`) REFERENCES `members` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_payments_registered_by` FOREIGN KEY (`registered_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `payment_allocations` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `payment_id` BIGINT UNSIGNED NOT NULL,
  `charge_instance_id` BIGINT UNSIGNED NOT NULL,
  `amount` DECIMAL(12,2) NOT NULL,
  UNIQUE KEY `uk_payment_allocations` (`payment_id`, `charge_instance_id`),
  KEY `idx_pa_instance` (`charge_instance_id`),
  CONSTRAINT `fk_pa_payment` FOREIGN KEY (`payment_id`) REFERENCES `payments` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_pa_instance` FOREIGN KEY (`charge_instance_id`) REFERENCES `charge_instances` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- role_payment_scope / role_payment_group_scope: a qué miembros/grupos da
-- acceso de TESORERÍA un rol con VIEW_PAYMENTS_SCOPED. Tabla separada del scope
-- de Miembros a propósito — "de quién puedo ver la plata" no es lo mismo que "a
-- quién puedo ver el perfil"; el acceso real exige AMBOS (ver payments.service.js).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `role_payment_scope` (
  `role_id` BIGINT UNSIGNED NOT NULL,
  `member_id` BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (`role_id`, `member_id`),
  KEY `idx_rps_member` (`member_id`),
  CONSTRAINT `fk_rps_role` FOREIGN KEY (`role_id`) REFERENCES `roles` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_rps_member` FOREIGN KEY (`member_id`) REFERENCES `members` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `role_payment_group_scope` (
  `role_id` BIGINT UNSIGNED NOT NULL,
  `group_id` BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (`role_id`, `group_id`),
  KEY `idx_rpgs_group` (`group_id`),
  CONSTRAINT `fk_rpgs_role` FOREIGN KEY (`role_id`) REFERENCES `roles` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_rpgs_group` FOREIGN KEY (`group_id`) REFERENCES `member_groups` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- Funcionalidades nuevas del módulo (categoría 'tesoreria', todas asignables a
-- un rol de club) + backfill al rol "Administrador" de cada club ya existente
-- (los clubes creados después de esta migración las reciben solas, ver
-- defaultClubRoles.js).
-- ----------------------------------------------------------------------------
INSERT INTO `functions` (`code`, `name`, `description`, `category`, `is_club_assignable`) VALUES
  ('VIEW_TREASURY_DASHBOARD', 'Ver dashboard de tesorería', 'Ver el resumen general del módulo de tesorería (totales, no detalle por miembro)', 'tesoreria', 1),
  ('VIEW_CHARGES',            'Ver cobros',                 'Ver el catálogo de cobros configurados', 'tesoreria', 1),
  ('CREATE_CHARGES',          'Crear cobros',               'Crear nuevos cobros (únicos o recurrentes)', 'tesoreria', 1),
  ('EDIT_CHARGES',            'Editar cobros',               'Editar cobros existentes (monto, a quién aplica, exclusiones)', 'tesoreria', 1),
  ('DELETE_CHARGES',          'Eliminar cobros',             'Eliminar cobros', 'tesoreria', 1),
  ('VIEW_PAYMENTS',           'Ver todos los pagos',         'Ver los pagos y el estado de cuenta de todos los miembros', 'tesoreria', 1),
  ('VIEW_PAYMENTS_SCOPED',    'Ver pagos específicos',       'Ver los pagos solo de los miembros/grupos vinculados específicamente al rol', 'tesoreria', 1),
  ('CREATE_PAYMENTS',         'Registrar pagos',             'Registrar pagos de miembros (sujeto al mismo alcance que verlos)', 'tesoreria', 1),
  ('EDIT_PAYMENTS',           'Editar pagos',                'Editar o anular un pago ya registrado (sujeto al mismo alcance)', 'tesoreria', 1),
  ('DELETE_PAYMENTS',         'Eliminar pagos',              'Eliminar un pago (sujeto al mismo alcance)', 'tesoreria', 1),
  ('EXEMPT_PAYMENTS',         'Eximir cobros',               'Marcar un período como "no corresponde" sin registrar pago (sujeto al mismo alcance)', 'tesoreria', 1)
ON DUPLICATE KEY UPDATE
  `name` = VALUES(`name`),
  `description` = VALUES(`description`),
  `category` = VALUES(`category`),
  `is_club_assignable` = VALUES(`is_club_assignable`);

INSERT IGNORE INTO `role_functions` (`role_id`, `function_id`)
SELECT r.id, f.id FROM `roles` r CROSS JOIN `functions` f
WHERE r.club_id IS NOT NULL AND r.is_system = 1 AND r.name = 'Administrador'
  AND f.code IN (
    'VIEW_TREASURY_DASHBOARD', 'VIEW_CHARGES', 'CREATE_CHARGES', 'EDIT_CHARGES', 'DELETE_CHARGES',
    'VIEW_PAYMENTS', 'VIEW_PAYMENTS_SCOPED', 'CREATE_PAYMENTS', 'EDIT_PAYMENTS', 'DELETE_PAYMENTS',
    'EXEMPT_PAYMENTS'
  );

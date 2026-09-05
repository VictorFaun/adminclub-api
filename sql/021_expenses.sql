-- ============================================================================
-- Módulo "Gastos" (egresos de Tesorería): mirror de charges/charge_instances/
-- payments (012_treasury.sql), pero SIN dimensión de miembro — un gasto genera
-- períodos directamente (sueldos, arriendo, servicios), no una matriz por
-- miembro. El destinatario del pago (`payee`) es SOLO texto libre, sin vínculo
-- a `members` (a diferencia de `charges.responsible_member_id`).
-- ============================================================================
USE `admin_club`;

-- ----------------------------------------------------------------------------
-- expense_categories: agrupación opcional de gastos (ej. "Sueldos", "Arriendo",
-- "Servicios") — mismo patrón que member_groups (010_members.sql).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `expense_categories` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `uuid` CHAR(36) NOT NULL,
  `club_id` BIGINT UNSIGNED NOT NULL,
  `name` VARCHAR(100) NOT NULL,
  `description` VARCHAR(255) NULL,
  `color` VARCHAR(9) NOT NULL DEFAULT '#6366F1',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `uk_expense_categories_uuid` (`uuid`),
  UNIQUE KEY `uk_expense_categories_club_name` (`club_id`, `name`),
  CONSTRAINT `fk_expense_categories_club` FOREIGN KEY (`club_id`) REFERENCES `clubs` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- expenses (plantilla, mirror de `charges` sin targets/purpose/responsable)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `expenses` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `uuid` CHAR(36) NOT NULL,
  `club_id` BIGINT UNSIGNED NOT NULL,
  `category_id` BIGINT UNSIGNED NULL,
  `name` VARCHAR(150) NOT NULL,
  `description` VARCHAR(500) NULL,
  `color` VARCHAR(9) NOT NULL DEFAULT '#6366F1',
  `amount` DECIMAL(12,2) NOT NULL,
  -- Texto libre (ej. "Juan Pérez, entrenador de fútbol") — a propósito SIN FK a `members`
  -- (confirmado con el usuario: un gasto no se vincula a una ficha de miembro).
  `payee` VARCHAR(150) NULL,
  `recurrence` ENUM('once','monthly','yearly') NOT NULL DEFAULT 'once',
  `start_date` DATE NOT NULL,
  `due_day` TINYINT UNSIGNED NULL,
  `due_month` TINYINT UNSIGNED NULL,
  `end_date` DATE NULL,
  `status` ENUM('active','inactive') NOT NULL DEFAULT 'active',
  -- Mismo ciclo que charges.archived_at (019_charge_archive.sql): oculta de Gastos pero su
  -- dinero histórico sigue contando; eliminar exige archivar primero (ver expenses.service.js).
  `archived_at` DATETIME NULL,
  `created_by` BIGINT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` DATETIME NULL,
  UNIQUE KEY `uk_expenses_uuid` (`uuid`),
  KEY `idx_expenses_club` (`club_id`),
  KEY `idx_expenses_status` (`status`),
  CONSTRAINT `fk_expenses_club` FOREIGN KEY (`club_id`) REFERENCES `clubs` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_expenses_category` FOREIGN KEY (`category_id`) REFERENCES `expense_categories` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_expenses_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- expense_instances (mirror de `charge_instances`, SIN member_id — un gasto no
-- tiene "participantes", genera un único período por período).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `expense_instances` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `uuid` CHAR(36) NOT NULL,
  `expense_id` BIGINT UNSIGNED NOT NULL,
  -- 'YYYY-MM' (monthly), 'YYYY' (yearly) o 'unico' (once) — mismo formato que charge_instances.
  `period_label` VARCHAR(9) NOT NULL,
  `amount` DECIMAL(12,2) NOT NULL,
  `due_date` DATE NOT NULL,
  `status` ENUM('pending','partial','paid') NOT NULL DEFAULT 'pending',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY `uk_expense_instances` (`expense_id`, `period_label`),
  UNIQUE KEY `uk_expense_instances_uuid` (`uuid`),
  KEY `idx_ei_status` (`status`),
  KEY `idx_ei_due_date` (`due_date`),
  CONSTRAINT `fk_ei_expense` FOREIGN KEY (`expense_id`) REFERENCES `expenses` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- expense_payments (mirror de `payments`, SIN payment_allocations — un pago de
-- gasto siempre apunta a UNA sola expense_instance, no hay que repartirlo).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `expense_payments` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `uuid` CHAR(36) NOT NULL,
  `club_id` BIGINT UNSIGNED NOT NULL,
  `expense_instance_id` BIGINT UNSIGNED NOT NULL,
  `amount` DECIMAL(12,2) NOT NULL,
  `paid_at` DATETIME NOT NULL,
  `note` VARCHAR(255) NULL,
  `registered_by` BIGINT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY `uk_expense_payments_uuid` (`uuid`),
  KEY `idx_ep_instance` (`expense_instance_id`),
  KEY `idx_ep_club` (`club_id`),
  CONSTRAINT `fk_ep_club` FOREIGN KEY (`club_id`) REFERENCES `clubs` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_ep_instance` FOREIGN KEY (`expense_instance_id`) REFERENCES `expense_instances` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_ep_registered_by` FOREIGN KEY (`registered_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- Funcionalidades nuevas del módulo (categoría 'tesoreria', todas asignables a
-- roles de club) — mismo bloque que 012_treasury.sql líneas 169-194. Funcio-
-- nalidades PROPIAS (no se reutilizan las de Cobros/Pagos): Gastos no tiene el
-- concepto de "responsable"/acceso cruzado de charges, así que EDIT_EXPENSES
-- también cubre gestionar los pagos de un gasto (no hay un CREATE_PAYMENTS
-- equivalente separado).
-- ----------------------------------------------------------------------------
INSERT INTO `functions` (`code`, `name`, `description`, `category`, `is_club_assignable`) VALUES
  ('VIEW_EXPENSES',   'Ver gastos',      'Ver el catálogo de gastos y sus períodos', 'tesoreria', 1),
  ('CREATE_EXPENSES', 'Crear gastos',    'Crear nuevos gastos (únicos o recurrentes)', 'tesoreria', 1),
  ('EDIT_EXPENSES',   'Editar gastos',   'Editar gastos existentes y registrar sus pagos', 'tesoreria', 1),
  ('DELETE_EXPENSES', 'Eliminar gastos', 'Eliminar gastos (solo una vez archivados)', 'tesoreria', 1)
ON DUPLICATE KEY UPDATE
  `name` = VALUES(`name`),
  `description` = VALUES(`description`),
  `category` = VALUES(`category`),
  `is_club_assignable` = VALUES(`is_club_assignable`);

INSERT IGNORE INTO `role_functions` (`role_id`, `function_id`)
SELECT r.id, f.id FROM `roles` r CROSS JOIN `functions` f
WHERE r.club_id IS NOT NULL AND r.is_system = 1 AND r.name = 'Administrador'
  AND f.code IN ('VIEW_EXPENSES', 'CREATE_EXPENSES', 'EDIT_EXPENSES', 'DELETE_EXPENSES');

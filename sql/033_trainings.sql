-- ============================================================================
-- Módulo "Entrenamientos": sesiones recurrentes (N días/semana + horario),
-- asistencia por miembro y sesión, responsables (entrenadores) opcionalmente
-- acotados a un grupo — mismo patrón exacto que Tesorería (charges/
-- charge_instances/charge_responsible_members, ver 012_treasury.sql y
-- 032_charge_responsibles.sql), adaptado a recurrencia semanal en vez de
-- mensual/anual y sin dinero de por medio (asistencia, no monto).
-- ============================================================================
USE `admin_club`;

-- ----------------------------------------------------------------------------
-- trainings (definición: nombre, a quién aplica) — sin `amount`/`recurrence`/
-- `due_day`/`due_month`/`purpose` (no aplican, ver training_schedules abajo).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `trainings` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `uuid` CHAR(36) NOT NULL,
  `club_id` BIGINT UNSIGNED NOT NULL,
  `name` VARCHAR(150) NOT NULL,
  `description` VARCHAR(500) NULL,
  `color` VARCHAR(9) NOT NULL DEFAULT '#6366F1',
  `start_date` DATE NOT NULL,
  `end_date` DATE NULL,
  `status` ENUM('active','inactive') NOT NULL DEFAULT 'active',
  `created_by` BIGINT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` DATETIME NULL,
  `archived_at` DATETIME NULL,
  UNIQUE KEY `uk_trainings_uuid` (`uuid`),
  KEY `idx_trainings_club` (`club_id`),
  KEY `idx_trainings_status` (`status`),
  CONSTRAINT `fk_trainings_club` FOREIGN KEY (`club_id`) REFERENCES `clubs` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_trainings_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- training_schedules: cuántos entrenamientos a la semana hay, qué días y a qué
-- hora — varias filas por training_id (ej. Lunes 18:00-19:30 + Miércoles
-- 18:00-19:30 = 2 filas). `day_of_week` en ISO (1=lunes .. 7=domingo).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `training_schedules` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `training_id` BIGINT UNSIGNED NOT NULL,
  `day_of_week` TINYINT UNSIGNED NOT NULL,
  `start_time` TIME NOT NULL,
  `end_time` TIME NULL,
  KEY `idx_ts_training` (`training_id`),
  CONSTRAINT `fk_ts_training` FOREIGN KEY (`training_id`) REFERENCES `trainings` (`id`) ON DELETE CASCADE,
  CONSTRAINT `chk_ts_day_of_week` CHECK (`day_of_week` BETWEEN 1 AND 7)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- A quién aplica un entrenamiento — mirror EXACTO de charge_target_members/
-- charge_target_groups/charge_target_exclusions, sin `amount` (no hay precio).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `training_target_members` (
  `training_id` BIGINT UNSIGNED NOT NULL,
  `member_id` BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (`training_id`, `member_id`),
  KEY `idx_ttm_member` (`member_id`),
  CONSTRAINT `fk_ttm_training` FOREIGN KEY (`training_id`) REFERENCES `trainings` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_ttm_member` FOREIGN KEY (`member_id`) REFERENCES `members` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `training_target_groups` (
  `training_id` BIGINT UNSIGNED NOT NULL,
  `group_id` BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (`training_id`, `group_id`),
  KEY `idx_ttg_group` (`group_id`),
  CONSTRAINT `fk_ttg_training` FOREIGN KEY (`training_id`) REFERENCES `trainings` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_ttg_group` FOREIGN KEY (`group_id`) REFERENCES `member_groups` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `training_target_exclusions` (
  `training_id` BIGINT UNSIGNED NOT NULL,
  `member_id` BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (`training_id`, `member_id`),
  KEY `idx_tte_member` (`member_id`),
  CONSTRAINT `fk_tte_training` FOREIGN KEY (`training_id`) REFERENCES `trainings` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_tte_member` FOREIGN KEY (`member_id`) REFERENCES `members` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- training_responsible_members — mirror EXACTO de charge_responsible_members
-- (032_charge_responsibles.sql): uno o más "entrenadores" por entrenamiento,
-- cada uno opcionalmente acotado a un grupo (`group_id NULL` = todos los
-- grupos). `position` desempata cuando un miembro pertenece a 2+ grupos con
-- responsable propio (gana menor `position`).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `training_responsible_members` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `training_id` BIGINT UNSIGNED NOT NULL,
  `member_id` BIGINT UNSIGNED NOT NULL,
  `group_id` BIGINT UNSIGNED NULL,
  `position` TINYINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_trm_training` (`training_id`),
  KEY `idx_trm_group` (`group_id`),
  CONSTRAINT `fk_trm_training` FOREIGN KEY (`training_id`) REFERENCES `trainings` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_trm_member` FOREIGN KEY (`member_id`) REFERENCES `members` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_trm_group` FOREIGN KEY (`group_id`) REFERENCES `member_groups` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- training_attendances — mirror de charge_instances, colapsando "sesión" +
-- "estado de asistencia" en una sola fila por (training,member,session_date):
-- una sesión existe implícitamente como el conjunto de filas con la misma
-- fecha para un training_id, no hay tabla de sesiones aparte. Sin
-- payments/allocations equivalente — asistencia es una marca única, no hay
-- "abono parcial".
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `training_attendances` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `uuid` CHAR(36) NOT NULL,
  `training_id` BIGINT UNSIGNED NOT NULL,
  `member_id` BIGINT UNSIGNED NOT NULL,
  `session_date` DATE NOT NULL,
  `status` ENUM('pending','attended','absent','exempt') NOT NULL DEFAULT 'pending',
  `exempt_type` ENUM('frozen','not_applicable') NULL,
  `exempt_reason` VARCHAR(255) NULL,
  `marked_by` BIGINT UNSIGNED NULL,
  `marked_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY `uk_training_attendances` (`training_id`, `member_id`, `session_date`),
  UNIQUE KEY `uk_training_attendances_uuid` (`uuid`),
  KEY `idx_ta_member` (`member_id`),
  KEY `idx_ta_status` (`status`),
  KEY `idx_ta_session_date` (`session_date`),
  CONSTRAINT `fk_ta_training` FOREIGN KEY (`training_id`) REFERENCES `trainings` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_ta_member` FOREIGN KEY (`member_id`) REFERENCES `members` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_ta_marked_by` FOREIGN KEY (`marked_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- Colores configurables por estado de asistencia — mirror de
-- charge_status_colors (013_treasury_status_colors.sql). `pending: NULL` (sin
-- color) es el default pedido, igual criterio que Tesorería.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `training_status_colors` (
  `club_id` BIGINT UNSIGNED NOT NULL,
  `status_code` ENUM('pending','attended','absent','not_applicable','frozen') NOT NULL,
  `color` VARCHAR(9) NULL,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`club_id`, `status_code`),
  CONSTRAINT `fk_tsc_club` FOREIGN KEY (`club_id`) REFERENCES `clubs` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- role_attendance_scope / role_attendance_group_scope — mirror de
-- role_payment_scope/role_payment_group_scope: a qué miembros/grupos da acceso
-- de asistencia un rol con VIEW_ATTENDANCE_SCOPED.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `role_attendance_scope` (
  `role_id` BIGINT UNSIGNED NOT NULL,
  `member_id` BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (`role_id`, `member_id`),
  KEY `idx_ras_member` (`member_id`),
  CONSTRAINT `fk_ras_role` FOREIGN KEY (`role_id`) REFERENCES `roles` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_ras_member` FOREIGN KEY (`member_id`) REFERENCES `members` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `role_attendance_group_scope` (
  `role_id` BIGINT UNSIGNED NOT NULL,
  `group_id` BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (`role_id`, `group_id`),
  KEY `idx_rags_group` (`group_id`),
  CONSTRAINT `fk_rags_role` FOREIGN KEY (`role_id`) REFERENCES `roles` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_rags_group` FOREIGN KEY (`group_id`) REFERENCES `member_groups` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- Funcionalidades nuevas (categoría 'entrenamientos') + backfill al rol
-- "Administrador" de cada club ya existente — clubes nuevos las reciben solas
-- (defaultClubRoles.js ya agrega TODA funcionalidad no-plataforma).
-- ----------------------------------------------------------------------------
INSERT INTO `functions` (`code`, `name`, `description`, `category`, `is_club_assignable`) VALUES
  ('VIEW_TRAININGS',         'Ver entrenamientos',           'Ver el catálogo de entrenamientos configurados', 'entrenamientos', 1),
  ('CREATE_TRAININGS',       'Crear entrenamientos',         'Crear nuevos entrenamientos recurrentes', 'entrenamientos', 1),
  ('EDIT_TRAININGS',         'Editar entrenamientos',        'Editar entrenamientos existentes (horario, a quién aplica, entrenadores)', 'entrenamientos', 1),
  ('DELETE_TRAININGS',       'Eliminar entrenamientos',      'Eliminar entrenamientos', 'entrenamientos', 1),
  ('VIEW_ATTENDANCE',        'Ver toda la asistencia',       'Ver la asistencia de todos los miembros', 'entrenamientos', 1),
  ('VIEW_ATTENDANCE_SCOPED', 'Ver asistencia específica',    'Ver la asistencia solo de los miembros/grupos vinculados específicamente al rol', 'entrenamientos', 1),
  ('MARK_ATTENDANCE',        'Marcar asistencia',            'Marcar asistió/no asistió/congelado/no aplica (sujeto al mismo alcance que verla)', 'entrenamientos', 1),
  ('VIEW_TRAINING_SETTINGS', 'Ver configuración de entrenamientos', 'Ver la configuración del módulo de entrenamientos (colores de estado, etc.)', 'entrenamientos', 1),
  ('EDIT_TRAINING_SETTINGS', 'Editar configuración de entrenamientos', 'Editar la configuración del módulo de entrenamientos (colores de estado, etc.)', 'entrenamientos', 1)
ON DUPLICATE KEY UPDATE
  `name` = VALUES(`name`),
  `description` = VALUES(`description`),
  `category` = VALUES(`category`),
  `is_club_assignable` = VALUES(`is_club_assignable`);

INSERT IGNORE INTO `role_functions` (`role_id`, `function_id`)
SELECT r.id, f.id FROM `roles` r CROSS JOIN `functions` f
WHERE r.club_id IS NOT NULL AND r.is_system = 1 AND r.name = 'Administrador'
  AND f.code IN (
    'VIEW_TRAININGS', 'CREATE_TRAININGS', 'EDIT_TRAININGS', 'DELETE_TRAININGS',
    'VIEW_ATTENDANCE', 'VIEW_ATTENDANCE_SCOPED', 'MARK_ATTENDANCE',
    'VIEW_TRAINING_SETTINGS', 'EDIT_TRAINING_SETTINGS'
  );

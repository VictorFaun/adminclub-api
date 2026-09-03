-- ============================================================================
-- Módulo "Miembros": ficha de una persona perteneciente a un club (nombre,
-- contacto, RUT, fecha de nacimiento + campos personalizados definidos por el
-- club), vinculable opcionalmente a una cuenta de usuario de la plataforma.
-- Un usuario es como máximo UN miembro por club (UNIQUE club_id+user_id, con
-- múltiples NULL permitidos por MySQL para quienes no tienen cuenta vinculada).
--
-- Incluye también el scope de "ver solo miembros/grupos específicos" que un
-- rol puede tener (role_member_scope / role_member_group_scope), y siembra las
-- funcionalidades nuevas + backfill al rol "Administrador" de cada club ya
-- existente (los clubes creados después de esta migración las reciben solas,
-- ver defaultClubRoles.js que arma la plantilla desde config/constants.js).
-- ============================================================================
USE `admin_club`;

-- ----------------------------------------------------------------------------
-- members
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `members` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `uuid` CHAR(36) NOT NULL,
  `club_id` BIGINT UNSIGNED NOT NULL,
  `first_name` VARCHAR(100) NOT NULL,
  `middle_name` VARCHAR(100) NULL,
  `last_name` VARCHAR(100) NOT NULL,
  `second_last_name` VARCHAR(100) NULL,
  `email` VARCHAR(255) NULL,
  `phone` VARCHAR(30) NULL,
  `rut` VARCHAR(20) NULL,
  `birth_date` DATE NULL,
  `user_id` BIGINT UNSIGNED NULL,
  `status` ENUM('active','inactive') NOT NULL DEFAULT 'active',
  `created_by` BIGINT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` DATETIME NULL,
  UNIQUE KEY `uk_members_uuid` (`uuid`),
  UNIQUE KEY `uk_members_club_user` (`club_id`, `user_id`),
  UNIQUE KEY `uk_members_club_rut` (`club_id`, `rut`),
  KEY `idx_members_club` (`club_id`),
  KEY `idx_members_status` (`status`),
  CONSTRAINT `fk_members_club` FOREIGN KEY (`club_id`) REFERENCES `clubs` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_members_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_members_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- member_fields (catálogo de campos personalizados por club)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `member_fields` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `club_id` BIGINT UNSIGNED NOT NULL,
  `code` VARCHAR(60) NOT NULL,
  `label` VARCHAR(120) NOT NULL,
  `field_type` ENUM('text','number','date','boolean','select') NOT NULL DEFAULT 'text',
  `options` JSON NULL,
  `is_required` TINYINT(1) NOT NULL DEFAULT 0,
  `sort_order` INT NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `uk_member_fields_club_code` (`club_id`, `code`),
  KEY `idx_member_fields_club` (`club_id`),
  CONSTRAINT `fk_member_fields_club` FOREIGN KEY (`club_id`) REFERENCES `clubs` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- member_field_values (clave/valor por miembro, mismo patrón que club_settings)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `member_field_values` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `member_id` BIGINT UNSIGNED NOT NULL,
  `field_id` BIGINT UNSIGNED NOT NULL,
  `value` TEXT NULL,
  UNIQUE KEY `uk_member_field_values` (`member_id`, `field_id`),
  CONSTRAINT `fk_mfv_member` FOREIGN KEY (`member_id`) REFERENCES `members` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_mfv_field` FOREIGN KEY (`field_id`) REFERENCES `member_fields` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- member_groups (categorías de miembros, usadas también como filtro)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `member_groups` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `uuid` CHAR(36) NOT NULL,
  `club_id` BIGINT UNSIGNED NOT NULL,
  `name` VARCHAR(100) NOT NULL,
  `description` VARCHAR(255) NULL,
  `color` VARCHAR(9) NOT NULL DEFAULT '#6366F1',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `uk_member_groups_uuid` (`uuid`),
  UNIQUE KEY `uk_member_groups_club_name` (`club_id`, `name`),
  CONSTRAINT `fk_member_groups_club` FOREIGN KEY (`club_id`) REFERENCES `clubs` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `member_group_members` (
  `group_id` BIGINT UNSIGNED NOT NULL,
  `member_id` BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (`group_id`, `member_id`),
  KEY `idx_mgm_member` (`member_id`),
  CONSTRAINT `fk_mgm_group` FOREIGN KEY (`group_id`) REFERENCES `member_groups` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_mgm_member` FOREIGN KEY (`member_id`) REFERENCES `members` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- role_member_scope / role_member_group_scope: a qué miembros/grupos puntuales
-- da acceso un rol con VIEW_MEMBERS_SCOPED (si el rol tiene VIEW_MEMBERS, este
-- scope se ignora — ver members.service.js#_resolveAccess).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `role_member_scope` (
  `role_id` BIGINT UNSIGNED NOT NULL,
  `member_id` BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (`role_id`, `member_id`),
  KEY `idx_rms_member` (`member_id`),
  CONSTRAINT `fk_rms_role` FOREIGN KEY (`role_id`) REFERENCES `roles` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_rms_member` FOREIGN KEY (`member_id`) REFERENCES `members` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `role_member_group_scope` (
  `role_id` BIGINT UNSIGNED NOT NULL,
  `group_id` BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (`role_id`, `group_id`),
  KEY `idx_rmgs_group` (`group_id`),
  CONSTRAINT `fk_rmgs_role` FOREIGN KEY (`role_id`) REFERENCES `roles` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_rmgs_group` FOREIGN KEY (`group_id`) REFERENCES `member_groups` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- Funcionalidades nuevas del módulo (categoría 'miembros', todas asignables a
-- un rol de club)
-- ----------------------------------------------------------------------------
INSERT INTO `functions` (`code`, `name`, `description`, `category`, `is_club_assignable`) VALUES
  ('VIEW_MEMBERS_DASHBOARD', 'Ver dashboard de miembros', 'Ver el resumen general del módulo de miembros (conteos y actividad)', 'miembros', 1),
  ('VIEW_MEMBERS',           'Ver todos los miembros',    'Listar y ver el detalle de todos los miembros del club', 'miembros', 1),
  ('VIEW_MEMBERS_SCOPED',    'Ver miembros específicos',  'Listar y ver el detalle solo de los miembros/grupos vinculados específicamente al rol', 'miembros', 1),
  ('CREATE_MEMBERS',         'Crear miembros',            'Crear nuevos miembros', 'miembros', 1),
  ('EDIT_MEMBERS',           'Editar miembros',           'Editar los datos de un miembro (sujeto al mismo alcance que verlo)', 'miembros', 1),
  ('DELETE_MEMBERS',         'Eliminar miembros',         'Eliminar un miembro (sujeto al mismo alcance que verlo)', 'miembros', 1),
  ('LINK_MEMBER_USER',       'Vincular cuenta de usuario', 'Vincular o desvincular la cuenta de usuario de un miembro (sujeto al mismo alcance que verlo)', 'miembros', 1),
  ('VIEW_MEMBER_GROUPS',     'Ver grupos de miembros',    'Ver los grupos de miembros del club, usados también como filtro', 'miembros', 1),
  ('MANAGE_MEMBER_GROUPS',   'Administrar grupos de miembros', 'Crear, editar, eliminar grupos y gestionar sus miembros', 'miembros', 1),
  ('VIEW_MEMBER_FIELDS',     'Ver campos personalizados', 'Ver la configuración de campos personalizados de miembros', 'miembros', 1),
  ('MANAGE_MEMBER_FIELDS',   'Administrar campos personalizados', 'Crear, editar y eliminar campos personalizados de miembros', 'miembros', 1)
ON DUPLICATE KEY UPDATE
  `name` = VALUES(`name`),
  `description` = VALUES(`description`),
  `category` = VALUES(`category`),
  `is_club_assignable` = VALUES(`is_club_assignable`);

-- Backfill: los clubes YA EXISTENTES suman estas funcionalidades a su rol de
-- sistema "Administrador" (los clubes creados después de esta migración ya las
-- reciben solas, ver defaultClubRoles.js).
INSERT IGNORE INTO `role_functions` (`role_id`, `function_id`)
SELECT r.id, f.id FROM `roles` r CROSS JOIN `functions` f
WHERE r.club_id IS NOT NULL AND r.is_system = 1 AND r.name = 'Administrador'
  AND f.code IN (
    'VIEW_MEMBERS_DASHBOARD', 'VIEW_MEMBERS', 'VIEW_MEMBERS_SCOPED', 'CREATE_MEMBERS',
    'EDIT_MEMBERS', 'DELETE_MEMBERS', 'LINK_MEMBER_USER', 'VIEW_MEMBER_GROUPS',
    'MANAGE_MEMBER_GROUPS', 'VIEW_MEMBER_FIELDS', 'MANAGE_MEMBER_FIELDS'
  );

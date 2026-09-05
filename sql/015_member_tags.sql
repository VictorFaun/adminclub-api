-- ============================================================================
-- Módulo "Etiquetas" en Miembros — mismo patrón exacto que member_groups/
-- member_group_members (010_members.sql), pero pensado para atributos
-- transversales (ej. "Directiva") en vez de pertenencia estructural. Un
-- miembro puede tener 0, 1 o varias etiquetas. Se usan luego en Tesorería
-- para fijar montos de cobro distintos según etiqueta (ver 016_charge_pricing.sql).
-- ============================================================================
USE `admin_club`;

CREATE TABLE IF NOT EXISTS `member_tags` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `uuid` CHAR(36) NOT NULL,
  `club_id` BIGINT UNSIGNED NOT NULL,
  `name` VARCHAR(100) NOT NULL,
  `description` VARCHAR(255) NULL,
  `color` VARCHAR(9) NOT NULL DEFAULT '#6366F1',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `uk_member_tags_uuid` (`uuid`),
  UNIQUE KEY `uk_member_tags_club_name` (`club_id`, `name`),
  CONSTRAINT `fk_member_tags_club` FOREIGN KEY (`club_id`) REFERENCES `clubs` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `member_tag_members` (
  `tag_id` BIGINT UNSIGNED NOT NULL,
  `member_id` BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (`tag_id`, `member_id`),
  KEY `idx_mtm_member` (`member_id`),
  CONSTRAINT `fk_mtm_tag` FOREIGN KEY (`tag_id`) REFERENCES `member_tags` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_mtm_member` FOREIGN KEY (`member_id`) REFERENCES `members` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- Funcionalidades nuevas (categoría 'miembros', mismo patrón que
-- VIEW_MEMBER_GROUPS/MANAGE_MEMBER_GROUPS) + backfill al rol "Administrador"
-- de cada club ya existente (los clubes creados después de esta migración las
-- reciben solas vía roles.service.js, que reparte todas las funcionalidades
-- `is_club_assignable=1` al crear el rol Administrador de un club nuevo).
-- ----------------------------------------------------------------------------
INSERT INTO `functions` (`code`, `name`, `description`, `category`, `is_club_assignable`) VALUES
  ('VIEW_MEMBER_TAGS',   'Ver etiquetas de miembros',           'Ver las etiquetas de miembros del club', 'miembros', 1),
  ('MANAGE_MEMBER_TAGS', 'Administrar etiquetas de miembros',   'Crear, editar, eliminar etiquetas y asignarlas a miembros', 'miembros', 1)
ON DUPLICATE KEY UPDATE
  `name` = VALUES(`name`),
  `description` = VALUES(`description`),
  `category` = VALUES(`category`),
  `is_club_assignable` = VALUES(`is_club_assignable`);

INSERT IGNORE INTO `role_functions` (`role_id`, `function_id`)
SELECT r.id, f.id FROM `roles` r CROSS JOIN `functions` f
WHERE r.club_id IS NOT NULL AND r.is_system = 1 AND r.name = 'Administrador'
  AND f.code IN ('VIEW_MEMBER_TAGS', 'MANAGE_MEMBER_TAGS');

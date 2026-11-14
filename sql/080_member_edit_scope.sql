-- ============================================================================
-- 080: editar fichas o campos específicos.
--
-- Para encargados que solo deben completar ciertos datos (ej. el preparador físico de una categoría
-- que registra mediciones: salto, tiempos en distancias). Dos funcionalidades nuevas, cada una con
-- su alcance en el rol (igual que "Ver miembros específicos" con sus miembros/grupos):
--   * EDIT_MEMBER_FORMS_SCOPED       → role_member_form_scope: puede editar los DATOS (y crear
--     versiones) de esas fichas, no cómo están armadas.
--   * EDIT_MEMBER_FIELD_VALUES_SCOPED → role_member_field_scope: puede editar esos campos, de la
--     ficha que sean.
-- Solo sobre los miembros que el rol puede ver (Ver todos / Ver miembros específicos). No permiten
-- cambiar estado, grupos, fichas asignadas ni la cuenta: eso sigue siendo "Editar miembros".
-- ============================================================================
USE `admin_club`;

CREATE TABLE IF NOT EXISTS `role_member_form_scope` (
  `role_id` BIGINT UNSIGNED NOT NULL,
  `form_id` BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (`role_id`, `form_id`),
  CONSTRAINT `fk_rmfs_role` FOREIGN KEY (`role_id`) REFERENCES `roles` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_rmfs_form` FOREIGN KEY (`form_id`) REFERENCES `member_forms` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `role_member_field_scope` (
  `role_id` BIGINT UNSIGNED NOT NULL,
  `field_id` BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (`role_id`, `field_id`),
  CONSTRAINT `fk_rmfds_role` FOREIGN KEY (`role_id`) REFERENCES `roles` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_rmfds_field` FOREIGN KEY (`field_id`) REFERENCES `member_fields` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `functions` (`code`, `name`, `description`, `category`, `is_club_assignable`) VALUES
  ('EDIT_MEMBER_FORMS_SCOPED', 'Editar fichas específicas', 'Editar los datos (y crear versiones) solo de las fichas elegidas en el rol, en los miembros que puede ver', 'miembros', 1),
  ('EDIT_MEMBER_FIELD_VALUES_SCOPED', 'Editar campos específicos', 'Editar solo los campos elegidos en el rol (de la ficha que sean), en los miembros que puede ver', 'miembros', 1)
ON DUPLICATE KEY UPDATE `name` = VALUES(`name`), `description` = VALUES(`description`), `category` = VALUES(`category`), `is_club_assignable` = VALUES(`is_club_assignable`);

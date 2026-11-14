-- ============================================================================
-- 081: permisos separados para cada parte del detalle del miembro.
--
-- Hasta ahora "Ver todos los miembros" / "Ver miembros específicos" mostraban todo el detalle
-- (todas las fichas, cuenta vinculada, apoderados, estado e ingreso). Ahora cada parte tiene su
-- permiso para ver y para editar, así un rol puede ver a un miembro y SOLO cierta ficha:
--   * VIEW_MEMBER_FORM_DATA          → los datos de todas sus fichas.
--   * VIEW_MEMBER_FORM_DATA_SCOPED   → solo las fichas elegidas en el rol (role_member_view_form_scope).
--     (Editar miembros, y las fichas/campos que el rol puede editar, también se pueden ver.)
--   * VIEW_MEMBER_ACCOUNT            → la cuenta de usuario vinculada (vincularla: LINK_MEMBER_USER).
--   * VIEW_MEMBER_GUARDIANS / EDIT_MEMBER_GUARDIANS → apoderados.
--   * VIEW_MEMBER_MEMBERSHIP / EDIT_MEMBER_MEMBERSHIP → "En el club": estado, fecha de ingreso e historial.
-- Grupos, pagos y asistencia ya tenían sus propios permisos.
--
-- Para no quitarle nada a nadie, los roles existentes reciben los permisos nuevos según lo que ya
-- podían hacer (ver o editar miembros, vincular cuentas).
-- ============================================================================
USE `admin_club`;

CREATE TABLE IF NOT EXISTS `role_member_view_form_scope` (
  `role_id` BIGINT UNSIGNED NOT NULL,
  `form_id` BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (`role_id`, `form_id`),
  CONSTRAINT `fk_rmvfs_role` FOREIGN KEY (`role_id`) REFERENCES `roles` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_rmvfs_form` FOREIGN KEY (`form_id`) REFERENCES `member_forms` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `functions` (`code`, `name`, `description`, `category`, `is_club_assignable`) VALUES
  ('VIEW_MEMBER_FORM_DATA', 'Ver todas las fichas', 'Ver los datos de todas las fichas de los miembros que puede ver', 'miembros', 1),
  ('VIEW_MEMBER_FORM_DATA_SCOPED', 'Ver fichas específicas', 'Ver los datos solo de las fichas elegidas en el rol, de los miembros que puede ver', 'miembros', 1),
  ('VIEW_MEMBER_ACCOUNT', 'Ver cuenta vinculada', 'Ver qué cuenta de usuario tiene vinculada cada miembro', 'miembros', 1),
  ('VIEW_MEMBER_GUARDIANS', 'Ver apoderados', 'Ver los apoderados de cada miembro y de quiénes es apoderado', 'miembros', 1),
  ('EDIT_MEMBER_GUARDIANS', 'Editar apoderados', 'Agregar o quitar apoderados de los miembros que puede ver', 'miembros', 1),
  ('VIEW_MEMBER_MEMBERSHIP', 'Ver estado e ingreso', 'Ver la fecha de ingreso y el historial de pertenencia al club', 'miembros', 1),
  ('EDIT_MEMBER_MEMBERSHIP', 'Editar estado e ingreso', 'Cambiar el estado (activo/inactivo, reincorporar) y la fecha de ingreso', 'miembros', 1)
ON DUPLICATE KEY UPDATE `name` = VALUES(`name`), `description` = VALUES(`description`), `category` = VALUES(`category`), `is_club_assignable` = VALUES(`is_club_assignable`);

-- Quien veía miembros sigue viendo todo el detalle.
INSERT IGNORE INTO `role_functions` (`role_id`, `function_id`)
SELECT DISTINCT rf.role_id, nf.id FROM `role_functions` rf
  INNER JOIN `functions` f ON f.id = rf.function_id AND f.code IN ('VIEW_MEMBERS', 'VIEW_MEMBERS_SCOPED')
  CROSS JOIN `functions` nf
WHERE nf.code IN ('VIEW_MEMBER_FORM_DATA', 'VIEW_MEMBER_ACCOUNT', 'VIEW_MEMBER_GUARDIANS', 'VIEW_MEMBER_MEMBERSHIP');

-- Apoderados: antes los editaba quien editaba miembros o vinculaba cuentas.
INSERT IGNORE INTO `role_functions` (`role_id`, `function_id`)
SELECT DISTINCT rf.role_id, nf.id FROM `role_functions` rf
  INNER JOIN `functions` f ON f.id = rf.function_id AND f.code IN ('EDIT_MEMBERS', 'LINK_MEMBER_USER')
  CROSS JOIN `functions` nf
WHERE nf.code = 'EDIT_MEMBER_GUARDIANS';

-- Estado e ingreso: antes era "Editar miembros".
INSERT IGNORE INTO `role_functions` (`role_id`, `function_id`)
SELECT DISTINCT rf.role_id, nf.id FROM `role_functions` rf
  INNER JOIN `functions` f ON f.id = rf.function_id AND f.code = 'EDIT_MEMBERS'
  CROSS JOIN `functions` nf
WHERE nf.code = 'EDIT_MEMBER_MEMBERSHIP';

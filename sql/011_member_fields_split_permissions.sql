-- ============================================================================
-- Separa MANAGE_MEMBER_FIELDS (crear+editar+eliminar campos personalizados) en
-- tres funcionalidades independientes, para que un rol pueda tener, por
-- ejemplo, permiso de crear pero no de eliminar. El acceso a la VISTA sigue
-- dependiendo únicamente de VIEW_MEMBER_FIELDS (sin ella no se puede hacer
-- nada, aunque el rol tenga alguna de las tres nuevas) — ver
-- members.routes.js / member-settings.page.html para el detalle.
-- ============================================================================
USE `admin_club`;

INSERT INTO `functions` (`code`, `name`, `description`, `category`, `is_club_assignable`) VALUES
  ('CREATE_MEMBER_FIELDS', 'Crear campos personalizados',   'Crear nuevos campos personalizados para la ficha de miembro', 'miembros', 1),
  ('EDIT_MEMBER_FIELDS',   'Editar campos personalizados',  'Editar campos personalizados existentes', 'miembros', 1),
  ('DELETE_MEMBER_FIELDS', 'Eliminar campos personalizados','Eliminar campos personalizados existentes', 'miembros', 1)
ON DUPLICATE KEY UPDATE
  `name` = VALUES(`name`),
  `description` = VALUES(`description`),
  `category` = VALUES(`category`),
  `is_club_assignable` = VALUES(`is_club_assignable`);

-- Backfill: todo rol que hoy tenga MANAGE_MEMBER_FIELDS recibe las tres funcionalidades nuevas,
-- para no perder de golpe el acceso que ya tenía al aplicar esta migración.
INSERT IGNORE INTO `role_functions` (`role_id`, `function_id`)
SELECT rf.role_id, f.id
FROM `role_functions` rf
INNER JOIN `functions` old_f ON old_f.id = rf.function_id AND old_f.code = 'MANAGE_MEMBER_FIELDS'
CROSS JOIN `functions` f
WHERE f.code IN ('CREATE_MEMBER_FIELDS', 'EDIT_MEMBER_FIELDS', 'DELETE_MEMBER_FIELDS');

-- Elimina MANAGE_MEMBER_FIELDS (role_functions cae en cascada automáticamente, ver FK en
-- 001_schema.sql). Re-ejecutar este archivo es seguro: si ya no existe, no hace nada.
DELETE FROM `functions` WHERE `code` = 'MANAGE_MEMBER_FIELDS';

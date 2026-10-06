-- ============================================================================
-- Agrega EDIT_INVITATIONS (editar usos máximos, expiración, rol, nota y ficha
-- requerida de una invitación ya creada). Backfill: todo rol que hoy puede
-- crear invitaciones recibe también la de editarlas.
-- ============================================================================
USE `admin_club`;

INSERT INTO `functions` (`code`, `name`, `description`, `category`, `is_club_assignable`) VALUES
  ('EDIT_INVITATIONS', 'Editar invitaciones', 'Editar usos máximos, expiración, rol y nota de una invitación', 'invitaciones', 1)
ON DUPLICATE KEY UPDATE
  `name` = VALUES(`name`),
  `description` = VALUES(`description`),
  `category` = VALUES(`category`),
  `is_club_assignable` = VALUES(`is_club_assignable`);

INSERT IGNORE INTO `role_functions` (`role_id`, `function_id`)
SELECT rf.role_id, f.id
FROM `role_functions` rf
INNER JOIN `functions` old_f ON old_f.id = rf.function_id AND old_f.code = 'CREATE_INVITATIONS'
CROSS JOIN `functions` f
WHERE f.code = 'EDIT_INVITATIONS';

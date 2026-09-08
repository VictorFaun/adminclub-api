-- ============================================================================
-- Agrega DELETE_INVITATIONS (mismo patrón VIEW/CREATE/EDIT/DELETE que ya usan
-- members/charges/expenses). Reactivar una invitación revocada reutiliza
-- REVOKE_INVITATIONS (mismo dominio: "gestionar el estado de la invitación").
-- ============================================================================
USE `admin_club`;

INSERT INTO `functions` (`code`, `name`, `description`, `category`, `is_club_assignable`) VALUES
  ('DELETE_INVITATIONS', 'Eliminar invitaciones', 'Eliminar invitaciones ya no activas (revocadas, expiradas o agotadas)', 'invitaciones', 1)
ON DUPLICATE KEY UPDATE
  `name` = VALUES(`name`),
  `description` = VALUES(`description`),
  `category` = VALUES(`category`),
  `is_club_assignable` = VALUES(`is_club_assignable`);

-- Backfill: todo rol que hoy tenga REVOKE_INVITATIONS recibe también DELETE_INVITATIONS, para
-- no perder de golpe la posibilidad de limpiar invitaciones viejas al aplicar esta migración.
INSERT IGNORE INTO `role_functions` (`role_id`, `function_id`)
SELECT rf.role_id, f.id
FROM `role_functions` rf
INNER JOIN `functions` old_f ON old_f.id = rf.function_id AND old_f.code = 'REVOKE_INVITATIONS'
CROSS JOIN `functions` f
WHERE f.code = 'DELETE_INVITATIONS';

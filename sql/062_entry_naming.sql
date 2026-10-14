-- =============================================================================
-- 062 — Nombres de las formas de entrar al club (solo textos)
-- =============================================================================
-- Un nombre por forma, igual en toda la app: "Códigos de invitación" (lo que antes se llamaba
-- solo "invitaciones"), "Invitar por correo", "Solicitudes de acceso" e "Inscripción pública".
USE `admin_club`;

UPDATE `functions` SET `name` = 'Ver códigos de invitación',      `description` = 'Listar los códigos de invitación del club' WHERE `code` = 'VIEW_INVITATIONS';
UPDATE `functions` SET `name` = 'Crear códigos de invitación',    `description` = 'Crear códigos para que nuevas personas se unan al club' WHERE `code` = 'CREATE_INVITATIONS';
UPDATE `functions` SET `name` = 'Editar códigos de invitación',   `description` = 'Editar usos máximos, expiración, rol y nota de un código de invitación' WHERE `code` = 'EDIT_INVITATIONS';
UPDATE `functions` SET `name` = 'Revocar códigos de invitación',  `description` = 'Desactivar códigos de invitación vigentes' WHERE `code` = 'REVOKE_INVITATIONS';
UPDATE `functions` SET `name` = 'Eliminar códigos de invitación', `description` = 'Eliminar códigos de invitación ya no activos (revocados, expirados o agotados)' WHERE `code` = 'DELETE_INVITATIONS';
UPDATE `functions` SET `name` = 'Invitar por correo',             `description` = 'Buscar por correo a personas con cuenta e invitarlas al club' WHERE `code` = 'CREATE_USERS';

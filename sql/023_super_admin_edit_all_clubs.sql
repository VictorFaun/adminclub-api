-- ============================================================================
-- Bug real encontrado: 004_super_admin_scope.sql corrió DESPUÉS de que 002 ya le diera
-- EDIT_ALL_CLUBS a SUPER_ADMIN (inline, en su propio INSERT), pero 004 predata a la
-- existencia de EDIT_ALL_CLUBS y borra explícitamente todo lo que NO sea
-- ('MANAGE_PLATFORM', 'VIEW_ALL_CLUBS') de su rol_functions. En una migración completa
-- desde cero (001→002→003→004 en orden), esto le saca EDIT_ALL_CLUBS a SUPER_ADMIN justo
-- después de habérselo dado, dejándolo sin poder editar/eliminar clubes ajenos aunque
-- permission.service.js#buildAuthorizationContext ya esté preparado para expandirle todas
-- las funcionalidades club-assignable (incluida DELETE_CLUB) apenas tenga EDIT_ALL_CLUBS.
--
-- Nunca se edita una migración ya aplicada (004), así que se lo vuelve a otorgar acá.
-- ============================================================================
USE `admin_club`;

INSERT IGNORE INTO `role_functions` (`role_id`, `function_id`)
SELECT r.id, f.id FROM `roles` r CROSS JOIN `functions` f
WHERE r.club_id IS NULL AND r.name = 'SUPER_ADMIN' AND f.code = 'EDIT_ALL_CLUBS';

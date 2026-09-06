-- ============================================================================
-- Nueva vista de plataforma "Usuarios" (todos los usuarios de la plataforma,
-- sin importar club): ver, editar datos básicos y suspender/reactivar cuentas
-- a nivel global. Mismo patrón que 005_view_all_functions.sql: funcionalidades
-- exclusivas de plataforma (is_club_assignable = 0), asignadas explícitamente
-- a los roles globales (no alcanza con el CROSS JOIN de DEVELOPER en
-- 002_seed_functions_and_roles.sql porque ese seed ya corrió antes de que
-- estas funciones existieran en `functions`).
-- ============================================================================
USE `admin_club`;

INSERT INTO `functions` (`code`, `name`, `description`, `category`, `is_club_assignable`) VALUES
  ('VIEW_ALL_USERS',    'Ver todos los usuarios',    'Ver el listado de todos los usuarios registrados en la plataforma, sin importar su club', 'plataforma', 0),
  ('EDIT_ALL_USERS',    'Editar todos los usuarios', 'Editar los datos básicos de cualquier usuario de la plataforma',                          'plataforma', 0),
  ('SUSPEND_ALL_USERS', 'Suspender todos los usuarios', 'Suspender o reactivar la cuenta de cualquier usuario de la plataforma',                'plataforma', 0)
ON DUPLICATE KEY UPDATE
  `name` = VALUES(`name`),
  `description` = VALUES(`description`),
  `category` = VALUES(`category`),
  `is_club_assignable` = VALUES(`is_club_assignable`);

-- SUPER_ADMIN y DEVELOPER: ver, editar y suspender.
INSERT IGNORE INTO `role_functions` (`role_id`, `function_id`)
SELECT r.id, f.id FROM `roles` r CROSS JOIN `functions` f
WHERE r.club_id IS NULL AND r.name IN ('SUPER_ADMIN', 'DEVELOPER')
  AND f.code IN ('VIEW_ALL_USERS', 'EDIT_ALL_USERS', 'SUSPEND_ALL_USERS');

-- SUPPORT: solo lectura, igual que con VIEW_ALL_CLUBS.
INSERT IGNORE INTO `role_functions` (`role_id`, `function_id`)
SELECT r.id, f.id FROM `roles` r CROSS JOIN `functions` f
WHERE r.club_id IS NULL AND r.name = 'SUPPORT' AND f.code = 'VIEW_ALL_USERS';

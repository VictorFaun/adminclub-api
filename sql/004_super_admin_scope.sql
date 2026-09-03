-- ============================================================================
-- Ser Super Admin YA NO da acceso implícito total en cualquier club (ver
-- permission.service.js). Su rol global queda limitado a las funcionalidades de
-- plataforma; administrar el contenido de un club puntual depende de tener un rol
-- propio asignado en ESE club, igual que cualquier otro usuario.
--
-- Bases ya provisionadas antes de este cambio tienen el rol SUPER_ADMIN con TODAS
-- las funcionalidades asignadas (seed viejo, CROSS JOIN sin filtrar) — esta
-- migración le saca todo lo que no sea de plataforma y le deja solo lo que
-- corresponde. Idempotente: el DELETE no falla si ya está limpio, y el INSERT
-- IGNORE no duplica si ya están los 2 codes.
-- ============================================================================
USE `admin_club`;

DELETE rf FROM role_functions rf
INNER JOIN roles r ON r.id = rf.role_id
INNER JOIN functions f ON f.id = rf.function_id
WHERE r.club_id IS NULL
  AND r.name = 'SUPER_ADMIN'
  AND f.code NOT IN ('MANAGE_PLATFORM', 'VIEW_ALL_CLUBS');

INSERT IGNORE INTO role_functions (role_id, function_id)
SELECT r.id, f.id FROM roles r CROSS JOIN functions f
WHERE r.club_id IS NULL AND r.name = 'SUPER_ADMIN' AND f.code IN ('MANAGE_PLATFORM', 'VIEW_ALL_CLUBS');

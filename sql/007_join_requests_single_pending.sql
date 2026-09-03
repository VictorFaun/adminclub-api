-- ============================================================================
-- 007: permite volver a resolver (aprobar/rechazar) solicitudes de acceso
-- repetidas de un mismo usuario a un mismo club.
--
-- El UNIQUE original (club_id, user_id, status) buscaba evitar que un mismo
-- usuario tuviera dos solicitudes "pending" simultáneas al mismo club, pero al
-- incluir `status` en la clave también impedía tener dos filas 'rejected' (o
-- dos 'approved') del mismo par club/usuario — es decir, una vez rechazada una
-- solicitud, una segunda solicitud posterior no se podía volver a rechazar
-- (chocaba con la fila 'rejected' anterior, ER_DUP_ENTRY / 409).
--
-- Fix: solo debe existir como mucho UNA solicitud 'pending' por club+usuario a
-- la vez; 'approved'/'rejected' deben poder repetirse (son historial). MySQL no
-- tiene "unique parcial" nativo, así que se logra con una columna generada que
-- vale 1 solo cuando status='pending' y NULL en cualquier otro caso — un UNIQUE
-- KEY trata cada NULL como distinto entre sí, así que las filas resueltas nunca
-- chocan entre ellas, y solo se sigue impidiendo tener 2 'pending' a la vez.
-- ============================================================================
USE `admin_club`;

-- `uk_join_requests_pending` es hoy el único índice con `club_id` como columna líder, y
-- `fk_join_requests_club` lo necesita para existir — hay que crear el índice de reemplazo
-- ANTES de soltar el viejo, o InnoDB rechaza el DROP ("needed in a foreign key constraint").
ALTER TABLE `join_requests`
  ADD COLUMN `pending_flag` TINYINT(1)
    GENERATED ALWAYS AS (CASE WHEN `status` = 'pending' THEN 1 ELSE NULL END) STORED
    AFTER `status`;

ALTER TABLE `join_requests`
  ADD UNIQUE KEY `uk_join_requests_one_pending` (`club_id`, `user_id`, `pending_flag`);

ALTER TABLE `join_requests` DROP INDEX `uk_join_requests_pending`;

-- ============================================================================
-- 035: `username` deja de ser único y de servir para iniciar sesión. Es solo un
-- nombre para mostrar (dos personas pueden llamarse igual); la identidad de la
-- cuenta pasa a ser exclusivamente el correo (`email`, único entre cuentas no
-- eliminadas). Se conserva un índice no único para las búsquedas/orden por nombre.
-- ============================================================================
USE `admin_club`;

ALTER TABLE `users`
  DROP INDEX `uk_users_username`,
  ADD KEY `idx_users_username` (`username`);

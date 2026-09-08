-- ============================================================================
-- Login con Google — agrega `google_id` (identificador estable de la cuenta de Google, `sub`
-- del id_token) y relaja `password_hash` a NULL: una cuenta creada 100% desde Google no tiene
-- contraseña propia hasta que el usuario decida crear una (reusa el flujo YA EXISTENTE de
-- "¿Olvidaste tu contraseña?" para eso — ver GOOGLE_LOGIN_SETUP.md, no hace falta ningún
-- mecanismo nuevo de verificación).
-- ============================================================================
USE `admin_club`;

ALTER TABLE `users`
  ADD COLUMN `google_id` VARCHAR(255) NULL AFTER `email`,
  ADD UNIQUE KEY `uk_users_google_id` (`google_id`);

ALTER TABLE `users`
  MODIFY COLUMN `password_hash` VARCHAR(255) NULL;

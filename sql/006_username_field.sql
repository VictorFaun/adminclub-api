-- ============================================================================
-- 006: fusiona first_name + last_name en un solo campo de texto libre
-- `username` ("nombre de usuario") — la cuenta deja de duplicar el nombre real
-- de la persona, que en adelante vive en la ficha de miembro (fuera del
-- alcance de esta migración). El teléfono se mantiene en la cuenta (solo se
-- dejó de pedir en el alta desde el formulario, no se tocó en la BD).
-- ============================================================================

ALTER TABLE `users` ADD COLUMN `username` VARCHAR(160) NULL AFTER `uuid`;

UPDATE `users` SET `username` = TRIM(CONCAT(`first_name`, ' ', `last_name`));

ALTER TABLE `users` MODIFY COLUMN `username` VARCHAR(160) NOT NULL;

ALTER TABLE `users` DROP COLUMN `first_name`, DROP COLUMN `last_name`;

-- =============================================================================
-- 053 — Imágenes y archivos en la inscripción pública / autoregistro
-- =============================================================================
-- Los campos de tipo "imagen" y "archivos" funcionan igual que el resto: también se piden en el
-- formulario público (si están marcados para él) y pueden ser obligatorios. Lo que se sube con una
-- solicitud queda guardado en privado, asociado a la solicitud; al aceptarla pasa a la ficha del
-- miembro (imagen → valor del campo, archivos → member_documents) y al rechazarla se borra.

CREATE TABLE IF NOT EXISTS `member_application_files` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `application_id` BIGINT UNSIGNED NOT NULL,
  `field_id` BIGINT UNSIGNED NULL,
  `name` VARCHAR(160) NOT NULL,
  `file_path` VARCHAR(255) NOT NULL,
  `mime_type` VARCHAR(120) NOT NULL,
  `size_bytes` INT UNSIGNED NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY `idx_member_application_files_app` (`application_id`),
  CONSTRAINT `fk_member_application_files_app` FOREIGN KEY (`application_id`) REFERENCES `member_applications` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_member_application_files_field` FOREIGN KEY (`field_id`) REFERENCES `member_fields` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Antes las imágenes y archivos nunca iban en el formulario público; ahora siguen la misma regla
-- que los demás campos (por defecto, sí).
UPDATE `member_fields` SET `in_public_form` = 1 WHERE `field_type` IN ('image', 'file');

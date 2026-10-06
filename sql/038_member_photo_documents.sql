-- ============================================================================
-- 038: ficha de miembro — foto (usada en las plantillas de cumpleaños) y documentos adjuntos.
--  * members.photo_url: imagen pública (misma carpeta servida que avatares/logos).
--  * member_documents: archivos PRIVADOS (contratos, autorizaciones, cédula...) — se guardan
--    fuera de /uploads y solo se descargan por un endpoint autenticado que revalida el acceso al
--    miembro (ver members.service.js#getDocumentFile).
-- ============================================================================
USE `admin_club`;

ALTER TABLE `members`
  ADD COLUMN `photo_url` VARCHAR(255) NULL AFTER `birth_date`;

CREATE TABLE IF NOT EXISTS `member_documents` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `uuid` CHAR(36) NOT NULL,
  `club_id` BIGINT UNSIGNED NOT NULL,
  `member_id` BIGINT UNSIGNED NOT NULL,
  `name` VARCHAR(160) NOT NULL,
  `file_path` VARCHAR(255) NOT NULL,
  `mime_type` VARCHAR(100) NOT NULL,
  `size_bytes` INT UNSIGNED NOT NULL DEFAULT 0,
  `uploaded_by` BIGINT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY `uk_member_documents_uuid` (`uuid`),
  KEY `idx_member_documents_member` (`member_id`),
  CONSTRAINT `fk_member_documents_club` FOREIGN KEY (`club_id`) REFERENCES `clubs` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_member_documents_member` FOREIGN KEY (`member_id`) REFERENCES `members` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_member_documents_user` FOREIGN KEY (`uploaded_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

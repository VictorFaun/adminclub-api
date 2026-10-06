-- ============================================================================
-- 051: inscripción pública de miembros. Con un enlace público del club (/inscripcion/<código>)
-- cualquier persona llena su ficha sin cuenta; queda como SOLICITUD pendiente hasta que alguien
-- con permiso la acepta (se crea la ficha del miembro) o la rechaza. Se activa en
-- Configuración → Ficha (club_settings.public_member_form_enabled).
-- ============================================================================
USE `admin_club`;

CREATE TABLE IF NOT EXISTS `member_applications` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `uuid` CHAR(36) NOT NULL,
  `club_id` BIGINT UNSIGNED NOT NULL,
  `status` ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  `first_name` VARCHAR(100) NOT NULL,
  `middle_name` VARCHAR(100) NULL,
  `last_name` VARCHAR(100) NOT NULL,
  `second_last_name` VARCHAR(100) NULL,
  `email` VARCHAR(255) NULL,
  `phone` VARCHAR(30) NULL,
  `rut` VARCHAR(12) NULL,
  `birth_date` DATE NULL,
  `custom_fields` JSON NULL,
  `message` VARCHAR(500) NULL,
  `reviewed_by` BIGINT UNSIGNED NULL,
  `reviewed_at` DATETIME NULL,
  `review_note` VARCHAR(255) NULL,
  `member_id` BIGINT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY `uk_member_applications_uuid` (`uuid`),
  KEY `idx_member_applications_club_status` (`club_id`, `status`),
  KEY `idx_member_applications_rut` (`club_id`, `rut`),
  CONSTRAINT `fk_ma_club` FOREIGN KEY (`club_id`) REFERENCES `clubs` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_ma_reviewed_by` FOREIGN KEY (`reviewed_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_ma_member` FOREIGN KEY (`member_id`) REFERENCES `members` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

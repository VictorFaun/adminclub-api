-- =============================================================================
-- 068 — Consentimientos y documentos en la inscripción pública
-- =============================================================================
-- El club agrega al formulario público los "consentimientos" que quiera (uso de imagen, términos
-- y condiciones, protocolo de ingreso, reglamento...): cada uno con su título, un texto libre,
-- el texto de la casilla que se marca ("Acepto...") y PDFs adjuntos para leer o descargar. Se
-- pueden activar/desactivar y marcar como obligatorios (sin aceptarlos no se puede enviar).
-- Ver memberApplications.service.js (sección consentimientos).
USE `admin_club`;

CREATE TABLE IF NOT EXISTS `public_form_consents` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `club_id` BIGINT UNSIGNED NOT NULL,
  `title` VARCHAR(150) NOT NULL,
  `body` TEXT NULL,
  `checkbox_label` VARCHAR(300) NOT NULL,
  `is_required` TINYINT(1) NOT NULL DEFAULT 1,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `sort_order` INT NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY `idx_public_form_consents_club` (`club_id`, `sort_order`),
  CONSTRAINT `fk_pfc_club` FOREIGN KEY (`club_id`) REFERENCES `clubs` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- PDFs de cada consentimiento. Se guardan en private_uploads y se entregan por un endpoint que
-- revisa que el formulario y el consentimiento sigan activos (no quedan expuestos al desactivarlos).
CREATE TABLE IF NOT EXISTS `public_form_consent_files` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `consent_id` BIGINT UNSIGNED NOT NULL,
  `name` VARCHAR(160) NOT NULL,
  `file_path` VARCHAR(255) NOT NULL,
  `mime_type` VARCHAR(120) NOT NULL,
  `size_bytes` INT UNSIGNED NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY `idx_pfcf_consent` (`consent_id`),
  CONSTRAINT `fk_pfcf_consent` FOREIGN KEY (`consent_id`) REFERENCES `public_form_consents` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Respaldo de lo que aceptó (o no) cada solicitud: copia del texto y de los nombres de archivo
-- tal como estaban al enviar, aunque después el club los cambie o borre.
CREATE TABLE IF NOT EXISTS `member_application_consents` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `application_id` BIGINT UNSIGNED NOT NULL,
  `consent_id` BIGINT UNSIGNED NULL,
  `title` VARCHAR(150) NOT NULL,
  `body` TEXT NULL,
  `checkbox_label` VARCHAR(300) NOT NULL,
  `file_names` JSON NULL,
  `is_required` TINYINT(1) NOT NULL DEFAULT 1,
  `accepted` TINYINT(1) NOT NULL DEFAULT 0,
  `accepted_at` DATETIME NULL,
  `ip_address` VARCHAR(64) NULL,
  `user_agent` VARCHAR(255) NULL,
  KEY `idx_mac_application` (`application_id`),
  CONSTRAINT `fk_mac_application` FOREIGN KEY (`application_id`) REFERENCES `member_applications` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_mac_consent` FOREIGN KEY (`consent_id`) REFERENCES `public_form_consents` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

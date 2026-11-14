-- ============================================================================
-- 078: versiones de las fichas.
--
-- Una misma ficha se puede responder varias veces y cada respuesta queda guardada como una versión
-- (por ficha: cada ficha del miembro tiene su propio historial). La principal es siempre la última.
--
--  * member_form_versions: una fila por respuesta. La ÚLTIMA de cada (miembro, ficha) tiene
--    `snapshot` NULL: sus datos son los vigentes del miembro (member_field_values + documentos sin
--    archivar), así las correcciones de la ficha la actualizan sin más. Al llegar una respuesta
--    nueva, la que era la última se "congela" (se copia lo vigente de esa ficha en `snapshot`).
--    snapshot = {"values": {"<field_id>": "<valor>"}, "documents": {"<field_id>": [<document_id>, ...]}}
--  * member_documents.archived_at: documento que ya no está en la ficha vigente pero sigue
--    siendo parte de una versión anterior (no se lista en la ficha; se descarga desde la versión).
--  * DELETE_MEMBER_FORM_VERSIONS: eliminar versiones (siempre queda al menos una).
--
-- Cada ficha ya asignada parte con una versión (la vigente).
-- ============================================================================
USE `admin_club`;

CREATE TABLE IF NOT EXISTS `member_form_versions` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `member_id` BIGINT UNSIGNED NOT NULL,
  `form_id` BIGINT UNSIGNED NOT NULL,
  `snapshot` MEDIUMTEXT NULL,
  `source` VARCHAR(20) NOT NULL DEFAULT 'manual',
  `created_by` BIGINT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY `idx_mfv_member_form` (`member_id`, `form_id`, `id`),
  CONSTRAINT `fk_mfver_member` FOREIGN KEY (`member_id`) REFERENCES `members` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_mfver_form` FOREIGN KEY (`form_id`) REFERENCES `member_forms` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_mfver_user` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE `member_documents`
  ADD COLUMN `archived_at` DATETIME NULL AFTER `uploaded_by`;

INSERT INTO `member_form_versions` (`member_id`, `form_id`, `source`, `created_by`, `created_at`)
SELECT mfm.member_id, mfm.form_id, 'initial', m.created_by, LEAST(mfm.created_at, m.created_at)
FROM `member_form_members` mfm
INNER JOIN `members` m ON m.id = mfm.member_id
WHERE NOT EXISTS (SELECT 1 FROM `member_form_versions` v WHERE v.member_id = mfm.member_id AND v.form_id = mfm.form_id);

INSERT INTO `functions` (`code`, `name`, `description`, `category`, `is_club_assignable`) VALUES
  ('DELETE_MEMBER_FORM_VERSIONS', 'Eliminar versiones de fichas', 'Eliminar respuestas anteriores (o la última) de una ficha de un miembro; siempre queda al menos una', 'miembros', 1)
ON DUPLICATE KEY UPDATE `name` = VALUES(`name`), `description` = VALUES(`description`), `category` = VALUES(`category`), `is_club_assignable` = VALUES(`is_club_assignable`);

INSERT IGNORE INTO `role_functions` (`role_id`, `function_id`)
SELECT r.id, f.id FROM `roles` r CROSS JOIN `functions` f
WHERE r.club_id IS NOT NULL AND r.is_system = 1 AND r.name = 'Administrador'
  AND f.code = 'DELETE_MEMBER_FORM_VERSIONS';

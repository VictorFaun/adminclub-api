-- ============================================================================
-- 049: historial de pertenencia al club (retiros y reincorporaciones).
-- Cada fila es un período en que el miembro estuvo activo: `started_on` NULL = desde siempre
-- (antes de que existiera este historial), `ended_on` NULL = sigue activo. Un miembro activo
-- tiene exactamente un período abierto; uno inactivo, todos cerrados.
-- Con esto los cobros y la asistencia saben qué períodos le corresponden: un mes aplica si el
-- miembro estuvo activo en algún momento de ese mes (ver helpers/membership.js); el resto es
-- "no aplica — Retirado", y en los años en que no estuvo ni aparece.
-- ============================================================================
USE `admin_club`;

CREATE TABLE IF NOT EXISTS `member_memberships` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `member_id` BIGINT UNSIGNED NOT NULL,
  `started_on` DATE NULL,
  `ended_on` DATE NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY `idx_member_memberships_member` (`member_id`, `started_on`),
  CONSTRAINT `fk_member_memberships_member` FOREIGN KEY (`member_id`) REFERENCES `members` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Un período por miembro existente: activo = abierto; inactivo = cerrado en su fecha de baja.
INSERT INTO `member_memberships` (`member_id`, `started_on`, `ended_on`)
SELECT m.id, NULL, CASE WHEN m.status = 'inactive' THEN DATE(COALESCE(m.deactivated_at, m.updated_at)) ELSE NULL END
FROM `members` m
WHERE NOT EXISTS (SELECT 1 FROM `member_memberships` mm WHERE mm.member_id = m.id);

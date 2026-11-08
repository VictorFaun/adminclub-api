-- ============================================================================
-- 072: varias fichas por club, apoderados como miembros e invitaciones unificadas.
--
-- 1. Fichas (`member_forms`): un club puede pedir información distinta según el tipo de miembro
--    (ej. "Ficha de jugador", "Ficha de apoderado"). Los campos siguen siendo el catálogo del club
--    (`member_fields`, con sus usos especiales únicos por club) y cada ficha es una SELECCIÓN
--    ordenada de ellos (`member_form_fields`): un mismo campo (ej. Nombre o RUT) puede estar en
--    varias fichas y su valor se guarda una sola vez por miembro (`member_field_values`), así no se
--    duplican datos. `member_form_members`: qué fichas tiene que responder cada miembro.
--    `is_default`: se asigna sola a los miembros nuevos cuando no se indica otra.
--    Backfill: la ficha actual de cada club pasa a ser "Ficha de miembro" (por defecto) con todos
--    sus campos en el mismo orden, asignada a TODOS los miembros existentes.
--
-- 2. Apoderados: dejan de ser cuentas (`member_guardians.user_id`) y pasan a ser MIEMBROS
--    vinculados a otro miembro (`guardian_member_id`). La cuenta es opcional: la del apoderado se
--    vincula a su propio registro de miembro (members.user_id), como la de cualquier socio.
--    Backfill: si la cuenta apoderada ya tenía ficha en ese club se usa esa; si no, se le crea su
--    registro de miembro (vinculado a la cuenta, nombre y correo desde la cuenta, sin fichas
--    asignadas: el club le asigna después la que corresponda).
--
-- 3. Invitaciones: cada una configura por separado si exige CUENTA (`requires_account`) y qué
--    FICHAS pide (`invitation_forms`; `requires_member_profile` queda como "pide alguna ficha").
--    Las que exigen cuenta siguen funcionando como siempre (código en "Unirse a un club" o enlace).
--    Las que no, solo por su enlace público (`/inscripcion/<código>`), sin sesión: cada envío
--    consume un uso y queda como solicitud (`member_applications.invitation_id`).
--    Backfill: todas las existentes exigen cuenta; las que exigían ficha piden la ficha por
--    defecto. El enlace público del club (`/inscripcion/<código-del-club>`), si estaba activo, se
--    convierte en una invitación sin cuenta, ilimitada, que pide la ficha por defecto
--    (`club_settings.public_member_form_invitation_id`, así el enlace viejo sigue funcionando).
-- ============================================================================
USE `admin_club`;

-- ----------------------------------------------------------------------------
-- 1. Fichas
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `member_forms` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `uuid` CHAR(36) NOT NULL,
  `club_id` BIGINT UNSIGNED NOT NULL,
  `name` VARCHAR(100) NOT NULL,
  `description` VARCHAR(255) NULL,
  `is_default` TINYINT(1) NOT NULL DEFAULT 0,
  `sort_order` INT NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `uk_member_forms_uuid` (`uuid`),
  UNIQUE KEY `uk_member_forms_club_name` (`club_id`, `name`),
  CONSTRAINT `fk_member_forms_club` FOREIGN KEY (`club_id`) REFERENCES `clubs` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `member_form_fields` (
  `form_id` BIGINT UNSIGNED NOT NULL,
  `field_id` BIGINT UNSIGNED NOT NULL,
  `sort_order` INT NOT NULL DEFAULT 0,
  PRIMARY KEY (`form_id`, `field_id`),
  KEY `idx_mff_field` (`field_id`),
  CONSTRAINT `fk_mff_form` FOREIGN KEY (`form_id`) REFERENCES `member_forms` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_mff_field` FOREIGN KEY (`field_id`) REFERENCES `member_fields` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `member_form_members` (
  `form_id` BIGINT UNSIGNED NOT NULL,
  `member_id` BIGINT UNSIGNED NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`form_id`, `member_id`),
  KEY `idx_mfm_member` (`member_id`),
  CONSTRAINT `fk_mfm_form` FOREIGN KEY (`form_id`) REFERENCES `member_forms` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_mfm_member` FOREIGN KEY (`member_id`) REFERENCES `members` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- La ficha actual de cada club (también la de clubes sin campos todavía).
INSERT INTO `member_forms` (`uuid`, `club_id`, `name`, `is_default`, `sort_order`)
SELECT UUID(), c.id, 'Ficha de miembro', 1, 1
FROM `clubs` c
WHERE NOT EXISTS (SELECT 1 FROM `member_forms` f WHERE f.club_id = c.id);

-- Todos sus campos, en el mismo orden.
INSERT IGNORE INTO `member_form_fields` (`form_id`, `field_id`, `sort_order`)
SELECT f.id, mf.id, mf.sort_order
FROM `member_fields` mf
INNER JOIN `member_forms` f ON f.club_id = mf.club_id AND f.is_default = 1;

-- Asignada a todos los miembros existentes (también retirados y eliminados: conservan su historia).
INSERT IGNORE INTO `member_form_members` (`form_id`, `member_id`)
SELECT f.id, m.id
FROM `members` m
INNER JOIN `member_forms` f ON f.club_id = m.club_id AND f.is_default = 1;

-- ----------------------------------------------------------------------------
-- 2. Apoderados: miembro ↔ miembro
-- ----------------------------------------------------------------------------
ALTER TABLE `member_guardians` ADD COLUMN `guardian_member_id` BIGINT UNSIGNED NULL AFTER `member_id`;

-- Cuentas apoderadas que todavía no tienen registro de miembro en el club de la ficha a cargo.
DROP TEMPORARY TABLE IF EXISTS `tmp_guardian_accounts`;
CREATE TEMPORARY TABLE `tmp_guardian_accounts` AS
SELECT child.club_id, mg.user_id, MIN(mg.created_by) AS created_by
FROM `member_guardians` mg
INNER JOIN `members` child ON child.id = mg.member_id
LEFT JOIN `members` own ON own.club_id = child.club_id AND own.user_id = mg.user_id
WHERE own.id IS NULL
GROUP BY child.club_id, mg.user_id;

INSERT INTO `members` (`uuid`, `club_id`, `user_id`, `status`, `created_by`)
SELECT UUID(), t.club_id, t.user_id, 'active', t.created_by FROM `tmp_guardian_accounts` t;

-- Su historial de pertenencia (activos desde siempre, como un alta sin fecha de ingreso).
INSERT INTO `member_memberships` (`member_id`, `started_on`)
SELECT m.id, NULL
FROM `members` m
INNER JOIN `tmp_guardian_accounts` t ON t.club_id = m.club_id AND t.user_id = m.user_id
WHERE NOT EXISTS (SELECT 1 FROM `member_memberships` mm WHERE mm.member_id = m.id);

-- Nombre (primera palabra del nombre de la cuenta → nombre; el resto → apellido) y correo.
INSERT IGNORE INTO `member_field_values` (`member_id`, `field_id`, `value`)
SELECT m.id, f.id, SUBSTRING_INDEX(TRIM(u.username), ' ', 1)
FROM `members` m
INNER JOIN `tmp_guardian_accounts` t ON t.club_id = m.club_id AND t.user_id = m.user_id
INNER JOIN `users` u ON u.id = m.user_id
INNER JOIN `member_fields` f ON f.club_id = m.club_id AND f.role = 'first_name'
WHERE TRIM(u.username) <> '';

INSERT IGNORE INTO `member_field_values` (`member_id`, `field_id`, `value`)
SELECT m.id, f.id, TRIM(SUBSTRING(TRIM(u.username), LOCATE(' ', TRIM(u.username)) + 1))
FROM `members` m
INNER JOIN `tmp_guardian_accounts` t ON t.club_id = m.club_id AND t.user_id = m.user_id
INNER JOIN `users` u ON u.id = m.user_id
INNER JOIN `member_fields` f ON f.club_id = m.club_id AND f.role = 'last_name'
WHERE LOCATE(' ', TRIM(u.username)) > 0;

INSERT IGNORE INTO `member_field_values` (`member_id`, `field_id`, `value`)
SELECT m.id, f.id, u.email
FROM `members` m
INNER JOIN `tmp_guardian_accounts` t ON t.club_id = m.club_id AND t.user_id = m.user_id
INNER JOIN `users` u ON u.id = m.user_id
INNER JOIN `member_fields` f ON f.club_id = m.club_id AND f.role = 'email'
WHERE COALESCE(u.email, '') <> '';

DROP TEMPORARY TABLE IF EXISTS `tmp_guardian_accounts`;

-- Cada vínculo apunta ahora al registro de miembro de la cuenta apoderada.
UPDATE `member_guardians` mg
  INNER JOIN `members` child ON child.id = mg.member_id
  INNER JOIN `members` g ON g.club_id = child.club_id AND g.user_id = mg.user_id
  SET mg.guardian_member_id = g.id;

-- Sin registro (no debería quedar ninguno) o apoderado de sí mismo: el vínculo no tiene sentido.
DELETE FROM `member_guardians` WHERE `guardian_member_id` IS NULL OR `guardian_member_id` = `member_id`;

ALTER TABLE `member_guardians`
  MODIFY COLUMN `guardian_member_id` BIGINT UNSIGNED NOT NULL,
  ADD UNIQUE KEY `uk_member_guardian_member` (`member_id`, `guardian_member_id`),
  ADD KEY `idx_member_guardians_guardian` (`guardian_member_id`),
  ADD CONSTRAINT `fk_mg_guardian_member` FOREIGN KEY (`guardian_member_id`) REFERENCES `members` (`id`) ON DELETE CASCADE;

ALTER TABLE `member_guardians`
  DROP FOREIGN KEY `fk_mg_user`,
  DROP INDEX `uk_member_guardian`,
  DROP INDEX `idx_member_guardians_user`,
  DROP COLUMN `user_id`;

-- ----------------------------------------------------------------------------
-- 3. Invitaciones
-- ----------------------------------------------------------------------------
ALTER TABLE `invitations`
  ADD COLUMN `requires_account` TINYINT(1) NOT NULL DEFAULT 1 AFTER `default_role_id`;

CREATE TABLE IF NOT EXISTS `invitation_forms` (
  `invitation_id` BIGINT UNSIGNED NOT NULL,
  `form_id` BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (`invitation_id`, `form_id`),
  KEY `idx_invitation_forms_form` (`form_id`),
  CONSTRAINT `fk_if_invitation` FOREIGN KEY (`invitation_id`) REFERENCES `invitations` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_if_form` FOREIGN KEY (`form_id`) REFERENCES `member_forms` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Las que exigían ficha piden la ficha por defecto (la única que existía).
INSERT IGNORE INTO `invitation_forms` (`invitation_id`, `form_id`)
SELECT i.id, f.id
FROM `invitations` i
INNER JOIN `member_forms` f ON f.club_id = i.club_id AND f.is_default = 1
WHERE i.requires_member_profile = 1;

-- Un uso de una invitación sin cuenta lo hace una solicitud (formulario enviado), no una cuenta.
ALTER TABLE `invitation_uses` MODIFY COLUMN `user_id` BIGINT UNSIGNED NULL;

-- Qué fichas le quedan por completar a una cuenta que entró con una invitación que las pide.
ALTER TABLE `user_clubs` ADD COLUMN `pending_form_ids` LONGTEXT NULL AFTER `requires_profile_completion`;
UPDATE `user_clubs` uc
  INNER JOIN `member_forms` f ON f.club_id = uc.club_id AND f.is_default = 1
  SET uc.pending_form_ids = CONCAT('[', f.id, ']')
  WHERE uc.requires_profile_completion = 1;

-- Solicitudes: de qué invitación vienen, qué fichas responden y (si el identificador coincide con
-- un miembro existente) a qué registro se agregan al aceptarlas, en vez de crear uno duplicado.
ALTER TABLE `member_applications`
  ADD COLUMN `invitation_id` BIGINT UNSIGNED NULL AFTER `user_id`,
  ADD COLUMN `form_ids` LONGTEXT NULL AFTER `fields`,
  ADD COLUMN `target_member_id` BIGINT UNSIGNED NULL AFTER `member_id`,
  ADD CONSTRAINT `fk_ma_invitation` FOREIGN KEY (`invitation_id`) REFERENCES `invitations` (`id`) ON DELETE SET NULL,
  ADD CONSTRAINT `fk_ma_target_member` FOREIGN KEY (`target_member_id`) REFERENCES `members` (`id`) ON DELETE SET NULL;

UPDATE `member_applications` a
  INNER JOIN `member_forms` f ON f.club_id = a.club_id AND f.is_default = 1
  SET a.form_ids = CONCAT('[', f.id, ']')
  WHERE a.form_ids IS NULL;

-- Las de cuenta: la última invitación que usó esa cuenta en el club.
UPDATE `member_applications` a
  SET a.invitation_id = (
    SELECT iu.invitation_id FROM `invitation_uses` iu INNER JOIN `invitations` i ON i.id = iu.invitation_id
    WHERE iu.user_id = a.user_id AND i.club_id = a.club_id ORDER BY iu.used_at DESC LIMIT 1
  )
  WHERE a.user_id IS NOT NULL AND a.invitation_id IS NULL;

ALTER TABLE `invitation_uses`
  ADD COLUMN `application_id` BIGINT UNSIGNED NULL AFTER `user_id`,
  ADD CONSTRAINT `fk_invitation_uses_application` FOREIGN KEY (`application_id`) REFERENCES `member_applications` (`id`) ON DELETE SET NULL;

-- Enlace público del club (si estaba activo) → invitación sin cuenta, ilimitada, con la ficha por
-- defecto. Sus usos parten en las solicitudes públicas que ya recibió.
DROP TEMPORARY TABLE IF EXISTS `tmp_public_clubs`;
CREATE TEMPORARY TABLE `tmp_public_clubs` AS
SELECT c.id AS club_id,
       COALESCE(c.created_by, (SELECT MIN(uc.user_id) FROM `user_clubs` uc WHERE uc.club_id = c.id)) AS created_by,
       UPPER(LEFT(REPLACE(UUID(), '-', ''), 10)) AS code
FROM `clubs` c
INNER JOIN `club_settings` cs ON cs.club_id = c.id AND cs.setting_key = 'public_member_form_enabled' AND cs.setting_value = '1'
WHERE NOT EXISTS (SELECT 1 FROM `club_settings` x WHERE x.club_id = c.id AND x.setting_key = 'public_member_form_invitation_id');

INSERT INTO `invitations` (`uuid`, `club_id`, `code`, `created_by`, `max_uses`, `uses_count`, `expires_at`, `status`, `default_role_id`, `requires_account`, `requires_member_profile`, `note`)
SELECT UUID(), t.club_id, t.code, t.created_by, NULL,
       (SELECT COUNT(*) FROM `member_applications` a WHERE a.club_id = t.club_id AND a.user_id IS NULL),
       NULL, 'active', NULL, 0, 1, 'Enlace público de inscripción'
FROM `tmp_public_clubs` t
WHERE t.created_by IS NOT NULL;

INSERT IGNORE INTO `invitation_forms` (`invitation_id`, `form_id`)
SELECT i.id, f.id
FROM `tmp_public_clubs` t
INNER JOIN `invitations` i ON i.code = t.code
INNER JOIN `member_forms` f ON f.club_id = t.club_id AND f.is_default = 1;

INSERT INTO `club_settings` (`club_id`, `setting_key`, `setting_value`)
SELECT t.club_id, 'public_member_form_invitation_id', i.id
FROM `tmp_public_clubs` t INNER JOIN `invitations` i ON i.code = t.code;

-- Las solicitudes públicas ya recibidas quedan asociadas a esa invitación.
UPDATE `member_applications` a
  INNER JOIN `club_settings` cs ON cs.club_id = a.club_id AND cs.setting_key = 'public_member_form_invitation_id'
  SET a.invitation_id = cs.setting_value
  WHERE a.user_id IS NULL AND a.invitation_id IS NULL;

DROP TEMPORARY TABLE IF EXISTS `tmp_public_clubs`;

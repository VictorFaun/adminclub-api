-- ============================================================================
-- 082: inscripción con apoderado.
--
-- Una invitación que pide fichas puede pedir además "fichas para apoderado" (en su form_settings:
-- `guardian: { enabled, formIds }`): quien responde completa también los datos de OTRA persona,
-- que queda como un miembro aparte y apoderado del primero.
-- Esos datos son una segunda solicitud enlazada a la principal (`guardian_of_id`), con sus
-- propias fichas y archivos. Se revisan en conjunto: aceptar o rechazar la principal aplica a
-- ambas (la observación es una sola). `guardian_relation`: parentesco (ej. Madre), opcional.
-- ============================================================================
USE `admin_club`;

ALTER TABLE `member_applications`
  ADD COLUMN `guardian_of_id` BIGINT UNSIGNED NULL AFTER `target_member_id`,
  ADD COLUMN `guardian_relation` VARCHAR(40) NULL AFTER `guardian_of_id`,
  ADD KEY `idx_ma_guardian_of` (`guardian_of_id`),
  ADD CONSTRAINT `fk_ma_guardian_of` FOREIGN KEY (`guardian_of_id`) REFERENCES `member_applications` (`id`) ON DELETE CASCADE;

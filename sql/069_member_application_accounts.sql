-- ============================================================================
-- 069: la ficha que exige un código de invitación pasa por revisión.
--  * Antes, al completar la ficha (POST /members/me) se creaba el miembro al instante. Ahora queda
--    como SOLICITUD (member_applications) ligada a la cuenta (`user_id`) y aparece junto a las del
--    formulario público, marcada como "con cuenta". Mientras esté pendiente (o rechazada), la
--    membresía sigue con `user_clubs.requires_profile_completion = 1` y no puede hacer nada en el
--    club; al aceptarla se crea la ficha vinculada a la cuenta y se libera.
--  * Rechazada: el motivo (review_note) es obligatorio y se le muestra a la persona, que corrige
--    y reenvía (nueva solicitud, con los datos anteriores precargados). Los archivos de una
--    solicitud con cuenta rechazada NO se borran: se reutilizan si no sube otros.
-- ============================================================================
USE `admin_club`;

ALTER TABLE `member_applications`
  ADD COLUMN `user_id` BIGINT UNSIGNED NULL AFTER `club_id`,
  ADD KEY `idx_member_applications_user` (`club_id`, `user_id`, `status`),
  ADD CONSTRAINT `fk_ma_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE;

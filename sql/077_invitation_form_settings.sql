-- ============================================================================
-- 077: opciones del formulario público POR INVITACIÓN.
--
-- Lo que se pregunta en el enlace público de una invitación sin cuenta (mensaje para el club,
-- categoría a la que postula y qué consentimientos se piden) pasa de ser una opción del club
-- (Configuración de fichas) a elegirse en cada invitación, junto con sus fichas.
-- JSON: { "askMessage": bool, "groups": { "mode": "off|optional|required", "groupIds": [..] },
--         "consentIds": [..] }.
-- NULL = invitación anterior a este cambio: sigue usando las opciones que tenía el club
-- (public_member_form_ask_message, public_member_form_groups y todos los consentimientos
-- activos), así nada cambia hasta que alguien la edite. Ver invitationFormSettings.service.js.
-- ============================================================================
USE `admin_club`;

ALTER TABLE `invitations`
  ADD COLUMN `form_settings` TEXT NULL AFTER `note`;

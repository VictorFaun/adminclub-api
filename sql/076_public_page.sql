-- ============================================================================
-- 076: página pública del club (antes "página pública de pagos").
--
-- La web pública (`/pay/<código-del-club>`, la persona se identifica con su RUT) deja de ser solo
-- de Tesorería: un interruptor general (`public_page_enabled`) y secciones que se activan por
-- separado, cada una en su pestaña:
--   * Tesorería  → `public_payments_enabled` (la clave de siempre: lo que debe y enviar comprobantes)
--   * Asistencia → `public_payments_show_attendance` (la de siempre; ya no depende de Tesorería)
--   * Fichas     → `public_page_form_ids` (JSON con las fichas que se muestran, una pestaña cada una)
-- Configuración → pestaña «Página pública».
--
-- Para que nada cambie al desplegar: los clubes que ya tenían la página de pagos activa quedan con
-- el interruptor general encendido.
-- ============================================================================
USE `admin_club`;

INSERT INTO `club_settings` (`club_id`, `setting_key`, `setting_value`)
SELECT cs.club_id, 'public_page_enabled', '1'
FROM `club_settings` cs
WHERE cs.setting_key = 'public_payments_enabled' AND cs.setting_value = '1'
  AND NOT EXISTS (SELECT 1 FROM `club_settings` x WHERE x.club_id = cs.club_id AND x.setting_key = 'public_page_enabled');

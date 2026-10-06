-- =============================================================================
-- 054 — Ajustes por campo de la ficha
-- =============================================================================
-- `settings` (JSON) guarda la configuración propia de cada tipo:
--   imagen    → { "aspect": "1:1" | "4:5" | "9:16" | "16:9" }   (proporción del recorte)
--   documento → { "formats": ["pdf","image","word","excel"], "multiple": true|false }

ALTER TABLE `member_fields` ADD COLUMN `settings` LONGTEXT NULL AFTER `options`;

-- La foto (uso especial) conserva la proporción de las plantillas de cumpleaños (historia 9:16).
UPDATE `member_fields` SET `settings` = '{"aspect":"9:16"}' WHERE `field_type` = 'image' AND `role` = 'photo';
UPDATE `member_fields` SET `settings` = '{"aspect":"1:1"}' WHERE `field_type` = 'image' AND (`role` IS NULL OR `role` <> 'photo');
-- Los campos de archivos existentes siguen aceptando lo mismo que antes, varios por campo.
UPDATE `member_fields` SET `settings` = '{"formats":["pdf","image","word"],"multiple":true}' WHERE `field_type` = 'file';

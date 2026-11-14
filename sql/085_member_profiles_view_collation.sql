-- ============================================================================
-- 085: vista member_profiles sin mezclar colaciones (arregla la de sql/083 y 084).
--
-- La de 083 (y la de 084, que solo cambió cómo se ubica la ficha del Identificador) elegía el
-- dato de la ficha que corresponde concatenando una clave de prioridad con el valor
-- (CONCAT + MIN + SUBSTRING). En MySQL 8 eso falla: «Illegal mix of collations
-- (utf8mb4_bin,NONE) ... for operation 'min'» (1267), así que la vista no se podía leer (ni
-- respaldar con mysqldump). En MariaDB sí funcionaba.
--
-- Ahora la prioridad se calcula con ROW_NUMBER() (números, no texto) y se toma el valor tal cual,
-- como hacía la vista original. Misma regla que en 083: primero un valor no vacío, de una ficha
-- que el miembro responde, la del Identificador, y después el orden de las fichas. Nombres e
-- Identificador van una sola vez en el club: se leen igual que antes (MAX del valor).
-- ============================================================================

CREATE OR REPLACE VIEW `member_profiles` AS
SELECT m.id AS member_id,
       MAX(CASE WHEN r.role = 'first_name' THEN r.value END) AS first_name,
       MAX(CASE WHEN r.role = 'middle_name' THEN r.value END) AS middle_name,
       MAX(CASE WHEN r.role = 'last_name' THEN r.value END) AS last_name,
       MAX(CASE WHEN r.role = 'second_last_name' THEN r.value END) AS second_last_name,
       MAX(CASE WHEN r.role = 'identifier' THEN r.value END) AS rut,
       MAX(CASE WHEN r.role = 'email' AND r.rn = 1 THEN r.value END) AS email,
       MAX(CASE WHEN r.role = 'phone' AND r.rn = 1 THEN r.value END) AS phone,
       CAST(MAX(CASE WHEN r.role = 'birth_date' AND r.rn = 1 THEN r.value END) AS DATE) AS birth_date,
       MAX(CASE WHEN r.role = 'birthday_photo' AND r.rn = 1 THEN r.value END) AS birthday_photo_url,
       MAX(CASE WHEN r.role = 'avatar' AND r.rn = 1 THEN r.value END) AS avatar_url
FROM `members` m
LEFT JOIN (
  SELECT v.member_id,
         f.role,
         v.value,
         ROW_NUMBER() OVER (
           PARTITION BY v.member_id, f.role
           ORDER BY (v.value IS NULL OR v.value = ''),
                    (mfm.member_id IS NULL),
                    (idff.form_id IS NULL),
                    COALESCE(fm.sort_order, 999999),
                    COALESCE(fm.id, 0),
                    f.id
         ) AS rn
  FROM `member_field_values` v
  INNER JOIN `member_fields` f ON f.id = v.field_id AND f.role IS NOT NULL
  -- Ficha del campo (una sola, uk_mff_field) y si el miembro la responde.
  LEFT JOIN `member_form_fields` mff ON mff.field_id = f.id
  LEFT JOIN `member_forms` fm ON fm.id = mff.form_id
  LEFT JOIN `member_form_members` mfm ON mfm.form_id = mff.form_id AND mfm.member_id = v.member_id
  -- ¿Esa ficha es la del Identificador? (uno por club; su campo está en una sola ficha)
  LEFT JOIN `member_fields` idf ON idf.club_id = f.club_id AND idf.role = 'identifier'
  LEFT JOIN `member_form_fields` idff ON idff.field_id = idf.id AND idff.form_id = mff.form_id
) r ON r.member_id = m.id
GROUP BY m.id;

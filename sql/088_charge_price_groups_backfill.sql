-- 088: Grupos que en la práctica eran "precio especial" pasan a serlo (ver 087).
--
-- Antes de 087, la única forma de dar un precio distinto (ej. Directiva, Estudiantes) era apuntar
-- ese grupo al cobro, lo que además AGREGABA al cobro a cualquiera que entrara a ese grupo (ej. una
-- dama del TC Damas que entra a Directiva quedaba cobrada en la mensualidad de varones).
--
-- Se marca `price_only = 1` un grupo apuntado a un cobro cuando:
--  - tiene miembros, y TODOS están también en otro grupo (más grande) al que se le cobra en ese mismo
--    cobro — o sea, hoy no le agrega a nadie: solo cambia el monto de quienes ya están por el otro;
--  - y no tiene un responsable asignado a ese grupo en el cobro (un responsable va con un grupo al
--    que se le cobra).
-- Con los miembros de hoy, lo que se cobra y a quién no cambia; solo deja de agregar gente nueva.
--
-- Se calcula primero en una tabla temporal: MySQL 8 no permite un UPDATE de charge_target_groups
-- con una subconsulta sobre la misma tabla (error 1093, "can't specify target table for update").
DROP TEMPORARY TABLE IF EXISTS tmp_088_price_only;

CREATE TEMPORARY TABLE tmp_088_price_only (charge_id BIGINT NOT NULL, group_id BIGINT NOT NULL);

INSERT INTO tmp_088_price_only (charge_id, group_id)
SELECT a.charge_id, a.group_id
FROM charge_target_groups a
WHERE a.price_only = 0
  AND EXISTS (SELECT 1 FROM member_group_members x WHERE x.group_id = a.group_id)
  AND NOT EXISTS (SELECT 1 FROM charge_responsible_members r WHERE r.charge_id = a.charge_id AND r.group_id = a.group_id)
  AND EXISTS (
    SELECT 1 FROM charge_target_groups b
    WHERE b.charge_id = a.charge_id AND b.group_id <> a.group_id AND b.price_only = 0
      AND NOT EXISTS (
        SELECT 1 FROM member_group_members x
        WHERE x.group_id = a.group_id
          AND NOT EXISTS (SELECT 1 FROM member_group_members y WHERE y.group_id = b.group_id AND y.member_id = x.member_id)
      )
      AND (SELECT COUNT(*) FROM member_group_members y WHERE y.group_id = b.group_id)
        > (SELECT COUNT(*) FROM member_group_members x WHERE x.group_id = a.group_id)
  );

UPDATE charge_target_groups t
INNER JOIN tmp_088_price_only c ON c.charge_id = t.charge_id AND c.group_id = t.group_id
SET t.price_only = 1;

DROP TEMPORARY TABLE IF EXISTS tmp_088_price_only;

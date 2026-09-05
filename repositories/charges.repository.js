const { pool } = require('../config/database');
const BaseRepository = require('./BaseRepository');

class ChargesRepository extends BaseRepository {
  constructor() {
    super('charges', 'id');
  }

  /** `responsible_member_name`: `CONCAT_WS` salta los `NULL` (middle_name/second_last_name
   * opcionales), pero si TODOS los argumentos son `NULL` (sin responsable, el LEFT JOIN no
   * encontró fila) devuelve `''` en vez de `NULL` — de ahí el `NULLIF(..., '')` envolvente, para
   * que el service pueda distinguir "sin responsable" con un simple `?? null` en JS. Mismo
   * patrón que arma el nombre completo en el resto del código, pero resuelto en la misma
   * consulta en vez de un segundo viaje a la BD. */
  async findActiveById(id, conn = pool) {
    const [rows] = await conn.query(
      `SELECT c.*, NULLIF(CONCAT_WS(' ', rm.first_name, rm.middle_name, rm.last_name, rm.second_last_name), '') AS responsible_member_name
       FROM charges c
       LEFT JOIN members rm ON rm.id = c.responsible_member_id
       WHERE c.id = ? AND c.deleted_at IS NULL LIMIT 1`,
      [id]
    );
    return rows[0] || null;
  }

  /** Solo cobros NO archivados — un cobro archivado no debe generar ruido en la vista "Cobros" ni
   * en los tabs de "Pagos" (ver charges.service.js#listArchivedForClub para la vista contraria). */
  async findByClub(clubId, conn = pool) {
    const [rows] = await conn.query(
      `SELECT c.*, NULLIF(CONCAT_WS(' ', rm.first_name, rm.middle_name, rm.last_name, rm.second_last_name), '') AS responsible_member_name
       FROM charges c
       LEFT JOIN members rm ON rm.id = c.responsible_member_id
       WHERE c.club_id = ? AND c.deleted_at IS NULL AND c.archived_at IS NULL ORDER BY c.name ASC`,
      [clubId]
    );
    return rows;
  }

  /** Cobros de los que ESTE miembro es responsable — usado cuando el actor no tiene VIEW_CHARGES
   * pero su ficha vinculada (`members.user_id`) es responsable de al menos un cobro (ver
   * charges.service.js#listForClub/actorHasAnyResponsibleCharge). Mismos filtros que findByClub
   * (nunca archivados/eliminados). */
  async findByClubResponsibleMember(clubId, memberId, conn = pool) {
    const [rows] = await conn.query(
      `SELECT c.*, NULLIF(CONCAT_WS(' ', rm.first_name, rm.middle_name, rm.last_name, rm.second_last_name), '') AS responsible_member_name
       FROM charges c
       LEFT JOIN members rm ON rm.id = c.responsible_member_id
       WHERE c.club_id = ? AND c.responsible_member_id = ? AND c.deleted_at IS NULL AND c.archived_at IS NULL ORDER BY c.name ASC`,
      [clubId, memberId]
    );
    return rows;
  }

  /** Chequeo de existencia liviano — ¿hay AL MENOS un cobro (no archivado/eliminado) del que este
   * miembro sea responsable? Usado por el guard de rutas para decidir si vale la pena dejar pasar
   * a alguien sin VIEW_CHARGES/VIEW_PAYMENTS(_SCOPED) (ver permission.middleware.js). */
  async existsResponsibleMember(clubId, memberId, conn = pool) {
    const [rows] = await conn.query(
      'SELECT 1 FROM charges WHERE club_id = ? AND responsible_member_id = ? AND deleted_at IS NULL AND archived_at IS NULL LIMIT 1',
      [clubId, memberId]
    );
    return rows.length > 0;
  }

  /** La vista "Cobros archivados" — orden por fecha de archivado, el más reciente primero. */
  async findArchivedByClub(clubId, conn = pool) {
    const [rows] = await conn.query(
      `SELECT c.*, NULLIF(CONCAT_WS(' ', rm.first_name, rm.middle_name, rm.last_name, rm.second_last_name), '') AS responsible_member_name
       FROM charges c
       LEFT JOIN members rm ON rm.id = c.responsible_member_id
       WHERE c.club_id = ? AND c.deleted_at IS NULL AND c.archived_at IS NOT NULL ORDER BY c.archived_at DESC`,
      [clubId]
    );
    return rows;
  }

  /** Solo cobros activos Y no archivados — la generación de instancias
   * (chargeInstances.service.js) nunca debe mirar cobros inactivos/eliminados/archivados. */
  async findActiveByClubForGeneration(clubId, conn = pool) {
    const [rows] = await conn.query(
      "SELECT * FROM charges WHERE club_id = ? AND status = 'active' AND deleted_at IS NULL AND archived_at IS NULL",
      [clubId]
    );
    return rows;
  }

  async countActiveByClub(clubId, conn = pool) {
    const [rows] = await conn.query(
      "SELECT COUNT(*) AS total FROM charges WHERE club_id = ? AND status = 'active' AND deleted_at IS NULL AND archived_at IS NULL",
      [clubId]
    );
    return rows[0].total;
  }

  async findAllActiveForGeneration(conn = pool) {
    const [rows] = await conn.query("SELECT * FROM charges WHERE status = 'active' AND deleted_at IS NULL AND archived_at IS NULL");
    return rows;
  }

  async archive(id, conn = pool) {
    await conn.query('UPDATE charges SET archived_at = NOW() WHERE id = ?', [id]);
  }

  async restore(id, conn = pool) {
    await conn.query('UPDATE charges SET archived_at = NULL WHERE id = ?', [id]);
  }

  async createCharge(data, conn = pool) {
    const [result] = await conn.query(
      `INSERT INTO charges
        (uuid, club_id, name, description, color, amount, recurrence, start_date, due_day, due_month, end_date, status, purpose, responsible_member_id, created_by)
       VALUES (UUID(), :clubId, :name, :description, :color, :amount, :recurrence, :startDate, :dueDay, :dueMonth, :endDate, :status, :purpose, :responsibleMemberId, :createdBy)`,
      data
    );
    return result.insertId;
  }

  async softDelete(id, conn = pool) {
    await conn.query('UPDATE charges SET deleted_at = NOW() WHERE id = ?', [id]);
  }

  // --- Targets (miembros / grupos / etiquetas / exclusiones), cada uno con SU propio monto ---
  // (grupos y etiquetas además llevan `position`: el orden en que el admin los dejó en el
  // formulario, usado para desempatar cuando un miembro califica para varios del mismo nivel —
  // ver resolveAmounts).

  async getTargetMembers(chargeId, conn = pool) {
    const [rows] = await conn.query('SELECT member_id, amount FROM charge_target_members WHERE charge_id = ?', [chargeId]);
    return rows.map((r) => ({ memberId: r.member_id, amount: Number(r.amount) }));
  }

  async getTargetGroups(chargeId, conn = pool) {
    const [rows] = await conn.query(
      'SELECT group_id, amount, position FROM charge_target_groups WHERE charge_id = ? ORDER BY position ASC',
      [chargeId]
    );
    return rows.map((r) => ({ groupId: r.group_id, amount: Number(r.amount), position: r.position }));
  }

  async getTargetTags(chargeId, conn = pool) {
    const [rows] = await conn.query(
      'SELECT tag_id, amount, position FROM charge_target_tags WHERE charge_id = ? ORDER BY position ASC',
      [chargeId]
    );
    return rows.map((r) => ({ tagId: r.tag_id, amount: Number(r.amount), position: r.position }));
  }

  async getExclusionMemberIds(chargeId, conn = pool) {
    const [rows] = await conn.query('SELECT member_id FROM charge_target_exclusions WHERE charge_id = ?', [chargeId]);
    return rows.map((r) => r.member_id);
  }

  /** `targets`: `[{memberId, amount}]`. */
  async setTargetMembers(chargeId, targets, conn = pool) {
    await conn.query('DELETE FROM charge_target_members WHERE charge_id = ?', [chargeId]);
    if (targets.length) {
      await conn.query('INSERT INTO charge_target_members (charge_id, member_id, amount) VALUES ?', [
        targets.map((t) => [chargeId, t.memberId, t.amount]),
      ]);
    }
  }

  /** `targets`: `[{groupId, amount}]` — `position` se asigna acá según el orden del array (el
   * orden en que llegan ya es el orden final que el admin dejó con las flechas subir/bajar). */
  async setTargetGroups(chargeId, targets, conn = pool) {
    await conn.query('DELETE FROM charge_target_groups WHERE charge_id = ?', [chargeId]);
    if (targets.length) {
      await conn.query('INSERT INTO charge_target_groups (charge_id, group_id, amount, position) VALUES ?', [
        targets.map((t, i) => [chargeId, t.groupId, t.amount, i]),
      ]);
    }
  }

  /** `targets`: `[{tagId, amount}]` — mismo criterio de `position` que setTargetGroups. */
  async setTargetTags(chargeId, targets, conn = pool) {
    await conn.query('DELETE FROM charge_target_tags WHERE charge_id = ?', [chargeId]);
    if (targets.length) {
      await conn.query('INSERT INTO charge_target_tags (charge_id, tag_id, amount, position) VALUES ?', [
        targets.map((t, i) => [chargeId, t.tagId, t.amount, i]),
      ]);
    }
  }

  async setExclusions(chargeId, memberIds, conn = pool) {
    await conn.query('DELETE FROM charge_target_exclusions WHERE charge_id = ?', [chargeId]);
    if (memberIds.length) {
      await conn.query('INSERT INTO charge_target_exclusions (charge_id, member_id) VALUES ?', [
        memberIds.map((memberId) => [chargeId, memberId]),
      ]);
    }
  }

  /** Monto efectivo por miembro para este cobro: default del cobro < grupo < etiqueta < miembro
   * específico — cada nivel más específico pisa por completo al anterior (aunque el monto sea
   * MENOR, ej. una etiqueta puede ser un descuento frente al grupo). Empate dentro de un mismo
   * nivel (un miembro que califica para 2+ grupos/etiquetas apuntados con montos distintos) lo
   * resuelve el orden: `groupRows`/`tagRows` ya vienen ordenados por `position` ASC, así que
   * quedarse con la PRIMERA fila vista por miembro (ver `seenGroup`/`seenTag`) equivale a "gana
   * el primero de la lista", sin necesitar un GROUP BY/MIN en SQL. */
  async resolveAmounts(chargeId, memberIds, defaultAmount, conn = pool) {
    const result = new Map(memberIds.map((id) => [id, Number(defaultAmount)]));
    if (!memberIds.length) return result;

    const [groupRows] = await conn.query(
      `SELECT mgm.member_id, ctg.amount FROM charge_target_groups ctg
       INNER JOIN member_group_members mgm ON mgm.group_id = ctg.group_id
       WHERE ctg.charge_id = ? AND mgm.member_id IN (?) ORDER BY ctg.position ASC`,
      [chargeId, memberIds]
    );
    const seenGroup = new Set();
    for (const row of groupRows) {
      if (seenGroup.has(row.member_id)) continue;
      seenGroup.add(row.member_id);
      result.set(row.member_id, Number(row.amount));
    }

    const [tagRows] = await conn.query(
      `SELECT mtm.member_id, ctt.amount FROM charge_target_tags ctt
       INNER JOIN member_tag_members mtm ON mtm.tag_id = ctt.tag_id
       WHERE ctt.charge_id = ? AND mtm.member_id IN (?) ORDER BY ctt.position ASC`,
      [chargeId, memberIds]
    );
    const seenTag = new Set();
    for (const row of tagRows) {
      if (seenTag.has(row.member_id)) continue;
      seenTag.add(row.member_id);
      result.set(row.member_id, Number(row.amount));
    }

    const [memberRows] = await conn.query(
      'SELECT member_id, amount FROM charge_target_members WHERE charge_id = ? AND member_id IN (?)',
      [chargeId, memberIds]
    );
    for (const row of memberRows) result.set(row.member_id, Number(row.amount));

    return result;
  }

  /** Miembros ACTIVOS (con ficha, no eliminados) a quienes aplica hoy este cobro: unión de
   * miembros puntuales + miembros de los grupos apuntados, menos las exclusiones. Es la lista
   * que usa chargeInstances.service.js para generar/actualizar períodos — se recalcula en cada
   * corrida (no se guarda), así que un miembro agregado a un grupo apuntado empieza a
   * generársele desde la próxima corrida sin ningún paso manual. */
  async expandTargetMemberIds(chargeId, conn = pool) {
    const [rows] = await conn.query(
      `SELECT DISTINCT m.id FROM members m
       WHERE m.deleted_at IS NULL AND m.id IN (
         SELECT member_id FROM charge_target_members WHERE charge_id = ?
         UNION
         SELECT mgm.member_id FROM charge_target_groups ctg
           INNER JOIN member_group_members mgm ON mgm.group_id = ctg.group_id
           WHERE ctg.charge_id = ?
       )
       AND m.id NOT IN (SELECT member_id FROM charge_target_exclusions WHERE charge_id = ?)`,
      [chargeId, chargeId, chargeId]
    );
    return rows.map((r) => r.id);
  }
}

module.exports = new ChargesRepository();

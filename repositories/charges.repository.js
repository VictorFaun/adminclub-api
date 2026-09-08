const { pool } = require('../config/database');
const BaseRepository = require('./BaseRepository');

class ChargesRepository extends BaseRepository {
  constructor() {
    super('charges', 'id');
  }

  async findActiveById(id, conn = pool) {
    const [rows] = await conn.query('SELECT * FROM charges WHERE id = ? AND deleted_at IS NULL LIMIT 1', [id]);
    return rows[0] || null;
  }

  /** Solo cobros NO archivados — un cobro archivado no debe generar ruido en la vista "Cobros" ni
   * en los tabs de "Pagos" (ver charges.service.js#listArchivedForClub para la vista contraria). */
  async findByClub(clubId, { sortBy = 'name', sortOrder = 'ASC' } = {}, conn = pool) {
    const [rows] = await conn.query(
      `SELECT * FROM charges WHERE club_id = ? AND deleted_at IS NULL AND archived_at IS NULL ORDER BY ${sortBy} ${sortOrder}`,
      [clubId]
    );
    return rows;
  }

  /** Cobros de los que ESTE miembro es responsable (de lo que sea, cualquier grupo) — usado
   * cuando el actor no tiene VIEW_CHARGES pero su ficha vinculada (`members.user_id`) figura como
   * responsable de al menos un cobro (ver charges.service.js#listForClub/actorHasAnyResponsibleCharge).
   * Mismos filtros que findByClub (nunca archivados/eliminados). */
  async findByClubResponsibleMember(clubId, memberId, { sortBy = 'name', sortOrder = 'ASC' } = {}, conn = pool) {
    const [rows] = await conn.query(
      `SELECT DISTINCT c.* FROM charges c
       INNER JOIN charge_responsible_members crm ON crm.charge_id = c.id
       WHERE c.club_id = ? AND crm.member_id = ? AND c.deleted_at IS NULL AND c.archived_at IS NULL ORDER BY c.${sortBy} ${sortOrder}`,
      [clubId, memberId]
    );
    return rows;
  }

  /** Chequeo de existencia liviano — ¿hay AL MENOS un cobro (no archivado/eliminado) del que este
   * miembro sea responsable de lo que sea? Usado por el guard de rutas para decidir si vale la
   * pena dejar pasar a alguien sin VIEW_CHARGES/VIEW_PAYMENTS(_SCOPED) (ver permission.middleware.js). */
  async existsResponsibleMember(clubId, memberId, conn = pool) {
    const [rows] = await conn.query(
      `SELECT 1 FROM charges c
       INNER JOIN charge_responsible_members crm ON crm.charge_id = c.id
       WHERE c.club_id = ? AND crm.member_id = ? AND c.deleted_at IS NULL AND c.archived_at IS NULL LIMIT 1`,
      [clubId, memberId]
    );
    return rows.length > 0;
  }

  /** La vista "Cobros archivados" — orden por fecha de archivado, el más reciente primero. */
  async findArchivedByClub(clubId, { sortBy = 'archived_at', sortOrder = 'DESC' } = {}, conn = pool) {
    const [rows] = await conn.query(
      `SELECT * FROM charges WHERE club_id = ? AND deleted_at IS NULL AND archived_at IS NOT NULL ORDER BY ${sortBy} ${sortOrder}`,
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
        (uuid, club_id, name, description, color, amount, recurrence, start_date, due_day, due_month, end_date, status, purpose, created_by)
       VALUES (UUID(), :clubId, :name, :description, :color, :amount, :recurrence, :startDate, :dueDay, :dueMonth, :endDate, :status, :purpose, :createdBy)`,
      data
    );
    return result.insertId;
  }

  async softDelete(id, conn = pool) {
    await conn.query('UPDATE charges SET deleted_at = NOW() WHERE id = ?', [id]);
  }

  // --- Targets (miembros / grupos / exclusiones), cada uno con SU propio monto ---
  // (grupos además llevan `position`: el orden en que el admin los dejó en el formulario, usado
  // para desempatar cuando un miembro califica para varios grupos apuntados — ver resolveAmounts).

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

  async setExclusions(chargeId, memberIds, conn = pool) {
    await conn.query('DELETE FROM charge_target_exclusions WHERE charge_id = ?', [chargeId]);
    if (memberIds.length) {
      await conn.query('INSERT INTO charge_target_exclusions (charge_id, member_id) VALUES ?', [
        memberIds.map((memberId) => [chargeId, memberId]),
      ]);
    }
  }

  // --- Responsables (varios por cobro, cada uno opcionalmente vinculado a un grupo) ---
  // Mismo patrón que los targets de arriba: `position` = orden en que el admin dejó las filas en
  // el formulario (reordenable con flechas), usado para desempatar cuando un miembro pertenece a
  // 2+ grupos con responsable propio — ver resolveResponsibles.

  /** Nombre CORTO ("primer nombre + primer apellido", `first_name` + `last_name`) — a propósito
   * distinto del nombre completo que usa el resto de la app: esta lista se muestra en contextos
   * apretados (picker de responsables, badges de "pagado a"), ver payments.service.js. */
  async getResponsibleMembers(chargeId, conn = pool) {
    const [rows] = await conn.query(
      `SELECT crm.member_id, crm.group_id, crm.position,
              NULLIF(CONCAT_WS(' ', m.first_name, m.last_name), '') AS member_name,
              mg.name AS group_name
       FROM charge_responsible_members crm
       INNER JOIN members m ON m.id = crm.member_id
       LEFT JOIN member_groups mg ON mg.id = crm.group_id
       WHERE crm.charge_id = ? ORDER BY crm.position ASC`,
      [chargeId]
    );
    return rows.map((r) => ({ memberId: r.member_id, memberName: r.member_name, groupId: r.group_id, groupName: r.group_name, position: r.position }));
  }

  /** `targets`: `[{memberId, groupId}]` (`groupId` puede ser `null` = "todos los grupos"). */
  async setResponsibleMembers(chargeId, targets, conn = pool) {
    await conn.query('DELETE FROM charge_responsible_members WHERE charge_id = ?', [chargeId]);
    if (targets.length) {
      await conn.query('INSERT INTO charge_responsible_members (charge_id, member_id, group_id, position) VALUES ?', [
        targets.map((t, i) => [chargeId, t.memberId, t.groupId ?? null, i]),
      ]);
    }
  }

  /** ¿Esta persona figura como responsable de ALGO en este cobro (cualquier grupo, o "todos los
   * grupos")? Chequeo grueso de autorización — la barrera fina (de QUÉ miembros puntuales, según
   * su grupo) la hace `resolveResponsibles`. Separado de ese, porque un responsable sin ningún
   * miembro que hoy resuelva a él (ej. su grupo quedó vacío) igual debe poder entrar y ver una
   * lista vacía, no un 403 — mismo criterio que el resto de la matriz ante un scope vacío. */
  async isAnyResponsible(chargeId, memberId, conn = pool) {
    const [rows] = await conn.query('SELECT 1 FROM charge_responsible_members WHERE charge_id = ? AND member_id = ? LIMIT 1', [chargeId, memberId]);
    return rows.length > 0;
  }

  /** Responsable efectivo por miembro para este cobro: el de "todos los grupos" (`group_id
   * IS NULL`, el de menor `position` si hay varios) es el default, pisado por un responsable de
   * grupo específico si el miembro pertenece a ese grupo — empate entre 2+ grupos apuntados lo
   * resuelve el orden (`groupRows` ya viene por `position` ASC, se queda con la primera fila
   * vista por miembro, mismo truco que `resolveAmounts`). `null` = sin responsable asignado (el
   * pago de ese miembro solo puede quedar "a Tesorería"). Devuelve `{memberId, memberName}` (no
   * solo el id) porque tanto el chequeo de acceso (compara contra el id) como la matriz/ficha de
   * pagos (necesitan mostrar el nombre) reusan este mismo método — nombre CORTO, ver punto 5 del
   * plan / getResponsibleMembers. */
  async resolveResponsibles(chargeId, memberIds, conn = pool) {
    const result = new Map(memberIds.map((id) => [id, null]));
    if (!memberIds.length) return result;

    const [wildcardRows] = await conn.query(
      `SELECT crm.member_id, NULLIF(CONCAT_WS(' ', m.first_name, m.last_name), '') AS member_name
       FROM charge_responsible_members crm INNER JOIN members m ON m.id = crm.member_id
       WHERE crm.charge_id = ? AND crm.group_id IS NULL ORDER BY crm.position ASC LIMIT 1`,
      [chargeId]
    );
    if (wildcardRows.length) {
      const fallback = { memberId: wildcardRows[0].member_id, memberName: wildcardRows[0].member_name };
      for (const id of memberIds) result.set(id, fallback);
    }

    const [groupRows] = await conn.query(
      `SELECT mgm.member_id, crm.member_id AS responsible_member_id,
              NULLIF(CONCAT_WS(' ', m.first_name, m.last_name), '') AS responsible_member_name
       FROM charge_responsible_members crm
       INNER JOIN member_group_members mgm ON mgm.group_id = crm.group_id
       INNER JOIN members m ON m.id = crm.member_id
       WHERE crm.charge_id = ? AND crm.group_id IS NOT NULL AND mgm.member_id IN (?)
       ORDER BY crm.position ASC`,
      [chargeId, memberIds]
    );
    const seen = new Set();
    for (const row of groupRows) {
      if (seen.has(row.member_id)) continue;
      seen.add(row.member_id);
      result.set(row.member_id, { memberId: row.responsible_member_id, memberName: row.responsible_member_name });
    }

    return result;
  }

  /** Monto efectivo por miembro para este cobro: default del cobro < grupo < miembro
   * específico — cada nivel más específico pisa por completo al anterior (aunque el monto sea
   * MENOR). Empate dentro de un mismo nivel (un miembro que califica para 2+ grupos apuntados
   * con montos distintos) lo resuelve el orden: `groupRows` ya viene ordenado por `position`
   * ASC, así que quedarse con la PRIMERA fila vista por miembro (ver `seenGroup`) equivale a
   * "gana el primero de la lista", sin necesitar un GROUP BY/MIN en SQL. */
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

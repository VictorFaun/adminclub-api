const { pool } = require('../config/database');
const BaseRepository = require('./BaseRepository');
const { PROFILE_COLS, profileJoin } = require('../helpers/memberProfileSql');

// Los datos del miembro (nombres, identificador, nacimiento, foto…) son campos de su ficha: se
// leen de la vista `member_profiles` con los mismos nombres de columna de siempre.

class MembersRepository extends BaseRepository {
  constructor() {
    super('members', 'id');
  }

  async findActiveById(id, conn = pool) {
    const [rows] = await conn.query(`SELECT m.*, ${PROFILE_COLS} FROM members m ${profileJoin()} WHERE m.id = ? AND m.deleted_at IS NULL LIMIT 1`, [id]);
    return rows[0] || null;
  }

  async findByUserId(userId, clubId, conn = pool) {
    const [rows] = await conn.query(
      `SELECT m.*, ${PROFILE_COLS} FROM members m ${profileJoin()} WHERE m.user_id = ? AND m.club_id = ? AND m.deleted_at IS NULL LIMIT 1`,
      [userId, clubId]
    );
    return rows[0] || null;
  }

  /** Usado al eliminar una cuenta de usuario (`users.service.js#removeGlobal`): sin esto, un
   * miembro seguiría "vinculado" a una cuenta fantasma para siempre — `_assertUserLinkable`
   * (members.service.js) rechaza vincular un miembro que ya tiene `user_id`, sin filtrar
   * eliminados, así que ese miembro quedaría imposible de re-vincular a una cuenta real nueva. */
  async unlinkFromAllMembers(userId, conn = pool) {
    await conn.query('UPDATE members SET user_id = NULL WHERE user_id = ?', [userId]);
  }

  async createMember(data, conn = pool) {
    const [result] = await conn.query(
      `INSERT INTO members (uuid, club_id, user_id, status, created_by)
       VALUES (UUID(), :clubId, :userId, :status, :createdBy)`,
      data
    );
    return result.insertId;
  }

  /** Miembros ACTIVOS con fecha de nacimiento (para el calendario, que arma los cumpleaños de
   * cualquier rango). `memberIds` = whitelist (scope) o null para todo el club. */
  async findBirthDatesForCalendar(clubId, memberIds, conn = pool) {
    if (memberIds && !memberIds.length) return [];
    const [rows] = await conn.query(
      `SELECT m.id, ${PROFILE_COLS} FROM members m ${profileJoin()}
       WHERE m.club_id = ? AND m.deleted_at IS NULL AND m.status = 'active' AND mp.birth_date IS NOT NULL ${memberIds ? 'AND m.id IN (?)' : ''}`,
      memberIds ? [clubId, memberIds] : [clubId]
    );
    return rows;
  }

  /** Miembros ACTIVOS con cumpleaños en los próximos `days` días (0 = hoy), ordenados por cercanía.
   * `days_until` se calcula sobre la próxima fecha de cumpleaños (este año, o el siguiente si ya
   * pasó). `memberIds` = whitelist (scope) o null para todo el club. `search` filtra por nombre y
   * `groupId` por grupo — mismos filtros (y mismo orden de placeholders JOIN-antes-que-WHERE) que
   * `paginateByClub`. */
  async findUpcomingBirthdays(clubId, days, memberIds, { search, groupId } = {}, conn = pool) {
    if (memberIds && !memberIds.length) return [];
    const joins = [];
    const joinParams = [];
    if (groupId) {
      joins.push('INNER JOIN member_group_members mgm_f ON mgm_f.member_id = m.id AND mgm_f.group_id = ?');
      joinParams.push(groupId);
    }
    const whereParams = [clubId];
    let scopeSql = '';
    if (memberIds) {
      scopeSql = 'AND m.id IN (?)';
      whereParams.push(memberIds);
    }
    let searchSql = '';
    if (search) {
      searchSql = 'AND (mp.first_name LIKE ? OR mp.middle_name LIKE ? OR mp.last_name LIKE ? OR mp.second_last_name LIKE ?)';
      whereParams.push(...Array(4).fill(`%${search}%`));
    }
    const joinSql = joins.join(' ');
    const [rows] = await conn.query(
      `SELECT t.*, DATEDIFF(t.next_birthday, CURDATE()) AS days_until FROM (
         SELECT m.*, ${PROFILE_COLS}, IF(
           DATE_ADD(mp.birth_date, INTERVAL TIMESTAMPDIFF(YEAR, mp.birth_date, CURDATE()) YEAR) >= CURDATE(),
           DATE_ADD(mp.birth_date, INTERVAL TIMESTAMPDIFF(YEAR, mp.birth_date, CURDATE()) YEAR),
           DATE_ADD(mp.birth_date, INTERVAL TIMESTAMPDIFF(YEAR, mp.birth_date, CURDATE()) + 1 YEAR)
         ) AS next_birthday
         FROM members m ${profileJoin()} ${joinSql}
         WHERE m.club_id = ? AND m.deleted_at IS NULL AND m.status = 'active' AND mp.birth_date IS NOT NULL ${scopeSql} ${searchSql}
       ) t
       WHERE DATEDIFF(t.next_birthday, CURDATE()) BETWEEN 0 AND ?
       ORDER BY days_until ASC, t.first_name ASC`,
      [...joinParams, ...whereParams, days]
    );
    return rows;
  }

  // --- Documentos adjuntos (privados) ---

  async findDocuments(memberId, conn = pool) {
    const [rows] = await conn.query(
      `SELECT d.*, u.username AS uploaded_by_username FROM member_documents d
       LEFT JOIN users u ON u.id = d.uploaded_by
       WHERE d.member_id = ? ORDER BY d.created_at DESC`,
      [memberId]
    );
    return rows;
  }

  async findDocument(documentId, conn = pool) {
    const [rows] = await conn.query('SELECT * FROM member_documents WHERE id = ? LIMIT 1', [documentId]);
    return rows[0] || null;
  }

  async createDocument(data, conn = pool) {
    const [result] = await conn.query(
      `INSERT INTO member_documents (uuid, club_id, member_id, field_id, name, file_path, mime_type, size_bytes, uploaded_by)
       VALUES (UUID(), :clubId, :memberId, :fieldId, :name, :filePath, :mimeType, :sizeBytes, :uploadedBy)`,
      data
    );
    return result.insertId;
  }

  async deleteDocument(documentId, conn = pool) {
    await conn.query('DELETE FROM member_documents WHERE id = ?', [documentId]);
  }

  async softDelete(id, conn = pool) {
    await conn.query('UPDATE members SET deleted_at = NOW() WHERE id = ?', [id]);
  }

  /**
   * Filtros combinables: `search` (nombre/email/rut), `status`, `groupId` (miembros de ESE
   * grupo), `linked` ('yes'/'no', si tienen cuenta de usuario vinculada) y `memberIds`
   * (whitelist explícita — la usa members.service.js cuando el actor solo tiene
   * VIEW_MEMBERS_SCOPED; si viene un arreglo VACÍO, el llamador debe evitar llamar acá y
   * devolver una página vacía directamente, sin query).
   */
  async paginateByClub(clubId, { limit, offset, sortBy, sortOrder, search, status, groupId, linked, memberIds, fieldFilters = [], hiddenFieldIds = [] }) {
    const whereParams = [clubId];
    const where = ['m.club_id = ?', 'm.deleted_at IS NULL'];
    const joins = [];
    const joinParams = [];

    if (status) {
      where.push('m.status = ?');
      whereParams.push(status);
    }
    if (search) {
      // Busca en CUALQUIER dato de la ficha (nombre, identificador, correo, campos propios del club).
      // Los campos sensibles no entran en la búsqueda de quien no puede verlos.
      const hidden = hiddenFieldIds.length ? ' AND sv.field_id NOT IN (?)' : '';
      where.push(`EXISTS (SELECT 1 FROM member_field_values sv WHERE sv.member_id = m.id AND (sv.value LIKE ? OR sv.value LIKE ?)${hidden})`);
      // Un RUT/identificador se guarda sin puntos: los que tipee quien busca se ignoran.
      whereParams.push(`%${search}%`, `%${search.replace(/\./g, '')}%`);
      if (hiddenFieldIds.length) whereParams.push(hiddenFieldIds);
    }
    if (groupId) {
      joins.push('INNER JOIN member_group_members mgm_f ON mgm_f.member_id = m.id AND mgm_f.group_id = ?');
      joinParams.push(groupId);
    }
    // Filtros por campos de la ficha: `{ fieldId, type, values }`. Opciones: alguno de los valores;
    // selección múltiple: contiene alguno; Sí/No: exacto (un "No" incluye a quien no tiene valor).
    for (const f of fieldFilters) {
      if (f.type === 'boolean' && f.values.length === 1 && f.values[0] === 'false') {
        where.push("NOT EXISTS (SELECT 1 FROM member_field_values fv WHERE fv.member_id = m.id AND fv.field_id = ? AND fv.value = 'true')");
        whereParams.push(f.fieldId);
      } else if (f.type === 'multiselect') {
        where.push(`EXISTS (SELECT 1 FROM member_field_values fv WHERE fv.member_id = m.id AND fv.field_id = ? AND (${f.values.map(() => 'fv.value LIKE ?').join(' OR ')}))`);
        whereParams.push(f.fieldId, ...f.values.map((v) => `%${JSON.stringify(v)}%`));
      } else if (f.type === 'text') {
        where.push('EXISTS (SELECT 1 FROM member_field_values fv WHERE fv.member_id = m.id AND fv.field_id = ? AND fv.value LIKE ?)');
        whereParams.push(f.fieldId, `%${f.values[0]}%`);
      } else {
        where.push('EXISTS (SELECT 1 FROM member_field_values fv WHERE fv.member_id = m.id AND fv.field_id = ? AND fv.value IN (?))');
        whereParams.push(f.fieldId, f.values);
      }
    }
    if (linked === 'yes') where.push('m.user_id IS NOT NULL');
    if (linked === 'no') where.push('m.user_id IS NULL');
    if (memberIds) {
      if (!memberIds.length) return { rows: [], total: 0 };
      where.push('m.id IN (?)');
      whereParams.push(memberIds);
    }

    const joinSql = joins.join(' ');
    const whereSql = where.join(' AND ');
    // El JOIN va ANTES que el WHERE en el SQL final, así que sus placeholders deben ir
    // primero en el array de params (mysql2 hace binding puramente posicional) — antes se
    // agregaba `groupId` al mismo array que `clubId`/`status`/`search` en orden de inserción,
    // desalineando todos los placeholders en cuanto se combinaba con el filtro de grupo.
    const baseParams = [...joinParams, ...whereParams];

    const [rows] = await pool.query(
      `SELECT m.*, ${PROFILE_COLS} FROM members m ${profileJoin()} ${joinSql} WHERE ${whereSql}
       ORDER BY ${['first_name', 'last_name'].includes(sortBy) ? 'mp' : 'm'}.${sortBy} ${sortOrder} LIMIT ? OFFSET ?`,
      [...baseParams, limit, offset]
    );
    const [countRows] = await pool.query(`SELECT COUNT(*) AS total FROM members m ${joinSql} WHERE ${whereSql}`, baseParams);
    return { rows, total: countRows[0].total };
  }

  /** Lista liviana `{id, ...}` para pickers (scope de rol, selector de grupo, miembros
   * específicos de un cobro) — sin paginar. Incluye `group_ids` (CSV, se parsea en el service)
   * para que los pickers de charge-form muestren de una a quién ya pertenece cada miembro sin
   * una consulta aparte por cada uno. */
  async findOptions(clubId, conn = pool) {
    const [rows] = await conn.query(
      `SELECT m.id, mp.first_name, mp.middle_name, mp.last_name, mp.second_last_name,
              GROUP_CONCAT(DISTINCT mgm.group_id) AS group_ids
       FROM members m
       ${profileJoin()}
       LEFT JOIN member_group_members mgm ON mgm.member_id = m.id
       WHERE m.club_id = ? AND m.deleted_at IS NULL
       GROUP BY m.id
       ORDER BY mp.first_name ASC, mp.last_name ASC`,
      [clubId]
    );
    return rows;
  }

  async findByIds(ids, clubId, conn = pool) {
    if (!ids.length) return [];
    const [rows] = await conn.query('SELECT id FROM members WHERE id IN (?) AND club_id = ? AND deleted_at IS NULL', [
      ids,
      clubId,
    ]);
    return rows;
  }

  /** Igual que `findByIds` pero trayendo los campos de nombre — usado por
   * payments.service.js#getChargeMatrix para armar las filas (una por miembro) sin tener que
   * pedir la ficha completa de cada uno. `group_ids` (CSV, mismo criterio que `findOptions`) —
   * lo necesita el filtro por grupo de la matriz de pagos. */
  async findIdsByClub(clubId, conn = pool) {
    const [rows] = await conn.query('SELECT id FROM members WHERE club_id = ? AND deleted_at IS NULL', [clubId]);
    return rows.map((r) => r.id);
  }

  async findNamesByIds(ids, clubId, conn = pool) {
    if (!ids.length) return [];
    const [rows] = await conn.query(
      `SELECT m.id, mp.first_name, mp.middle_name, mp.last_name, mp.second_last_name, mp.avatar_url, m.status, m.deactivated_at,
              GROUP_CONCAT(DISTINCT mgm.group_id) AS group_ids
       FROM members m
       ${profileJoin()}
       LEFT JOIN member_group_members mgm ON mgm.member_id = m.id
       WHERE m.id IN (?) AND m.club_id = ? AND m.deleted_at IS NULL
       GROUP BY m.id ORDER BY mp.first_name ASC, mp.last_name ASC`,
      [ids, clubId]
    );
    return rows;
  }

  /**
   * Miembros accesibles para un usuario que NO tiene VIEW_MEMBERS (solo VIEW_MEMBERS_SCOPED):
   * unión de miembros vinculados directamente a alguno de sus roles en el club + miembros que
   * pertenecen a algún grupo vinculado a alguno de sus roles. Una sola query (UNION), evita
   * N+1 y evita traer roles/scopes a JS solo para volver a consultar.
   */
  async findAccessibleMemberIds(userId, clubId, conn = pool) {
    const [rows] = await conn.query(
      `SELECT m.id AS id FROM role_member_scope rms
         INNER JOIN user_roles ur ON ur.role_id = rms.role_id
         INNER JOIN members m ON m.id = rms.member_id AND m.deleted_at IS NULL
         WHERE ur.user_id = ? AND ur.club_id = ?
       UNION
       SELECT m.id AS id FROM role_member_group_scope rmgs
         INNER JOIN user_roles ur ON ur.role_id = rmgs.role_id
         INNER JOIN member_group_members mgm ON mgm.group_id = rmgs.group_id
         INNER JOIN members m ON m.id = mgm.member_id AND m.deleted_at IS NULL
         WHERE ur.user_id = ? AND ur.club_id = ?`,
      [userId, clubId, userId, clubId]
    );
    return rows.map((r) => r.id);
  }

  // --- Grupos de un miembro / de varios miembros (batch, evita N+1 en listados) ---

  async getGroupsForMember(memberId, conn = pool) {
    const [rows] = await conn.query(
      `SELECT g.id, g.name, g.color FROM member_group_members mgm
       INNER JOIN member_groups g ON g.id = mgm.group_id WHERE mgm.member_id = ? ORDER BY g.name ASC`,
      [memberId]
    );
    return rows;
  }

  async getGroupsForMembers(memberIds, conn = pool) {
    if (!memberIds.length) return {};
    const [rows] = await conn.query(
      `SELECT mgm.member_id, g.id, g.name, g.color FROM member_group_members mgm
       INNER JOIN member_groups g ON g.id = mgm.group_id WHERE mgm.member_id IN (?)`,
      [memberIds]
    );
    const byMember = {};
    for (const row of rows) {
      (byMember[row.member_id] ??= []).push({ id: row.id, name: row.name, color: row.color });
    }
    return byMember;
  }

  async setGroups(memberId, groupIds, conn = pool) {
    await conn.query('DELETE FROM member_group_members WHERE member_id = ?', [memberId]);
    if (!groupIds.length) return;
    const values = groupIds.map((groupId) => [groupId, memberId]);
    await conn.query('INSERT INTO member_group_members (group_id, member_id) VALUES ?', [values]);
  }

  // --- Valores de campos personalizados ---

  async getFieldValues(memberId, conn = pool) {
    const [rows] = await conn.query('SELECT field_id, value FROM member_field_values WHERE member_id = ?', [memberId]);
    return rows;
  }

  async getFieldValuesForMembers(memberIds, conn = pool) {
    if (!memberIds.length) return {};
    const [rows] = await conn.query('SELECT member_id, field_id, value FROM member_field_values WHERE member_id IN (?)', [
      memberIds,
    ]);
    const byMember = {};
    for (const row of rows) {
      (byMember[row.member_id] ??= []).push({ field_id: row.field_id, value: row.value });
    }
    return byMember;
  }

  async upsertFieldValues(memberId, entries, conn = pool) {
    const fieldIds = Object.keys(entries);
    if (!fieldIds.length) return;
    const values = fieldIds.map((fieldId) => [memberId, Number(fieldId), entries[fieldId]]);
    await conn.query(
      `INSERT INTO member_field_values (member_id, field_id, value) VALUES ?
       ON DUPLICATE KEY UPDATE value = VALUES(value)`,
      [values]
    );
  }

  async deleteFieldValues(memberId, fieldIds, conn = pool) {
    if (!fieldIds.length) return;
    await conn.query('DELETE FROM member_field_values WHERE member_id = ? AND field_id IN (?)', [memberId, fieldIds]);
  }

  async countByClub(clubId, conn = pool) {
    const [rows] = await conn.query('SELECT COUNT(*) AS total FROM members WHERE club_id = ? AND deleted_at IS NULL', [
      clubId,
    ]);
    return rows[0].total;
  }

  async countByClubAndStatus(clubId, status, conn = pool) {
    const [rows] = await conn.query(
      'SELECT COUNT(*) AS total FROM members WHERE club_id = ? AND status = ? AND deleted_at IS NULL',
      [clubId, status]
    );
    return rows[0].total;
  }
}

module.exports = new MembersRepository();

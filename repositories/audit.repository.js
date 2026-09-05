const { pool } = require('../config/database');

class AuditRepository {
  /** `changes` se guarda como JSON string (mysql2 no lo auto-parsea de vuelta); se resuelve una sola vez acá. */
  _parseChanges(row) {
    if (!row.changes) return { ...row, changes: null };
    if (typeof row.changes !== 'string') return row;
    try {
      return { ...row, changes: JSON.parse(row.changes) };
    } catch {
      return { ...row, changes: null };
    }
  }

  // `entity_id` es un VARCHAR polimórfico (ver 001_schema.sql) sin FK real, así que no hay
  // forma de traer el nombre de la entidad con un JOIN directo. Se resuelve aparte, agrupando
  // los ids por tipo y haciendo un solo SELECT ... IN (...) por tabla en vez de N+1 por fila.
  /** Agrega `entity_name` a cada fila (null si la entidad ya no existe o el tipo no se resuelve). */
  async _withEntityNames(rawRows) {
    const rows = rawRows.map((row) => this._parseChanges(row));

    const idsByType = {};
    for (const row of rows) {
      if (!row.entity_type || !row.entity_id) continue;
      (idsByType[row.entity_type] ??= new Set()).add(row.entity_id);
    }
    if (Object.keys(idsByType).length === 0) return rows.map((row) => ({ ...row, entity_name: this._fallbackNameFromChanges(row) }));

    const names = new Map(); // `${entity_type}:${entity_id}` -> nombre

    const roleIds = [...(idsByType.role ?? [])];
    if (roleIds.length) {
      const [r] = await pool.query('SELECT id, name FROM roles WHERE id IN (?)', [roleIds]);
      r.forEach((x) => names.set(`role:${x.id}`, x.name));
    }

    const userIds = [...(idsByType.user ?? [])];
    if (userIds.length) {
      const [r] = await pool.query('SELECT id, username FROM users WHERE id IN (?)', [userIds]);
      r.forEach((x) => names.set(`user:${x.id}`, x.username));
    }

    // entity_id de 'club_settings' es el id del club, no una tabla propia.
    const clubIds = [...new Set([...(idsByType.club ?? []), ...(idsByType.club_settings ?? [])])];
    if (clubIds.length) {
      const [r] = await pool.query('SELECT id, name FROM clubs WHERE id IN (?)', [clubIds]);
      r.forEach((x) => {
        names.set(`club:${x.id}`, x.name);
        names.set(`club_settings:${x.id}`, x.name);
      });
    }

    const invitationIds = [...(idsByType.invitation ?? [])];
    if (invitationIds.length) {
      const [r] = await pool.query('SELECT id, code FROM invitations WHERE id IN (?)', [invitationIds]);
      r.forEach((x) => names.set(`invitation:${x.id}`, x.code));
    }

    const joinRequestIds = [...(idsByType.join_request ?? [])];
    if (joinRequestIds.length) {
      const [r] = await pool.query(
        `SELECT jr.id, u.username FROM join_requests jr
         JOIN users u ON u.id = jr.user_id WHERE jr.id IN (?)`,
        [joinRequestIds]
      );
      r.forEach((x) => names.set(`join_request:${x.id}`, x.username));
    }

    const memberIds = [...(idsByType.member ?? [])];
    if (memberIds.length) {
      const [r] = await pool.query(
        `SELECT id, CONCAT_WS(' ', first_name, middle_name, last_name, second_last_name) AS full_name
         FROM members WHERE id IN (?)`,
        [memberIds]
      );
      r.forEach((x) => names.set(`member:${x.id}`, x.full_name));
    }

    const memberGroupIds = [...(idsByType.member_group ?? [])];
    if (memberGroupIds.length) {
      const [r] = await pool.query('SELECT id, name FROM member_groups WHERE id IN (?)', [memberGroupIds]);
      r.forEach((x) => names.set(`member_group:${x.id}`, x.name));
    }

    const chargeIds = [...(idsByType.charge ?? [])];
    if (chargeIds.length) {
      const [r] = await pool.query('SELECT id, name FROM charges WHERE id IN (?)', [chargeIds]);
      r.forEach((x) => names.set(`charge:${x.id}`, x.name));
    }

    const paymentIds = [...(idsByType.payment ?? [])];
    if (paymentIds.length) {
      const [r] = await pool.query(
        `SELECT p.id, CONCAT_WS(' ', m.first_name, m.last_name) AS member_name FROM payments p
         INNER JOIN members m ON m.id = p.member_id WHERE p.id IN (?)`,
        [paymentIds]
      );
      r.forEach((x) => names.set(`payment:${x.id}`, x.member_name));
    }

    const chargeInstanceIds = [...(idsByType.charge_instance ?? [])];
    if (chargeInstanceIds.length) {
      const [r] = await pool.query(
        `SELECT ci.id, CONCAT_WS(' ', c.name, ci.period_label) AS label FROM charge_instances ci
         INNER JOIN charges c ON c.id = ci.charge_id WHERE ci.id IN (?)`,
        [chargeInstanceIds]
      );
      r.forEach((x) => names.set(`charge_instance:${x.id}`, x.label));
    }

    return rows.map((row) => {
      const key = row.entity_type && row.entity_id ? `${row.entity_type}:${row.entity_id}` : null;
      const entityName = (key && names.get(key)) ?? this._fallbackNameFromChanges(row);
      return { ...row, entity_name: entityName };
    });
  }

  /**
   * Un rol eliminado ya no existe para cuando alguien lea el log, así que el lookup en vivo
   * de arriba no lo encuentra — se recurre al nombre que quedó guardado en `changes` al
   * momento de la acción (ver roles.service.js#remove). Solo aplica a 'role': es el único
   * tipo de entidad que se borra de verdad (clubes/usuarios/invitaciones solo cambian de
   * estado, así que el lookup en vivo siempre los sigue encontrando).
   */
  _fallbackNameFromChanges(row) {
    if (row.entity_type !== 'role' || !row.changes) return null;
    return row.changes.name ?? null;
  }

  async logAction({ userId, clubId, action, entityType, entityId, changes, ipAddress, userAgent }, conn = pool) {
    await conn.query(
      `INSERT INTO audit_logs (user_id, club_id, action, entity_type, entity_id, changes, ip_address, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [userId, clubId, action, entityType, entityId, changes ? JSON.stringify(changes) : null, ipAddress, userAgent]
    );
  }

  async logActivity({ userId, clubId, description, metadata }, conn = pool) {
    await conn.query(
      `INSERT INTO activity_logs (user_id, club_id, description, metadata) VALUES (?, ?, ?, ?)`,
      [userId, clubId, description, metadata ? JSON.stringify(metadata) : null]
    );
  }

  async paginateAuditLogs(clubId, { limit, offset }) {
    const [rows] = await pool.query(
      `SELECT a.*, u.username, u.email FROM audit_logs a
       LEFT JOIN users u ON u.id = a.user_id
       WHERE a.club_id <=> ? ORDER BY a.created_at DESC LIMIT ? OFFSET ?`,
      [clubId, limit, offset]
    );
    const [countRows] = await pool.query('SELECT COUNT(*) AS total FROM audit_logs WHERE club_id <=> ?', [clubId]);
    return { rows: await this._withEntityNames(rows), total: countRows[0].total };
  }

  async recentActivity(clubId, limit = 10) {
    const [rows] = await pool.query(
      `SELECT al.*, u.username, u.avatar_url FROM activity_logs al
       LEFT JOIN users u ON u.id = al.user_id
       WHERE al.club_id = ? ORDER BY al.created_at DESC LIMIT ?`,
      [clubId, limit]
    );
    return rows;
  }

  /** Igual que `recentActivity`, pero de `audit_logs` (acciones administrativas estructuradas)
   * acotado a ciertos `entity_type` — lo usa el dashboard de un módulo puntual (p.ej. "miembros")
   * para no mezclar actividad de todo el club. */
  async recentActivityByEntityTypes(clubId, entityTypes, limit = 10, conn = pool) {
    const [rows] = await conn.query(
      `SELECT a.*, u.username, u.avatar_url FROM audit_logs a
       LEFT JOIN users u ON u.id = a.user_id
       WHERE a.club_id = ? AND a.entity_type IN (?) ORDER BY a.created_at DESC LIMIT ?`,
      [clubId, entityTypes, limit]
    );
    return this._withEntityNames(rows);
  }
}

module.exports = new AuditRepository();

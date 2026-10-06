const { pool } = require('../config/database');
const BaseRepository = require('./BaseRepository');

class PaymentProofsRepository extends BaseRepository {
  constructor() {
    super('payment_proofs', 'id');
  }

  // --- Vista pública (sin sesión) ---

  /** Miembro ACTIVO del club por su identificador (el campo con uso "identificador": RUT, DNI…),
   * ya normalizado (ver helpers/memberFieldTypes.js#normalizeIdentifier). */
  async findActiveMemberByIdentifier(clubId, normalized, conn = pool) {
    const [rows] = await conn.query(
      `SELECT m.id, m.club_id, mp.first_name FROM members m
       INNER JOIN member_profiles mp ON mp.member_id = m.id
       WHERE m.club_id = ? AND m.deleted_at IS NULL AND m.status = 'active' AND mp.rut IS NOT NULL
         AND UPPER(mp.rut) = ? LIMIT 1`,
      [clubId, normalized]
    );
    return rows[0] || null;
  }

  /** Períodos con saldo (pendientes o abonados) de cobros activos, del más antiguo al más nuevo. */
  async findPayableInstances(memberId, conn = pool) {
    const [rows] = await conn.query(
      `SELECT ci.id, ci.period_label, ci.amount, ci.due_date, ci.status,
              c.id AS charge_id, c.name AS charge_name, c.color AS charge_color, c.recurrence AS charge_recurrence,
              COALESCE((SELECT SUM(pa.amount) FROM payment_allocations pa WHERE pa.charge_instance_id = ci.id), 0) AS paid_amount,
              (SELECT COUNT(*) FROM payment_proofs pp WHERE pp.charge_instance_id = ci.id AND pp.status = 'pending') AS pending_proofs
       FROM charge_instances ci
       INNER JOIN charges c ON c.id = ci.charge_id
       WHERE ci.member_id = ? AND ci.status IN ('pending', 'partial')
         AND c.deleted_at IS NULL AND c.archived_at IS NULL AND c.status = 'active'
       ORDER BY ci.due_date ASC LIMIT 80`,
      [memberId]
    );
    return rows;
  }

  /** Cobros recurrentes activos que aplican a la persona (tiene o tuvo períodos en ellos). */
  async findActiveRecurringCharges(memberId, conn = pool) {
    const [rows] = await conn.query(
      `SELECT DISTINCT c.id, c.name, c.color, c.recurrence, c.amount
       FROM charge_instances ci
       INNER JOIN charges c ON c.id = ci.charge_id
       WHERE ci.member_id = ? AND c.recurrence <> 'once'
         AND c.deleted_at IS NULL AND c.archived_at IS NULL AND c.status = 'active'
       ORDER BY c.name ASC`,
      [memberId]
    );
    return rows;
  }

  async countPendingForInstance(instanceId, conn = pool) {
    const [rows] = await conn.query("SELECT COUNT(*) AS total FROM payment_proofs WHERE charge_instance_id = ? AND status = 'pending'", [instanceId]);
    return rows[0].total;
  }

  async createProof(data, conn = pool) {
    const [result] = await conn.query(
      `INSERT INTO payment_proofs (uuid, batch_uuid, club_id, member_id, paid_to_member_id, charge_instance_id, amount, paid_at, note, file_path, mime_type)
       VALUES (UUID(), :batchUuid, :clubId, :memberId, :paidToMemberId, :chargeInstanceId, :amount, :paidAt, :note, :filePath, :mimeType)`,
      data
    );
    return result.insertId;
  }

  // --- Revisión (admin) ---

  /** Todas las filas de un lote (un envío = un archivo, uno o varios períodos). */
  async findByBatch(batchUuid, conn = pool) {
    const [rows] = await conn.query(
      `SELECT pp.*, ci.period_label FROM payment_proofs pp
       INNER JOIN charge_instances ci ON ci.id = pp.charge_instance_id
       WHERE pp.batch_uuid = ? ORDER BY ci.due_date ASC, pp.id ASC`,
      [batchUuid]
    );
    return rows;
  }

  /**
   * `memberIds` null = todos los del club; array = whitelist (scope).
   * Filtros: `groupId` (grupo del miembro), `chargeId` (el lote incluye algún período de ese cobro;
   * se devuelve el lote COMPLETO para no mostrarlo a medias), `search` (nombre o RUT del miembro),
   * `from`/`to` (fecha de envío, YYYY-MM-DD).
   */
  async listByClub(clubId, { status, memberIds, groupId, chargeId, search, from, to }, conn = pool) {
    if (memberIds && !memberIds.length) return [];
    const params = [clubId];
    let where = 'pp.club_id = ?';
    if (status) {
      where += ' AND pp.status = ?';
      params.push(status);
    }
    if (memberIds) {
      where += ' AND pp.member_id IN (?)';
      params.push(memberIds);
    }
    if (groupId) {
      where += ' AND EXISTS (SELECT 1 FROM member_group_members mgm WHERE mgm.member_id = pp.member_id AND mgm.group_id = ?)';
      params.push(groupId);
    }
    if (chargeId) {
      where += ` AND pp.batch_uuid IN (
        SELECT pp2.batch_uuid FROM payment_proofs pp2
        INNER JOIN charge_instances ci2 ON ci2.id = pp2.charge_instance_id
        WHERE pp2.club_id = ? AND ci2.charge_id = ?)`;
      params.push(clubId, chargeId);
    }
    if (search) {
      where += " AND (CONCAT_WS(' ', mp.first_name, mp.middle_name, mp.last_name, mp.second_last_name) LIKE ? OR mp.rut LIKE ?)";
      // El RUT se guarda sin puntos: los que tipee quien busca se ignoran para ese campo.
      params.push(`%${search}%`, `%${search.replace(/\./g, '')}%`);
    }
    if (from) {
      where += ' AND pp.created_at >= ?';
      params.push(from);
    }
    if (to) {
      where += ' AND pp.created_at < DATE_ADD(?, INTERVAL 1 DAY)';
      params.push(to);
    }
    const [rows] = await conn.query(
      `SELECT pp.*, ci.period_label, ci.due_date, c.id AS charge_id, c.name AS charge_name, c.color AS charge_color,
              c.recurrence AS charge_recurrence, c.purpose AS charge_purpose, c.treasury_account_id AS charge_treasury_account_id,
              NULLIF(CONCAT_WS(' ', ptp.first_name, ptp.last_name), '') AS paid_to_member_name,
              (SELECT crm.account FROM charge_responsible_members crm
                WHERE crm.charge_id = c.id AND crm.member_id = pp.paid_to_member_id LIMIT 1) AS paid_to_account,
              NULLIF(CONCAT_WS(' ', mp.first_name, mp.last_name), '') AS member_name, mp.rut AS member_rut,
              (SELECT GROUP_CONCAT(mg.name ORDER BY mg.name SEPARATOR '||')
                 FROM member_group_members mgm INNER JOIN member_groups mg ON mg.id = mgm.group_id
                WHERE mgm.member_id = pp.member_id) AS member_groups,
              u.username AS reviewed_by_username
       FROM payment_proofs pp
       INNER JOIN charge_instances ci ON ci.id = pp.charge_instance_id
       INNER JOIN charges c ON c.id = ci.charge_id
       INNER JOIN members m ON m.id = pp.member_id LEFT JOIN member_profiles mp ON mp.member_id = m.id
       LEFT JOIN members pt ON pt.id = pp.paid_to_member_id LEFT JOIN member_profiles ptp ON ptp.member_id = pt.id
       LEFT JOIN users u ON u.id = pp.reviewed_by
       WHERE ${where}
       ORDER BY (pp.status = 'pending') DESC, pp.created_at DESC, pp.batch_uuid, ci.due_date ASC LIMIT 500`,
      params
    );
    return rows;
  }

  /** Opciones de los filtros de la revisión: grupos del club y cobros que aparecen en comprobantes visibles. */
  async filterOptions(clubId, memberIds, conn = pool) {
    const [groups] = await conn.query('SELECT id, name, color FROM member_groups WHERE club_id = ? ORDER BY name ASC', [clubId]);
    if (memberIds && !memberIds.length) return { groups, charges: [] };
    const params = [clubId];
    let scope = '';
    if (memberIds) {
      scope = 'AND pp.member_id IN (?)';
      params.push(memberIds);
    }
    const [charges] = await conn.query(
      `SELECT DISTINCT c.id, c.name, c.color FROM payment_proofs pp
       INNER JOIN charge_instances ci ON ci.id = pp.charge_instance_id
       INNER JOIN charges c ON c.id = ci.charge_id
       WHERE pp.club_id = ? ${scope} ORDER BY c.name ASC`,
      params
    );
    return { groups, charges };
  }

  async countPending(clubId, memberIds, conn = pool) {
    if (memberIds && !memberIds.length) return 0;
    const params = [clubId];
    let scope = '';
    if (memberIds) {
      scope = 'AND member_id IN (?)';
      params.push(memberIds);
    }
    // Un pago múltiple (varias filas, mismo lote) cuenta como UN comprobante por revisar.
    const [rows] = await conn.query(`SELECT COUNT(DISTINCT batch_uuid) AS total FROM payment_proofs WHERE club_id = ? AND status = 'pending' ${scope}`, params);
    return rows[0].total;
  }

  async markReviewed(id, { status, reviewedBy, reviewNote, paymentId }, conn = pool) {
    await conn.query(
      'UPDATE payment_proofs SET status = ?, reviewed_by = ?, reviewed_at = NOW(), review_note = ?, payment_id = ? WHERE id = ?',
      [status, reviewedBy, reviewNote || null, paymentId || null, id]
    );
  }
}

module.exports = new PaymentProofsRepository();

const crypto = require('crypto');
const { pool } = require('../config/database');
const BaseRepository = require('./BaseRepository');

class ChargeInstancesRepository extends BaseRepository {
  constructor() {
    super('charge_instances', 'id');
  }

  async findActiveById(id, conn = pool) {
    const [rows] = await conn.query('SELECT * FROM charge_instances WHERE id = ? LIMIT 1', [id]);
    return rows[0] || null;
  }

  /** Genera (o ignora si ya existe, ver UNIQUE(charge_id, member_id, period_label)) las
   * instancias de un período para una lista de miembros — usado tanto por la generación
   * periódica (chargeInstances.service.js#generateDueInstances) como al crear un cobro nuevo. */
  async bulkInsertIgnore(rows, conn = pool) {
    if (!rows.length) return 0;
    // UUID generado en JS (no MySQL `UUID()`): el patrón bulk `VALUES ?` escapa cada elemento
    // del array como un valor literal, no admite mezclar una llamada a función SQL por fila.
    const values = rows.map((r) => [crypto.randomUUID(), r.chargeId, r.memberId, r.periodLabel, r.amount, r.dueDate]);
    const [result] = await conn.query(
      `INSERT IGNORE INTO charge_instances (uuid, charge_id, member_id, period_label, amount, due_date) VALUES ?`,
      [values]
    );
    return result.affectedRows;
  }

  /** Cuenta miembros DISTINTOS con al menos una instancia vencida sin ningún pago — para el
   * dashboard. Solo `pending` cuenta como atrasada (mismo criterio que
   * payments.service.js#_instanceToDto): una `partial` ya tiene algo abonado, no debería sumar
   * como "atrasado" aunque su fecha haya pasado. `memberIds` null = todo el club; array =
   * acotado (mismo criterio que sumDirectPayments). Excluye cobros eliminados/archivados: un
   * cobro archivado se oculta justamente para no generar ruido, así que tampoco debería seguir
   * apareciendo acá como pendiente de seguimiento (a diferencia de las sumas de dinero, que sí
   * lo siguen contando — este es un indicador de "a quién perseguir", no de plata). */
  async countOverdueMembers(clubId, memberIds, conn = pool) {
    const params = [clubId];
    let memberFilter = '';
    if (memberIds) {
      if (!memberIds.length) return 0;
      memberFilter = 'AND ci.member_id IN (?)';
      params.push(memberIds);
    }
    const [rows] = await conn.query(
      `SELECT COUNT(DISTINCT ci.member_id) AS total FROM charge_instances ci
       INNER JOIN charges c ON c.id = ci.charge_id
       WHERE c.club_id = ? ${memberFilter} AND ci.status = 'pending' AND ci.due_date < CURDATE()
         AND c.deleted_at IS NULL AND c.archived_at IS NULL`,
      params
    );
    return rows[0].total;
  }

  /** Todas las instancias de UN cobro para un conjunto de miembros — usado por
   * payments.service.js#getChargeMatrix para armar la matriz miembro×período de un solo cobro
   * (a diferencia de `findForMember`, que trae TODOS los cobros de UN miembro). */
  async findForChargeAndMembers(chargeId, memberIds, conn = pool) {
    if (!memberIds.length) return [];
    const [rows] = await conn.query('SELECT * FROM charge_instances WHERE charge_id = ? AND member_id IN (?)', [
      chargeId,
      memberIds,
    ]);
    return rows;
  }

  /** `sumAllocations` en lote: `{ [instanceId]: totalPagado }` para varias instancias a la vez
   * (evita N+1 al armar la matriz, donde puede haber decenas de celdas `partial`). */
  async sumAllocationsForInstances(instanceIds, conn = pool) {
    if (!instanceIds.length) return {};
    const [rows] = await conn.query(
      'SELECT charge_instance_id, COALESCE(SUM(amount), 0) AS total FROM payment_allocations WHERE charge_instance_id IN (?) GROUP BY charge_instance_id',
      [instanceIds]
    );
    const map = {};
    for (const row of rows) map[row.charge_instance_id] = Number(row.total);
    return map;
  }

  async findForMember(memberId, conn = pool) {
    const [rows] = await conn.query(
      `SELECT ci.*, c.name AS charge_name, c.color AS charge_color, c.recurrence AS charge_recurrence,
              c.purpose AS charge_purpose,
              c.responsible_member_id AS charge_responsible_member_id,
              NULLIF(CONCAT_WS(' ', rm.first_name, rm.middle_name, rm.last_name, rm.second_last_name), '') AS charge_responsible_member_name
       FROM charge_instances ci
       INNER JOIN charges c ON c.id = ci.charge_id
       LEFT JOIN members rm ON rm.id = c.responsible_member_id
       WHERE ci.member_id = ? AND c.deleted_at IS NULL
       ORDER BY ci.due_date DESC`,
      [memberId]
    );
    return rows;
  }

  async sumAllocations(instanceId, conn = pool) {
    const [rows] = await conn.query(
      'SELECT COALESCE(SUM(amount), 0) AS total FROM payment_allocations WHERE charge_instance_id = ?',
      [instanceId]
    );
    return Number(rows[0].total);
  }

  /** Recalcula `status` sumando las allocations vigentes contra el monto de la instancia — se
   * llama después de cada alta/baja de pago que la haya tocado, dentro de la misma transacción.
   * No toca instancias `exempt` (no deberían tener allocations; si las tuviera por algún bug,
   * de todas formas se prioriza no pisar una exención puesta a mano). */
  async recomputeStatus(instanceId, conn = pool) {
    const instance = await this.findActiveById(instanceId, conn);
    if (!instance || instance.status === 'exempt') return;
    const paid = await this.sumAllocations(instanceId, conn);
    const status = paid <= 0 ? 'pending' : paid >= Number(instance.amount) ? 'paid' : 'partial';
    await conn.query('UPDATE charge_instances SET status = ? WHERE id = ?', [status, instanceId]);
  }

  /** `exemptType`: 'frozen' ("congelado") o 'not_applicable' ("no aplica") — ambos bloquean el
   * registro de un pago igual, solo cambia la etiqueta/color mostrados (ver
   * payments.service.js#_resolveDisplayStatus). */
  async markExempt(instanceId, reason, exemptType, actorId, conn = pool) {
    await conn.query(
      "UPDATE charge_instances SET status = 'exempt', exempt_reason = ?, exempt_type = ?, exempt_by = ?, exempt_at = NOW() WHERE id = ?",
      [reason || null, exemptType || 'frozen', actorId, instanceId]
    );
  }

  async markUnexempt(instanceId, conn = pool) {
    await conn.query(
      "UPDATE charge_instances SET status = 'pending', exempt_reason = NULL, exempt_type = NULL, exempt_by = NULL, exempt_at = NULL WHERE id = ?",
      [instanceId]
    );
  }

  /** Una instancia puntual de UN cobro para UN miembro en UN período — usado por
   * chargeInstances.service.js#ensureInstance para saber si ya existe antes de crearla. */
  async findByChargeMemberPeriod(chargeId, memberId, periodLabel, conn = pool) {
    const [rows] = await conn.query(
      'SELECT * FROM charge_instances WHERE charge_id = ? AND member_id = ? AND period_label = ? LIMIT 1',
      [chargeId, memberId, periodLabel]
    );
    return rows[0] || null;
  }
}

module.exports = new ChargeInstancesRepository();

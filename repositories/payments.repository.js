const { pool } = require('../config/database');
const BaseRepository = require('./BaseRepository');

class PaymentsRepository extends BaseRepository {
  constructor() {
    super('payments', 'id');
  }

  /** `paid_to_member_name`: `NULLIF(CONCAT_WS(...), '')` da `NULL` cuando `paid_to_member_id`
   * es `NULL` ("a Tesorería", pago directo sin intermediario) — `CONCAT_WS` solo, sin el
   * `NULLIF`, da `''` en ese caso, no `NULL` (hay que forzarlo). Mismo patrón que
   * charges.repository.js#findActiveById para `responsible_member_name`. */
  async findActiveById(id, conn = pool) {
    const [rows] = await conn.query(
      `SELECT p.*, NULLIF(CONCAT_WS(' ', ptm.first_name, ptm.middle_name, ptm.last_name, ptm.second_last_name), '') AS paid_to_member_name
       FROM payments p
       LEFT JOIN members ptm ON ptm.id = p.paid_to_member_id
       WHERE p.id = ? LIMIT 1`,
      [id]
    );
    return rows[0] || null;
  }

  /** "Historial de pagos" de la ficha de un miembro — excluye pagos cuyo cobro fue ELIMINADO
   * (`charges.deleted_at`, vía payment_allocations → charge_instances → charges; un pago siempre
   * tiene exactamente UNA allocation, así que el INNER JOIN nunca duplica ni pierde filas de
   * pagos con cobro vigente). Antes traía todos los pagos del miembro sin filtrar, así que un
   * cobro eliminado seguía apareciendo en el historial como si nada — igual que
   * chargeInstancesRepository.findForMember, que ya filtraba esto para las pestañas "por cobro". */
  async findByMember(memberId, conn = pool) {
    const [rows] = await conn.query(
      `SELECT p.*, u.username AS registered_by_username,
              NULLIF(CONCAT_WS(' ', ptm.first_name, ptm.middle_name, ptm.last_name, ptm.second_last_name), '') AS paid_to_member_name
       FROM payments p
       INNER JOIN payment_allocations pa ON pa.payment_id = p.id
       INNER JOIN charge_instances ci ON ci.id = pa.charge_instance_id
       INNER JOIN charges c ON c.id = ci.charge_id
       LEFT JOIN users u ON u.id = p.registered_by
       LEFT JOIN members ptm ON ptm.id = p.paid_to_member_id
       WHERE p.member_id = ? AND c.deleted_at IS NULL
       ORDER BY p.paid_at DESC`,
      [memberId]
    );
    return rows;
  }

  async createPayment(data, conn = pool) {
    const [result] = await conn.query(
      `INSERT INTO payments (uuid, club_id, member_id, paid_to_member_id, amount, paid_at, note, registered_by)
       VALUES (UUID(), :clubId, :memberId, :paidToMemberId, :amount, :paidAt, :note, :registeredBy)`,
      data
    );
    return result.insertId;
  }

  async createAllocations(paymentId, allocations, conn = pool) {
    if (!allocations.length) return;
    const values = allocations.map((a) => [paymentId, a.chargeInstanceId, a.amount]);
    await conn.query('INSERT INTO payment_allocations (payment_id, charge_instance_id, amount) VALUES ?', [values]);
  }

  async getAllocations(paymentId, conn = pool) {
    const [rows] = await conn.query(
      `SELECT pa.*, ci.period_label, ci.due_date, c.name AS charge_name, c.color AS charge_color
       FROM payment_allocations pa
       INNER JOIN charge_instances ci ON ci.id = pa.charge_instance_id
       INNER JOIN charges c ON c.id = ci.charge_id
       WHERE pa.payment_id = ?`,
      [paymentId]
    );
    return rows;
  }

  /** Todos los pagos que tocan UN período puntual — un `charge_instance` puede tener varios
   * pagos encima (varios abonos hasta cubrir el total). Usado por el modal de la matriz "Pagos"
   * al hacer clic en una celda `partial`/`paid`, para listarlos con edición/eliminación. */
  async findByInstance(instanceId, conn = pool) {
    const [rows] = await conn.query(
      `SELECT p.*, u.username AS registered_by_username,
              NULLIF(CONCAT_WS(' ', ptm.first_name, ptm.middle_name, ptm.last_name, ptm.second_last_name), '') AS paid_to_member_name
       FROM payments p
       INNER JOIN payment_allocations pa ON pa.payment_id = p.id
       LEFT JOIN users u ON u.id = p.registered_by
       LEFT JOIN members ptm ON ptm.id = p.paid_to_member_id
       WHERE pa.charge_instance_id = ?
       ORDER BY p.paid_at DESC`,
      [instanceId]
    );
    return rows;
  }

  /** Cambia el monto de la (única) allocation de un pago — ver payments.service.js#update: un
   * pago siempre tiene exactamente 1 allocation con el diseño actual. */
  async updateAllocationAmount(allocationId, amount, conn = pool) {
    await conn.query('UPDATE payment_allocations SET amount = ? WHERE id = ?', [amount, allocationId]);
  }

  /** ids de `charge_instances` afectadas por un pago — se necesita ANTES de borrarlo (las
   * allocations caen en cascada) para poder recalcular el estado de cada una después. */
  async getAllocatedInstanceIds(paymentId, conn = pool) {
    const [rows] = await conn.query('SELECT charge_instance_id FROM payment_allocations WHERE payment_id = ?', [
      paymentId,
    ]);
    return rows.map((r) => r.charge_instance_id);
  }

  async deletePayment(id, conn = pool) {
    await conn.query('DELETE FROM payments WHERE id = ?', [id]);
  }

  /** Solo pagos DIRECTOS a Tesorería (`paid_to_member_id IS NULL`), histórico completo — un pago
   * "al responsable" todavía no llegó a Tesorería, no cuenta acá (ver
   * payments.service.js#getDashboard, que suma esto más las transferencias de responsables para
   * el total real que Tesorería ha recibido). Se une hasta `charges` (en vez de sumar
   * `payments` directo) para excluir pagos de cobros YA ELIMINADOS (`deleted_at`) — eliminar un
   * cobro no debería seguir inflando el total de Tesorería con dinero de un cobro que ya no
   * existe. `memberIds` null = todo el club (VIEW_PAYMENTS completo); array = acotado a esos
   * miembros (VIEW_PAYMENTS_SCOPED) — usado por el dashboard, que nunca debe sumar pagos de
   * miembros que el actor no puede ver. */
  async sumDirectPayments(clubId, memberIds, conn = pool) {
    const params = [clubId];
    let memberFilter = '';
    if (memberIds) {
      if (!memberIds.length) return 0;
      memberFilter = 'AND p.member_id IN (?)';
      params.push(memberIds);
    }
    const [rows] = await conn.query(
      `SELECT COALESCE(SUM(pa.amount), 0) AS total
       FROM payment_allocations pa
       INNER JOIN payments p ON p.id = pa.payment_id
       INNER JOIN charge_instances ci ON ci.id = pa.charge_instance_id
       INNER JOIN charges c ON c.id = ci.charge_id
       WHERE p.club_id = ? AND p.paid_to_member_id IS NULL AND c.deleted_at IS NULL ${memberFilter}`,
      params
    );
    return Number(rows[0].total);
  }

  /** Cuánto hay en total, AHORA MISMO, en manos de responsables de cobros de este club —
   * suma histórica completa de pagos marcados "al responsable" (`paid_to_member_id IS NOT NULL`),
   * sin restar transferencias todavía (eso lo hace payments.service.js#getDashboard,
   * comparándolo contra chargeSettlements.repository.js#sumAllTime — cada `charge_settlement` ya
   * se valida al crearse contra el saldo pendiente de SU período, así que la resta global nunca
   * puede quedar negativa). Igual que sumDirectPayments, se excluyen cobros eliminados.
   * `memberIds` = mismo scope de sumDirectPayments, sobre quién PAGÓ (no sobre el responsable que
   * recibió). */
  async sumHeldByResponsibles(clubId, memberIds, conn = pool) {
    const params = [clubId];
    let memberFilter = '';
    if (memberIds) {
      if (!memberIds.length) return 0;
      memberFilter = 'AND p.member_id IN (?)';
      params.push(memberIds);
    }
    const [rows] = await conn.query(
      `SELECT COALESCE(SUM(pa.amount), 0) AS total
       FROM payment_allocations pa
       INNER JOIN payments p ON p.id = pa.payment_id
       INNER JOIN charge_instances ci ON ci.id = pa.charge_instance_id
       INNER JOIN charges c ON c.id = ci.charge_id
       WHERE p.club_id = ? AND p.paid_to_member_id IS NOT NULL AND c.deleted_at IS NULL ${memberFilter}`,
      params
    );
    return Number(rows[0].total);
  }

  /** `{ 'YYYY-MM': total }` de pagos DIRECTOS a Tesorería, agrupados por mes, de los últimos
   * `months` meses (incluyendo el actual) — usado para el gráfico de ingresos del dashboard (ver
   * payments.service.js#getDashboard). Mismo criterio de exclusión que sumDirectPayments (cobros
   * eliminados no cuentan). */
  async sumDirectPaymentsByMonth(clubId, memberIds, months, conn = pool) {
    const params = [clubId];
    let memberFilter = '';
    if (memberIds) {
      if (!memberIds.length) return {};
      memberFilter = 'AND p.member_id IN (?)';
      params.push(memberIds);
    }
    params.push(months - 1);
    const [rows] = await conn.query(
      `SELECT DATE_FORMAT(p.paid_at, '%Y-%m') AS month, COALESCE(SUM(pa.amount), 0) AS total
       FROM payment_allocations pa
       INNER JOIN payments p ON p.id = pa.payment_id
       INNER JOIN charge_instances ci ON ci.id = pa.charge_instance_id
       INNER JOIN charges c ON c.id = ci.charge_id
       WHERE p.club_id = ? AND p.paid_to_member_id IS NULL AND c.deleted_at IS NULL ${memberFilter}
         AND p.paid_at >= DATE_SUB(DATE_FORMAT(NOW(), '%Y-%m-01'), INTERVAL ? MONTH)
       GROUP BY month`,
      params
    );
    const byMonth = {};
    for (const row of rows) byMonth[row.month] = Number(row.total);
    return byMonth;
  }

  /** `{ [periodLabel]: totalQueQuedóEnManosDelResponsable }` — suma los pagos de miembros de
   * este cobro, agrupados por período, filtrados a los que quedaron "a nombre" del responsable
   * (`paid_to_member_id = responsibleMemberId`; lo pagado directo a Tesorería, `NULL`, NO
   * cuenta acá — ya llegó, no hay nada que transferir por eso). Usado por
   * getChargeMatrix#settlements para calcular cuánto le falta transferir al responsable. */
  async sumPaidToByChargeAndPeriods(chargeId, responsibleMemberId, periodLabels, conn = pool) {
    if (!periodLabels.length) return {};
    const [rows] = await conn.query(
      `SELECT ci.period_label, COALESCE(SUM(pa.amount), 0) AS total
       FROM payment_allocations pa
       INNER JOIN payments p ON p.id = pa.payment_id
       INNER JOIN charge_instances ci ON ci.id = pa.charge_instance_id
       WHERE ci.charge_id = ? AND ci.period_label IN (?) AND p.paid_to_member_id = ?
       GROUP BY ci.period_label`,
      [chargeId, periodLabels, responsibleMemberId]
    );
    const byPeriod = {};
    for (const row of rows) byPeriod[row.period_label] = Number(row.total);
    return byPeriod;
  }

  /** Miembros a los que da acceso de TESORERÍA (no de perfil — ver members.repository.js para
   * eso) alguno de los roles del actor en este club: unión de miembros vinculados directo a
   * role_payment_scope + miembros de grupos vinculados a role_payment_group_scope. Mismo patrón
   * exacto que members.repository.js#findAccessibleMemberIds, tablas paralelas. */
  async findAccessibleMemberIds(userId, clubId, conn = pool) {
    const [rows] = await conn.query(
      `SELECT m.id AS id FROM role_payment_scope rps
         INNER JOIN user_roles ur ON ur.role_id = rps.role_id
         INNER JOIN members m ON m.id = rps.member_id AND m.deleted_at IS NULL
         WHERE ur.user_id = ? AND ur.club_id = ?
       UNION
       SELECT m.id AS id FROM role_payment_group_scope rpgs
         INNER JOIN user_roles ur ON ur.role_id = rpgs.role_id
         INNER JOIN member_group_members mgm ON mgm.group_id = rpgs.group_id
         INNER JOIN members m ON m.id = mgm.member_id AND m.deleted_at IS NULL
         WHERE ur.user_id = ? AND ur.club_id = ?`,
      [userId, clubId, userId, clubId]
    );
    return rows.map((r) => r.id);
  }
}

module.exports = new PaymentsRepository();

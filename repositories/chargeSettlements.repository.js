const { pool } = require('../config/database');
const BaseRepository = require('./BaseRepository');

/** Transferencias del responsable de un cobro hacia Tesorería — ver `018_charge_settlements.sql`.
 * Mismo patrón que `payments.repository.js`: varias filas posibles por (charge_id,
 * period_label) para permitir transferencias parciales. */
class ChargeSettlementsRepository extends BaseRepository {
  constructor() {
    super('charge_settlements', 'id');
  }

  async findActiveById(id, conn = pool) {
    const [rows] = await conn.query('SELECT * FROM charge_settlements WHERE id = ? LIMIT 1', [id]);
    return rows[0] || null;
  }

  /** Todas las transferencias registradas para UN período de UN cobro — usado por el modal
   * "editar/eliminar" (mismo rol que payments.repository.js#findByInstance). */
  async findByChargeAndPeriod(chargeId, periodLabel, conn = pool) {
    const [rows] = await conn.query(
      `SELECT cs.*, u.username AS registered_by_username FROM charge_settlements cs
       LEFT JOIN users u ON u.id = cs.registered_by
       WHERE cs.charge_id = ? AND cs.period_label = ? ORDER BY cs.transferred_at DESC`,
      [chargeId, periodLabel]
    );
    return rows;
  }

  /** `{ [periodLabel]: totalTransferido }` para un conjunto de períodos de un cobro — usado por
   * getChargeMatrix para calcular cuánto ya se le transfirió a Tesorería por período. */
  async sumByChargeAndPeriods(chargeId, periodLabels, conn = pool) {
    if (!periodLabels.length) return {};
    const [rows] = await conn.query(
      `SELECT period_label, COALESCE(SUM(amount), 0) AS total FROM charge_settlements
       WHERE charge_id = ? AND period_label IN (?) GROUP BY period_label`,
      [chargeId, periodLabels]
    );
    const byPeriod = {};
    for (const row of rows) byPeriod[row.period_label] = Number(row.total);
    return byPeriod;
  }

  /** Total histórico transferido por responsables a Tesorería en todo el club — usado junto con
   * paymentsRepository#sumHeldByResponsibles para el saldo AHORA MISMO en manos de responsables
   * (ver payments.service.js#getDashboard). Excluye cobros eliminados (`c.deleted_at`), igual que
   * paymentsRepository#sumDirectPayments/#sumHeldByResponsibles — las tres queries del dashboard
   * deben tratar un cobro eliminado de la misma forma (fuera de los totales), si no la resta
   * `heldByResponsibles - settledAllTime` queda inconsistente (dinero de un cobro ya eliminado
   * restando contra un total que ya no lo incluye). */
  async sumAllTime(clubId, memberIds, conn = pool) {
    const params = [clubId];
    let memberFilter = '';
    if (memberIds) {
      if (!memberIds.length) return 0;
      memberFilter = 'AND c.responsible_member_id IN (?)';
      params.push(memberIds);
    }
    const [rows] = await conn.query(
      `SELECT COALESCE(SUM(cs.amount), 0) AS total
       FROM charge_settlements cs
       INNER JOIN charges c ON c.id = cs.charge_id
       WHERE c.club_id = ? AND c.deleted_at IS NULL ${memberFilter}`,
      params
    );
    return Number(rows[0].total);
  }

  /** Igual que sumAllTime, pero solo cuenta transferencias de cobros `purpose = 'treasury'` — un
   * cobro `external` (ej. inscripción de un campeonato) nunca entrega su dinero a Tesorería, así
   * que su transferencia SÍ debe descontarse de "lo que tiene el responsable" (sumAllTime, sin
   * filtrar) pero NUNCA debe sumarse al total de Tesorería (ver payments.service.js#getDashboard). */
  async sumAllTimeToTreasury(clubId, memberIds, conn = pool) {
    const params = [clubId];
    let memberFilter = '';
    if (memberIds) {
      if (!memberIds.length) return 0;
      memberFilter = 'AND c.responsible_member_id IN (?)';
      params.push(memberIds);
    }
    const [rows] = await conn.query(
      `SELECT COALESCE(SUM(cs.amount), 0) AS total
       FROM charge_settlements cs
       INNER JOIN charges c ON c.id = cs.charge_id
       WHERE c.club_id = ? AND c.deleted_at IS NULL AND c.purpose = 'treasury' ${memberFilter}`,
      params
    );
    return Number(rows[0].total);
  }

  /** `{ 'YYYY-MM': total }` de transferencias a Tesorería (`purpose = 'treasury'`), agrupadas por
   * mes, de los últimos `months` meses — usado junto con
   * paymentsRepository#sumDirectPaymentsByMonth para el gráfico de ingresos del dashboard (ver
   * payments.service.js#getDashboard). */
  async sumToTreasuryByMonth(clubId, memberIds, months, conn = pool) {
    const params = [clubId];
    let memberFilter = '';
    if (memberIds) {
      if (!memberIds.length) return {};
      memberFilter = 'AND c.responsible_member_id IN (?)';
      params.push(memberIds);
    }
    params.push(months - 1);
    const [rows] = await conn.query(
      `SELECT DATE_FORMAT(cs.transferred_at, '%Y-%m') AS month, COALESCE(SUM(cs.amount), 0) AS total
       FROM charge_settlements cs
       INNER JOIN charges c ON c.id = cs.charge_id
       WHERE c.club_id = ? AND c.deleted_at IS NULL AND c.purpose = 'treasury' ${memberFilter}
         AND cs.transferred_at >= DATE_SUB(DATE_FORMAT(NOW(), '%Y-%m-01'), INTERVAL ? MONTH)
       GROUP BY month`,
      params
    );
    const byMonth = {};
    for (const row of rows) byMonth[row.month] = Number(row.total);
    return byMonth;
  }

  async createSettlement(data, conn = pool) {
    const [result] = await conn.query(
      `INSERT INTO charge_settlements (uuid, charge_id, period_label, amount, transferred_at, note, registered_by)
       VALUES (UUID(), :chargeId, :periodLabel, :amount, :transferredAt, :note, :registeredBy)`,
      data
    );
    return result.insertId;
  }
}

module.exports = new ChargeSettlementsRepository();

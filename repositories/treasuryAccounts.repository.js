const { pool } = require('../config/database');
const BaseRepository = require('./BaseRepository');

/** Suma `rows` ({account_id, total}) en `map` (clave = id de cuenta o `null`) con el signo dado. */
function accumulate(map, rows, sign) {
  for (const r of rows) {
    const key = r.account_id ?? null;
    map.set(key, (map.get(key) ?? 0) + sign * Number(r.total));
  }
}

class TreasuryAccountsRepository extends BaseRepository {
  constructor() {
    super('treasury_accounts', 'id');
  }

  /** Cuentas vigentes (no eliminadas) del club. */
  async findByClub(clubId, conn = pool) {
    const [rows] = await conn.query('SELECT * FROM treasury_accounts WHERE club_id = ? AND deleted_at IS NULL ORDER BY position ASC, id ASC', [clubId]);
    return rows;
  }

  /** Incluye las eliminadas: para nombrar la cuenta de movimientos viejos. */
  async findAllByClub(clubId, conn = pool) {
    const [rows] = await conn.query('SELECT * FROM treasury_accounts WHERE club_id = ? ORDER BY position ASC, id ASC', [clubId]);
    return rows;
  }

  /** Cuenta vigente del club. */
  async findInClub(clubId, id, conn = pool) {
    const [rows] = await conn.query('SELECT * FROM treasury_accounts WHERE club_id = ? AND id = ? AND deleted_at IS NULL LIMIT 1', [clubId, id]);
    return rows[0] || null;
  }

  async create(clubId, data, conn = pool) {
    const [[{ next }]] = await conn.query('SELECT COALESCE(MAX(position), -1) + 1 AS next FROM treasury_accounts WHERE club_id = ?', [clubId]);
    const [result] = await conn.query(
      `INSERT INTO treasury_accounts
        (uuid, club_id, name, bank_name, account_type, account_number, holder_name, holder_rut, email, notes, position)
       VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [clubId, data.name, data.bankName, data.accountType, data.accountNumber, data.holderName, data.holderRut, data.email, data.notes, next]
    );
    return result.insertId;
  }

  async update(id, data, conn = pool) {
    await conn.query(
      `UPDATE treasury_accounts SET name = ?, bank_name = ?, account_type = ?, account_number = ?, holder_name = ?,
              holder_rut = ?, email = ?, notes = ? WHERE id = ?`,
      [data.name, data.bankName, data.accountType, data.accountNumber, data.holderName, data.holderRut, data.email, data.notes, id]
    );
  }

  /** Eliminación "suave": la cuenta desaparece de la configuración y de los selectores, pero los
   * movimientos que se hicieron a ella la siguen nombrando. Los cobros que la usaban quedan sin
   * cuenta elegida. */
  async softDelete(id, conn = pool) {
    await conn.query('UPDATE treasury_accounts SET deleted_at = NOW() WHERE id = ?', [id]);
    await conn.query('UPDATE charges SET treasury_account_id = NULL WHERE treasury_account_id = ?', [id]);
  }

  /** Cobros activos (no eliminados) que apuntan a esta cuenta — se avisa antes de borrarla. */
  async countCharges(id, conn = pool) {
    const [rows] = await conn.query('SELECT COUNT(*) AS total FROM charges WHERE treasury_account_id = ? AND deleted_at IS NULL', [id]);
    return rows[0].total;
  }

  /**
   * Saldo de cada cuenta del club (incluidas las eliminadas, y `null` = "sin cuenta asignada"):
   *   + pagos directos a Tesorería + entregas de responsables a Tesorería
   *   − pagos de gastos ± transferencias entre cuentas.
   * Mismo criterio que el total del dashboard (payments.service.js#getDashboard): se excluyen
   * cobros y gastos eliminados. Devuelve `Map<accountId|null, saldo>`.
   */
  async balances(clubId, conn = pool) {
    const [[direct], [settled], [expenses], [transfersIn], [transfersOut]] = await Promise.all([
      conn.query(
        `SELECT p.treasury_account_id AS account_id, COALESCE(SUM(pa.amount), 0) AS total
         FROM payment_allocations pa
         INNER JOIN payments p ON p.id = pa.payment_id
         INNER JOIN charge_instances ci ON ci.id = pa.charge_instance_id
         INNER JOIN charges c ON c.id = ci.charge_id
         WHERE p.club_id = ? AND p.paid_to_member_id IS NULL AND c.deleted_at IS NULL
         GROUP BY p.treasury_account_id`,
        [clubId]
      ),
      conn.query(
        `SELECT cs.treasury_account_id AS account_id, COALESCE(SUM(cs.amount), 0) AS total
         FROM charge_settlements cs
         INNER JOIN charges c ON c.id = cs.charge_id
         WHERE c.club_id = ? AND c.deleted_at IS NULL AND c.purpose = 'treasury'
         GROUP BY cs.treasury_account_id`,
        [clubId]
      ),
      conn.query(
        `SELECT ep.treasury_account_id AS account_id, COALESCE(SUM(ep.amount), 0) AS total
         FROM expense_payments ep
         INNER JOIN expense_instances ei ON ei.id = ep.expense_instance_id
         INNER JOIN expenses e ON e.id = ei.expense_id
         WHERE ep.club_id = ? AND e.deleted_at IS NULL
         GROUP BY ep.treasury_account_id`,
        [clubId]
      ),
      conn.query('SELECT to_account_id AS account_id, SUM(amount) AS total FROM treasury_account_transfers WHERE club_id = ? GROUP BY to_account_id', [clubId]),
      conn.query('SELECT from_account_id AS account_id, SUM(amount) AS total FROM treasury_account_transfers WHERE club_id = ? GROUP BY from_account_id', [clubId]),
    ]);
    const map = new Map();
    accumulate(map, direct, 1);
    accumulate(map, settled, 1);
    accumulate(map, expenses, -1);
    accumulate(map, transfersIn, 1);
    accumulate(map, transfersOut, -1);
    return map;
  }

  // --- Transferencias entre cuentas ---

  async createTransfer(data, conn = pool) {
    const [result] = await conn.query(
      `INSERT INTO treasury_account_transfers (uuid, club_id, from_account_id, to_account_id, amount, transferred_at, note, registered_by)
       VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?)`,
      [data.clubId, data.fromAccountId, data.toAccountId, data.amount, data.transferredAt, data.note, data.registeredBy]
    );
    return result.insertId;
  }

  async listTransfers(clubId, conn = pool) {
    const [rows] = await conn.query(
      `SELECT t.*, fa.name AS from_name, fa.deleted_at AS from_deleted_at, ta.name AS to_name, ta.deleted_at AS to_deleted_at,
              u.username AS registered_by_username
       FROM treasury_account_transfers t
       LEFT JOIN treasury_accounts fa ON fa.id = t.from_account_id
       INNER JOIN treasury_accounts ta ON ta.id = t.to_account_id
       LEFT JOIN users u ON u.id = t.registered_by
       WHERE t.club_id = ?
       ORDER BY t.transferred_at DESC, t.id DESC LIMIT 200`,
      [clubId]
    );
    return rows;
  }
}

module.exports = new TreasuryAccountsRepository();

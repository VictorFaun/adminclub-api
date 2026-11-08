const { pool } = require('../config/database');
const BaseRepository = require('./BaseRepository');
const { shortNameSql } = require('../helpers/memberProfileSql');

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

  /**
   * Movimientos de dinero de Tesorería, del más reciente al más antiguo — los mismos que suma
   * `balances` (mismo criterio: sin cobros ni gastos eliminados): pagos directos, entregas de
   * responsables, pagos de gastos y transferencias. `accountId`: solo esa cuenta (una
   * transferencia sale como entrada o salida según el lado); `null` = todas (cada transferencia
   * una sola vez, de una cuenta a otra). Cada fila:
   * { kind, ref_id, account_id, amount (con signo), happened_at, created_at, label, detail, from_name, to_name }.
   */
  async movements(clubId, { accountId = null, limit = 20 } = {}, conn = pool) {
    const params = [];
    // Arma los placeholders en el mismo orden en que aparecen en el SQL.
    const club = () => {
      params.push(clubId);
      return '?';
    };
    const account = (col) => {
      if (accountId === null) return '';
      params.push(Number(accountId));
      return `AND ${col} = ?`;
    };
    // Función (no valor): sus placeholders deben empujarse cuando le toca en el SQL, al final.
    const transfers = () =>
      accountId === null
        ? `SELECT 'transfer', t.id, t.to_account_id, t.amount, t.transferred_at, t.created_at, NULL, t.note, COALESCE(fa.name, 'Sin cuenta asignada'), ta.name
           FROM treasury_account_transfers t
           LEFT JOIN treasury_accounts fa ON fa.id = t.from_account_id
           INNER JOIN treasury_accounts ta ON ta.id = t.to_account_id
           WHERE t.club_id = ${club()}`
        : `SELECT 'transfer_in', t.id, t.to_account_id, t.amount, t.transferred_at, t.created_at, NULL, t.note, COALESCE(fa.name, 'Sin cuenta asignada'), ta.name
           FROM treasury_account_transfers t
           LEFT JOIN treasury_accounts fa ON fa.id = t.from_account_id
           INNER JOIN treasury_accounts ta ON ta.id = t.to_account_id
           WHERE t.club_id = ${club()} ${account('t.to_account_id')}
           UNION ALL
           SELECT 'transfer_out', t.id, t.from_account_id, -t.amount, t.transferred_at, t.created_at, NULL, t.note, COALESCE(fa.name, 'Sin cuenta asignada'), ta.name
           FROM treasury_account_transfers t
           LEFT JOIN treasury_accounts fa ON fa.id = t.from_account_id
           INNER JOIN treasury_accounts ta ON ta.id = t.to_account_id
           WHERE t.club_id = ${club()} ${account('t.from_account_id')}`;
    const sql = `SELECT * FROM (
         SELECT 'payment' AS kind, p.id AS ref_id, p.treasury_account_id AS account_id, SUM(pa.amount) AS amount,
                p.paid_at AS happened_at, p.created_at, GROUP_CONCAT(DISTINCT c.name ORDER BY c.name SEPARATOR ', ') AS label,
                ${shortNameSql('mp')} AS detail, NULL AS from_name, NULL AS to_name
         FROM payments p
         INNER JOIN payment_allocations pa ON pa.payment_id = p.id
         INNER JOIN charge_instances ci ON ci.id = pa.charge_instance_id
         INNER JOIN charges c ON c.id = ci.charge_id AND c.deleted_at IS NULL
         LEFT JOIN member_profiles mp ON mp.member_id = p.member_id
         WHERE p.club_id = ${club()} AND p.paid_to_member_id IS NULL ${account('p.treasury_account_id')}
         GROUP BY p.id
         UNION ALL
         SELECT 'settlement', cs.id, cs.treasury_account_id, cs.amount, cs.transferred_at, cs.created_at, c.name, ${shortNameSql('mp')}, NULL, NULL
         FROM charge_settlements cs
         INNER JOIN charges c ON c.id = cs.charge_id AND c.deleted_at IS NULL AND c.purpose = 'treasury'
         LEFT JOIN member_profiles mp ON mp.member_id = cs.responsible_member_id
         WHERE c.club_id = ${club()} ${account('cs.treasury_account_id')}
         UNION ALL
         SELECT 'expense', ep.id, ep.treasury_account_id, -ep.amount, ep.paid_at, ep.created_at, e.name, ei.period_label, NULL, NULL
         FROM expense_payments ep
         INNER JOIN expense_instances ei ON ei.id = ep.expense_instance_id
         INNER JOIN expenses e ON e.id = ei.expense_id AND e.deleted_at IS NULL
         WHERE ep.club_id = ${club()} ${account('ep.treasury_account_id')}
         UNION ALL
         ${transfers()}
       ) mv
       ORDER BY mv.happened_at DESC, mv.created_at DESC
       LIMIT ?`;
    params.push(Number(limit));
    const [rows] = await conn.query(sql, params);
    return rows;
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

const { pool } = require('../config/database');
const AppError = require('../helpers/AppError');
const permissionService = require('./permission.service');
const paymentsService = require('./payments.service');
const paymentsRepository = require('../repositories/payments.repository');
const chargeSettlementsRepository = require('../repositories/chargeSettlements.repository');
const expensePaymentsRepository = require('../repositories/expensePayments.repository');
const settingsRepository = require('../repositories/settings.repository');
const { PROFILE_COLS, profileJoin } = require('../helpers/memberProfileSql');
const { FUNCTIONS } = require('../config/constants');

const F = FUNCTIONS;
/** Meses de historia para calcular "este mes / este año" y su comparación con el período anterior. */
const HISTORY_MONTHS = 24;
const DEFAULT_KEY_PREFIX = 'dashboard_default_role_';

const monthKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
/** Condición SQL: la fecha cae en el mes anterior, entre el día 1 y el mismo día de hoy. */
const PREV_MONTH_TO_DATE = (col) =>
  `${col} >= DATE_SUB(DATE_FORMAT(CURDATE(), '%Y-%m-01'), INTERVAL 1 MONTH)
   AND ${col} < DATE_ADD(DATE_SUB(CURDATE(), INTERVAL 1 MONTH), INTERVAL 1 DAY)`;
const fullName = (r) => [r.first_name, r.last_name].filter(Boolean).join(' ') || `Miembro #${r.member_id}`;

/**
 * Datos de los widgets del dashboard personalizable (uno por tipo, con sus opciones: grupo,
 * período, cobro…). Cada tipo valida su propio permiso: el dashboard pide solo los widgets que el
 * usuario tiene puestos, y quien no tiene acceso a un dato recibe 403 en ese widget, no en todo.
 */
class DashboardWidgetsService {
  async get(type, clubId, authContext, actorId, query = {}) {
    const handler = this.handlers[type];
    if (!handler) throw AppError.notFound('Widget desconocido.');
    if (!permissionService.hasAnyFunction(authContext, handler.requires)) throw AppError.forbidden('No tienes acceso a este widget.');
    return handler.load.call(this, clubId, authContext, actorId, query);
  }

  get handlers() {
    return {
      members: { requires: [F.VIEW_MEMBERS_DASHBOARD], load: this._members },
      debtors: { requires: [F.VIEW_PAYMENTS, F.VIEW_PAYMENTS_SCOPED], load: this._debtors },
      'top-debtors': { requires: [F.VIEW_PAYMENTS, F.VIEW_PAYMENTS_SCOPED], load: this._topDebtors },
      income: { requires: [F.VIEW_PAYMENTS, F.VIEW_PAYMENTS_SCOPED], load: this._income },
      expenses: { requires: [F.VIEW_EXPENSES], load: this._expenses },
      proofs: { requires: [F.VIEW_PAYMENTS, F.VIEW_PAYMENTS_SCOPED], load: this._proofs },
      due: { requires: [F.VIEW_PAYMENTS, F.VIEW_PAYMENTS_SCOPED, F.VIEW_EXPENSES], load: this._due },
      'charge-progress': { requires: [F.VIEW_PAYMENTS, F.VIEW_PAYMENTS_SCOPED], load: this._chargeProgress },
      attendance: { requires: [F.VIEW_ATTENDANCE, F.VIEW_ATTENDANCE_SCOPED, F.VIEW_TRAININGS], load: this._attendance },
      applications: { requires: [F.VIEW_MEMBERS], load: this._applications },
    };
  }

  // ------------------------------------------------------------------ filtros comunes

  /** Miembros visibles según el scope de pagos (null = todos). */
  async _paymentMemberIds(authContext, actorId, clubId) {
    const access = await paymentsService.resolveAccessForController(authContext, actorId, clubId);
    return access.full ? null : access.memberIds;
  }

  /** `AND <alias>.member_id IN (...)` para scope y grupo; devuelve null si el scope está vacío. */
  _memberFilter(alias, memberIds, groupId) {
    const parts = [];
    const params = [];
    if (memberIds) {
      if (!memberIds.length) return null;
      parts.push(`AND ${alias}.member_id IN (?)`);
      params.push(memberIds);
    }
    if (groupId) {
      parts.push(`AND ${alias}.member_id IN (SELECT member_id FROM member_group_members WHERE group_id = ?)`);
      params.push(Number(groupId));
    }
    return { sql: parts.join(' '), params };
  }

  // ------------------------------------------------------------------ cifras

  async _members(clubId, _auth, _actor, { groupId }) {
    const groupSql = groupId ? 'AND m.id IN (SELECT member_id FROM member_group_members WHERE group_id = ?)' : '';
    const params = groupId ? [clubId, Number(groupId)] : [clubId];
    const [[row]] = await pool.query(
      `SELECT COUNT(*) AS total, SUM(m.status = 'active') AS active FROM members m
       WHERE m.club_id = ? AND m.deleted_at IS NULL ${groupSql}`,
      params
    );
    return { active: Number(row.active || 0), total: Number(row.total || 0) };
  }

  /** Saldos vencidos por miembro activo (pendiente o abonado, con fecha pasada). */
  async _overdueByMember(clubId, authContext, actorId, groupId) {
    const memberIds = await this._paymentMemberIds(authContext, actorId, clubId);
    const filter = this._memberFilter('ci', memberIds, groupId);
    if (!filter) return [];
    const [rows] = await pool.query(
      `SELECT ci.member_id, SUM(ci.amount - COALESCE(pa.paid, 0)) AS amount, COUNT(*) AS periods
       FROM charge_instances ci
       INNER JOIN charges c ON c.id = ci.charge_id
       INNER JOIN members m ON m.id = ci.member_id AND m.status = 'active' AND m.deleted_at IS NULL
       LEFT JOIN (SELECT charge_instance_id, SUM(amount) AS paid FROM payment_allocations GROUP BY charge_instance_id) pa
         ON pa.charge_instance_id = ci.id
       WHERE c.club_id = ? AND c.deleted_at IS NULL AND c.archived_at IS NULL
         AND ci.status IN ('pending', 'partial') AND ci.due_date < CURDATE() ${filter.sql}
       GROUP BY ci.member_id
       HAVING amount > 0
       ORDER BY amount DESC`,
      [clubId, ...filter.params]
    );
    return rows.map((r) => ({ memberId: r.member_id, amount: Number(r.amount), periods: Number(r.periods) }));
  }

  async _debtors(clubId, authContext, actorId, { groupId }) {
    const list = await this._overdueByMember(clubId, authContext, actorId, groupId);
    return { count: list.length, amount: list.reduce((s, d) => s + d.amount, 0) };
  }

  async _topDebtors(clubId, authContext, actorId, { groupId, limit }) {
    const list = (await this._overdueByMember(clubId, authContext, actorId, groupId)).slice(0, Math.min(Number(limit) || 10, 30));
    if (!list.length) return { items: [], total: 0 };
    const [names] = await pool.query(`SELECT m.id AS member_id, ${PROFILE_COLS} FROM members m ${profileJoin('m', 'mp')} WHERE m.id IN (?)`, [list.map((d) => d.memberId)]);
    const byId = new Map(names.map((n) => [n.member_id, fullName(n)]));
    return { items: list.map((d) => ({ ...d, name: byId.get(d.memberId) ?? `Miembro #${d.memberId}` })), total: list.length };
  }

  /** Serie mensual (24 meses) → valor del período elegido, el anterior y los últimos 6 meses. */
  _periodFigures(byMonth, period, previousToDate = null) {
    const now = new Date();
    const keys = [];
    for (let i = HISTORY_MONTHS - 1; i >= 0; i -= 1) keys.push(monthKey(new Date(now.getFullYear(), now.getMonth() - i, 1)));
    const v = (k) => Number(byMonth[k] || 0);
    const cur = keys[keys.length - 1];
    const series = keys.slice(-6).map(v);
    if (period === 'year') {
      const year = now.getFullYear();
      const month = now.getMonth() + 1;
      // Mismo tramo del año anterior (ene → mes actual) para que la comparación sea justa.
      const sumYear = (y) => keys.filter((k) => k.startsWith(`${y}-`) && Number(k.slice(5)) <= month).reduce((s, k) => s + v(k), 0);
      return { value: sumYear(year), previous: sumYear(year - 1), label: `${year}`, previousLabel: `mismo período de ${year - 1}`, series };
    }
    if (period === '6m') {
      const last6 = keys.slice(-6).reduce((s, k) => s + v(k), 0);
      const prev6 = keys.slice(-12, -6).reduce((s, k) => s + v(k), 0);
      return { value: last6, previous: prev6, label: 'últimos 6 meses', previousLabel: 'los 6 meses anteriores', series };
    }
    const prev = keys[keys.length - 2];
    // El mes en curso va a medias: se compara contra los mismos días del mes anterior (si se
    // calcularon), no contra el mes anterior completo.
    const previous = previousToDate ?? v(prev);
    return { value: v(cur), previous, label: cur, previousLabel: prev, partial: previousToDate !== null, series };
  }

  async _income(clubId, authContext, actorId, { period }) {
    const memberIds = await this._paymentMemberIds(authContext, actorId, clubId);
    const [direct, settled] = await Promise.all([
      paymentsRepository.sumDirectPaymentsByMonth(clubId, memberIds, HISTORY_MONTHS),
      chargeSettlementsRepository.sumToTreasuryByMonth(clubId, memberIds, HISTORY_MONTHS),
    ]);
    const merged = { ...direct };
    for (const [k, val] of Object.entries(settled)) merged[k] = (merged[k] || 0) + Number(val);
    const toDate = (period ?? 'month') === 'month' ? await this._incomePrevMonthToDate(clubId, memberIds) : null;
    return this._periodFigures(merged, period, toDate);
  }

  async _expenses(clubId, _auth, _actor, { period }) {
    const byMonth = await expensePaymentsRepository.sumAllTimeByMonth(clubId, HISTORY_MONTHS);
    let toDate = null;
    if ((period ?? 'month') === 'month') {
      const [[r]] = await pool.query(
        `SELECT COALESCE(SUM(ep.amount), 0) AS total FROM expense_payments ep
         INNER JOIN expense_instances ei ON ei.id = ep.expense_instance_id
         INNER JOIN expenses e ON e.id = ei.expense_id
         WHERE ep.club_id = ? AND e.deleted_at IS NULL AND ${PREV_MONTH_TO_DATE('ep.paid_at')}`,
        [clubId]
      );
      toDate = Number(r.total);
    }
    const figures = this._periodFigures(byMonth, period, toDate);
    // Lo presupuestado del mes en curso (todo lo que vence este mes), para "pagado de X".
    const [[row]] = await pool.query(
      `SELECT COALESCE(SUM(ei.amount), 0) AS budgeted FROM expense_instances ei
       INNER JOIN expenses e ON e.id = ei.expense_id
       WHERE e.club_id = ? AND e.deleted_at IS NULL AND DATE_FORMAT(ei.due_date, '%Y-%m') = DATE_FORMAT(CURDATE(), '%Y-%m')`,
      [clubId]
    );
    return { ...figures, budgetedThisMonth: Number(row.budgeted) };
  }

  /** Ingresos (mismo criterio que el gráfico: pagos directos + lo transferido por responsables)
   * del mes anterior hasta el mismo día de hoy. */
  async _incomePrevMonthToDate(clubId, memberIds) {
    if (memberIds && !memberIds.length) return 0;
    const direct = memberIds ? 'AND p.member_id IN (?)' : '';
    const settled = memberIds ? 'AND cs.responsible_member_id IN (?)' : '';
    const [[a]] = await pool.query(
      `SELECT COALESCE(SUM(pa.amount), 0) AS total FROM payment_allocations pa
       INNER JOIN payments p ON p.id = pa.payment_id
       INNER JOIN charge_instances ci ON ci.id = pa.charge_instance_id
       INNER JOIN charges c ON c.id = ci.charge_id
       WHERE p.club_id = ? AND p.paid_to_member_id IS NULL AND c.deleted_at IS NULL ${direct} AND ${PREV_MONTH_TO_DATE('p.paid_at')}`,
      memberIds ? [clubId, memberIds] : [clubId]
    );
    const [[b]] = await pool.query(
      `SELECT COALESCE(SUM(cs.amount), 0) AS total FROM charge_settlements cs
       INNER JOIN charges c ON c.id = cs.charge_id
       WHERE c.club_id = ? AND c.deleted_at IS NULL AND c.purpose = 'treasury' ${settled} AND ${PREV_MONTH_TO_DATE('cs.transferred_at')}`,
      memberIds ? [clubId, memberIds] : [clubId]
    );
    return Number(a.total) + Number(b.total);
  }

  async _proofs(clubId, authContext, actorId) {
    const memberIds = await this._paymentMemberIds(authContext, actorId, clubId);
    const filter = this._memberFilter('pp', memberIds, null);
    if (!filter) return { count: 0, oldestAt: null };
    const [[row]] = await pool.query(
      `SELECT COUNT(DISTINCT COALESCE(pp.batch_uuid, pp.uuid)) AS n, MIN(pp.created_at) AS oldest
       FROM payment_proofs pp WHERE pp.club_id = ? AND pp.status = 'pending' ${filter.sql}`,
      [clubId, ...filter.params]
    );
    return { count: Number(row.n), oldestAt: row.oldest };
  }

  // ------------------------------------------------------------------ listas

  /** Lo que vence en los próximos `days` días: cobros (por período, cuántos y cuánto falta) y gastos. */
  async _due(clubId, authContext, actorId, { days }) {
    const horizon = Math.min(Math.max(Number(days) || 30, 7), 90);
    const items = [];
    if (permissionService.hasAnyFunction(authContext, [F.VIEW_PAYMENTS, F.VIEW_PAYMENTS_SCOPED])) {
      const memberIds = await this._paymentMemberIds(authContext, actorId, clubId);
      const filter = this._memberFilter('ci', memberIds, null);
      if (filter) {
        const [rows] = await pool.query(
          `SELECT c.id AS charge_id, c.name, c.color, ci.period_label, MIN(ci.due_date) AS due_date,
                  COUNT(*) AS members, SUM(ci.amount - COALESCE(pa.paid, 0)) AS remaining
           FROM charge_instances ci
           INNER JOIN charges c ON c.id = ci.charge_id
           INNER JOIN members m ON m.id = ci.member_id AND m.status = 'active' AND m.deleted_at IS NULL
           LEFT JOIN (SELECT charge_instance_id, SUM(amount) AS paid FROM payment_allocations GROUP BY charge_instance_id) pa
             ON pa.charge_instance_id = ci.id
           WHERE c.club_id = ? AND c.deleted_at IS NULL AND c.archived_at IS NULL
             AND ci.status IN ('pending', 'partial') AND ci.due_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL ? DAY) ${filter.sql}
           GROUP BY c.id, ci.period_label
           ORDER BY due_date ASC`,
          [clubId, horizon, ...filter.params]
        );
        for (const r of rows) {
          items.push({ kind: 'charge', id: r.charge_id, name: r.name, color: r.color, periodLabel: r.period_label, dueDate: r.due_date, members: Number(r.members), amount: Number(r.remaining) });
        }
      }
    }
    if (permissionService.hasFunction(authContext, F.VIEW_EXPENSES)) {
      const [rows] = await pool.query(
        `SELECT e.id, e.name, e.color, ei.period_label, ei.due_date, ei.amount - COALESCE(SUM(ep.amount), 0) AS remaining
         FROM expense_instances ei
         INNER JOIN expenses e ON e.id = ei.expense_id
         LEFT JOIN expense_payments ep ON ep.expense_instance_id = ei.id
         WHERE e.club_id = ? AND e.deleted_at IS NULL AND e.archived_at IS NULL AND ei.status <> 'paid'
           AND ei.due_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL ? DAY)
         GROUP BY ei.id
         HAVING remaining > 0`,
        [clubId, horizon]
      );
      for (const r of rows) {
        items.push({ kind: 'expense', id: r.id, name: r.name, color: r.color, periodLabel: r.period_label, dueDate: r.due_date, members: null, amount: Number(r.remaining) });
      }
    }
    items.sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));
    return { days: horizon, items };
  }

  /** Avance de pago de un cobro en su período vigente (el de vencimiento más cercano a hoy). */
  async _chargeProgress(clubId, authContext, actorId, { chargeId }) {
    const memberIds = await this._paymentMemberIds(authContext, actorId, clubId);
    const filter = this._memberFilter('ci', memberIds, null);
    const [charges] = await pool.query(
      `SELECT id, name, color, recurrence FROM charges WHERE club_id = ? AND deleted_at IS NULL AND archived_at IS NULL AND status = 'active'
       ORDER BY (recurrence = 'monthly') DESC, name ASC`,
      [clubId]
    );
    const charge = charges.find((c) => c.id === Number(chargeId)) ?? charges[0];
    if (!charge || !filter) return { charge: null };
    // Período vigente: el del mes en curso en un cobro mensual; si no, el último que ya venció o
    // vence en los próximos 15 días; si no hay ninguno, el primero que viene.
    const [[period]] = await pool.query(
      `SELECT ci.period_label FROM charge_instances ci WHERE ci.charge_id = ?
       ORDER BY (ci.period_label = DATE_FORMAT(CURDATE(), '%Y-%m')) DESC,
                (ci.due_date <= DATE_ADD(CURDATE(), INTERVAL 15 DAY)) DESC,
                CASE WHEN ci.due_date <= DATE_ADD(CURDATE(), INTERVAL 15 DAY) THEN ci.due_date END DESC,
                ci.due_date ASC
       LIMIT 1`,
      [charge.id]
    );
    if (!period) return { charge: { id: charge.id, name: charge.name, color: charge.color }, periodLabel: null, paid: 0, partial: 0, pending: 0, exempt: 0, collected: 0, expected: 0 };
    const [rows] = await pool.query(
      `SELECT ci.status, COUNT(*) AS n, SUM(ci.amount) AS expected, SUM(COALESCE(pa.paid, 0)) AS collected, MIN(ci.due_date) AS due_date
       FROM charge_instances ci
       INNER JOIN members m ON m.id = ci.member_id AND m.deleted_at IS NULL
       LEFT JOIN (SELECT charge_instance_id, SUM(amount) AS paid FROM payment_allocations GROUP BY charge_instance_id) pa ON pa.charge_instance_id = ci.id
       WHERE ci.charge_id = ? AND ci.period_label = ? ${filter.sql}
       GROUP BY ci.status`,
      [charge.id, period.period_label, ...filter.params]
    );
    // Atrasados de este cobro (cualquier período vencido con saldo), para las tarjetas de Cobros.
    const [[late]] = await pool.query(
      `SELECT COUNT(DISTINCT ci.member_id) AS n FROM charge_instances ci
       INNER JOIN members m ON m.id = ci.member_id AND m.status = 'active' AND m.deleted_at IS NULL
       LEFT JOIN (SELECT charge_instance_id, SUM(amount) AS paid FROM payment_allocations GROUP BY charge_instance_id) pa ON pa.charge_instance_id = ci.id
       WHERE ci.charge_id = ? AND ci.status IN ('pending', 'partial') AND ci.due_date < CURDATE()
         AND ci.amount - COALESCE(pa.paid, 0) > 0 ${filter.sql}`,
      [charge.id, ...filter.params]
    );
    const by = Object.fromEntries(rows.map((r) => [r.status, r]));
    const n = (s) => Number(by[s]?.n || 0);
    const sum = (field) => rows.filter((r) => r.status !== 'exempt').reduce((s, r) => s + Number(r[field] || 0), 0);
    return {
      charge: { id: charge.id, name: charge.name, color: charge.color },
      periodLabel: period.period_label,
      dueDate: rows.map((r) => r.due_date).sort()[0] ?? null,
      paid: n('paid'),
      partial: n('partial'),
      pending: n('pending'),
      exempt: n('exempt'),
      collected: sum('collected'),
      expected: sum('expected'),
      overdueMembers: Number(late.n || 0),
    };
  }

  /** % de asistencia por entrenamiento en los últimos 7 días (presentes / marcados). */
  async _attendance(clubId) {
    const [rows] = await pool.query(
      `SELECT t.id, t.name, t.color,
              SUM(ta.status = 'attended') AS attended, SUM(ta.status = 'absent') AS absent
       FROM trainings t
       LEFT JOIN training_attendances ta ON ta.training_id = t.id
         AND ta.session_date BETWEEN DATE_SUB(CURDATE(), INTERVAL 6 DAY) AND CURDATE()
       WHERE t.club_id = ? AND t.deleted_at IS NULL AND t.archived_at IS NULL AND t.status = 'active'
       GROUP BY t.id ORDER BY t.name ASC`,
      [clubId]
    );
    // Última sesión con asistencia marcada (hasta hoy) de cada entrenamiento, para las tarjetas.
    const ids = rows.map((r) => r.id);
    const [last] = ids.length
      ? await pool.query(
          `SELECT ta.training_id, ta.session_date, SUM(ta.status = 'attended') AS attended, SUM(ta.status IN ('attended', 'absent')) AS marked
           FROM training_attendances ta
           INNER JOIN (
             SELECT training_id, MAX(session_date) AS d FROM training_attendances
             WHERE training_id IN (?) AND session_date <= CURDATE() AND status IN ('attended', 'absent')
             GROUP BY training_id
           ) x ON x.training_id = ta.training_id AND x.d = ta.session_date
           GROUP BY ta.training_id, ta.session_date`,
          [ids]
        )
      : [[]];
    const lastById = new Map(last.map((l) => [l.training_id, l]));
    return {
      items: rows.map((r) => {
        const attended = Number(r.attended || 0);
        const marked = attended + Number(r.absent || 0);
        const l = lastById.get(r.id);
        const lastSession = l
          ? { date: l.session_date, pct: Number(l.marked) ? Math.round((Number(l.attended) / Number(l.marked)) * 100) : null }
          : null;
        return { trainingId: r.id, name: r.name, color: r.color, attended, marked, pct: marked ? Math.round((attended / marked) * 100) : null, lastSession };
      }),
    };
  }

  async _applications(clubId) {
    const [apps] = await pool.query(
      `SELECT a.id, a.fields, a.created_at, g.name AS group_name, g.color AS group_color
       FROM member_applications a LEFT JOIN member_groups g ON g.id = a.group_id
       WHERE a.club_id = ? AND a.status = 'pending' ORDER BY a.created_at ASC`,
      [clubId]
    );
    const [nameFields] = await pool.query("SELECT code, role FROM member_fields WHERE club_id = ? AND role IN ('first_name', 'last_name')", [clubId]);
    const code = (role) => nameFields.find((f) => f.role === role)?.code;
    return {
      items: apps.map((a) => {
        let data = a.fields;
        if (typeof data === 'string') {
          try {
            data = JSON.parse(data);
          } catch {
            data = {};
          }
        }
        const name = [data?.[code('first_name')], data?.[code('last_name')]].filter(Boolean).join(' ') || 'Sin nombre';
        return { id: a.id, name, groupName: a.group_name, groupColor: a.group_color, createdAt: a.created_at };
      }),
    };
  }

  // ------------------------------------------------------------------ diseño predeterminado por rol

  /** Diseño que el club dejó para alguno de los roles del usuario (el primero que tenga uno). */
  async defaultLayoutFor(clubId, userId) {
    const [roles] = await pool.query('SELECT role_id FROM user_roles WHERE club_id = ? AND user_id = ? ORDER BY role_id', [clubId, userId]);
    const settings = await settingsRepository.findAllByClub(clubId);
    for (const { role_id: roleId } of roles) {
      const raw = settings[DEFAULT_KEY_PREFIX + roleId];
      if (!raw) continue;
      try {
        return { roleId, layout: JSON.parse(raw) };
      } catch {
        // valor corrupto: se ignora
      }
    }
    return { roleId: null, layout: null };
  }

  /** Qué roles tienen diseño predeterminado (para la pantalla de edición). */
  async defaultsSummary(clubId) {
    const settings = await settingsRepository.findAllByClub(clubId);
    return Object.keys(settings)
      .filter((k) => k.startsWith(DEFAULT_KEY_PREFIX) && settings[k])
      .map((k) => Number(k.slice(DEFAULT_KEY_PREFIX.length)));
  }

  async setDefaultLayout(clubId, roleIds, layout) {
    const [valid] = roleIds.length ? await pool.query('SELECT id FROM roles WHERE club_id = ? AND id IN (?)', [clubId, roleIds]) : [[]];
    if (valid.length !== roleIds.length) throw AppError.badRequest('Algún rol no pertenece al club.');
    const value = layout ? JSON.stringify(layout) : '';
    if (value.length > 20000) throw AppError.badRequest('El diseño es demasiado grande.');
    await settingsRepository.upsertMany(clubId, Object.fromEntries(roleIds.map((id) => [DEFAULT_KEY_PREFIX + id, value])));
    return this.defaultsSummary(clubId);
  }
}

module.exports = new DashboardWidgetsService();

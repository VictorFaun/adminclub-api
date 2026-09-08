const paymentsRepository = require('../repositories/payments.repository');
const chargeInstancesRepository = require('../repositories/chargeInstances.repository');
const chargesRepository = require('../repositories/charges.repository');
const chargeSettlementsRepository = require('../repositories/chargeSettlements.repository');
const membersRepository = require('../repositories/members.repository');
const auditRepository = require('../repositories/audit.repository');
const membersService = require('./members.service');
const chargeInstancesService = require('./chargeInstances.service');
const permissionService = require('./permission.service');
const expensesRepository = require('../repositories/expenses.repository');
const expensePaymentsRepository = require('../repositories/expensePayments.repository');
const AppError = require('../helpers/AppError');
const { withTransaction } = require('../config/database');
const { FUNCTIONS, CHARGE_EXEMPT_TYPE } = require('../config/constants');

const MATRIX_MONTH_LABELS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
// Ventana centrada en el período actual (o en el `anchor` pedido) que muestra la matriz de
// "Pagos" — no todo el historial, para no armar una tabla gigante con un cobro muy antiguo; los
// botones "anterior/siguiente" recorren de a un período por clic (ver getChargeMatrix). El ANCHO
// de la ventana ahora lo decide el frontend según cuántas columnas entran sin scroll horizontal
// (ver `columns` en getChargeMatrix) — este es solo el valor por defecto si no manda ninguno.
const DEFAULT_WINDOW_SIZE = 12;
// Cuántos meses trae el gráfico "Ingresos a Tesorería" del dashboard (ver getDashboard).
const DASHBOARD_CHART_MONTHS = 6;
const MIN_WINDOW_SIZE = 1;
const MAX_WINDOW_SIZE = 18;

// Mismos helpers de fecha que chargeInstances.service.js (duplicados a propósito: son dos
// funciones de una línea, no vale la pena exportarlas solo para esto).
const pad = (n) => String(n).padStart(2, '0');
function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}
function clampDay(year, month, day) {
  return Math.min(day, daysInMonth(year, month));
}

class PaymentsService {
  toDto(payment, allocations = []) {
    return {
      id: payment.id,
      uuid: payment.uuid,
      clubId: payment.club_id,
      memberId: payment.member_id,
      // `null` = pago directo a Tesorería (sin intermediario) — cualquier otro valor debe ser
      // uno de los responsables configurados en el cobro al que pertenece este pago (ver
      // _validatePaidToMemberId en create()/update()).
      paidToMemberId: payment.paid_to_member_id,
      paidToMemberName: payment.paid_to_member_name ?? null,
      amount: Number(payment.amount),
      paidAt: payment.paid_at,
      note: payment.note,
      registeredBy: payment.registered_by,
      registeredByUsername: payment.registered_by_username ?? null,
      allocations: allocations.map((a) => ({
        id: a.id,
        chargeInstanceId: a.charge_instance_id,
        amount: Number(a.amount),
        periodLabel: a.period_label,
        dueDate: a.due_date,
        chargeName: a.charge_name,
        chargeColor: a.charge_color,
      })),
      createdAt: payment.created_at,
    };
  }

  /** Estado a mostrar en pantalla, distinto del `status` guardado en dos casos:
   * - `pending` cuya `due_date` ya pasó se muestra como "overdue" (rojo) sin que la fila cambie
   *   de valor — es un hecho temporal, se recalcula en cada lectura, no hay cron que la "venza".
   *   Ojo: solo `pending` puede volverse "overdue" — una `partial` (ya se abonó algo) NUNCA se
   *   muestra en rojo aunque su fecha haya pasado, mostrarla en rojo escondería que sí se pagó algo.
   * - `exempt` se abre en dos etiquetas según `exempt_type`: "exempt" (congelado) o
   *   "not_applicable" (no aplica) — mismo bloqueo de pago en ambos casos, ver create(). */
  _resolveDisplayStatus(row) {
    if (row.status === 'exempt') return row.exempt_type === CHARGE_EXEMPT_TYPE.NOT_APPLICABLE ? 'not_applicable' : 'exempt';
    if (row.status === 'pending' && new Date(row.due_date) < new Date()) return 'overdue';
    return row.status;
  }

  /** `responsibleInfo`: `{resolved: {memberId,memberName}|null, all: {memberId,memberName}[]}` —
   * `resolved` es el responsable RESUELTO (con prioridad de grupo) para el miembro dueño de esta
   * instancia puntual (ya no "el" responsable del cobro, ver
   * charges.repository.js#resolveResponsibles), usado para PRE-seleccionar "pagado a"; `all` son
   * TODOS los responsables configurados en el cobro, para las demás opciones del selector (el
   * usuario puede pagarle a cualquiera, no solo al sugerido — confirmado con el usuario). Lo arma
   * `listForMember`, una sola vez por cobro distinto entre las instancias del miembro, no acá
   * (este método no golpea la BD). */
  _instanceToDto(row, responsibleInfo = null) {
    return {
      id: row.id,
      uuid: row.uuid,
      chargeId: row.charge_id,
      chargeName: row.charge_name,
      chargeColor: row.charge_color,
      chargeRecurrence: row.charge_recurrence,
      chargePurpose: row.charge_purpose,
      chargeResponsibleMemberId: responsibleInfo?.resolved?.memberId ?? null,
      chargeResponsibleMemberName: responsibleInfo?.resolved?.memberName ?? null,
      chargeResponsibles: responsibleInfo?.all ?? [],
      periodLabel: row.period_label,
      amount: Number(row.amount),
      dueDate: row.due_date,
      status: row.status,
      displayStatus: this._resolveDisplayStatus(row),
      exemptReason: row.exempt_reason,
      exemptType: row.exempt_type,
    };
  }

  /** `full: true` = ve los pagos de todos los miembros del club (VIEW_PAYMENTS). Si no,
   * `memberIds` es la whitelist exacta (unión del scope de pagos de sus roles en este club) —
   * mismo patrón que members.service.js#_resolveAccess, tablas paralelas
   * (role_payment_scope/role_payment_group_scope). */
  async _resolveAccess(authContext, actorId, clubId) {
    if (permissionService.hasFunction(authContext, FUNCTIONS.VIEW_PAYMENTS)) return { full: true, memberIds: null };
    const memberIds = await paymentsRepository.findAccessibleMemberIds(actorId, clubId);
    return { full: false, memberIds };
  }

  _assertAccessible(access, memberId) {
    if (access.full) return;
    if (!access.memberIds.includes(memberId)) throw AppError.notFound('Miembro no encontrado.');
  }

  /** Envoltorio público de `_resolveAccess` — lo usa `members.controller.js` para marcar
   * `canViewPayments` por fila en `GET /members` sin duplicar la resolución del scope acá.
   * `members.service.js` NUNCA importa este archivo (evita un ciclo: este servicio ya depende
   * de `members.service.js` para revalidar visibilidad de perfil) — por eso el cálculo vive en
   * el controller, no en el service de Miembros. */
  async resolveAccessForController(authContext, actorId, clubId) {
    return this._resolveAccess(authContext, actorId, clubId);
  }

  /** Intersección completa de a quién puede ver el actor: scope de Miembros ∩ scope de Pagos —
   * la misma regla de `assertMemberPaymentsAccessible` pero para una LISTA de miembros de una
   * sola vez, en vez de validar uno por uno (usado por getChargeMatrix, que necesita filtrar
   * hasta decenas de filas). Devuelve `null` si no hay que filtrar nada (acceso completo en
   * ambos scopes); si no, la lista exacta de ids visibles. */
  async getVisibleMemberIds(authContext, actorId, clubId) {
    const [memberAccess, paymentAccess] = await Promise.all([
      membersService.resolveAccessForController(authContext, actorId, clubId),
      this._resolveAccess(authContext, actorId, clubId),
    ]);
    if (memberAccess.full && paymentAccess.full) return null;
    if (memberAccess.full) return paymentAccess.memberIds;
    if (paymentAccess.full) return memberAccess.memberIds;
    const paymentSet = new Set(paymentAccess.memberIds);
    return memberAccess.memberIds.filter((id) => paymentSet.has(id));
  }

  /** "Primer nombre + primer apellido" — usado SOLO en la matriz de pagos (columna de miembro,
   * espacio angosto) — mismo criterio que ya existe en audit.repository.js para su propia
   * variante corta. */
  _shortName(m) {
    return [m.first_name, m.last_name].filter(Boolean).join(' ');
  }

  /** El primer período en que el cobro REALMENTE corresponde, comparando fechas completas (no
   * solo el mes/año) — mismo criterio exacto que chargeInstances.service.js#_computePeriods usa
   * para decidir si generar una instancia (`dueDate >= startDate`). Ej: si el cobro inicia el 2
   * y vence el día 1 de cada mes, el mes de inicio NO cuenta (el vencimiento cae antes de que el
   * cobro existiera) — recién cuenta desde el siguiente. Si inicia el 1 y vence el 1, sí cuenta
   * ese mismo mes (el vencimiento cae justo en la fecha de inicio, no antes). */
  _firstApplicableMonthIndex(charge) {
    const startDate = new Date(charge.start_date);
    const startYear = startDate.getUTCFullYear();
    const startMonth = startDate.getUTCMonth() + 1;
    const startIndex = startYear * 12 + startMonth;
    const dueDateInStartMonth = new Date(Date.UTC(startYear, startMonth - 1, clampDay(startYear, startMonth, charge.due_day)));
    return dueDateInStartMonth >= startDate ? startIndex : startIndex + 1;
  }

  /** Simétrico a `_firstApplicableMonthIndex` pero para `end_date` — `null` si el cobro no tiene
   * fecha de término. */
  _lastApplicableMonthIndex(charge) {
    if (!charge.end_date) return null;
    const endDate = new Date(charge.end_date);
    const endYear = endDate.getUTCFullYear();
    const endMonth = endDate.getUTCMonth() + 1;
    const endIndex = endYear * 12 + endMonth;
    const dueDateInEndMonth = new Date(Date.UTC(endYear, endMonth - 1, clampDay(endYear, endMonth, charge.due_day)));
    return dueDateInEndMonth <= endDate ? endIndex : endIndex - 1;
  }

  /** Mismo criterio que `_firstApplicableMonthIndex`, para cobros anuales. */
  _firstApplicableYear(charge) {
    const startDate = new Date(charge.start_date);
    const startYear = startDate.getUTCFullYear();
    const dueDateInStartYear = new Date(Date.UTC(startYear, charge.due_month - 1, clampDay(startYear, charge.due_month, charge.due_day)));
    return dueDateInStartYear >= startDate ? startYear : startYear + 1;
  }

  _lastApplicableYear(charge) {
    if (!charge.end_date) return null;
    const endDate = new Date(charge.end_date);
    const endYear = endDate.getUTCFullYear();
    const dueDateInEndYear = new Date(Date.UTC(endYear, charge.due_month - 1, clampDay(endYear, charge.due_month, charge.due_day)));
    return dueDateInEndYear <= endDate ? endYear : endYear - 1;
  }

  /** Columnas de la matriz de un cobro, según su recurrencia — mismo formato de `period_label`
   * que chargeInstances.service.js#_computePeriods (`YYYY-MM`/`YYYY`/`'unico'`), así las celdas
   * calzan con las instancias ya generadas sin transformación. Ventana de tamaño fijo (12 meses
   * o 9 años). Sin `anchor`, se centra en el período ACTUAL (o se corre al primer período
   * aplicable si centrar dejaría columnas antes de que el cobro empezara a aplicar — ver
   * `_firstApplicableMonthIndex`). CON `anchor` (al usar los botones "anterior/siguiente"), este
   * YA ES el primer período de la ventana (no un centro) — el frontend lo arma tomando el primer
   * `period.key` de la respuesta anterior y sumando/restando un período, así cada clic mueve la
   * ventana exactamente 1 período, se vea o no clampeada — con `anchor` como "centro" (versión
   * anterior), un clic podía no mover nada visible si la ventana todavía estaba pegada al
   * clamp, obligando a apretar varias veces antes de que "se notara". `canGoBack`/`canGoForward`
   * le dicen al frontend si aún queda margen para deshabilitar los botones en el límite exacto.
   * Los períodos sin instancia generada quedan con celda `null` en getChargeMatrix (ahí se arma
   * una celda "virtual" pendiente/atrasada según la fecha, sin esperar a que el cron la cree). */
  /** Cuánto retrocede la ventana desde el período actual (el resto, `windowSize - 1 - back`,
   * queda adelante) — misma proporción que los valores fijos de antes (más adelante que atrás,
   * ej. 12 → 5/6) para que el período actual quede levemente a la izquierda del centro en vez de
   * exactamente al medio. */
  _windowBack(windowSize) {
    return Math.floor((windowSize - 1) / 2);
  }

  /** `windowSize` = cuántas columnas de período mostrar — la decide el frontend según cuántas
   * entran sin scroll horizontal en la pantalla actual (ver `columns` en getChargeMatrix); si no
   * llega, se usa `DEFAULT_WINDOW_SIZE`. Clampeada a [MIN_WINDOW_SIZE, MAX_WINDOW_SIZE]. */
  _matrixPeriods(charge, anchor, windowSize) {
    if (charge.recurrence === 'once') return { periods: [{ key: 'unico', label: 'Único' }], canGoBack: false, canGoForward: false };

    const size = Math.max(MIN_WINDOW_SIZE, Math.min(MAX_WINDOW_SIZE, windowSize || DEFAULT_WINDOW_SIZE));
    const back = this._windowBack(size);

    if (charge.recurrence === 'monthly') {
      const firstIndex = this._firstApplicableMonthIndex(charge);
      const lastIndex = this._lastApplicableMonthIndex(charge);

      const match = anchor ? /^(\d{4})-(\d{2})$/.exec(anchor) : null;
      let windowStart;
      if (match) {
        windowStart = Math.max(Number(match[1]) * 12 + Number(match[2]), firstIndex);
      } else {
        const now = new Date();
        const todayIndex = now.getUTCFullYear() * 12 + (now.getUTCMonth() + 1);
        windowStart = Math.max(todayIndex - back, firstIndex);
      }

      let windowEnd = windowStart + size - 1;
      if (lastIndex !== null) windowEnd = Math.min(windowEnd, lastIndex);
      if (windowEnd < windowStart) windowEnd = windowStart;

      const periods = [];
      for (let idx = windowStart; idx <= windowEnd; idx += 1) {
        const year = Math.floor((idx - 1) / 12);
        const month = idx - year * 12;
        periods.push({ key: `${year}-${pad(month)}`, label: `${MATRIX_MONTH_LABELS[month - 1]} ${year}` });
      }
      return { periods, canGoBack: windowStart > firstIndex, canGoForward: lastIndex === null || windowEnd < lastIndex };
    }

    // yearly
    const firstYear = this._firstApplicableYear(charge);
    const lastYear = this._lastApplicableYear(charge);
    let windowStart;
    if (anchor && /^\d{4}$/.test(anchor)) {
      windowStart = Math.max(Number(anchor), firstYear);
    } else {
      windowStart = Math.max(new Date().getUTCFullYear() - back, firstYear);
    }

    let windowEnd = windowStart + size - 1;
    if (lastYear !== null) windowEnd = Math.min(windowEnd, lastYear);
    if (windowEnd < windowStart) windowEnd = windowStart;

    const periods = [];
    for (let y = windowStart; y <= windowEnd; y += 1) periods.push({ key: String(y), label: String(y) });
    return { periods, canGoBack: windowStart > firstYear, canGoForward: lastYear === null || windowEnd < lastYear };
  }

  _matrixCellToDto(row, paidAmount) {
    return {
      id: row.id,
      periodLabel: row.period_label,
      amount: Number(row.amount),
      paidAmount: row.status === 'paid' ? Number(row.amount) : paidAmount,
      dueDate: row.due_date,
      status: row.status,
      displayStatus: this._resolveDisplayStatus(row),
      exemptReason: row.exempt_reason,
      exemptType: row.exempt_type,
    };
  }

  /** Misma fecha de vencimiento que calcularía la generación real (chargeInstances.service.js)
   * para este período puntual — se usa para las celdas "virtuales" de abajo. */
  _dueDateForPeriod(charge, periodKey) {
    if (charge.recurrence === 'once') return new Date(charge.start_date);
    if (charge.recurrence === 'monthly') {
      const [year, month] = periodKey.split('-').map(Number);
      return new Date(Date.UTC(year, month - 1, clampDay(year, month, charge.due_day)));
    }
    const year = Number(periodKey);
    return new Date(Date.UTC(year, charge.due_month - 1, clampDay(year, charge.due_month, charge.due_day)));
  }

  /** Celda "virtual" para un período aplicable que TODAVÍA no tiene `charge_instance` — pasa
   * esto normalmente si el cobro se creó con `start_date` en el pasado (el cron/la creación solo
   * generan el período actual + el siguiente, nunca retroactivo) o si un período futuro dentro
   * de la ventana mostrada simplemente no se ha generado aún. Se calcula igual que una instancia
   * real: vencida y sin pago → "overdue" (atrasado); si no, "pending" (en blanco). No se guarda
   * en la base — si el admin interactúa con la celda, ensureInstance recién ahí la crea. */
  _virtualCellToDto(charge, periodKey, amount) {
    const dueDate = this._dueDateForPeriod(charge, periodKey);
    const isOverdue = dueDate < new Date();
    return {
      id: null,
      periodLabel: periodKey,
      amount: Number(amount),
      paidAmount: 0,
      dueDate: dueDate.toISOString(),
      status: 'pending',
      displayStatus: isOverdue ? 'overdue' : 'pending',
      exemptReason: null,
      exemptType: null,
    };
  }

  /** Misma idea que `_virtualCellToDto` pero con la forma de `_instanceToDto` (incluye nombre y
   * color del cobro) — usado por `listForMember`/la ficha de pagos de un miembro, no por la
   * matriz. `responsibleInfo`: ver `_instanceToDto`. */
  _virtualInstanceToDto(charge, periodKey, amount, responsibleInfo = null) {
    const dueDate = this._dueDateForPeriod(charge, periodKey);
    const isOverdue = dueDate < new Date();
    return {
      id: null,
      uuid: null,
      chargeId: charge.id,
      chargeName: charge.name,
      chargeColor: charge.color,
      chargeRecurrence: charge.recurrence,
      chargePurpose: charge.purpose,
      chargeResponsibleMemberId: responsibleInfo?.resolved?.memberId ?? null,
      chargeResponsibleMemberName: responsibleInfo?.resolved?.memberName ?? null,
      chargeResponsibles: responsibleInfo?.all ?? [],
      periodLabel: periodKey,
      amount: Number(amount),
      dueDate: dueDate.toISOString(),
      status: 'pending',
      displayStatus: isOverdue ? 'overdue' : 'pending',
      exemptReason: null,
      exemptType: null,
    };
  }

  /** Rellena TODOS los huecos de la ficha de un miembro, no solo los de antes de la primera
   * instancia real — la generación automática solo crea "período actual + el siguiente" cada
   * vez que corre (al crear/editar el cobro, o el cron diario), así que si pasó tiempo sin que
   * nada disparara una corrida (el cron no alcanzó a correr, o el cobro se editó recién ahora
   * después de mucho) quedan meses sueltos SIN instancia real en el medio — ej. enero real (de
   * cuando se creó el cobro) y septiembre/octubre real (de una edición reciente), con
   * febrero-agosto invisibles en el medio. Se recorre cada índice de período entre el primer
   * período aplicable y el más reciente conocido (el mayor entre la última instancia real y HOY,
   * para que el mes actual nunca falte aunque la generación todavía no lo haya alcanzado),
   * saltando los que YA tienen una instancia real. Se sintetizan igual que las celdas virtuales
   * de la matriz (mismo cálculo de fecha de vencimiento) — mismo acotamiento razonable (36 meses
   * / 20 años desde el final del rango) por si un `start_date` quedó mal cargado hace mucho
   * tiempo, para no devolver cientos de filas. Un cobro `once` nunca tiene huecos (se genera
   * completo para todos los targets al crearse). `responsibleByCharge`: `Map<chargeId,
   * {resolved,all}>` ya armado por `listForMember` (una vez por cobro distinto) — ver
   * `_instanceToDto`. */
  async _computeMissingPastInstances(instanceRows, memberId, responsibleByCharge) {
    const byCharge = new Map();
    for (const row of instanceRows) {
      if (!byCharge.has(row.charge_id)) byCharge.set(row.charge_id, []);
      byCharge.get(row.charge_id).push(row.period_label);
    }

    const virtual = [];
    for (const [chargeId, periodLabels] of byCharge) {
      // eslint-disable-next-line no-await-in-loop
      const charge = await chargesRepository.findActiveById(chargeId);
      if (!charge || charge.recurrence === 'once') continue;
      // eslint-disable-next-line no-await-in-loop
      const amount = (await chargesRepository.resolveAmounts(chargeId, [memberId], charge.amount)).get(memberId);
      const responsibleInfo = responsibleByCharge.get(chargeId) ?? null;

      if (charge.recurrence === 'monthly') {
        const existing = new Set(
          periodLabels.map((k) => {
            const [y, m] = k.split('-').map(Number);
            return y * 12 + m;
          })
        );
        const firstApplicable = this._firstApplicableMonthIndex(charge);
        const lastApplicable = this._lastApplicableMonthIndex(charge);
        const now = new Date();
        const todayIndex = now.getUTCFullYear() * 12 + (now.getUTCMonth() + 1);
        let endIndex = Math.max(Math.max(...existing), firstApplicable, todayIndex);
        if (lastApplicable !== null) endIndex = Math.min(endIndex, lastApplicable);
        const startIndex = Math.max(firstApplicable, endIndex - 36);

        for (let idx = startIndex; idx <= endIndex; idx += 1) {
          if (existing.has(idx)) continue;
          const year = Math.floor((idx - 1) / 12);
          const month = idx - year * 12;
          virtual.push(this._virtualInstanceToDto(charge, `${year}-${pad(month)}`, amount, responsibleInfo));
        }
      } else {
        const existing = new Set(periodLabels.map(Number));
        const firstApplicable = this._firstApplicableYear(charge);
        const lastApplicable = this._lastApplicableYear(charge);
        const todayYear = new Date().getUTCFullYear();
        let endYear = Math.max(Math.max(...existing), firstApplicable, todayYear);
        if (lastApplicable !== null) endYear = Math.min(endYear, lastApplicable);
        const startYear = Math.max(firstApplicable, endYear - 20);

        for (let y = startYear; y <= endYear; y += 1) {
          if (existing.has(y)) continue;
          virtual.push(this._virtualInstanceToDto(charge, String(y), amount, responsibleInfo));
        }
      }
    }
    return virtual;
  }

  /** Cuánto le falta transferir a Tesorería CADA responsable del cobro, por período — `null` si
   * el cobro no tiene ningún responsable (no hay nada que "transferir": todo pago ya va directo).
   * Devuelve `{ [periodKey]: { [responsibleMemberId]: {memberId,memberName,owed,paid,remaining,
   * status,dueDate} } }` — desglosado por responsable porque, con varios por cobro, cada uno
   * junta y transfiere SU PROPIA plata de forma independiente (ver
   * api/sql/032_charge_responsibles.sql). El desglose completo es SIEMPRE sobre TODOS los
   * responsables del cobro, sin filtrar por el scope de quien consulta — `getChargeMatrix` recorta
   * esto después a solo la fila del propio actor si entró como responsable sin rol real (ver
   * `_filterSettlementsToResponsible`). Reusa el mismo set de 5 estados/colores que ya existe
   * para `charge_instances` (`pending`/`partial`/`paid`/`overdue`/`not_applicable`):
   * `not_applicable` cuando no hay nada que transferir ese período (`owed<=0`, ej. todos pagaron
   * directo a Tesorería). */
  async _computeSettlements(charge, periods) {
    const responsibles = await chargesRepository.getResponsibleMembers(charge.id);
    if (!responsibles.length) return null;
    const periodKeys = periods.map((p) => p.key);
    const [owedByPeriod, paidByPeriod] = await Promise.all([
      paymentsRepository.sumPaidToByChargeAndPeriods(charge.id, periodKeys),
      chargeSettlementsRepository.sumByChargeAndPeriods(charge.id, periodKeys),
    ]);

    const now = new Date();
    const result = {};
    for (const period of periods) {
      const dueDate = this._dueDateForPeriod(charge, period.key);
      const byResponsible = {};
      for (const r of responsibles) {
        const owed = owedByPeriod[period.key]?.[r.memberId] ?? 0;
        const paid = paidByPeriod[period.key]?.[r.memberId] ?? 0;
        const remaining = Math.max(0, owed - paid);
        let status;
        if (owed <= 0.005) status = 'not_applicable';
        else if (remaining <= 0.005) status = 'paid';
        else if (paid > 0.005) status = 'partial';
        else if (dueDate < now) status = 'overdue';
        else status = 'pending';
        byResponsible[r.memberId] = { memberId: r.memberId, memberName: r.memberName, owed, paid, remaining, status, dueDate: dueDate.toISOString() };
      }
      result[period.key] = byResponsible;
    }
    return result;
  }

  /** Recorta un desglose de `_computeSettlements` a la fila de UN solo responsable — usado por
   * `getChargeMatrix` cuando el actor entró como responsable sin rol real de Tesorería: solo debe
   * ver SU PROPIO saldo, no el del resto de responsables del mismo cobro. */
  _filterSettlementsToResponsible(settlements, memberId) {
    if (!settlements) return settlements;
    const result = {};
    for (const [period, byResponsible] of Object.entries(settlements)) {
      result[period] = byResponsible[memberId] ? { [memberId]: byResponsible[memberId] } : {};
    }
    return result;
  }

  /** Monto pendiente de transferir por UN responsable puntual en UN período — mismo cálculo que
   * `_computeSettlements` pero acotado a uno solo, usado al validar `createSettlement`/
   * `updateSettlement` sin tener que armar todo el desglose. */
  async _remainingSettlement(charge, responsibleMemberId, periodKey) {
    const [owedByPeriod, paidByPeriod] = await Promise.all([
      paymentsRepository.sumPaidToByChargeAndPeriods(charge.id, [periodKey]),
      chargeSettlementsRepository.sumByChargeAndPeriods(charge.id, [periodKey]),
    ]);
    const owed = owedByPeriod[periodKey]?.[responsibleMemberId] ?? 0;
    const paid = paidByPeriod[periodKey]?.[responsibleMemberId] ?? 0;
    return Math.max(0, owed - paid);
  }

  _settlementToDto(row) {
    return {
      id: row.id,
      uuid: row.uuid,
      chargeId: row.charge_id,
      responsibleMemberId: row.responsible_member_id,
      periodLabel: row.period_label,
      amount: Number(row.amount),
      transferredAt: row.transferred_at,
      note: row.note,
      registeredBy: row.registered_by,
      registeredByUsername: row.registered_by_username ?? null,
      createdAt: row.created_at,
    };
  }

  async _findChargeInClub(clubId, chargeId) {
    const charge = await chargesRepository.findActiveById(chargeId);
    if (!charge || charge.club_id !== clubId) throw AppError.notFound('Cobro no encontrado.');
    return charge;
  }

  /** Todas las transferencias registradas para UN responsable + UN período de un cobro — mismo
   * rol que `listForInstance` pero para settlements (editar/eliminar en el modal). */
  async listSettlements(clubId, chargeId, periodKey, responsibleMemberId, actorId, authContext) {
    const charge = await this._findChargeInClub(clubId, chargeId);
    await this._assertSettlementAccessible(charge, responsibleMemberId, actorId, authContext);
    const rows = await chargeSettlementsRepository.findByChargeResponsibleAndPeriod(chargeId, responsibleMemberId, periodKey);
    return rows.map((r) => this._settlementToDto(r));
  }

  /** Una transferencia corresponde SIEMPRE a UN período + UN responsable de UN cobro — completa
   * o parcial, mismo criterio que un pago de miembro (create() más arriba). `data.responsibleMemberId`
   * debe ser uno de los responsables YA configurados en el cobro (validado en
   * charges.validation.js/acá solo se resuelve el acceso). */
  async createSettlement(clubId, chargeId, data, actorId, authContext) {
    const charge = await this._findChargeInClub(clubId, chargeId);
    if (!(await chargesRepository.isAnyResponsible(chargeId, data.responsibleMemberId))) {
      throw AppError.badRequest('Ese responsable no está configurado en este cobro.');
    }
    await this._assertSettlementAccessible(charge, data.responsibleMemberId, actorId, authContext);
    if (data.amount <= 0) throw AppError.badRequest('El monto debe ser mayor a cero.');

    const remaining = await this._remainingSettlement(charge, data.responsibleMemberId, data.periodKey);
    if (data.amount > remaining + 0.005) {
      throw AppError.badRequest(`El monto excede lo pendiente de transferir ($${remaining.toFixed(2)}).`);
    }

    const id = await chargeSettlementsRepository.createSettlement({
      chargeId,
      responsibleMemberId: data.responsibleMemberId,
      periodLabel: data.periodKey,
      amount: data.amount,
      transferredAt: data.transferredAt || new Date(),
      note: data.note || null,
      registeredBy: actorId,
    });

    await auditRepository.logAction({
      userId: actorId,
      clubId,
      action: 'CHARGE_SETTLEMENT_CREATED',
      entityType: 'charge_settlement',
      entityId: id,
      changes: { chargeId, responsibleMemberId: data.responsibleMemberId, periodLabel: data.periodKey, amount: data.amount },
    });

    const created = await chargeSettlementsRepository.findActiveById(id);
    return this._settlementToDto(created);
  }

  /** Igual que payments.service.js#update: excluye la contribución ACTUAL de esta misma
   * transferencia de "lo ya transferido" al validar el nuevo monto (si no, nunca podría
   * subírsele el monto aunque sobre margen). */
  async updateSettlement(clubId, settlementId, data, actorId, authContext) {
    const settlement = await chargeSettlementsRepository.findActiveById(settlementId);
    if (!settlement) throw AppError.notFound('Transferencia no encontrada.');
    const charge = await this._findChargeInClub(clubId, settlement.charge_id);
    await this.assertMemberPaymentsAccessible(clubId, settlement.responsible_member_id, actorId, authContext);

    const updates = {};
    if (data.amount !== undefined) {
      if (data.amount <= 0) throw AppError.badRequest('El monto debe ser mayor a cero.');
      const remaining = await this._remainingSettlement(charge, settlement.responsible_member_id, settlement.period_label);
      const maxAllowed = remaining + Number(settlement.amount);
      if (data.amount > maxAllowed + 0.005) {
        throw AppError.badRequest(`El monto excede lo pendiente de transferir ($${maxAllowed.toFixed(2)}).`);
      }
      updates.amount = data.amount;
    }
    if (data.transferredAt !== undefined) updates.transferred_at = data.transferredAt;
    if (data.note !== undefined) updates.note = data.note || null;
    if (Object.keys(updates).length) await chargeSettlementsRepository.updateById(settlementId, updates);

    await auditRepository.logAction({
      userId: actorId,
      clubId,
      action: 'CHARGE_SETTLEMENT_UPDATED',
      entityType: 'charge_settlement',
      entityId: settlementId,
      changes: { amount: data.amount !== undefined ? { from: Number(settlement.amount), to: data.amount } : undefined },
    });

    const updated = await chargeSettlementsRepository.findActiveById(settlementId);
    return this._settlementToDto(updated);
  }

  async removeSettlement(clubId, settlementId, actorId, authContext) {
    const settlement = await chargeSettlementsRepository.findActiveById(settlementId);
    if (!settlement) throw AppError.notFound('Transferencia no encontrada.');
    await this._findChargeInClub(clubId, settlement.charge_id);
    await this.assertMemberPaymentsAccessible(clubId, settlement.responsible_member_id, actorId, authContext);

    await chargeSettlementsRepository.deleteById(settlementId);
    await auditRepository.logAction({
      userId: actorId,
      clubId,
      action: 'CHARGE_SETTLEMENT_DELETED',
      entityType: 'charge_settlement',
      entityId: settlementId,
      changes: { amount: Number(settlement.amount), periodLabel: settlement.period_label },
    });
  }

  /** Matriz miembro × período de UN cobro — la vista "quién debe qué mes" pedida para
   * complementar la ficha por miembro (que muestra "qué debe un miembro" en todos sus cobros).
   * Respeta el mismo acceso compuesto que el resto del módulo: solo aparecen filas de miembros
   * visibles tanto por Miembros como por Pagos (getVisibleMemberIds). */
  async getChargeMatrix(clubId, chargeId, { anchor, columns } = {}, actorId, authContext) {
    const charge = await chargesRepository.findActiveById(chargeId);
    if (!charge || charge.club_id !== clubId) throw AppError.notFound('Cobro no encontrado.');

    const chargeDto = {
      id: charge.id,
      name: charge.name,
      color: charge.color,
      recurrence: charge.recurrence,
      amount: Number(charge.amount),
      status: charge.status,
      purpose: charge.purpose,
      responsibles: (await chargesRepository.getResponsibleMembers(charge.id)).map((r) => ({
        memberId: r.memberId,
        memberName: r.memberName,
        groupId: r.groupId,
        groupName: r.groupName,
      })),
    };
    const { periods, canGoBack, canGoForward } = this._matrixPeriods(charge, anchor || null, columns || null);
    const rawSettlements = await this._computeSettlements(charge, periods);

    const { memberIds, scopedToMemberId } = await this._resolveChargeParticipants(charge, actorId, authContext);
    const settlements = scopedToMemberId ? this._filterSettlementsToResponsible(rawSettlements, scopedToMemberId) : rawSettlements;

    if (!memberIds.length) return { charge: chargeDto, periods, canGoBack, canGoForward, rows: [], settlements };

    const [members, instances, amounts, responsibleByMember] = await Promise.all([
      membersRepository.findNamesByIds(memberIds, clubId),
      chargeInstancesRepository.findForChargeAndMembers(chargeId, memberIds),
      chargesRepository.resolveAmounts(chargeId, memberIds, charge.amount),
      chargesRepository.resolveResponsibles(chargeId, memberIds),
    ]);
    const paidByInstance = await chargeInstancesRepository.sumAllocationsForInstances(instances.map((i) => i.id));

    const cellLookup = new Map();
    for (const inst of instances) {
      if (!cellLookup.has(inst.member_id)) cellLookup.set(inst.member_id, new Map());
      cellLookup.get(inst.member_id).set(inst.period_label, inst);
    }

    const rows = members
      .map((m) => ({
        memberId: m.id,
        memberName: this._shortName(m),
        // Responsable RESUELTO (con prioridad de grupo) para ESTE miembro puntual — ya no "el"
        // responsable del cobro, ver charges.repository.js#resolveResponsibles.
        responsibleMemberId: responsibleByMember.get(m.id)?.memberId ?? null,
        responsibleMemberName: responsibleByMember.get(m.id)?.memberName ?? null,
        // Usado por el filtro por grupo del frontend (treasury-payments.page.ts) — mismo criterio
        // de parseo de CSV que members.service.js#findOptions.
        groupIds: m.group_ids ? m.group_ids.split(',').map(Number) : [],
        cells: periods.reduce((acc, p) => {
          const inst = cellLookup.get(m.id)?.get(p.key);
          acc[p.key] = inst ? this._matrixCellToDto(inst, paidByInstance[inst.id] ?? 0) : this._virtualCellToDto(charge, p.key, amounts.get(m.id));
          return acc;
        }, {}),
      }))
      .sort((a, b) => a.memberName.localeCompare(b.memberName));

    return { charge: chargeDto, periods, canGoBack, canGoForward, rows, settlements };
  }

  /** ¿El actor es responsable de ALGO en este cobro (cualquier grupo, o "todos los grupos")? Gate
   * grueso de autorización — distingue "no tengo nada que ver acá" (403) de "soy responsable pero
   * hoy no me resuelve nadie" (lista vacía, ver `_resolveChargeParticipants`). La barrera FINA de
   * qué miembros puntuales corresponden a cada responsable la hace `resolveResponsibles`. */
  async _isResponsibleForCharge(charge, actorId) {
    const member = await membersRepository.findByUserId(actorId, charge.club_id);
    if (!member) return false;
    return chargesRepository.isAnyResponsible(charge.id, member.id);
  }

  /** A quién de los participantes de ESTE cobro puede ver el actor — dos caminos independientes,
   * cualquiera alcanza: (a) el camino normal (`getVisibleMemberIds`, intersección de scope de
   * Miembros y de Pagos) o (b) ser responsable de ESTE cobro, que da acceso SOLO a los miembros
   * cuyo responsable resuelto (con prioridad de grupo) sea justo el actor — ya no acceso total a
   * todo el cobro, cada responsable ve nada más que su propio grupo (o todos, si no tiene uno
   * asignado). Devuelve además `scopedToMemberId` (el `member.id` del actor si entró por (b),
   * `null` si entró por (a)) — lo usa `getChargeMatrix` para recortar el desglose de settlements
   * a solo la fila propia del actor. Sin ninguno de los dos caminos, 403 — a diferencia del resto
   * de la matriz (que ante un scope vacío simplemente muestra 0 filas), acá si ni siquiera es
   * responsable no debería haber llegado a este punto, así que es un error real. Si SÍ es
   * responsable pero hoy no resuelve para nadie (ej. su grupo quedó vacío), no es un error: se
   * devuelve una lista vacía, igual que el camino normal ante un scope vacío. */
  async _resolveChargeParticipants(charge, actorId, authContext) {
    const participantIds = await chargesRepository.expandTargetMemberIds(charge.id);
    if (permissionService.hasAnyFunction(authContext, [FUNCTIONS.VIEW_PAYMENTS, FUNCTIONS.VIEW_PAYMENTS_SCOPED])) {
      const visibleMemberIds = await this.getVisibleMemberIds(authContext, actorId, charge.club_id);
      const memberIds = visibleMemberIds === null ? participantIds : participantIds.filter((id) => visibleMemberIds.includes(id));
      return { memberIds, scopedToMemberId: null };
    }
    const member = await membersRepository.findByUserId(actorId, charge.club_id);
    if (!member || !(await chargesRepository.isAnyResponsible(charge.id, member.id))) {
      throw AppError.forbidden('No tienes permiso para ver este cobro.');
    }
    const resolved = await chargesRepository.resolveResponsibles(charge.id, participantIds);
    const memberIds = participantIds.filter((id) => resolved.get(id)?.memberId === member.id);
    return { memberIds, scopedToMemberId: member.id };
  }

  /** Camino combinado para crear/ver el pago de UN miembro puntual dentro de un cobro — además
   * del camino normal (`assertMemberPaymentsAccessible`), acepta ser el responsable RESUELTO
   * (con prioridad de grupo) para ESE miembro puntual, sin necesitar ningún scope de Miembros/
   * Pagos asignado — ya no "ser responsable de este cobro" a secas (acceso total), ahora acotado
   * a los miembros que de verdad le corresponden a este responsable. */
  async assertChargeMemberPaymentAccessible(charge, memberId, actorId, authContext) {
    const member = await membersRepository.findByUserId(actorId, charge.club_id);
    if (member) {
      const resolved = await chargesRepository.resolveResponsibles(charge.id, [memberId]);
      if (resolved.get(memberId)?.memberId === member.id) return;
    }
    await this.assertMemberPaymentsAccessible(charge.club_id, memberId, actorId, authContext);
  }

  /** Acceso a la transferencia (settlement) de UN responsable puntual — a diferencia de
   * `assertChargeMemberPaymentAccessible` (que resuelve "quién cobra la plata de un miembro que
   * PAGA"), acá `responsibleMemberId` NO es alguien que paga, es la persona a la que se refiere
   * el settlement — el bypass es de identidad directa (soy justo esa persona), no de resolución
   * por grupo. */
  async _assertSettlementAccessible(charge, responsibleMemberId, actorId, authContext) {
    const member = await membersRepository.findByUserId(actorId, charge.club_id);
    if (member && member.id === responsibleMemberId) return;
    await this.assertMemberPaymentsAccessible(charge.club_id, responsibleMemberId, actorId, authContext);
  }

  /** El acceso real a los pagos de un miembro exige DOS resoluciones independientes que deben
   * cumplirse AMBAS: que el miembro sea visible por el módulo Miembros (delegado a
   * `membersService.getById`, que además confirma que existe y pertenece al club — lanza 404 si
   * no) Y que sea visible por el scope de Tesorería acá. Ver el propio miembro sin poder ver
   * tesorería no alcanza, y viceversa. */
  async assertMemberPaymentsAccessible(clubId, memberId, actorId, authContext) {
    await membersService.getById(clubId, memberId, authContext, actorId);
    const access = await this._resolveAccess(authContext, actorId, clubId);
    this._assertAccessible(access, memberId);
    return access;
  }

  /** Una fila real de `charge_instances` puede quedar con un `period_label` que ya NO
   * corresponde a la recurrencia ACTUAL del cobro si esta se editó después de generarla bajo la
   * recurrencia anterior (ej. un cobro creado "único" con su instancia 'unico' ya generada, y
   * luego editado a "mensual" — esa fila vieja se queda con label 'unico' para siempre, la
   * generación nueva no la toca ni la borra). Se descarta acá antes de armar la ficha del
   * miembro por dos motivos: que no aparezca mezclada bajo la pestaña del cobro equivocado, y
   * que no rompa el relleno de huecos — un label con formato inesperado (ej. 'unico'.split('-')
   * → `NaN`) filtra hacia `Math.max(...existing)`, y `Math.max` con CUALQUIER `NaN` entre sus
   * argumentos devuelve `NaN` sin importar los demás, dejando `startIndex > endIndex` (ambos
   * `NaN`) y el bucle entero sin correr NUNCA — no solo ese período queda mal, se pierde el
   * relleno completo de ESE cobro. La matriz general no sufre esto (busca por clave de período
   * exacta, nunca "cae" en una fila con label inesperado). */
  _matchesCurrentRecurrence(row) {
    if (row.charge_recurrence === 'once') return row.period_label === 'unico';
    if (row.charge_recurrence === 'monthly') return /^\d{4}-\d{2}$/.test(row.period_label);
    return /^\d{4}$/.test(row.period_label);
  }

  async listForMember(clubId, memberId, actorId, authContext) {
    await this.assertMemberPaymentsAccessible(clubId, memberId, actorId, authContext);

    const [allInstanceRows, paymentRows] = await Promise.all([
      chargeInstancesRepository.findForMember(memberId),
      paymentsRepository.findByMember(memberId),
    ]);
    const instanceRows = allInstanceRows.filter((r) => this._matchesCurrentRecurrence(r));

    const payments = await Promise.all(
      paymentRows.map(async (p) => this.toDto(p, await paymentsRepository.getAllocations(p.id)))
    );

    // Responsable RESUELTO (con prioridad de grupo) para ESTE miembro + la lista completa de
    // responsables del cobro (para las demás opciones de "pagado a") — una vez por cada cobro
    // distinto entre sus instancias, ya no es "el" responsable único del cobro, ver
    // charges.repository.js#resolveResponsibles.
    const chargeIds = [...new Set(instanceRows.map((r) => r.charge_id))];
    const responsibleEntries = await Promise.all(
      chargeIds.map(async (chargeId) => {
        const [resolvedMap, all] = await Promise.all([
          chargesRepository.resolveResponsibles(chargeId, [memberId]),
          chargesRepository.getResponsibleMembers(chargeId),
        ]);
        return [chargeId, { resolved: resolvedMap.get(memberId) ?? null, all: all.map((r) => ({ memberId: r.memberId, memberName: r.memberName })) }];
      })
    );
    const responsibleByCharge = new Map(responsibleEntries);

    const virtualInstances = await this._computeMissingPastInstances(instanceRows, memberId, responsibleByCharge);
    const instances = [
      ...instanceRows.map((r) => this._instanceToDto(r, responsibleByCharge.get(r.charge_id) ?? null)),
      ...virtualInstances,
    ];
    this._demoteFuturePendingDuplicates(instances);
    instances.sort((a, b) => new Date(b.dueDate) - new Date(a.dueDate));

    return { instances, payments };
  }

  /** `chargeInstances.service.js#_computePeriods` genera deliberadamente el período ACTUAL y el
   * SIGUIENTE de una vez (para que el cron no tenga que correr justo el día del vencimiento) —
   * eso hacía que, mientras el período actual seguía sin vencer, el siguiente YA apareciera acá
   * también como "Pendiente", mostrando 2 pendientes simultáneos para el mismo cobro. Entre las
   * instancias `pending` de un mismo cobro, solo la de vencimiento más próximo se muestra como
   * "Pendiente" — el resto pasa a `displayStatus: 'upcoming'` ("Próximo"). En cuanto la más
   * próxima se paga o vence (deja de ser `pending`), la siguiente queda como la única `pending`
   * y se "promueve" sola, sin tocar nada de la generación ni el cron. */
  _demoteFuturePendingDuplicates(instances) {
    const earliestPendingByCharge = new Map();
    for (const inst of instances) {
      if (inst.displayStatus !== 'pending') continue;
      const current = earliestPendingByCharge.get(inst.chargeId);
      if (!current || new Date(inst.dueDate) < new Date(current.dueDate)) {
        earliestPendingByCharge.set(inst.chargeId, inst);
      }
    }
    for (const inst of instances) {
      if (inst.displayStatus === 'pending' && earliestPendingByCharge.get(inst.chargeId) !== inst) {
        inst.displayStatus = 'upcoming';
      }
    }
  }

  async getById(paymentId) {
    const payment = await paymentsRepository.findActiveById(paymentId);
    if (!payment) throw AppError.notFound('Pago no encontrado.');
    const allocations = await paymentsRepository.getAllocations(paymentId);
    return this.toDto(payment, allocations);
  }

  /** "A quién se le paga" — reglas distintas según `charge.purpose`: un cobro normal
   * ('treasury') admite Tesorería (`null`) o CUALQUIERA de los responsables configurados en el
   * cobro (no necesariamente el que le correspondería a este miembro por su grupo — confirmado
   * con el usuario: el resuelto por grupo es solo la sugerencia por defecto en el frontend, no
   * una validación estricta, porque a veces el dinero termina en manos de otro responsable
   * presente ese día); un cobro 'external' (ej. inscripción de un campeonato, ver
   * charges.service.js) SIEMPRE tiene al menos un responsable y NUNCA admite Tesorería como
   * destino — todo pago de un cobro externo debe quedar a nombre de alguno de sus responsables,
   * porque ese dinero nunca pasa por Tesorería. `responsibleIds`: ids de TODOS los responsables
   * configurados en el cobro (ver charges.repository.js#getResponsibleMembers). */
  _validatePaidToMemberId(charge, paidToMemberId, responsibleIds) {
    if (charge.purpose === 'external') {
      if (paidToMemberId === null || !responsibleIds.includes(paidToMemberId)) {
        throw AppError.badRequest('Este cobro es externo — el pago debe quedar a nombre de uno de sus responsables.');
      }
      return;
    }
    if (paidToMemberId !== null && !responsibleIds.includes(paidToMemberId)) {
      throw AppError.badRequest('El destinatario del pago no es válido para este cobro.');
    }
  }

  /** Un pago corresponde SIEMPRE a UN solo período — completo o abono. Ya no se pueden repartir
   * varios períodos/cobros en un mismo pago (antes `data.allocations` era un arreglo; ahora es
   * `chargeInstanceId` + `amount` directos). Un abono deja el período en `partial`, y se pueden
   * seguir registrando más pagos sobre esa misma instancia hasta cubrir el monto total — eso NO
   * cambió, sigue siendo `payment_allocations` con una fila por pago (queda en 1 fila siempre,
   * en vez de N), solo se sacó la posibilidad de mezclar varios períodos en un solo pago. */
  async create(clubId, data, actorId, authContext) {
    const instance = await chargeInstancesRepository.findActiveById(data.chargeInstanceId);
    if (!instance || instance.member_id !== data.memberId) {
      throw AppError.badRequest('El período indicado no corresponde a este miembro.');
    }
    const charge = await chargesRepository.findActiveById(instance.charge_id);
    if (!charge || charge.club_id !== clubId) throw AppError.notFound('Cobro no encontrado.');
    await this.assertChargeMemberPaymentAccessible(charge, data.memberId, actorId, authContext);

    if (instance.status === 'exempt') {
      throw AppError.conflict('No se puede registrar un pago sobre un período marcado como no corresponde.');
    }
    if (data.amount <= 0) throw AppError.badRequest('El monto debe ser mayor a cero.');

    const alreadyPaid = await chargeInstancesRepository.sumAllocations(instance.id);
    const remaining = Number(instance.amount) - alreadyPaid;
    if (data.amount > remaining + 0.005) {
      throw AppError.badRequest(`El monto excede el saldo pendiente de "${instance.period_label}" ($${remaining.toFixed(2)}).`);
    }

    // "A quién se le paga": alguno de los responsables del cobro (si tiene) o Tesorería (`null`,
    // pago directo) — no cualquier miembro, ver _validatePaidToMemberId.
    const paidToMemberId = data.paidToMemberId ?? null;
    const responsibleIds = (await chargesRepository.getResponsibleMembers(charge.id)).map((r) => r.memberId);
    this._validatePaidToMemberId(charge, paidToMemberId, responsibleIds);

    const paymentId = await withTransaction(async (conn) => {
      const id = await paymentsRepository.createPayment(
        {
          clubId,
          memberId: data.memberId,
          paidToMemberId,
          amount: data.amount,
          paidAt: data.paidAt || new Date(),
          note: data.note || null,
          registeredBy: actorId,
        },
        conn
      );
      await paymentsRepository.createAllocations(id, [{ chargeInstanceId: instance.id, amount: data.amount }], conn);
      await chargeInstancesRepository.recomputeStatus(instance.id, conn);
      return id;
    });

    await auditRepository.logAction({
      userId: actorId,
      clubId,
      action: 'PAYMENT_CREATED',
      entityType: 'payment',
      entityId: paymentId,
      changes: { memberId: data.memberId, amount: data.amount, periodLabel: instance.period_label },
    });

    return this.getById(paymentId);
  }

  /** Lista los pagos que tocan UN período — el modal de la matriz "Pagos" lo usa al hacer clic
   * en una celda `partial`/`paid`, para editarlos/eliminarlos (un período puede acumular varios
   * abonos). Mismo alcance que el resto: exige que el miembro dueño de la instancia sea visible. */
  async listForInstance(clubId, instanceId, actorId, authContext) {
    const { instance, charge } = await this._findInstanceInClub(clubId, instanceId);
    await this.assertChargeMemberPaymentAccessible(charge, instance.member_id, actorId, authContext);

    const rows = await paymentsRepository.findByInstance(instanceId);
    return Promise.all(rows.map(async (p) => this.toDto(p, await paymentsRepository.getAllocations(p.id))));
  }

  /** Edita monto/fecha/nota de un pago ya registrado — el monto sigue validado contra el saldo
   * pendiente del período, mismo criterio que create(), pero excluyendo la contribución ACTUAL
   * de este mismo pago de "lo ya pagado" (si no, un pago de $10.000 nunca podría subirse a
   * $12.000 aunque haya espacio, porque se contaría a sí mismo como parte de lo ya cubierto). */
  async update(clubId, paymentId, data, actorId, authContext) {
    const payment = await paymentsRepository.findActiveById(paymentId);
    if (!payment || payment.club_id !== clubId) throw AppError.notFound('Pago no encontrado.');
    await this.assertMemberPaymentsAccessible(clubId, payment.member_id, actorId, authContext);

    const allocations = await paymentsRepository.getAllocations(paymentId);
    const allocation = allocations[0];
    if (!allocation) throw AppError.notFound('Pago no encontrado.');

    let newAmount = Number(allocation.amount);
    if (data.amount !== undefined) {
      newAmount = data.amount;
      if (newAmount <= 0) throw AppError.badRequest('El monto debe ser mayor a cero.');

      const instance = await chargeInstancesRepository.findActiveById(allocation.charge_instance_id);
      const paidByOthers = (await chargeInstancesRepository.sumAllocations(instance.id)) - Number(allocation.amount);
      const remaining = Number(instance.amount) - paidByOthers;
      if (newAmount > remaining + 0.005) {
        throw AppError.badRequest(`El monto excede el saldo pendiente de "${instance.period_label}" ($${remaining.toFixed(2)}).`);
      }
    }

    // Mismo criterio que create(): solo un responsable del cobro o Tesorería (`null`) son
    // destinatarios válidos (y en un cobro externo, SOLO alguno de los responsables).
    if (data.paidToMemberId !== undefined) {
      const instance = await chargeInstancesRepository.findActiveById(allocation.charge_instance_id);
      const charge = await chargesRepository.findActiveById(instance.charge_id);
      const responsibleIds = (await chargesRepository.getResponsibleMembers(charge.id)).map((r) => r.memberId);
      this._validatePaidToMemberId(charge, data.paidToMemberId, responsibleIds);
    }

    await withTransaction(async (conn) => {
      const updates = {};
      if (data.amount !== undefined) updates.amount = newAmount;
      if (data.paidAt !== undefined) updates.paid_at = data.paidAt;
      if (data.note !== undefined) updates.note = data.note || null;
      if (data.paidToMemberId !== undefined) updates.paid_to_member_id = data.paidToMemberId;
      if (Object.keys(updates).length) await paymentsRepository.updateById(paymentId, updates, conn);
      if (data.amount !== undefined) {
        await paymentsRepository.updateAllocationAmount(allocation.id, newAmount, conn);
        await chargeInstancesRepository.recomputeStatus(allocation.charge_instance_id, conn);
      }
    });

    await auditRepository.logAction({
      userId: actorId,
      clubId,
      action: 'PAYMENT_UPDATED',
      entityType: 'payment',
      entityId: paymentId,
      changes: { amount: data.amount !== undefined ? { from: Number(payment.amount), to: newAmount } : undefined },
    });

    return this.getById(paymentId);
  }

  async remove(clubId, paymentId, actorId, authContext) {
    const payment = await paymentsRepository.findActiveById(paymentId);
    if (!payment || payment.club_id !== clubId) throw AppError.notFound('Pago no encontrado.');
    await this.assertMemberPaymentsAccessible(clubId, payment.member_id, actorId, authContext);

    const instanceIds = await paymentsRepository.getAllocatedInstanceIds(paymentId);
    await withTransaction(async (conn) => {
      await paymentsRepository.deletePayment(paymentId, conn);
      for (const instanceId of instanceIds) {
        // eslint-disable-next-line no-await-in-loop
        await chargeInstancesRepository.recomputeStatus(instanceId, conn);
      }
    });

    await auditRepository.logAction({
      userId: actorId,
      clubId,
      action: 'PAYMENT_DELETED',
      entityType: 'payment',
      entityId: paymentId,
      changes: { memberId: payment.member_id, amount: Number(payment.amount) },
    });
  }

  async _findInstanceInClub(clubId, instanceId) {
    const instance = await chargeInstancesRepository.findActiveById(instanceId);
    if (!instance) throw AppError.notFound('Período no encontrado.');
    const charge = await chargesRepository.findActiveById(instance.charge_id);
    if (!charge || charge.club_id !== clubId) throw AppError.notFound('Período no encontrado.');
    return { instance, charge };
  }

  /** Además de EXEMPT_PAYMENTS, deja pasar a quien es el responsable RESUELTO (con prioridad de
   * grupo) del miembro dueño de esta instancia — mismo bypass que ya tenía registrar un pago (ver
   * requireFunctionOrResponsibleCharge en la ruta), extendido acá por pedido explícito. */
  async exemptInstance(clubId, instanceId, reason, exemptType, actorId, authContext) {
    const { instance, charge } = await this._findInstanceInClub(clubId, instanceId);
    await this.assertChargeMemberPaymentAccessible(charge, instance.member_id, actorId, authContext);
    if (instance.status === 'paid' || instance.status === 'partial') {
      throw AppError.conflict('No se puede eximir un período con pagos registrados — elimina el pago primero.');
    }
    const resolvedType = exemptType === CHARGE_EXEMPT_TYPE.NOT_APPLICABLE ? CHARGE_EXEMPT_TYPE.NOT_APPLICABLE : CHARGE_EXEMPT_TYPE.FROZEN;
    await chargeInstancesRepository.markExempt(instanceId, reason, resolvedType, actorId);
    await auditRepository.logAction({
      userId: actorId,
      clubId,
      action: 'PAYMENT_INSTANCE_EXEMPTED',
      entityType: 'charge_instance',
      entityId: instanceId,
      changes: { reason: reason || null, type: resolvedType },
    });
  }

  /** Igual regla que `exemptInstance`, aplicada a varios períodos de una sola vez (pedido:
   * "congelar/marcar varias fechas a la vez", solo cobros mensuales desde el frontend). Los
   * períodos con pago ya registrado se saltan en vez de abortar todo el lote — el usuario
   * seleccionó varias filas, algunas mixtas no deberían bloquear las que sí son válidas. */
  async exemptMany(clubId, instanceIds, reason, exemptType, actorId, authContext) {
    const resolvedType = exemptType === CHARGE_EXEMPT_TYPE.NOT_APPLICABLE ? CHARGE_EXEMPT_TYPE.NOT_APPLICABLE : CHARGE_EXEMPT_TYPE.FROZEN;
    const applied = [];
    const skipped = [];

    await withTransaction(async (conn) => {
      for (const instanceId of instanceIds) {
        // eslint-disable-next-line no-await-in-loop
        const { instance, charge } = await this._findInstanceInClub(clubId, instanceId);
        // eslint-disable-next-line no-await-in-loop
        await this.assertChargeMemberPaymentAccessible(charge, instance.member_id, actorId, authContext);
        if (instance.status === 'paid' || instance.status === 'partial') {
          skipped.push(instanceId);
          continue;
        }
        // eslint-disable-next-line no-await-in-loop
        await chargeInstancesRepository.markExempt(instanceId, reason, resolvedType, actorId, conn);
        applied.push(instanceId);
      }
    });

    await Promise.all(
      applied.map((instanceId) =>
        auditRepository.logAction({
          userId: actorId,
          clubId,
          action: 'PAYMENT_INSTANCE_EXEMPTED',
          entityType: 'charge_instance',
          entityId: instanceId,
          changes: { reason: reason || null, type: resolvedType },
        })
      )
    );

    return { applied, skipped };
  }

  /** Crea (si no existe) la instancia de UN período puntual para UN miembro de este cobro —
   * disparado desde la matriz "Pagos" al interactuar con una celda vacía (registrar un pago o
   * eximir un período que el cron aún no generó). `memberId` debe ser un participante real del
   * cobro (targets directos + grupos - exclusiones), no cualquier miembro del club. */
  async ensureInstance(clubId, chargeId, memberId, periodKey, actorId, authContext) {
    const charge = await chargesRepository.findActiveById(chargeId);
    if (!charge || charge.club_id !== clubId) throw AppError.notFound('Cobro no encontrado.');

    await this.assertChargeMemberPaymentAccessible(charge, memberId, actorId, authContext);

    const participantIds = await chargesRepository.expandTargetMemberIds(chargeId);
    if (!participantIds.includes(memberId)) throw AppError.badRequest('Este miembro no participa de este cobro.');

    const instance = await chargeInstancesService.ensureInstance(chargeId, memberId, periodKey);
    if (!instance) throw AppError.badRequest('Período inválido para este cobro.');

    const paid = await chargeInstancesRepository.sumAllocations(instance.id);
    return this._matrixCellToDto(instance, paid);
  }

  /** Totales agregados, no detalle por miembro: la cantidad de cobros ACTIVOS es club-wide
   * (no depende del scope de pagos, es configuración — ver VIEW_CHARGES). El resto sí respeta el
   * scope de pagos del actor: sin VIEW_PAYMENTS ni VIEW_PAYMENTS_SCOPED, no se calcula (queda en
   * null) — VIEW_TREASURY_DASHBOARD por sí sola no debe filtrar montos reales de miembros que el
   * actor no puede ver.
   *
   * `treasuryTotal`: SALDO NETO de Tesorería (ingresos − gastos), histórico completo — pagos
   * directos más lo que los responsables ya transfirieron, MENOS lo pagado en gastos (ver
   * expensePaymentsRepository.sumAllTime). Un pago marcado "al responsable" todavía no cuenta acá
   * mientras no se registre su transferencia (antes sumaba igual que un pago directo, dando un
   * número que Tesorería nunca tuvo realmente en la mano). Si el actor no tiene VIEW_EXPENSES no
   * se resta nada — mostrar un neto a medias (ingresos completos menos gastos parciales que sí
   * puede ver) sería peor que mostrar el bruto: al menos el bruto es honesto sobre lo que es.
   * `incomeTotal`: BRUTO histórico (sin restar gastos) — directo + transferido por responsables.
   * `expensesTotal`: total histórico gastado, `null` si el actor no tiene VIEW_EXPENSES.
   * `pendingFromResponsibles`: cuánto queda AHORA MISMO en manos de responsables sin transferir,
   * sumado entre TODOS ellos.
   * `monthlyTreasury`: para el gráfico — `{month, income, expenses}` de los últimos
   * DASHBOARD_CHART_MONTHS meses (incluido el actual), mismo criterio de "qué es Tesorería" que
   * `treasuryTotal` pero agrupado por mes en vez de acumulado histórico. */
  async getDashboard(clubId, authContext, actorId) {
    const activeChargesCount = await chargesRepository.countActiveByClub(clubId);
    const hasExpenseAccess = permissionService.hasFunction(authContext, FUNCTIONS.VIEW_EXPENSES);
    const hasPaymentAccess = permissionService.hasAnyFunction(authContext, [FUNCTIONS.VIEW_PAYMENTS, FUNCTIONS.VIEW_PAYMENTS_SCOPED]);

    const activeExpensesCount = hasExpenseAccess ? await expensesRepository.countActiveByClub(clubId) : null;
    const [expensesTotal, expensesByMonth] = hasExpenseAccess
      ? await Promise.all([expensePaymentsRepository.sumAllTime(clubId), expensePaymentsRepository.sumAllTimeByMonth(clubId, DASHBOARD_CHART_MONTHS)])
      : [null, {}];

    let treasuryTotal = null;
    let incomeTotal = null;
    let overdueMembersCount = null;
    let pendingFromResponsibles = null;
    let incomeByMonth = null;

    if (hasPaymentAccess) {
      const access = await this._resolveAccess(authContext, actorId, clubId);
      const memberIds = access.full ? null : access.memberIds;
      // `settledToTreasury` (solo cobros purpose='treasury') alimenta el total de Tesorería;
      // `settledAllTime` (cualquier purpose) es lo que de verdad salió de manos del responsable,
      // usado para el saldo pendiente — un cobro `external` transfiere su plata "afuera" del
      // club, nunca a Tesorería, pero igual deja de estar "pendiente" en el responsable.
      const [directTotal, settledToTreasury, settledAllTime, overdue, heldByResponsibles, directByMonth, settledByMonth] = await Promise.all([
        paymentsRepository.sumDirectPayments(clubId, memberIds),
        chargeSettlementsRepository.sumAllTimeToTreasury(clubId, memberIds),
        chargeSettlementsRepository.sumAllTime(clubId, memberIds),
        chargeInstancesRepository.countOverdueMembers(clubId, memberIds),
        paymentsRepository.sumHeldByResponsibles(clubId, memberIds),
        paymentsRepository.sumDirectPaymentsByMonth(clubId, memberIds, DASHBOARD_CHART_MONTHS),
        chargeSettlementsRepository.sumToTreasuryByMonth(clubId, memberIds, DASHBOARD_CHART_MONTHS),
      ]);
      // Neto (ingresos − gastos) solo cuando el actor también ve Gastos — mostrar un neto a
      // medias (ingreso completo menos un gasto que en realidad no puede ver del todo) sería
      // peor que mostrar el bruto: al menos el bruto es honesto sobre lo que representa.
      incomeTotal = directTotal + settledToTreasury;
      treasuryTotal = incomeTotal - (hasExpenseAccess ? expensesTotal : 0);
      overdueMembersCount = overdue;
      pendingFromResponsibles = Math.max(0, heldByResponsibles - settledAllTime);
      incomeByMonth = this._sumMonthlyMaps(directByMonth, settledByMonth, DASHBOARD_CHART_MONTHS);
    }

    // El gráfico se arma si el actor ve AL MENOS una de las dos series — el lado sin acceso
    // queda en 0 en vez de ocultar el gráfico entero.
    const monthlyTreasury =
      hasPaymentAccess || hasExpenseAccess
        ? this._buildMonthlySeries(incomeByMonth ?? {}, expensesByMonth, DASHBOARD_CHART_MONTHS)
        : null;

    return { activeChargesCount, activeExpensesCount, treasuryTotal, incomeTotal, expensesTotal, overdueMembersCount, pendingFromResponsibles, monthlyTreasury };
  }

  /** Suma dos mapas `{ 'YYYY-MM': total }` en uno solo — usado para combinar pagos directos +
   * transferencias de responsables antes de armar la serie mensual del dashboard. */
  _sumMonthlyMaps(a, b, months) {
    const result = {};
    const now = new Date();
    for (let i = months - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      result[key] = (a[key] ?? 0) + (b[key] ?? 0);
    }
    return result;
  }

  /** Arma los últimos `months` meses (incluido el actual) en orden cronológico, combinando el
   * mapa de ingresos (`{ 'YYYY-MM': total }`, ya sumados pagos directos + transferencias, ver
   * `_sumMonthlyMaps`) con el de gastos — un mes sin ningún movimiento queda en 0 en vez de
   * faltar, así el gráfico del frontend siempre recibe exactamente `months` puntos. */
  _buildMonthlySeries(incomeByMonth, expensesByMonth, months) {
    const result = [];
    const now = new Date();
    for (let i = months - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      result.push({ month: key, income: incomeByMonth[key] ?? 0, expenses: expensesByMonth[key] ?? 0 });
    }
    return result;
  }

  async unexemptInstance(clubId, instanceId, actorId, authContext) {
    const { instance, charge } = await this._findInstanceInClub(clubId, instanceId);
    await this.assertChargeMemberPaymentAccessible(charge, instance.member_id, actorId, authContext);
    if (instance.status !== 'exempt') throw AppError.conflict('Este período no está marcado como no corresponde.');
    await chargeInstancesRepository.markUnexempt(instanceId);
    await auditRepository.logAction({
      userId: actorId,
      clubId,
      action: 'PAYMENT_INSTANCE_UNEXEMPTED',
      entityType: 'charge_instance',
      entityId: instanceId,
      changes: null,
    });
  }
}

module.exports = new PaymentsService();

const treasuryAccountsRepository = require('../repositories/treasuryAccounts.repository');
const auditRepository = require('../repositories/audit.repository');
const AppError = require('../helpers/AppError');
const { withTransaction } = require('../config/database');
const { DEFAULT_TREASURY_ACCOUNT_NAME, normalizeAccount, treasuryAccountToDto } = require('../helpers/paymentAccount');

const round = (n) => Math.round(n * 100) / 100;

/**
 * Cuentas de Tesorería del club (varias). Cada cobro con destino Tesorería pertenece a una de
 * ellas (`charges.treasury_account_id`); si el club tiene una sola, todos los cobros usan esa
 * aunque no la tengan elegida — ver `resolveForCharge`.
 *
 * Cada movimiento (pago directo, entrega de responsable, pago de gasto, transferencia) guarda la
 * cuenta en que se hizo, así el saldo de cada una sale de sumar sus movimientos (ver
 * treasuryAccounts.repository.js#balances). Una cuenta eliminada no se borra: se oculta
 * (`deleted_at`) y sus movimientos la siguen nombrando.
 */
class TreasuryAccountsService {
  /** Todo club tiene SIEMPRE al menos una cuenta: se crea con el club (clubs.service.js#create) y
   * la migración 048 la creó en los existentes; esto cubre clubes creados por otras vías (seeds). */
  async _ensureDefault(clubId) {
    const accounts = await treasuryAccountsRepository.findByClub(clubId);
    if (accounts.length) return accounts;
    const empty = { bankName: null, accountType: null, accountNumber: null, holderName: null, holderRut: null, email: null, notes: null };
    await treasuryAccountsRepository.create(clubId, { name: DEFAULT_TREASURY_ACCOUNT_NAME, ...empty });
    return treasuryAccountsRepository.findByClub(clubId);
  }

  async list(clubId) {
    return (await this._ensureDefault(clubId)).map(treasuryAccountToDto);
  }

  _toData(data) {
    const name = String(data.name ?? '').trim().slice(0, 100);
    if (!name) throw AppError.badRequest('El nombre de la cuenta es obligatorio.');
    const account = normalizeAccount(data) ?? {};
    return {
      name,
      bankName: account.bankName ?? null,
      accountType: account.accountType ?? null,
      accountNumber: account.accountNumber ?? null,
      holderName: account.holderName ?? null,
      holderRut: account.holderRut ?? null,
      email: account.email ?? null,
      notes: account.notes ?? null,
    };
  }

  async create(clubId, data, actorId) {
    const values = this._toData(data);
    const id = await treasuryAccountsRepository.create(clubId, values);
    await auditRepository.logAction({ userId: actorId, clubId, action: 'TREASURY_ACCOUNT_CREATED', entityType: 'treasury_account', entityId: id, changes: { name: values.name } });
    return treasuryAccountToDto(await treasuryAccountsRepository.findById(id));
  }

  async update(clubId, id, data, actorId) {
    const existing = await treasuryAccountsRepository.findInClub(clubId, id);
    if (!existing) throw AppError.notFound('Cuenta no encontrada.');
    const values = this._toData(data);
    await treasuryAccountsRepository.update(id, values);
    await auditRepository.logAction({ userId: actorId, clubId, action: 'TREASURY_ACCOUNT_UPDATED', entityType: 'treasury_account', entityId: id, changes: { name: values.name } });
    return treasuryAccountToDto(await treasuryAccountsRepository.findById(id));
  }

  // ------------------------------------------------------------------ saldos

  /**
   * Saldo de cada cuenta vigente + `unassigned` (movimientos sin cuenta: anteriores a las cuentas,
   * o hechos cuando el club no tenía ninguna) + `deleted` (saldo que quedó en cuentas eliminadas;
   * normalmente 0, porque se exige transferirlo antes de eliminar). `total` = suma de todo.
   */
  async balances(clubId) {
    const [accounts, map] = await Promise.all([this._ensureDefault(clubId), treasuryAccountsRepository.balances(clubId)]);
    const activeIds = new Set(accounts.map((a) => a.id));
    let deleted = 0;
    for (const [id, value] of map) if (id !== null && !activeIds.has(id)) deleted += value;
    const list = accounts.map((a) => ({ id: a.id, name: a.name, balance: round(map.get(a.id) ?? 0) }));
    const unassigned = round(map.get(null) ?? 0);
    const total = round([...map.values()].reduce((sum, v) => sum + v, 0));
    return { accounts: list, unassigned, deleted: round(deleted), total };
  }

  async balanceOf(clubId, accountId, conn) {
    const map = await treasuryAccountsRepository.balances(clubId, conn);
    return round(map.get(accountId) ?? 0);
  }

  // ------------------------------------------------------------------ transferencias

  /**
   * Traspasa dinero entre cuentas. `fromAccountId: null` = desde "sin cuenta asignada" (para
   * repartir el dinero registrado antes de tener cuentas). No se puede transferir más que el saldo
   * de la cuenta de origen.
   */
  async transfer(clubId, { fromAccountId, toAccountId, amount, transferredAt, note }, actorId, conn = null) {
    const from = fromAccountId == null ? null : Number(fromAccountId);
    const to = Number(toAccountId);
    const value = round(Number(amount));
    if (!Number.isFinite(value) || value <= 0) throw AppError.badRequest('El monto debe ser mayor a cero.');
    if (from === to) throw AppError.badRequest('La cuenta de origen y la de destino deben ser distintas.');
    if (!(await treasuryAccountsRepository.findInClub(clubId, to, conn ?? undefined))) throw AppError.badRequest('La cuenta de destino no es válida.');
    if (from !== null && !(await treasuryAccountsRepository.findInClub(clubId, from, conn ?? undefined))) throw AppError.badRequest('La cuenta de origen no es válida.');

    const available = await this.balanceOf(clubId, from, conn ?? undefined);
    if (value > available + 0.005) {
      throw AppError.badRequest(`El monto supera el saldo disponible en la cuenta de origen ($${Math.max(available, 0).toFixed(0)}).`);
    }

    const id = await treasuryAccountsRepository.createTransfer(
      {
        clubId,
        fromAccountId: from,
        toAccountId: to,
        amount: value,
        transferredAt: (transferredAt ? new Date(transferredAt) : new Date()).toISOString().slice(0, 10),
        note: note ? String(note).trim().slice(0, 255) || null : null,
        registeredBy: actorId,
      },
      conn ?? undefined
    );
    await auditRepository.logAction({
      userId: actorId,
      clubId,
      action: 'TREASURY_ACCOUNT_TRANSFER_CREATED',
      entityType: 'treasury_account_transfer',
      entityId: id,
      changes: { fromAccountId: from, toAccountId: to, amount: value },
    });
    return { id };
  }

  async listTransfers(clubId) {
    const rows = await treasuryAccountsRepository.listTransfers(clubId);
    return rows.map((r) => ({
      id: r.id,
      fromAccountId: r.from_account_id,
      fromName: r.from_account_id ? r.from_name : 'Sin cuenta asignada',
      fromDeleted: !!r.from_deleted_at,
      toAccountId: r.to_account_id,
      toName: r.to_name,
      toDeleted: !!r.to_deleted_at,
      amount: Number(r.amount),
      transferredAt: r.transferred_at,
      note: r.note,
      registeredByUsername: r.registered_by_username ?? null,
      createdAt: r.created_at,
    }));
  }

  // ------------------------------------------------------------------ eliminar

  /** Lo que conviene saber antes de eliminar: cobros que la usan y su saldo actual. */
  async usage(clubId, id) {
    const existing = await treasuryAccountsRepository.findInClub(clubId, id);
    if (!existing) throw AppError.notFound('Cuenta no encontrada.');
    const [charges, balance] = await Promise.all([treasuryAccountsRepository.countCharges(id), this.balanceOf(clubId, id)]);
    return { charges, balance };
  }

  /**
   * Elimina (oculta) una cuenta. Si tiene saldo, exige `transferToAccountId`: se transfiere TODO el
   * saldo a esa cuenta en la misma operación, así el dinero no se pierde. Si el saldo es negativo
   * (salió más de lo que entró), la transferencia va en sentido contrario para dejarla en 0.
   */
  async remove(clubId, id, { transferToAccountId } = {}, actorId) {
    const existing = await treasuryAccountsRepository.findInClub(clubId, id);
    if (!existing) throw AppError.notFound('Cuenta no encontrada.');
    if ((await treasuryAccountsRepository.findByClub(clubId)).length <= 1) {
      throw AppError.conflict('El club debe tener siempre al menos una cuenta de Tesorería. Crea otra antes de eliminar esta.');
    }

    await withTransaction(async (conn) => {
      const balance = await this.balanceOf(clubId, id, conn);
      if (Math.abs(balance) > 0.005) {
        if (transferToAccountId == null) {
          throw AppError.conflict(`La cuenta tiene un saldo de $${balance.toFixed(0)}. Transfiérelo a otra cuenta antes de eliminarla.`);
        }
        const target = Number(transferToAccountId);
        if (target === id) throw AppError.badRequest('Elige otra cuenta para transferir el saldo.');
        const note = `Traspaso de saldo al eliminar la cuenta "${existing.name}"`;
        if (balance > 0) {
          await this.transfer(clubId, { fromAccountId: id, toAccountId: target, amount: balance, note }, actorId, conn);
        } else {
          await this.transfer(clubId, { fromAccountId: target, toAccountId: id, amount: -balance, note }, actorId, conn);
        }
      }
      await treasuryAccountsRepository.softDelete(id, conn);
    });
    await auditRepository.logAction({ userId: actorId, clubId, action: 'TREASURY_ACCOUNT_DELETED', entityType: 'treasury_account', entityId: id, changes: { name: existing.name } });
  }

  // ------------------------------------------------------------------ uso desde otros módulos

  /**
   * Cuenta de Tesorería de un cobro: la elegida, o la única del club si no eligió ninguna. `null` =
   * sin cuenta (el club no cargó cuentas, o tiene varias y el cobro no eligió). `accounts` permite
   * pasar las del club ya cargadas para no consultarlas por cada cobro.
   */
  async resolveForCharge(charge, accounts = null) {
    const list = accounts ?? (await treasuryAccountsRepository.findByClub(charge.club_id));
    const row = (charge.treasury_account_id && list.find((a) => a.id === charge.treasury_account_id)) || (list.length === 1 ? list[0] : null);
    return treasuryAccountToDto(row);
  }

  /** Valida el `treasuryAccountId` de un cobro: debe ser del club; obligatorio si el club tiene 2+
   * cuentas y el dinero va a Tesorería. Devuelve el id a guardar (o `null`). */
  async assertValidForCharge(clubId, treasuryAccountId, purpose) {
    const accounts = await treasuryAccountsRepository.findByClub(clubId);
    if (purpose === 'external') return null;
    if (treasuryAccountId == null) {
      if (accounts.length > 1) throw AppError.badRequest('Elige a qué cuenta de Tesorería pertenece este cobro.');
      return null;
    }
    if (!accounts.some((a) => a.id === Number(treasuryAccountId))) throw AppError.badRequest('La cuenta de Tesorería indicada no pertenece a este club.');
    return Number(treasuryAccountId);
  }

  /** Cuenta de la que sale un pago de gasto: la indicada (debe ser del club), o la única del club.
   * Con 2+ cuentas es obligatoria; sin cuentas queda `null`. */
  async resolveForExpensePayment(clubId, treasuryAccountId) {
    const accounts = await this._ensureDefault(clubId);
    if (treasuryAccountId != null) {
      if (!accounts.some((a) => a.id === Number(treasuryAccountId))) throw AppError.badRequest('La cuenta de Tesorería indicada no es válida.');
      return Number(treasuryAccountId);
    }
    if (accounts.length > 1) throw AppError.badRequest('Elige de qué cuenta de Tesorería sale este pago.');
    return accounts[0]?.id ?? null;
  }

  /** `Map<id, {name, deleted}>` con TODAS las cuentas del club (incluidas eliminadas) para nombrar movimientos. */
  async namesByClub(clubId) {
    const rows = await treasuryAccountsRepository.findAllByClub(clubId);
    return new Map(rows.map((r) => [r.id, { name: r.name, deleted: !!r.deleted_at }]));
  }
}

module.exports = new TreasuryAccountsService();
